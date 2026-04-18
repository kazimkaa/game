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
    let playerNickname = null;
    let playerCharacter = 1;
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log("Received:", data);
            
            switch(data.type) {
                case 'join':
                    playerId = data.id;
                    playerNickname = data.nickname || "Player";
                    playerCharacter = data.character || 1;
                    
                    players[playerId] = { 
                        x: data.x, 
                        y: data.y, 
                        flip: false,
                        nickname: playerNickname,
                        character: playerCharacter
                    };
                    console.log("Join:", playerId, playerNickname, "char:", playerCharacter);
                    
                    const playersData = {};
                    for (let id in players) {
                        playersData[id] = {
                            nickname: players[id].nickname,
                            character: players[id].character,
                            x: players[id].x,
                            y: players[id].y,
                            flip: players[id].flip
                        };
                    }
                    ws.send(JSON.stringify({
                        type: 'init',
                        players: playersData
                    }));
                    
                    wss.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'player_joined',
                                id: playerId,
                                nickname: playerNickname,
                                character: playerCharacter,
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
            console.log("Error:", e);
        }
    });
    
    ws.on('close', () => {
        if (playerId) {
            delete players[playerId];
            console.log("Disconnect:", playerId);
            
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
    console.log(`Server on port ${PORT}`);
});
