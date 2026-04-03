const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_TIME_MS = 10 * 60 * 1000;
const INCREMENT_MS = 3000;

const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createTimers(timeMs) {
  return {
    w: timeMs,
    b: timeMs,
    activeColor: 'w',
    lastTickAt: null,
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
  room.timers[color] = Math.max(0, room.timers[color] - elapsed) + INCREMENT_MS;
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

function tryStartGame(room) {
  if (!room.colorPicks.w || !room.colorPicks.b) return;

  room.phase = 'playing';
  room.timers = createTimers(room.timeMs);

  // Map color picks to player info
  room.white = room.colorPicks.w;
  room.black = room.colorPicks.b;

  const whiteSocket = io.sockets.sockets.get(room.white.id);
  const blackSocket = io.sockets.sockets.get(room.black.id);
  if (whiteSocket) whiteSocket.data.color = 'w';
  if (blackSocket) blackSocket.data.color = 'b';

  io.to(room.white.id).emit('game-start', {
    color: 'w',
    opponentName: room.black.name,
    timeMs: room.timeMs,
  });
  io.to(room.black.id).emit('game-start', {
    color: 'b',
    opponentName: room.white.name,
    timeMs: room.timeMs,
  });

  startClock(room);
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('create-room', (playerName) => {
    const roomId = generateRoomId();
    const room = {
      roomId,
      phase: 'waiting', // waiting -> picking -> playing
      players: [{ id: socket.id, name: playerName }],
      white: null,
      black: null,
      colorPicks: { w: null, b: null },
      timeMs: DEFAULT_TIME_MS,
      moves: [],
      timers: createTimers(DEFAULT_TIME_MS),
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit('room-created', { roomId });
    console.log(`Room ${roomId} created by ${playerName}`);
  });

  socket.on('join-room', ({ roomId, playerName }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error-msg', 'Room not found');
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error-msg', 'Room is full');
      return;
    }

    room.players.push({ id: socket.id, name: playerName });
    socket.join(roomId);
    socket.data.roomId = roomId;
    room.phase = 'picking';

    // Send both players to the color pick screen
    io.to(room.roomId).emit('enter-pick-phase', {
      players: room.players.map(p => p.name),
      timeMs: room.timeMs,
    });

    console.log(`${playerName} joined room ${roomId}`);
  });

  socket.on('pick-color', (color) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'picking') return;
    if (color !== 'w' && color !== 'b') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Check if this player already picked
    if (room.colorPicks.w?.id === socket.id || room.colorPicks.b?.id === socket.id) return;

    // Check if color is already taken
    if (room.colorPicks[color]) {
      socket.emit('color-taken', color);
      return;
    }

    room.colorPicks[color] = player;

    // Notify both players about the pick
    io.to(room.roomId).emit('color-picked', {
      color,
      playerName: player.name,
      playerId: socket.id,
    });

    // If one player picked, auto-assign the other
    const otherPlayer = room.players.find(p => p.id !== socket.id);
    const otherColor = color === 'w' ? 'b' : 'w';
    if (otherPlayer && !room.colorPicks[otherColor]) {
      // Check if the other player hasn't picked yet
      if (room.colorPicks.w?.id !== otherPlayer.id && room.colorPicks.b?.id !== otherPlayer.id) {
        room.colorPicks[otherColor] = otherPlayer;
        io.to(room.roomId).emit('color-picked', {
          color: otherColor,
          playerName: otherPlayer.name,
          playerId: otherPlayer.id,
        });
      }
    }

    tryStartGame(room);
  });

  socket.on('set-time', (timeMs) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'picking') return;

    const validTimes = [60000, 180000, 300000, 600000, 900000, 1800000];
    if (!validTimes.includes(timeMs)) return;

    room.timeMs = timeMs;
    socket.to(roomId).emit('time-changed', timeMs);
  });

  socket.on('move', (move) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    room.moves.push(move);
    switchClock(room);
    socket.to(roomId).emit('move', move);

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

    // Reset to picking phase
    room.phase = 'picking';
    room.colorPicks = { w: null, b: null };
    room.white = null;
    room.black = null;
    room.moves = [];

    io.to(room.roomId).emit('enter-pick-phase', {
      players: room.players.map(p => p.name),
      timeMs: room.timeMs,
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit('opponent-disconnected');
      const room = rooms.get(roomId);
      if (room) {
        stopClock(room);
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) rooms.delete(roomId);
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
