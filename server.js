const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};
const clientRoom = new Map();

// Таймер лобби
let countdownActive = false;
let countdownValue = 60;
let countdownInterval = null;

app.get('/', (req, res) => {
    res.send('WebSocket server works!');
});

function startCountdown() {
    if (countdownActive) return;
    
    const playersCount = Object.keys(lobbyPlayers).length;
    if (playersCount < 2) return;
    
    countdownActive = true;
    countdownValue = 10; // Для теста 10 секунд
    
    broadcastToLobby({
        type: 'countdown_start',
        time: countdownValue
    });
    
    countdownInterval = setInterval(() => {
        countdownValue--;
        
        if (countdownValue <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            countdownActive = false;
            startGameForAll();
        } else {
            broadcastToLobby({
                type: 'countdown_update',
                time: countdownValue
            });
        }
    }, 1000);
}

function cancelCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    countdownActive = false;
    broadcastToLobby({ type: 'countdown_cancel' });
}

function broadcastToLobby(data) {
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'lobby') {
            client.send(JSON.stringify(data));
        }
    }
}

function broadcastToGame(data) {
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'game') {
            client.send(JSON.stringify(data));
        }
    }
}

function startGameForAll() {
    console.log("🎮 STARTGAMEFORALL");
    
    // Переносим всех из лобби в игру
    const playersToMove = [...Object.keys(lobbyPlayers)];
    
    for (let id of playersToMove) {
        if (lobbyPlayers[id]) {
            gamePlayers[id] = { ...lobbyPlayers[id] };
            delete lobbyPlayers[id];
        }
    }
    
    // Отправляем каждому клиенту переход в игру и список игроков
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'lobby') {
            clientRoom.set(client, 'game');
            
            // Список остальных игроков
            const otherPlayers = {};
            for (let id in gamePlayers) {
                if (id !== client.playerId) {
                    otherPlayers[id] = {
                        nickname: gamePlayers[id].nickname,
                        character: gamePlayers[id].character,
                        x: gamePlayers[id].x,
                        y: gamePlayers[id].y,
                        flip: gamePlayers[id].flip
                    };
                }
            }
            
            // Отправляем команду на переход в игру с данными
            client.send(JSON.stringify({
                type: 'start_game',
                players: otherPlayers
            }));
        }
    }
    
    console.log(`📊 В игре: ${Object.keys(gamePlayers).length} игроков`);
}

wss.on('connection', (ws) => {
    let playerId = null;
    let playerNickname = "";
    let playerCharacter = 1;
    
    Object.defineProperty(ws, 'playerId', {
        get: () => playerId,
        set: (value) => playerId = value
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log("📨 Received:", data.type, data.id || '');
            
            switch(data.type) {
                case 'join':
                    playerId = data.id;
                    playerNickname = data.nickname || "Player";
                    playerCharacter = data.character || 1;
                    clientRoom.set(ws, 'lobby');
                    ws.playerId = playerId;
                    
                    if (gamePlayers[playerId]) delete gamePlayers[playerId];
                    
                    lobbyPlayers[playerId] = { 
                        x: data.x, y: data.y, flip: data.flip || false,
                        nickname: playerNickname, character: playerCharacter, hp: 100
                    };
                    console.log(`✅ ${playerNickname} в ЛОББИ (лобби: ${Object.keys(lobbyPlayers).length})`);
                    
                    // Отправляем текущему игроку список лобби
                    const onlyLobbyPlayers = {};
                    for (let id in lobbyPlayers) {
                        if (id !== playerId) {
                            onlyLobbyPlayers[id] = {
                                nickname: lobbyPlayers[id].nickname,
                                character: lobbyPlayers[id].character,
                                x: lobbyPlayers[id].x, y: lobbyPlayers[id].y, flip: lobbyPlayers[id].flip
                            };
                        }
                    }
                    ws.send(JSON.stringify({ type: 'init', players: onlyLobbyPlayers }));
                    
                    // Оповещаем лобби о новом игроке
                    for (let client of wss.clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'lobby') {
                            client.send(JSON.stringify({
                                type: 'player_joined', id: playerId,
                                nickname: playerNickname, character: playerCharacter,
                                x: data.x, y: data.y, flip: false
                            }));
                        }
                    }
                    
                    if (Object.keys(lobbyPlayers).length >= 2 && !countdownActive) {
                        startCountdown();
                    }
                    break;
                
                case 'level_ready':
                    // Клиент загрузил уровень, отправляем ему список игроков
                    console.log(`📍 ${playerNickname} загрузил уровень, отправляем список игроков`);
                    
                    const otherPlayers = {};
                    for (let id in gamePlayers) {
                        if (id !== playerId) {
                            otherPlayers[id] = {
                                nickname: gamePlayers[id].nickname,
                                character: gamePlayers[id].character,
                                x: gamePlayers[id].x,
                                y: gamePlayers[id].y,
                                flip: gamePlayers[id].flip
                            };
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'init_game',
                        players: otherPlayers
                    }));
                    break;
                    
                case 'move':
                    if (clientRoom.get(ws) === 'lobby' && lobbyPlayers[playerId]) {
                        lobbyPlayers[playerId].x = data.x;
                        lobbyPlayers[playerId].y = data.y;
                        lobbyPlayers[playerId].flip = data.flip;
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'lobby') {
                                client.send(JSON.stringify({ type: 'player_moved', id: playerId, x: data.x, y: data.y, flip: data.flip }));
                            }
                        }
                    } else if (clientRoom.get(ws) === 'game' && gamePlayers[playerId]) {
                        gamePlayers[playerId].x = data.x;
                        gamePlayers[playerId].y = data.y;
                        gamePlayers[playerId].flip = data.flip;
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'game') {
                                client.send(JSON.stringify({ type: 'player_moved', id: playerId, x: data.x, y: data.y, flip: data.flip }));
                            }
                        }
                    }
                    break;
                    
                case 'damage':
                    if (!gamePlayers[data.target_id]) break;
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'game') {
                            client.send(JSON.stringify({
                                type: 'damage', target_id: data.target_id,
                                damage: data.damage, attacker_id: data.attacker_id
                            }));
                        }
                    }
                    break;
                    
                case 'death':
                    if (gamePlayers[data.id]) delete gamePlayers[data.id];
                    broadcastToGame({ type: 'death', id: data.id });
                    break;
                    
                case 'chat':
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'chat', nickname: data.nickname, message: data.message }));
                        }
                    }
                    break;
                    
                case 'reset_room':
                    for (let id in lobbyPlayers) {
                        if (id !== playerId) delete lobbyPlayers[id];
                    }
                    cancelCountdown();
                    ws.send(JSON.stringify({ type: 'room_reset', status: 'ok' }));
                    break;
            }
        } catch(e) {
            console.log("Error:", e);
        }
    });
    
    ws.on('close', () => {
        if (playerId) {
            console.log(`👋 ${playerNickname} (${playerId}) отключился`);
            delete lobbyPlayers[playerId];
            delete gamePlayers[playerId];
            clientRoom.delete(ws);
            
            if (Object.keys(lobbyPlayers).length < 2 && countdownActive) {
                cancelCountdown();
            }
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
