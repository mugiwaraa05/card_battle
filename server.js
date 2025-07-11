const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: '*' } });
const { v4: uuidv4 } = require('uuid');

const rooms = {};

function applyCardEffects(card, user, target, room) {
  if (card.type === "attack" || card.name === "Egg") {
    let damage = card.power;
    if (user.nextAttackDoubled) {
      damage *= 2;
      user.nextAttackDoubled = false;
    }
    if (target.shieldActive) {
      damage = Math.max(1, Math.floor(damage / 2));
      target.shieldActive = false;
    }
    target.health -= damage;
    if (target.health < 0) target.health = 0;
  } else if (card.type === "heal") {
    user.health += card.power;
    if (user.health > 100) user.health = 100;
  } else if (card.name === "Shield") {
    user.shieldActive = true;
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, avatar, deck, specialMove }) => {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    rooms[roomId] = {
      players: [{
        socketId: socket.id,
        name,
        avatar,
        health: 100,
        deck,
        deckSize: deck.length,
        deckInitial: [...deck],
        specialMove,
        specialMoveUsed: false,
        shieldActive: false,
        nextAttackDoubled: false,
        extraTurns: 0
      }],
      currentTurn: socket.id
    };
    socket.join(roomId);
    socket.emit('roomCreated', { roomId });
  });

  socket.on('joinRoom', ({ roomId, playerData }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error', 'Room is full');
      return;
    }
    room.players.push({
      socketId: socket.id,
      name: playerData.name,
      avatar: playerData.avatar,
      health: 100,
      deck: playerData.deck,
      deckSize: playerData.deck.length,
      deckInitial: [...playerData.deck],
      specialMove: playerData.specialMove,
      specialMoveUsed: false,
      shieldActive: false,
      nextAttackDoubled: false,
      extraTurns: 0
    });
    socket.join(roomId);
    io.to(roomId).emit('playerJoined', { players: room.players, roomId });
  });

  socket.on('playerReady', ({ roomId, deck, specialMove }) => {
    const room = rooms[roomId];
    if (!room || room.players.length < 2) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.deck = deck;
      player.deckSize = deck.length;
      player.deckInitial = [...deck];
      player.specialMove = specialMove;
    }
    if (room.players.every(p => p.deck && p.specialMove)) {
      io.to(roomId).emit('gameStarted', {
        players: room.players.map(p => ({
          socketId: p.socketId,
          name: p.name,
          avatar: p.avatar,
          health: p.health,
          deckSize: p.deckSize,
          specialMove: { name: p.specialMove.name, description: p.specialMove.description },
          specialMoveUsed: p.specialMoveUsed,
          shieldActive: p.shieldActive,
          nextAttackDoubled: p.nextAttackDoubled,
          extraTurns: p.extraTurns
        })),
        currentTurn: room.currentTurn,
        roomId
      });
    }
  });

  socket.on('playCard', ({ roomId, cardIndex, card, newCard }) => {
    console.log('playCard received:', { roomId, cardIndex, card, newCard }); // Debug log
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', 'Room not found');
      console.error('Room not found:', roomId);
      return;
    }
    const player = room.players.find(p => p.socketId === socket.id);
    const opponent = room.players.find(p => p.socketId !== socket.id);
    if (!player || !opponent || room.currentTurn !== socket.id) {
      socket.emit('error', 'Invalid move');
      console.error('Invalid move:', { player: !!player, opponent: !!opponent, currentTurn: room.currentTurn, socketId: socket.id });
      return;
    }

    applyCardEffects(card, player, opponent, room);
    player.deck.splice(cardIndex, 1);
    if (player.deck.length < 5 && newCard) {
      player.deck.push(newCard);
      player.deckSize = player.deck.length;
    } else {
      player.deckSize = player.deck.length;
    }

    io.to(opponent.socketId).emit('cardPlayed', { playerId: socket.id, cardIndex, card });

    if (player.health <= 0 || opponent.health <= 0) {
      const winner = player.health <= 0 && opponent.health <= 0 ? null :
                     player.health > 0 ? player.socketId : opponent.socketId;
      io.to(roomId).emit('gameOver', { winner });
      console.log('Game over:', { winner, playerHealth: player.health, opponentHealth: opponent.health });
      return;
    }

    room.currentTurn = player.extraTurns > 0 ? socket.id : opponent.socketId;
    if (player.extraTurns > 0) player.extraTurns--;

    io.to(roomId).emit('gameStateUpdated', {
      players: [
        {
          socketId: player.socketId,
          name: player.name,
          health: player.health,
          deckSize: player.deck.length,
          specialMoveUsed: player.specialMoveUsed,
          shieldActive: player.shieldActive,
          nextAttackDoubled: player.nextAttackDoubled,
          extraTurns: player.extraTurns
        },
        {
          socketId: opponent.socketId,
          name: opponent.name,
          health: opponent.health,
          deckSize: opponent.deck.length,
          specialMoveUsed: opponent.specialMoveUsed,
          shieldActive: opponent.shieldActive,
          nextAttackDoubled: opponent.nextAttackDoubled,
          extraTurns: opponent.extraTurns
        }
      ],
      currentTurn: room.currentTurn,
      roomId
    });
    console.log('gameStateUpdated emitted:', {
      players: [
        { socketId: player.socketId, health: player.health, deckSize: player.deck.length },
        { socketId: opponent.socketId, health: opponent.health, deckSize: opponent.deck.length }
      ],
      currentTurn: room.currentTurn,
      roomId
    });
  });

  socket.on('useSpecialMove', ({ roomId, playerId, message, playerHealth, opponentHealth, playerName, opponentName, specialMoveName, extraTurn, doubleDamage }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    const opponent = room.players.find(p => p.socketId !== socket.id);
    if (!player || !opponent) return;

    player.health = playerHealth;
    opponent.health = opponentHealth;
    player.specialMoveUsed = true;
    if (doubleDamage) player.nextAttackDoubled = true;

    io.to(roomId).emit('specialMoveApplied', {
      playerId: socket.id,
      message,
      playerHealth,
      opponentHealth,
      extraTurn,
      doubleDamage
    });

    if (player.health <= 0 || opponent.health <= 0) {
      const winner = player.health <= 0 && opponent.health <= 0 ? null :
                     player.health > 0 ? player.socketId : opponent.socketId;
      io.to(roomId).emit('gameOver', { winner });
    } else {
      room.currentTurn = extraTurn ? socket.id : opponent.socketId;
      io.to(roomId).emit('gameStateUpdated', {
        players: [
          {
            socketId: player.socketId,
            name: player.name,
            health: player.health,
            deckSize: player.deck.length,
            specialMoveUsed: player.specialMoveUsed,
            shieldActive: player.shieldActive,
            nextAttackDoubled: player.nextAttackDoubled,
            extraTurns: player.extraTurns
          },
          {
            socketId: opponent.socketId,
            name: opponent.name,
            health: opponent.health,
            deckSize: opponent.deck.length,
            specialMoveUsed: opponent.specialMoveUsed,
            shieldActive: opponent.shieldActive,
            nextAttackDoubled: opponent.nextAttackDoubled,
            extraTurns: opponent.extraTurns
          }
        ],
        currentTurn: room.currentTurn,
        roomId
      });
    }
  });

  socket.on('requestRestart', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    const opponent = room.players.find(p => p.socketId !== socket.id);
    if (!opponent) return;

    player.restartRequested = true;
    io.to(opponent.socketId).emit('restartRequested', { playerId: socket.id, playerName: player.name });

    if (room.players.every(p => p.restartRequested)) {
      room.players.forEach(p => {
        p.health = 100;
        p.deck = [...p.deckInitial];
        p.deckSize = p.deck.length;
        p.specialMoveUsed = false;
        p.shieldActive = false;
        p.nextAttackDoubled = false;
        p.extraTurns = 0;
        p.restartRequested = false;
      });
      room.currentTurn = room.players[Math.floor(Math.random() * 2)].socketId;
      io.to(roomId).emit('gameStarted', {
        players: room.players.map(p => ({
          socketId: p.socketId,
          name: p.name,
          avatar: p.avatar,
          health: p.health,
          deckSize: p.deckSize,
          specialMove: { name: p.specialMove.name, description: p.specialMove.description },
          specialMoveUsed: p.specialMoveUsed,
          shieldActive: p.shieldActive,
          nextAttackDoubled: p.nextAttackDoubled,
          extraTurns: p.extraTurns
        })),
        currentTurn: room.currentTurn,
        roomId
      });
    }
  });

  socket.on('leaveRoom', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const remainingPlayers = room.players.filter(p => p.socketId !== socket.id);
    if (remainingPlayers.length > 0) {
      io.to(remainingPlayers[0].socketId).emit('opponentDisconnected');
    }
    delete rooms[roomId];
    socket.leave(roomId);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const remainingPlayers = room.players.filter(p => p.socketId !== socket.id);
        if (remainingPlayers.length > 0) {
          io.to(remainingPlayers[0].socketId).emit('opponentDisconnected');
        }
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
