// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (update in production)
  }
});

const rooms = new Map(); // Stores active game rooms

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Create a new game room
  socket.on('createRoom', (playerData) => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      players: [{ ...playerData, socketId: socket.id }],
      gameState: null
    });
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
  });

  // Join existing room
  socket.on('joinRoom', ({ roomId, playerData }) => {
    const room = rooms.get(roomId);
    if (room && room.players.length < 2) {
      room.players.push({ ...playerData, socketId: socket.id });
      socket.join(roomId);
      io.to(roomId).emit('playerJoined', room.players);
    } else {
      socket.emit('error', 'Room full or invalid');
    }
  });

  // Handle game moves
  socket.on('playCard', ({ roomId, cardIndex }) => {
    io.to(roomId).emit('cardPlayed', cardIndex);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});