const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const INITIAL_TIME_MS = 10 * 60 * 1000; // 10 minutes

const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createTimers() {
  return {
    w: INITIAL_TIME_MS,
    b: INITIAL_TIME_MS,
    activeColor: 'w',
    lastTickAt: null, // set when game starts
    interval: null,
  };
}

function startClock(room) {
  room.timers.lastTickAt = Date.now();
  room.timers.activeColor = 'w';

  room.timers.interval = setInterval(() => {
    if (!room.timers.lastTickAt) return;
    const now = Date.now();
    const elapsed = now - room.timers.lastTickAt;
    room.timers.lastTickAt = now;
    const color = room.timers.activeColor;
    room.timers[color] = Math.max(0, room.timers[color] - elapsed);

    // Broadcast time every second
    io.to(room.roomId).emit('time-update', {
      w: Math.round(room.timers.w),
      b: Math.round(room.timers.b),
    });

    if (room.timers[color] <= 0) {
      clearInterval(room.timers.interval);
      room.timers.interval = null;
      const winner = color === 'w' ? 'b' : 'w';
      io.to(room.roomId).emit('flag-fall', { loser: color, winner });
    }
  }, 200);
}

function switchClock(room) {
  if (!room.timers.lastTickAt) return;
  const now = Date.now();
  const elapsed = now - room.timers.lastTickAt;
  const color = room.timers.activeColor;
  room.timers[color] = Math.max(0, room.timers[color] - elapsed);
  room.timers.activeColor = color === 'w' ? 'b' : 'w';
  room.timers.lastTickAt = now;
}

function stopClock(room) {
  if (room.timers.interval) {
    clearInterval(room.timers.interval);
    room.timers.interval = null;
  }
  room.timers.lastTickAt = null;
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('create-room', (playerName) => {
    const roomId = generateRoomId();
    const room = {
      roomId,
      white: { id: socket.id, name: playerName },
      black: null,
      moves: [],
      timers: createTimers(),
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = 'w';
    socket.emit('room-created', { roomId, color: 'w' });
    console.log(`Room ${roomId} created by ${playerName}`);
  });

  socket.on('join-room', ({ roomId, playerName }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error-msg', 'Room not found');
      return;
    }
    if (room.black) {
      socket.emit('error-msg', 'Room is full');
      return;
    }
    room.black = { id: socket.id, name: playerName };
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = 'b';

    socket.emit('room-joined', {
      roomId,
      color: 'b',
      opponentName: room.white.name,
      moves: room.moves,
      timers: { w: room.timers.w, b: room.timers.b },
    });

    io.to(room.white.id).emit('opponent-joined', { opponentName: playerName });

    // Start the clock
    startClock(room);
    console.log(`${playerName} joined room ${roomId}`);
  });

  socket.on('move', (move) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    room.moves.push(move);
    switchClock(room);
    socket.to(roomId).emit('move', move);

    // Send updated times immediately after move
    io.to(roomId).emit('time-update', {
      w: Math.round(room.timers.w),
      b: Math.round(room.timers.b),
    });
  });

  socket.on('game-over', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (room) stopClock(room);
  });

  socket.on('chat', (message) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('chat', message);
  });

  socket.on('resign', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!roomId) return;
    if (room) stopClock(room);
    socket.to(roomId).emit('opponent-resigned');
  });

  socket.on('offer-rematch', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('rematch-offered');
  });

  socket.on('accept-rematch', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    stopClock(room);

    // Swap colors
    const oldWhite = room.white;
    const oldBlack = room.black;
    room.white = { id: oldBlack.id, name: oldBlack.name };
    room.black = { id: oldWhite.id, name: oldWhite.name };
    room.moves = [];
    room.timers = createTimers();

    // Update socket data
    const whiteSocket = io.sockets.sockets.get(room.white.id);
    const blackSocket = io.sockets.sockets.get(room.black.id);
    if (whiteSocket) whiteSocket.data.color = 'w';
    if (blackSocket) blackSocket.data.color = 'b';

    io.to(room.white.id).emit('rematch-start', { color: 'w' });
    io.to(room.black.id).emit('rematch-start', { color: 'b' });

    startClock(room);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit('opponent-disconnected');
      const room = rooms.get(roomId);
      if (room) {
        stopClock(room);
        if (room.white?.id === socket.id) room.white = null;
        if (room.black?.id === socket.id) room.black = null;
        if (!room.white && !room.black) rooms.delete(roomId);
      }
    }
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  console.log(`\n  Chess server running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  LAN:     http://${net.address}:${PORT}`);
      }
    }
  }
  console.log();
});
