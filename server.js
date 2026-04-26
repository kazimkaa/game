const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};

app.get('/', (req, res) => {
    res.send('WebSocket server works!');
});

wss.on('connection', (ws) => {
    let playerId = null;
    let currentRoom = null;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log("Received:", data.type);
            
            switch(data.type) {
                case 'join':
                    playerId = data.id;
                    currentRoom = 'lobby';
                    
                    // Удаляем из игры если был
                    if (gamePlayers[playerId]) {
                        delete gamePlayers[playerId];
                    }
                    
                    lobbyPlayers[playerId] = { 
                        x: data.x, 
                        y: data.y, 
                        flip: data.flip || false,
                        nickname: data.nickname || "Player",
                        character: data.character,
                        hp: 100
                    };
                    console.log(`✅ ${lobbyPlayers[playerId].nickname} в ЛОББИ (всего в лобби: ${Object.keys(lobbyPlayers).length})`);
                    
                    // Отправляем ТОЛЬКО игроков из ЛОББИ
                    const onlyLobbyPlayers = {};
                    for (let id in lobbyPlayers) {
                        if (id !== playerId) {
                            onlyLobbyPlayers[id] = {
                                nickname: lobbyPlayers[id].nickname,
                                character: lobbyPlayers[id].character,
                                x: lobbyPlayers[id].x,
                                y: lobbyPlayers[id].y,
                                flip: lobbyPlayers[id].flip
                            };
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'init',
                        players: onlyLobbyPlayers
                    }));
                    
                    // Оповещаем ТОЛЬКО игроков из ЛОББИ
                    for (let client of wss.clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN && client.currentRoom === 'lobby') {
                            client.send(JSON.stringify({
                                type: 'player_joined',
                                id: playerId,
                                nickname: lobbyPlayers[playerId].nickname,
                                character: lobbyPlayers[playerId].character,
                                x: data.x,
                                y: data.y,
                                flip: false
                            }));
                        }
                    }
                    break;
                    
                case 'join_game':
                    console.log(`🎮 Игрок ${playerId} переходит в ИГРУ`);
                    
                    // Удаляем из лобби
                    if (lobbyPlayers[playerId]) {
                        delete lobbyPlayers[playerId];
                    }
                    
                    gamePlayers[playerId] = { 
                        x: data.x || 500,
                        y: data.y || 300,
                        flip: false,
                        nickname: data.nickname || "Player",
                        character: data.character || 1,
                        hp: 100
                    };
                    currentRoom = 'game';
                    
                    // Оповещаем ЛОББИ что игрок ушёл
                    for (let client of wss.clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN && client.currentRoom === 'lobby') {
                            client.send(JSON.stringify({
                                type: 'player_left',
                                id: playerId,
                                nickname: gamePlayers[playerId].nickname
                            }));
                        }
                    }
                    
                    // Отправляем игроку ТОЛЬКО игроков из ИГРЫ
                    const onlyGamePlayers = {};
                    for (let id in gamePlayers) {
                        if (id !== playerId) {
                            onlyGamePlayers[id] = {
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
                        players: onlyGamePlayers
                    }));
                    console.log(`📊 Теперь в игре: ${Object.keys(gamePlayers).length}, в лобби: ${Object.keys(lobbyPlayers).length}`);
                    break;
                    
                case 'move':
                    if (currentRoom === 'lobby' && lobbyPlayers[playerId]) {
                        lobbyPlayers[playerId].x = data.x;
                        lobbyPlayers[playerId].y = data.y;
                        lobbyPlayers[playerId].flip = data.flip;
                        
                        // Рассылаем ТОЛЬКО в лобби
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN && client.currentRoom === 'lobby') {
                                client.send(JSON.stringify({
                                    type: 'player_moved',
                                    id: playerId,
                                    x: data.x,
                                    y: data.y,
                                    flip: data.flip
                                }));
                            }
                        }
                    } else if (currentRoom === 'game' && gamePlayers[playerId]) {
                        gamePlayers[playerId].x = data.x;
                        gamePlayers[playerId].y = data.y;
                        gamePlayers[playerId].flip = data.flip;
                        
                        // Рассылаем ТОЛЬКО в игру
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN && client.currentRoom === 'game') {
                                client.send(JSON.stringify({
                                    type: 'player_moved',
                                    id: playerId,
                                    x: data.x,
                                    y: data.y,
                                    flip: data.flip
                                }));
                            }
                        }
                    }
                    break;
                
                case 'chat':
                    // Чат для всех
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'chat',
                                nickname: data.nickname,
                                message: data.message
                            }));
                        }
                    }
                    break;
                
                case 'damage':
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN && client.currentRoom === 'game') {
                            client.send(JSON.stringify({
                                type: 'damage',
                                target_id: data.target_id,
                                damage: data.damage,
                                attacker_id: data.attacker_id
                            }));
                        }
                    }
                    break;
                
                case 'death':
                    delete gamePlayers[data.id];
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN && client.currentRoom === 'game') {
                            client.send(JSON.stringify({
                                type: 'death',
                                id: data.id
                            }));
                        }
                    }
                    break;
                
                case 'reset_room':
                    for (let id in lobbyPlayers) {
                        if (id !== playerId) delete lobbyPlayers[id];
                    }
                    ws.send(JSON.stringify({ type: 'room_reset', status: 'ok' }));
                    break;
            }
        } catch(e) {
            console.log("Error:", e);
        }
    });
    
    ws.on('close', () => {
        if (playerId) {
            console.log(`👋 Игрок отключился: ${playerId}`);
            if (lobbyPlayers[playerId]) delete lobbyPlayers[playerId];
            if (gamePlayers[playerId]) delete gamePlayers[playerId];
            
            for (let client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'player_left',
                        id: playerId,
                        nickname: "Player"
                    }));
                }
            }
        }
    });
    
    // Сохраняем комнату
    Object.defineProperty(ws, 'currentRoom', {
        get: () => currentRoom,
        set: (value) => currentRoom = value
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
