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

// Improved room management
class GameRoom {
  constructor(roomId, hostPlayer) {
    this.id = roomId;
    this.players = [hostPlayer];
    this.gameState = null;
    this.currentTurn = null;
    this.createdAt = Date.now();
  }

  addPlayer(player) {
    if (this.players.length >= 2) return false;
    this.players.push(player);
    return true;
  }

  startGame() {
    this.gameState = {
      players: this.players.map(player => ({
        ...player,
        health: 100,
        specialMoveUsed: false,
        shieldActive: false
      })),
      currentTurn: this.players[0].socketId,
      gameOver: false
    };
    return this.gameState;
  }
}

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Create room with validation
  socket.on('createRoom', (playerData) => {
    try {
      const roomId = generateRoomId();
      const room = new GameRoom(roomId, {
        ...playerData,
        socketId: socket.id,
        ready: false
      });
      
      rooms.set(roomId, room);
      socket.join(roomId);
      
      socket.emit('roomCreated', { 
        roomId,
        isHost: true
      });
      
      console.log(`Room ${roomId} created by ${socket.id}`);
    } catch (err) {
      console.error('Create room error:', err);
      socket.emit('error', 'Failed to create room');
    }
  });

  // Join room with full validation
  socket.on('joinRoom', ({ roomId, playerData }) => {
  try {
    console.log(`🟡 Received joinRoom: ${roomId}`);
    const room = rooms.get(roomId);

    if (!room) {
      console.warn(`❌ Room ${roomId} does not exist`);
      socket.emit('error', 'Room does not exist');
      return;
    }

    if (room.players.length >= 2) {
      console.warn(`❌ Room ${roomId} is full`);
      socket.emit('error', 'Room is full');
      return;
    }

    const player = {
      ...playerData,
      socketId: socket.id,
      ready: false
    };

    const added = room.addPlayer(player);
    if (!added) {
      console.error(`❌ Failed to add player to room ${roomId}`);
      socket.emit('error', 'Failed to join room');
      return;
    }

    socket.join(roomId);
    console.log(`✅ Player joined room ${roomId}:`, player.name);

    console.log(`📦 Room players now:`, room.players.map(p => p.name));

    // EMIT playerJoined
    io.to(roomId).emit('playerJoined', {
      players: room.players,
      roomId
    });

    console.log(`📤 Emitted playerJoined to room ${roomId}`);

  } catch (err) {
    console.error('❌ joinRoom error:', err.message);
    socket.emit('error', err.message);
  }
});

  // Player ready with deck validation
  socket.on('playerReady', ({ roomId, deck }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) throw new Error('Room not found');
      
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) throw new Error('Player not in room');
      
      if (!deck || deck.length !== 5) {
        throw new Error('Invalid deck size');
      }
      
      player.ready = true;
      player.deck = deck;
      
      // Check if both players are ready
      if (room.players.length === 2 && room.players.every(p => p.ready)) {
        const gameState = room.startGame();
        io.to(roomId).emit('gameStarted', {
          players: gameState.players,
          currentTurn: gameState.currentTurn
        });
        console.log(`Game started in room ${roomId}`);
      }
    } catch (err) {
      console.error('Player ready error:', err.message);
      socket.emit('error', err.message);
    }
  });

  // Game actions with full validation
  socket.on('playCard', ({ roomId, cardIndex }) => {
    try {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) {
        throw new Error('Game not found');
      }
      
      const currentPlayer = room.gameState.players.find(p => p.socketId === socket.id);
      if (!currentPlayer) {
        throw new Error('Player not in game');
      }
      
      if (room.gameState.currentTurn !== socket.id) {
        throw new Error('Not your turn');
      }
      
      if (cardIndex < 0 || cardIndex >= currentPlayer.deck.length) {
        throw new Error('Invalid card');
      }
      
      const card = currentPlayer.deck[cardIndex];
      
      // Broadcast the move
      io.to(roomId).emit('cardPlayed', {
        playerId: socket.id,
        cardIndex,
        cardType: card.type
      });
      
      // Process game logic
      processGameAction(room, socket.id, cardIndex);
      
    } catch (err) {
      console.error('Play card error:', err.message);
      socket.emit('error', err.message);
    }
  });

  // Special move handling
  socket.on('useSpecialMove', ({ roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room || !room.gameState) throw new Error('Game not found');
      
      const player = room.gameState.players.find(p => p.socketId === socket.id);
      if (!player) throw new Error('Player not found');
      
      if (room.gameState.currentTurn !== socket.id) {
        throw new Error('Not your turn');
      }
      
      if (player.specialMoveUsed) {
        throw new Error('Special move already used');
      }
      
      player.specialMoveUsed = true;
      
      io.to(roomId).emit('specialMoveUsed', {
        playerId: socket.id,
        moveName: player.specialMove.name
      });
      
      // Process special move effects
      processSpecialMove(room, socket.id);
      
    } catch (err) {
      console.error('Special move error:', err.message);
      socket.emit('error', err.message);
    }
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    cleanupPlayer(socket.id);
  });
});

