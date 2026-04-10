const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = {};

app.get('/', (req, res) => {
    res.send('WebSocket сервер работает!');
});

wss.on('connection', (ws) => {
    let playerId = null;
    let playerNickname = null;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'join':
                    playerId = data.id;
                    playerNickname = data.nickname || "Игрок";
                    players[playerId] = { 
                        x: data.x, 
                        y: data.y, 
                        flip: false,
                        nickname: playerNickname
                    };
                    console.log('Игрок присоединился:', playerId, playerNickname);
                    
                    // Отправляем новому игроку всех существующих
                    ws.send(JSON.stringify({
                        type: 'init',
                        players: players
                    }));
                    
                    // Сообщаем всем остальным о новом игроке
                    wss.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'player_joined',
                                id: playerId,
                                nickname: playerNickname,
                                x: data.x,
                                y: data.y,
                                flip: false
                            }));
                        }
                    });
                    break;
                    
                case 'move':
                    if (playerId && players[playerId]) {
                        players[playerId].x = data.x;
                        players[playerId].y = data.y;
                        players[playerId].flip = data.flip;
                        
                        wss.clients.forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'player_moved',
                                    id: playerId,
                                    x: data.x,
                                    y: data.y,
                                    flip: data.flip
                                }));
                            }
                        });
                    }
                    break;
            }
        } catch(e) {
            console.log('Ошибка:', e);
        }
    });
    
    ws.on('close', () => {
        if (playerId) {
            delete players[playerId];
            console.log('Игрок отключился:', playerId);
            
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
    console.log(`Сервер на порту ${PORT}`);
});
