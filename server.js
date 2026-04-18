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

wss.on('connection', (ws) => {
    let playerId = null;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log("Received:", data);
            
            switch(data.type) {
                case 'join':
                    playerId = data.id;
                    
                    // Сохраняем ВСЕ данные игрока
                    players[playerId] = { 
                        x: data.x, 
                        y: data.y, 
                        flip: data.flip || false,
                        nickname: data.nickname || "Player",
                        character: data.character || 1
                    };
                    console.log(`✅ JOIN: ${playerId} | ${players[playerId].nickname} | Character: ${players[playerId].character}`);
                    
                    // Отправляем новому игроку всех существующих (с их персонажами)
                    const allPlayers = {};
                    for (let id in players) {
                        allPlayers[id] = {
                            nickname: players[id].nickname,
                            character: players[id].character,
                            x: players[id].x,
                            y: players[id].y,
                            flip: players[id].flip
                        };
                    }
                    ws.send(JSON.stringify({
                        type: 'init',
                        players: allPlayers
                    }));
                    
                    // Оповещаем остальных о новом игроке (с его персонажем)
                    const joinMsg = {
                        type: 'player_joined',
                        id: playerId,
                        nickname: players[playerId].nickname,
                        character: players[playerId].character,
                        x: data.x,
                        y: data.y,
                        flip: data.flip || false
                    };
                    
                    wss.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(joinMsg));
                        }
                    });
                    break;
                    
                case 'move':
                    if (playerId && players[playerId]) {
                        players[playerId].x = data.x;
                        players[playerId].y = data.y;
                        players[playerId].flip = data.flip;
                        
                        const moveMsg = {
                            type: 'player_moved',
                            id: playerId,
                            x: data.x,
                            y: data.y,
                            flip: data.flip
                        };
                        
                        wss.clients.forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify(moveMsg));
                            }
                        });
                    }
                    break;
                    
                case 'change_character':
                    if (playerId && players[playerId]) {
                        players[playerId].character = data.character;
                        console.log(`🔄 ${playerId} changed character to ${data.character}`);
                        
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'character_changed',
                                    id: playerId,
                                    character: data.character
                                }));
                            }
                        });
                    }
                    break;
            }
        } catch(e) {
            console.log("❌ Error:", e.message);
        }
    });
    
    ws.on('close', () => {
        if (playerId) {
            delete players[playerId];
            console.log(`❌ DISCONNECT: ${playerId}`);
            
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'player_left',
                        id: playerId
                    }));
                }
            });
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
