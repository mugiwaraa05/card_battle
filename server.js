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

 // In your server.js file
socket.on('useSpecialMove', ({ roomId, playerId, specialMove }) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) {
        console.error(`Room ${roomId} not found or game not started`);
        return;
    }

    const player = room.gameState.players.find(p => p.socketId === playerId);
    const opponent = room.gameState.players.find(p => p.socketId !== playerId);

    if (!player || !opponent) {
        console.error('Player or opponent not found');
        return;
    }

    // Mark special move as used
    player.specialMoveUsed = true;

    let message = '';
    let extraTurn = false;
    let doubleDamage = false;

    // Handle each special move by name
    switch(specialMove.name) {
        case "Founder Dominance":
            opponent.health -= 40;
            message = `${player.name} uses Founder Dominance! Deals 40 damage to ${opponent.name}!`;
            break;
        case "I am Batman":
            opponent.health -= 25;
            message = `${player.name} uses I am Batman! Deals 25 damage to ${opponent.name}!`;
            break;
        case "Cat Attack":
            opponent.health -= 20;
            message = `${player.name} uses Cat Attack! Deals 20 damage to ${opponent.name}!`;
            break;
        case "Dictator":
            opponent.health -= 35;
            message = `${player.name} uses Dictator! Deals 35 damage to ${opponent.name}!`;
            break;
        case "Eggscalibur":
            opponent.health -= 30;
            message = `${player.name} uses Eggscalibur! Deals 30 damage to ${opponent.name}!`;
            break;
        case "Botman":
        case "Queen":
            extraTurn = true;
            message = `${player.name} uses ${specialMove.name}! Gets one additional turn!`;
            break;
        case "Artiste":
            player.health = Math.min(100, player.health + 40);
            message = `${player.name} uses Artiste! Heals 40 HP!`;
            break;
        case "Labubu Rage":
            opponent.health -= 40;
            message = `${player.name} uses Labubu Rage! Deals 40 damage to ${opponent.name}!`;
            break;
        case "Mr Helper":
            player.health = Math.min(100, player.health + 30);
            message = `${player.name} uses Mr Helper! Heals 30 HP!`;
            break;
        case "Mr Green":
            player.health = Math.min(100, player.health + 25);
            message = `${player.name} uses Mr Green! Heals 25 HP!`;
            break;
        case "Love Bomb":
            opponent.health -= 5;
            extraTurn = true;
            message = `${player.name} uses Love Bomb! Deals 5 damage to ${opponent.name} and gets an extra turn!`;
            break;
        case "The Clown":
            player.health -= 35;
            message = `${player.name} uses The Clown! Deals 35 damage to himself!`;
            break;
        case "Matrix Glitch":
            doubleDamage = true;
            message = `${player.name} uses Matrix Glitch! Next attack will deal double damage!`;
            break;
        case "Mr Shipper":
            player.health = Math.min(100, player.health + 20);
            opponent.health -= 20;
            message = `${player.name} uses Mr Shipper! +20 HP to himself and -20 HP to ${opponent.name}!`;
            break;
        case "Proofer Regen":
            player.health = Math.min(100, player.health + 40);
            message = `${player.name} uses Proofer Regen! +40 HP!`;
            break;
        case "The Don":
            opponent.health -= 30;
            player.health -= 10;
            message = `${player.name} uses The Don! Deals 30 damage to ${opponent.name} and 10 damage to himself!`;
            break;
        case "Mr Simp":
            const femaleCharacters = ["Uma", "Cocowaves", "Chixxey", "Pix"];
            if (femaleCharacters.includes(opponent.name)) {
                player.health -= 30;
                message = `${player.name} uses Mr Simp against ${opponent.name}! Deals 30 damage to himself!`;
            } else {
                opponent.health -= 10;
                message = `${player.name} uses Mr Simp! Deals 10 damage to ${opponent.name}!`;
            }
            break;
        default:
            message = `${player.name} uses ${specialMove.name}!`;
            console.warn(`Unknown special move: ${specialMove.name}`);
            break;
    }

    // Ensure health doesn't go below 0
    player.health = Math.max(0, player.health);
    opponent.health = Math.max(0, opponent.health);

    // Update game state
    if (extraTurn) {
        player.extraTurns = (player.extraTurns || 0) + 1;
    }
    if (doubleDamage) {
        player.nextAttackDoubled = true;
    }

    // Broadcast the result
    io.to(roomId).emit('specialMoveApplied', {
        playerId,
        message,
        playerHealth: player.health,
        opponentHealth: opponent.health,
        extraTurn,
        doubleDamage
    });

    // Check for game over
    if (player.health <= 0 || opponent.health <= 0) {
        const winner = player.health <= 0 ? opponent.socketId : player.socketId;
        io.to(roomId).emit('gameOver', { winner });
    } else if (!extraTurn) {
        // Switch turns if no extra turn was granted
        room.gameState.currentTurn = opponent.socketId;
        io.to(roomId).emit('gameStateUpdated', room.gameState);
    }
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
