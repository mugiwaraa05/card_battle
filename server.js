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

     io.on('connection', (socket) => {
       console.log('📡 New connection:', socket.id);

       socket.on('createRoom', (playerData) => {
         if (!playerData || !playerData.name || !playerData.avatar || !playerData.deck || !playerData.deck.length || !playerData.specialMove || !playerData.specialMove.name || !playerData.specialMove.description) {
           socket.emit('error', 'Invalid player data for room creation');
           console.error('Invalid createRoom data:', playerData);
           return;
         }
         const roomId = generateRoomId();
         rooms.set(roomId, {
           players: [{
             socketId: socket.id,
             name: playerData.name,
             avatar: playerData.avatar,
             deck: playerData.deck,
             deckInitial: [...playerData.deck],
             specialMove: playerData.specialMove,
             health: 100,
             specialMoveUsed: false,
             deckSize: playerData.deck.length,
             extraTurns: 0,
             shieldActive: false,
             nextAttackDoubled: false,
             ready: false,
             restartRequested: false
           }],
           gameState: null,
           currentTurn: null
         });
         socket.join(roomId);
         socket.emit('roomCreated', { roomId, isHost: true });
         console.log(`🟢 Room ${roomId} created by ${socket.id}`);
       });

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
         if (!playerData || !playerData.name || !playerData.avatar || !playerData.deck || !playerData.deck.length || !playerData.specialMove || !playerData.specialMove.name || !playerData.specialMove.description) {
           socket.emit('error', 'Invalid player data for joining room');
           console.error('Invalid joinRoom data:', playerData);
           return;
         }
         room.players.push({
           socketId: socket.id,
           name: playerData.name,
           avatar: playerData.avatar,
           deck: playerData.deck,
           deckInitial: [...playerData.deck],
           specialMove: playerData.specialMove,
           health: 100,
           specialMoveUsed: false,
           deckSize: playerData.deck.length,
           extraTurns: 0,
           shieldActive: false,
           nextAttackDoubled: false,
           ready: false,
           restartRequested: false
         });
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
         if (!room) {
           socket.emit('error', 'Room does not exist');
           console.error(`Room ${roomId} not found for playerReady by ${socket.id}`);
           return;
         }
         if (!deck || !Array.isArray(deck) || deck.length !== 5 || !specialMove || !specialMove.name || !specialMove.description) {
           socket.emit('error', 'Invalid deck or special move data');
           console.error('Invalid playerReady data:', { deck, specialMove });
           return;
         }
         const player = room.players.find(p => p.socketId === socket.id);
         if (!player) {
           socket.emit('error', 'Player not found in room');
           console.error(`Player ${socket.id} not found in room ${roomId}`);
           return;
         }
         player.ready = true;
         player.deck = deck;
         player.deckInitial = [...deck];
         player.specialMove = specialMove;
         console.log(`✅ Player ${player.name} is ready in room ${roomId}`);
         if (room.players.length === 2 && room.players.every(p => p.ready)) {
           startGame(roomId);
         }
       });

       socket.on('playCard', ({ roomId, cardIndex }) => {
         const room = rooms.get(roomId);
         if (!room || !room.gameState) {
           socket.emit('error', 'Room does not exist or game not started');
           console.error(`Room ${roomId} not found or no gameState for playCard by ${socket.id}`);
           return;
         }
         if (room.gameState.currentTurn !== socket.id) {
           socket.emit('error', 'Not your turn');
           console.error(`Not ${socket.id}'s turn in room ${roomId}`);
           return;
         }
         const currentPlayer = room.gameState.players.find(p => p.socketId === socket.id);
         const opponent = room.gameState.players.find(p => p.socketId !== socket.id);
         const card = currentPlayer.deck[cardIndex];
         if (!card || !currentPlayer || !opponent) {
           socket.emit('error', 'Invalid card play attempt');
           console.error('Invalid playCard attempt:', { roomId, cardIndex, card, socketId: socket.id });
           return;
         }
         applyCardEffectsServer(card, currentPlayer, opponent);
         currentPlayer.deck.splice(cardIndex, 1);
         currentPlayer.deckSize = currentPlayer.deck.length;
         let newCard = null;
         if (currentPlayer.deck.length < 5) {
           newCard = getRandomCardServer();
           currentPlayer.deck.push(newCard);
           currentPlayer.deckSize = currentPlayer.deck.length;
         }
         io.to(roomId).emit('cardPlayed', { playerId: socket.id, cardIndex, card, newCard });
         if (opponent.health <= 0 || currentPlayer.health <= 0) {
           const winner = opponent.health <= 0 ? currentPlayer.socketId : (currentPlayer.health <= 0 ? opponent.socketId : null);
           room.gameState.gameOver = true;
           io.to(roomId).emit('gameOver', { winner });
           console.log(`🏁 Game over in room ${roomId}, winner: ${winner || 'draw'}`);
           return;
         }
         room.gameState.currentTurn = currentPlayer.extraTurns > 0 ? currentPlayer.socketId : opponent.socketId;
         if (currentPlayer.extraTurns > 0) {
           currentPlayer.extraTurns--;
           console.log(`${currentPlayer.name} gets extra turn, extraTurns left: ${currentPlayer.extraTurns}`);
         }
         io.to(roomId).emit('gameStateUpdated', {
           players: room.gameState.players,
           currentTurn: room.gameState.currentTurn,
           roomId
         });
         console.log(`🎴 Card played in room ${roomId} by ${currentPlayer.name}:`, { card, newCard });
       });

       socket.on('useSpecialMove', ({ roomId, playerId, message, playerHealth, opponentHealth, extraTurn, doubleDamage }) => {
         const room = rooms.get(roomId);
         if (!room || !room.gameState) {
           socket.emit('error', 'Room does not exist or game not started');
           console.error(`Room ${roomId} not found for specialMove by ${socket.id}`);
           return;
         }
         if (room.gameState.currentTurn !== playerId) {
           socket.emit('error', 'Not your turn');
           console.error('Invalid specialMove attempt:', { roomId, playerId, currentTurn: room.gameState.currentTurn });
           return;
         }
         const player = room.gameState.players.find(p => p.socketId === playerId);
         const opponent = room.gameState.players.find(p => p.socketId !== playerId);
         if (!player || !opponent || playerHealth === undefined || opponentHealth === undefined) {
           socket.emit('error', 'Invalid special move data');
           console.error('Invalid specialMove data:', { playerId, playerHealth, opponentHealth });
           return;
         }
         player.health = playerHealth;
         opponent.health = opponentHealth;
         player.specialMoveUsed = true;
         if (doubleDamage) player.nextAttackDoubled = true;
         if (extraTurn) player.extraTurns = 1;
         room.gameState.currentTurn = extraTurn ? playerId : opponent.socketId;
         io.to(roomId).emit('specialMoveApplied', {
           playerId,
           message,
           playerHealth,
           opponentHealth,
           extraTurn,
           doubleDamage
         });
         io.to(roomId).emit('gameStateUpdated', {
           players: room.gameState.players,
           currentTurn: room.gameState.currentTurn,
           roomId
         });
         if (player.health <= 0 || opponent.health <= 0) {
           const winner = player.health <= 0 ? opponent.socketId : (opponent.health <= 0 ? playerId : null);
           room.gameState.gameOver = true;
           io.to(roomId).emit('gameOver', { winner });
           console.log(`🏁 Game over in room ${roomId}, winner: ${winner || 'draw'}`);
         }
         console.log(`🌟 Special move used in room ${roomId} by ${player.name}: ${message}`);
       });

       socket.on('requestRestart', ({ roomId }) => {
         const room = rooms.get(roomId);
         if (!room) {
           socket.emit('error', 'Room does not exist');
           console.error(`Room ${roomId} not found for restart by ${socket.id}`);
           return;
         }
         const player = room.players.find(p => p.socketId === socket.id);
         if (!player) {
           socket.emit('error', 'Player not found in room');
           console.error(`Player ${socket.id} not found in room ${roomId}`);
           return;
         }
         const opponent = room.players.find(p => p.socketId !== socket.id);
         if (!opponent) {
           socket.emit('error', 'Opponent not found');
           console.error(`Opponent not found in room ${roomId}`);
           return;
         }
         player.restartRequested = true;
         io.to(opponent.socketId).emit('restartRequested', { playerId: socket.id, playerName: player.name });
         console.log(`${player.name} requested restart in room ${roomId}`);
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
           room.gameState = {
             players: room.players.map(player => ({
               socketId: player.socketId,
               name: player.name,
               avatar: player.avatar,
               health: 100,
               deck: player.deck,
               specialMove: player.specialMove,
               specialMoveUsed: false,
               deckSize: player.deck.length,
               extraTurns: 0,
               shieldActive: false,
               nextAttackDoubled: false
             })),
             currentTurn: room.players[Math.floor(Math.random() * 2)].socketId,
             gameOver: false
           };
           io.to(roomId).emit('gameStarted', {
             players: room.gameState.players,
             currentTurn: room.gameState.currentTurn,
             roomId
           });
           console.log(`🔄 Game restarted in room ${roomId}`);
         }
       });

       socket.on('gameOver', ({ roomId, winner }) => {
         const room = rooms.get(roomId);
         if (!room) {
           console.error(`Invalid roomId for gameOver: ${roomId}`);
           return;
         }
         room.gameState.gameOver = true;
         io.to(roomId).emit('gameOver', { winner });
         console.log(`🏁 Game over in room ${roomId}, winner: ${winner || 'draw'}`);
       });

       socket.on('leaveRoom', ({ roomId }) => {
         if (!roomId) {
           console.error(`Invalid roomId for leaveRoom by ${socket.id}`);
           return;
         }
         socket.leave(roomId);
         const room = rooms.get(roomId);
         if (room) {
           room.players = room.players.filter(p => p.socketId !== socket.id);
           if (room.players.length === 0) {
             rooms.delete(roomId);
             console.log(`🗑️ Room ${roomId} deleted (empty)`);
           } else {
             io.to(roomId).emit('opponentDisconnected');
             console.log(`🚪 Player ${socket.id} left room ${roomId}`);
           }
         }
       });

       socket.on('disconnect', () => {
         console.log(`🔴 Client disconnected: ${socket.id}`);
         for (const [roomId, room] of rooms.entries()) {
           const index = room.players.findIndex(p => p.socketId === socket.id);
           if (index !== -1) {
             room.players.splice(index, 1);
             if (room.players.length === 0) {
               rooms.delete(roomId);
               console.log(`🗑️ Room ${roomId} deleted (empty)`);
             } else {
               io.to(roomId).emit('opponentDisconnected');
               console.log(`📢 Notified room ${roomId} of disconnect`);
             }
             break;
           }
         }
       });

       function applyCardEffectsServer(card, user, target) {
         if (!card || !card.type || card.power === undefined) {
           console.error('Invalid card data in applyCardEffectsServer:', card);
           return;
         }
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

       function getRandomCardServer() {
         const allCardTypes = [
           { name: "Slash", type: "attack", power: 15, icon: "⚔️" },
           { name: "Fireball", type: "attack", power: 20, icon: "🔥" },
           { name: "Crush", type: "attack", power: 25, icon: "🔨" },
           { name: "Pierce", type: "attack", power: 18, icon: "🗡️" },
           { name: "Heal", type: "heal", power: 10, icon: "❤️" },
           { name: "Cure", type: "heal", power: 15, icon: "✨" },
           { name: "Revive", type: "heal", power: 15, icon: "🌿" },
           { name: "Shield", type: "block", power: 0, icon: "🛡️", description: "Blocks half of next attack's damage" },
           { name: "Egg", type: "attack", power: 28, icon: "🥚" }
         ];
         return { ...allCardTypes[Math.floor(Math.random() * allCardTypes.length)] };
       }
     });

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
           specialMoveUsed: false,
           deckSize: player.deck.length,
           extraTurns: 0,
           shieldActive: false,
           nextAttackDoubled: false
         })),
         currentTurn: room.players[0].socketId,
         gameOver: false
       };

       console.log(`🚀 Game started in room ${roomId} with payload:`, JSON.stringify({
         players: room.gameState.players,
         currentTurn: room.gameState.currentTurn,
         roomId
       }, null, 2));

       io.to(roomId).emit('gameStarted', {
         players: room.gameState.players,
         currentTurn: room.gameState.currentTurn,
         roomId
       });
     }

     function generateRoomId() {
       return Math.random().toString(36).substring(2, 6).toUpperCase();
     }

     const PORT = process.env.PORT || 3000;
     server.listen(PORT, () => {
       console.log(`🚀 Server running on port ${PORT}`);
     });
