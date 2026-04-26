const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = {};

app.get('/', (req, res) => {
    res.send('WebSocket server works!');
});

// Функция очистки старых игроков
function clearOldPlayers() {
    const now = Date.now();
    let removed = 0;
    
    for (let id in players) {
        if (players[id].timestamp && (now - players[id].timestamp > 60000)) {
            console.log(`🗑️ Удаляю: ${id} (${players[id].nickname})`);
            delete players[id];
            removed++;
        }
    }
    if (removed > 0) console.log(`✨ Удалено: ${removed} игроков`);
}

setInterval(clearOldPlayers, 30000);

wss.on('connection', (ws) => {
    let playerId = null;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log("Received:", data.type, data.id);
            
            switch(data.type) {
                case 'join':
                    playerId = data.id;
                    
                    players[playerId] = { 
                        x: data.x, 
                        y: data.y, 
                        flip: data.flip || false,
                        nickname: data.nickname || "Player",
                        character: data.character,
                        hp: 100,
                        timestamp: Date.now(),
                        status: "lobby"
                    };
                    console.log(`✅ ${players[playerId].nickname} в ЛОББИ (${playerId})`);
                    
                    // Отправляем ТОЛЬКО игроков которые в лобби
                    const lobbyPlayers = {};
                    for (let id in players) {
                        if (id !== playerId && players[id].status === "lobby") {
                            lobbyPlayers[id] = {
                                nickname: players[id].nickname,
                                character: players[id].character,
                                x: players[id].x,
                                y: players[id].y,
                                flip: players[id].flip,
                                status: players[id].status
                            };
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'init',
                        players: lobbyPlayers
                    }));
                    
                    // Оповещаем только тех кто в лобби о новом игроке
                    for (let client of wss.clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            const p = players[playerId];
                            if (p && p.status === "lobby") {
                                client.send(JSON.stringify({
                                    type: 'player_joined',
                                    id: playerId,
                                    nickname: p.nickname,
                                    character: p.character,
                                    x: data.x,
                                    y: data.y,
                                    flip: false
                                }));
                            }
                        }
                    }
                    break;
                    
                case 'move':
                    if (players[playerId]) {
                        players[playerId].x = data.x;
                        players[playerId].y = data.y;
                        players[playerId].flip = data.flip;
                        players[playerId].timestamp = Date.now();
                        
                        // Рассылаем движение только тем кто в лобби
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                const targetPlayer = players[playerId];
                                if (targetPlayer && targetPlayer.status === "lobby") {
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
                    }
                    break;
                
                case 'chat':
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
                        if (client.readyState === WebSocket.OPEN) {
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
                    delete players[data.id];
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'death',
                                id: data.id
                            }));
                        }
                    }
                    break;
                
                case 'leave_lobby':
                    if (players[playerId]) {
                        console.log(`🎮 ${players[playerId].nickname} переходит в ИГРУ`);
                        players[playerId].status = "game";
                        players[playerId].timestamp = Date.now();
                        
                        // Оповещаем всех в лобби что игрок ушёл
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                const targetPlayer = players[playerId];
                                if (targetPlayer && targetPlayer.status === "game") {
                                    client.send(JSON.stringify({
                                        type: 'player_left',
                                        id: playerId,
                                        nickname: targetPlayer.nickname
                                    }));
                                }
                            }
                        }
                    }
                    break;
                
                case 'reset_room':
                    for (let id in players) {
                        if (id !== playerId) {
                            delete players[id];
                        }
                    }
                    ws.send(JSON.stringify({ type: 'room_reset', status: 'ok' }));
                    break;
            }
        } catch(e) {
            console.log("Error:", e);
        }
    });
    
    ws.on('close', () => {
        if (playerId && players[playerId]) {
            console.log(`👋 ${players[playerId].nickname} отключился`);
            delete players[playerId];
            
            for (let client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'player_left',
                        id: playerId,
                        nickname: players[playerId]?.nickname || "Player"
                    }));
                }
            }
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
