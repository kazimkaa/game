const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};
const clientRoom = new Map(); // Хранит состояние каждого клиента: 'lobby' или 'game'

// Состояние башен
let town1_hp = 1000;
let town2_hp = 1000;

// Таймер
let countdownActive = false;
let countdownValue = 15; // Можно изменить на 60
let countdownInterval = null;

app.get('/', (req, res) => res.send('Game Server is Online!'));

// --- ФУНКЦИИ РАССЫЛКИ ---

function broadcastToRoom(room, data) {
    const packet = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === room) {
            client.send(packet);
        }
    });
}

// --- ЛОГИКА ИГРЫ ---

function assignTeams() {
    const ids = Object.keys(gamePlayers);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const half = Math.ceil(ids.length / 2);
    ids.forEach((id, i) => {
        gamePlayers[id].team = i < half ? 1 : 2;
    });
}

function startCountdown() {
    if (countdownActive || Object.keys(lobbyPlayers).length < 2) return;
    
    countdownActive = true;
    countdownValue = 15; 
    broadcastToRoom('lobby', { type: 'countdown_start', time: countdownValue });
    
    countdownInterval = setInterval(() => {
        countdownValue--;
        if (countdownValue <= 0) {
            clearInterval(countdownInterval);
            countdownActive = false;
            startGameForAll();
        } else {
            broadcastToRoom('lobby', { type: 'countdown_update', time: countdownValue });
        }
    }, 1000);
}

function cancelCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownActive = false;
    broadcastToRoom('lobby', { type: 'countdown_cancel' });
}

function startGameForAll() {
    const playersToMove = Object.keys(lobbyPlayers);
    playersToMove.forEach(id => {
        gamePlayers[id] = { ...lobbyPlayers[id] };
        delete lobbyPlayers[id];
    });

    assignTeams();
    town1_hp = 1000;
    town2_hp = 1000;

    wss.clients.forEach(client => {
        if (clientRoom.get(client) === 'lobby') {
            clientRoom.set(client, 'game');
            client.send(JSON.stringify({ type: 'start_game' }));
        }
    });
}

// --- ОБРАБОТКА СОЕДИНЕНИЙ ---

wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'join':
                    playerId = data.id;
                    clientRoom.set(ws, 'lobby');
                    
                    lobbyPlayers[playerId] = { 
                        nickname: data.nickname || "Player", 
                        character: data.character || 1,
                        x: data.x, y: data.y, flip: false 
                    };

                    // Инициализация для вошедшего
                    const currentOnlines = {};
                    for (let id in lobbyPlayers) {
                        if (id !== playerId) currentOnlines[id] = lobbyPlayers[id];
                    }
                    ws.send(JSON.stringify({ type: 'init', players: currentOnlines }));

                    // Оповещение остальных в лобби
                    broadcastToRoom('lobby', {
                        type: 'player_joined',
                        id: playerId,
                        ...lobbyPlayers[playerId]
                    });

                    if (Object.keys(lobbyPlayers).length >= 2) startCountdown();
                    break;

                case 'move':
                    const room = clientRoom.get(ws);
                    const playersList = room === 'lobby' ? lobbyPlayers : gamePlayers;
                    
                    if (playersList[playerId]) {
                        playersList[playerId].x = data.x;
                        playersList[playerId].y = data.y;
                        playersList[playerId].flip = data.flip;
                        
                        // Рассылаем только тем, кто в той же "комнате"
                        const moveData = JSON.stringify({ 
                            type: 'player_moved', id: playerId, x: data.x, y: data.y, flip: data.flip 
                        });
                        wss.clients.forEach(c => {
                            if (c !== ws && c.readyState === WebSocket.OPEN && clientRoom.get(c) === room) {
                                c.send(moveData);
                            }
                        });
                    }
                    break;

                case 'chat':
                    // ИСПРАВЛЕНО: Рассылка идет в ту комнату, где находится отправитель
                    const roomType = clientRoom.get(ws);
                    if (roomType) {
                        broadcastToRoom(roomType, {
                            type: 'chat',
                            nickname: data.nickname,
                            message: data.message
                        });
                    }
                    break;

                case 'level_ready':
                    if (!gamePlayers[playerId]) return;
                    
                    const otherInGame = {};
                    for (let id in gamePlayers) {
                        if (id !== playerId) otherInGame[id] = gamePlayers[id];
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'init_game',
                        players: otherInGame,
                        my_team: gamePlayers[playerId].team,
                        town1_hp: town1_hp,
                        town2_hp: town2_hp
                    }));
                    break;

                case 'town_damage':
                    if (!gamePlayers[playerId]) break;
                    const attackerTeam = gamePlayers[playerId].team;
                    
                    // Защита от урона по своей башне
                    if ((data.town_id === 1 && attackerTeam === 1) || (data.town_id === 2 && attackerTeam === 2)) break;

                    if (data.town_id === 1) town1_hp = Math.max(0, town1_hp - data.damage);
                    else town2_hp = Math.max(0, town2_hp - data.damage);

                    broadcastToRoom('game', {
                        type: 'town_damage',
                        town_id: data.town_id,
                        damage: data.damage,
                        new_hp: data.town_id === 1 ? town1_hp : town2_hp
                    });

                    if (town1_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 2 });
                    else if (town2_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 1 });
                    break;

                case 'reset_room':
                    cancelCountdown();
                    ws.send(JSON.stringify({ type: 'room_reset' }));
                    break;
            }
        } catch(e) { console.error("Error:", e); }
    });

    ws.on('close', () => {
        if (playerId) {
            delete lobbyPlayers[playerId];
            delete gamePlayers[playerId];
            clientRoom.delete(ws);
            if (Object.keys(lobbyPlayers).length < 2) cancelCountdown();
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
