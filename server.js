// server.js - Enhanced Version
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Create room
  socket.on('createRoom', (playerData) => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      players: [{ ...playerData, socketId: socket.id, ready: false }],
      gameState: null,
      currentTurn: null
    });
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  // Join room
  socket.on('joinRoom', ({ roomId, playerData }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('error', 'Room does not exist');
      return;
    }
    
    if (room.players.length >= 2) {
      socket.emit('error', 'Room is full');
      return;
    }
    
    room.players.push({ ...playerData, socketId: socket.id, ready: false });
    socket.join(roomId);
    
    // Notify both players
    io.to(roomId).emit('playerJoined', room.players);
    console.log(`Player ${socket.id} joined room ${roomId}`);
  });

  // Player ready
  socket.on('playerReady', ({ roomId, deck }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.ready = true;
      player.deck = deck;
    }

    // Check if both players are ready
    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      startGame(roomId);
    }
  });

  // Game actions
  socket.on('playCard', ({ roomId, cardIndex }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;

    // Validate it's the player's turn
    const currentPlayer = room.players.find(p => p.socketId === socket.id);
    if (room.gameState.currentTurn !== currentPlayer.socketId) {
      socket.emit('error', 'Not your turn');
      return;
    }

    // Broadcast the move to both players
    io.to(roomId).emit('cardPlayed', {
      playerId: socket.id,
      cardIndex
    });

    // Update game state and switch turns
    updateGameState(roomId, socket.id, cardIndex);
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Find and clean up rooms with this player
    for (const [roomId, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        // Notify other player
        const otherPlayer = room.players[1 - playerIndex];
        if (otherPlayer) {
          io.to(otherPlayer.socketId).emit('opponentDisconnected');
        }
        // Clean up room
        rooms.delete(roomId);
        break;
      }
    }
  });
});

function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Initialize game state
  room.gameState = {
    players: room.players.map(player => ({
      socketId: player.socketId,
      name: player.name,
      avatar: player.avatar,
      health: 100,
      deck: player.deck,
      specialMoveUsed: false
    })),
    currentTurn: room.players[0].socketId, // First player goes first
    gameOver: false
  };

  // Notify players game is starting
  io.to(roomId).emit('gameStarted', {
    players: room.gameState.players,
    currentTurn: room.gameState.currentTurn
  });
}

function updateGameState(roomId, playerId, cardIndex) {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return;

  // Update game state (simplified - you'll need to implement your game logic here)
  const currentPlayer = room.gameState.players.find(p => p.socketId === playerId);
  const opponent = room.gameState.players.find(p => p.socketId !== playerId);
  
  if (!currentPlayer || !opponent) return;

  // Apply card effects (simplified example)
  const card = currentPlayer.deck[cardIndex];
  if (card.type === 'attack') {
    opponent.health -= card.power;
  } else if (card.type === 'heal') {
    currentPlayer.health = Math.min(100, currentPlayer.health + card.power);
  }

  // Check for game over
  if (opponent.health <= 0) {
    room.gameState.gameOver = true;
    io.to(roomId).emit('gameOver', { winner: playerId });
    rooms.delete(roomId);
    return;
  }

  // Switch turns
  room.gameState.currentTurn = opponent.socketId;
  
  // Broadcast updated game state
  io.to(roomId).emit('gameStateUpdated', room.gameState);
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
