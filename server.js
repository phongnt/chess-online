const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game rooms: roomId -> { white, black, chess state handled client-side }
const rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('create-room', (playerName) => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      white: { id: socket.id, name: playerName },
      black: null,
      moves: [],
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.color = 'white';
    socket.emit('room-created', { roomId, color: 'white' });
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
    socket.data.color = 'black';

    socket.emit('room-joined', {
      roomId,
      color: 'black',
      opponentName: room.white.name,
      moves: room.moves,
    });

    // Notify white that opponent joined
    io.to(room.white.id).emit('opponent-joined', { opponentName: playerName });
    console.log(`${playerName} joined room ${roomId}`);
  });

  socket.on('move', (move) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    room.moves.push(move);
    socket.to(roomId).emit('move', move);
  });

  socket.on('chat', (message) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('chat', message);
  });

  socket.on('resign', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
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

    // Swap colors
    const oldWhite = room.white;
    room.white = { ...room.black, id: room.black.id };
    room.black = { ...oldWhite, id: oldWhite.id };
    room.moves = [];

    // Tell each player their new color
    io.to(room.white.id).emit('rematch-start', { color: 'white' });
    io.to(room.black.id).emit('rematch-start', { color: 'black' });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit('opponent-disconnected');
      const room = rooms.get(roomId);
      if (room) {
        // Remove player from room
        if (room.white?.id === socket.id) room.white = null;
        if (room.black?.id === socket.id) room.black = null;
        // Clean up empty rooms
        if (!room.white && !room.black) rooms.delete(roomId);
      }
    }
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  // Show LAN addresses
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
