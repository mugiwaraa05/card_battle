const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();

// Connection
io.on('connection', (socket) => {
  console.log('📡 New connection:', socket.id);

  // Create room
  socket.on('createRoom', (playerData) => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      players: [{ ...playerData, socketId: socket.id, ready: false }],
      gameState: null,
      currentTurn: null
    });
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, isHost: true });
    console.log(`🟢 Room ${roomId} created by ${socket.id}`);
  });

  // Join room
  socket.on('joinRoom', ({ roomId, playerData }) => {
    const room = rooms.get(roomId);

    if (!room) {
      console.warn(`❌ Room ${roomId} not found`);
      socket.emit('error', 'Room does not exist');
      return;
    }

    if (room.players.length >= 2) {
      console.warn(`❌ Room ${roomId} is full`);
      socket.emit('error', 'Room is full');
      return;
    }

    room.players.push({ ...playerData, socketId: socket.id, ready: false });
    socket.join(roomId);

    console.log(`🟡 Player ${playerData.name} (${socket.id}) joined room ${roomId}`);
    console.log(`👥 Players in room ${roomId}:`, room.players.map(p => p.name));

    io.to(roomId).emit('playerJoined', {
      players: room.players,
      roomId
    });
  });

  socket.on('playerReady', ({ roomId, deck, specialMove }) => {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.find(p => p.socketId === socket.id);
  if (player) {
    player.ready = true;
    player.deck = deck;
    player.specialMove = specialMove;  // ✅ properly assign it

    console.log(`✅ Player ${player.name} is ready in room ${roomId}`);

    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      startGame(roomId);
    }
  }
});

  // Play card
  socket.on('playCard', ({ roomId, cardIndex }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;

    const currentPlayer = room.gameState.players.find(p => p.socketId === socket.id);
    if (!currentPlayer || room.gameState.currentTurn !== socket.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    io.to(roomId).emit('cardPlayed', {
      playerId: socket.id,
      cardIndex
    });

    updateGameState(roomId, socket.id, cardIndex);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('🔌 Disconnected:', socket.id);
    for (const [roomId, room] of rooms.entries()) {
      const index = room.players.findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        const other = room.players.find(p => p.socketId !== socket.id);
        if (other) {
          io.to(other.socketId).emit('opponentDisconnected');
        }
        rooms.delete(roomId);
        console.log(`🧹 Cleaned up room ${roomId}`);
        break;
      }
    }
  });
});

// Helper: Start game
function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.gameState = {
    players: room.players.map(player => ({
      socketId: player.socketId,
      name: player.name,
      avatar: player.avatar,
      health: 100,
      deck: player.deck,
      specialMove: player.specialMove,
      specialMoveUsed: false
    })),
    currentTurn: room.players[0].socketId,
    gameOver: false
  };

  console.log(`🚀 Game started in room ${roomId}`);

  io.to(roomId).emit('gameStarted', {
    players: room.gameState.players,
    currentTurn: room.gameState.currentTurn
  });
}

// Helper: Update game state
function updateGameState(roomId, playerId, cardIndex) {
  const room = rooms.get(roomId);
  if (!room || !room.gameState) return;

  const currentPlayer = room.gameState.players.find(p => p.socketId === playerId);
  const opponent = room.gameState.players.find(p => p.socketId !== playerId);
  if (!currentPlayer || !opponent) return;

  const card = currentPlayer.deck[cardIndex];
  if (!card) return;

  if (card.type === 'attack') {
    opponent.health -= card.power;
  } else if (card.type === 'heal') {
    currentPlayer.health = Math.min(100, currentPlayer.health + card.power);
  }

  if (opponent.health <= 0) {
    room.gameState.gameOver = true;
    io.to(roomId).emit('gameOver', { winner: playerId });
    rooms.delete(roomId);
    console.log(`🏁 Game over in room ${roomId}`);
    return;
  }

  room.gameState.currentTurn = opponent.socketId;
  io.to(roomId).emit('gameStateUpdated', room.gameState);
}

// Room ID generator
function generateRoomId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
