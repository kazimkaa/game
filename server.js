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
                    
                    players[playerId] = { 
                        x: data.x, 
                        y: data.y, 
                        flip: data.flip || false,
                        nickname: data.nickname || "Player",
                        character: data.character
                    };
                    console.log(`Player joined: ${playerId} (${players[playerId].nickname})`);
                    
                    // Отправляем новому игроку всех существующих игроков
                    const allPlayers = {};
                    for (let id in players) {
                        if (id != playerId) {
                            allPlayers[id] = {
                                nickname: players[id].nickname,
                                character: players[id].character,
                                x: players[id].x,
                                y: players[id].y,
                                flip: players[id].flip
                            };
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'init',
                        players: allPlayers
                    }));
                    
                    // Рассылаем ВСЕМ клиентам (включая нового) о подключении
                    const joinMessage = JSON.stringify({
                        type: 'player_joined',
                        id: playerId,
                        nickname: players[playerId].nickname,
                        character: players[playerId].character,
                        x: data.x,
                        y: data.y,
                        flip: false
                    });
                    
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(joinMessage);
                        }
                    }
                    break;
                    
                case 'move':
                    if (players[playerId]) {
                        players[playerId].x = data.x;
                        players[playerId].y = data.y;
                        players[playerId].flip = data.flip;
                        
                        const moveMessage = JSON.stringify({
                            type: 'player_moved',
                            id: playerId,
                            x: data.x,
                            y: data.y,
                            flip: data.flip
                        });
                        
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(moveMessage);
                            }
                        }
                    }
                    break;
                
                case 'chat':
                    const chatMessage = data.message;
                    const chatNickname = data.nickname;
                    
                    console.log(`Chat: ${chatNickname}: ${chatMessage}`);
                    
                    const chatResponse = JSON.stringify({
                        type: 'chat',
                        nickname: chatNickname,
                        message: chatMessage
                    });
                    
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(chatResponse);
                        }
                    }
                    break;
            }
        } catch(e) {
            console.log("Error:", e);
        }
    });
    
    ws.on('close', () => {
        if (playerId && players[playerId]) {
            const playerNickname = players[playerId].nickname;
            console.log(`Player left: ${playerId} (${playerNickname})`);
            
            delete players[playerId];
            
            const leaveMessage = JSON.stringify({
                type: 'player_left',
                id: playerId,
                nickname: playerNickname
            });
            
            for (let client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(leaveMessage);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