// Game logic functions
function processGameAction(room, playerId, cardIndex) {
  const currentPlayer = room.gameState.players.find(p => p.socketId === playerId);
  const opponent = room.gameState.players.find(p => p.socketId !== playerId);
  const card = currentPlayer.deck[cardIndex];
  
  // Apply card effects
  switch (card.type) {
    case 'attack':
      let damage = card.power;
      if (opponent.shieldActive) {
        damage = Math.floor(damage / 2);
        opponent.shieldActive = false;
      }
      opponent.health -= damage;
      break;
      
    case 'heal':
      currentPlayer.health = Math.min(100, currentPlayer.health + card.power);
      break;
      
    case 'shield':
      currentPlayer.shieldActive = true;
      break;
  }
  
  // Check for game over
  if (opponent.health <= 0) {
    room.gameState.gameOver = true;
    io.to(room.id).emit('gameOver', { 
      winner: playerId,
      winnerName: currentPlayer.name
    });
    rooms.delete(room.id);
    return;
  }
  
  // Switch turns (handle extra turns)
  if (!currentPlayer.extraTurns || currentPlayer.extraTurns <= 0) {
    room.gameState.currentTurn = opponent.socketId;
  } else {
    currentPlayer.extraTurns--;
  }
  
  // Broadcast updated state
  io.to(room.id).emit('gameStateUpdated', room.gameState);
}

function processSpecialMove(room, playerId) {
  const player = room.gameState.players.find(p => p.socketId === playerId);
  const opponent = room.gameState.players.find(p => p.socketId !== playerId);
  
  // Apply special move effects
  const move = player.specialMove;
  const result = move.effect(player, opponent);
  
  // Broadcast move result
  io.to(room.id).emit('specialMoveResult', {
    playerId,
    message: result
  });
  
  // Check for game over
  if (player.health <= 0 || opponent.health <= 0) {
    room.gameState.gameOver = true;
    const winner = player.health <= 0 ? opponent.socketId : playerId;
    io.to(room.id).emit('gameOver', { 
      winner,
      winnerName: winner === playerId ? player.name : opponent.name
    });
    rooms.delete(room.id);
    return;
  }
  
  // Update game state
  io.to(room.id).emit('gameStateUpdated', room.gameState);
}

function cleanupPlayer(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    const playerIndex = room.players.findIndex(p => p.socketId === socketId);
    if (playerIndex !== -1) {
      const otherPlayer = room.players[1 - playerIndex];
      if (otherPlayer) {
        io.to(otherPlayer.socketId).emit('opponentDisconnected');
      }
      rooms.delete(roomId);
      console.log(`Cleaned up room ${roomId}`);
      break;
    }
  }
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Cleanup old rooms periodically
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes
  
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.createdAt > timeout) {
      rooms.delete(roomId);
      console.log(`Cleaned up inactive room ${roomId}`);
    }
  }
}, 60 * 1000); // Check every minute

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
