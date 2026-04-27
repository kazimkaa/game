const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};
const clientRoom = new Map();

let town1_hp = 1000;
let town2_hp = 1000;

let countdownActive = false;
let countdownValue = 60;
let countdownInterval = null;

app.get('/', (req, res) => res.send('Server is running!'));

// --- УТИЛИТЫ РАССЫЛКИ ---

// Универсальная функция рассылки по комнатам
function broadcast(room, data) {
    const packet = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === room) {
            client.send(packet);
        }
    });
}

function broadcastToLobby(data) { broadcast('lobby', data); }
function broadcastToGame(data) { broadcast('game', data); }

// --- ЛОГИКА ИГРЫ ---

function assignTeams() {
    const ids = Object.keys(gamePlayers);
    // Перемешивание Фишера-Йетса
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
    countdownValue = 15; // Уменьшил для тестов, поставь 60 если нужно

    broadcastToLobby({ type: 'countdown_start', time: countdownValue });
    
    countdownInterval = setInterval(() => {
        countdownValue--;
        if (countdownValue <= 0) {
            clearInterval(countdownInterval);
            countdownActive = false;
            startGameForAll();
        } else {
            broadcastToLobby({ type: 'countdown_update', time: countdownValue });
        }
    }, 1000);
}

function cancelCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownActive = false;
    broadcastToLobby({ type: 'countdown_cancel' });
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
                    ws.playerId = playerId;
                    clientRoom.set(ws, 'lobby');
                    
                    lobbyPlayers[playerId] = { 
                        nickname: data.nickname || "Player", 
                        character: data.character || 1,
                        x: data.x, y: data.y, flip: false 
                    };

                    // Отправляем новичку список тех, кто уже в лобби
                    const currentPlayers = {};
                    for (let id in lobbyPlayers) {
                        if (id !== playerId) currentPlayers[id] = lobbyPlayers[id];
                    }
                    ws.send(JSON.stringify({ type: 'init', players: currentPlayers }));

                    // Оповещаем остальных
                    broadcastToLobby({
                        type: 'player_joined',
                        id: playerId,
                        ...lobbyPlayers[playerId]
                    });

                    if (Object.keys(lobbyPlayers).length >= 2) startCountdown();
                    break;

                case 'move':
                    const room = clientRoom.get(ws);
                    const list = room === 'lobby' ? lobbyPlayers : gamePlayers;
                    if (list[playerId]) {
                        list[playerId].x = data.x;
                        list[playerId].y = data.y;
                        list[playerId].flip = data.flip;
                        
                        // Рассылаем позицию только игрокам в той же комнате
                        const movePacket = JSON.stringify({ type: 'player_moved', id: playerId, x: data.x, y: data.y, flip: data.flip });
                        wss.clients.forEach(c => {
                            if (c !== ws && clientRoom.get(c) === room) c.send(movePacket);
                        });
                    }
                    break;

                case 'chat':
                    // ГЛАВНОЕ ИСПРАВЛЕНИЕ: Чат работает и в лобби, и в игре
                    const chatPacket = {
                        type: 'chat',
                        nickname: data.nickname,
                        message: data.message
                    };
                    const currentRoom = clientRoom.get(ws);
                    if (currentRoom === 'lobby') broadcastToLobby(chatPacket);
                    else broadcastToGame(chatPacket);
                    break;

                case 'town_damage':
                    if (!gamePlayers[playerId]) break;
                    const team = gamePlayers[playerId].team;
                    if ((data.town_id === 1 && team === 1) || (data.town_id === 2 && team === 2)) break;

                    if (data.town_id === 1) town1_hp = Math.max(0, town1_hp - data.damage);
                    else town2_hp = Math.max(0, town2_hp - data.damage);

                    broadcastToGame({
                        type: 'town_damage',
                        town_id: data.town_id,
                        damage: data.damage,
                        new_hp: data.town_id === 1 ? town1_hp : town2_hp
                    });

                    if (town1_hp <= 0) broadcastToGame({ type: 'game_over', winner: 2 });
                    else if (town2_hp <= 0) broadcastToGame({ type: 'game_over', winner: 1 });
                    break;

                case 'reset_room':
                    if (clientRoom.get(ws) === 'lobby') {
                        cancelCountdown();
                        ws.send(JSON.stringify({ type: 'room_reset' }));
                    }
                    break;
            }
        } catch(e) { console.error("Socket error:", e); }
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
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port ${PORT}`));
