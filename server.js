const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const players = {};
const lobbies = {};

app.get('/', (req, res) => {
    res.send('WebSocket server works!');
});

// Функция очистки старых игроков (по времени)
function clearOldPlayers() {
    const now = Date.now();
    let removed = 0;
    
    for (let id in players) {
        if (players[id].timestamp && (now - players[id].timestamp > 30000)) {
            console.log(`🗑️ Удаляю старого игрока: ${id} (${players[id].nickname})`);
            
            for (let client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'player_left',
                        id: id,
                        nickname: players[id].nickname
                    }));
                }
            }
            
            delete players[id];
            removed++;
        }
    }
    
    if (removed > 0) {
        console.log(`✨ Очистка завершена. Удалено: ${removed} игроков`);
    }
    return removed;
}

// Запускаем очистку каждые 10 секунд
setInterval(() => {
    clearOldPlayers();
}, 10000);

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
                        character: data.character,
                        hp: 100,
                        timestamp: Date.now(),
                        status: "in_lobby"
                    };
                    console.log(`✅ Player joined: ${playerId} (${players[playerId].nickname}) в лобби`);
                    
                    // Отправляем новому игроку всех существующих (кроме игроков в игре)
                    const allPlayers = {};
                    for (let id in players) {
                        if (id !== playerId && players[id].status !== "in_game") {
                            allPlayers[id] = {
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
                        players: allPlayers
                    }));
                    
                    // Оповещаем всех остальных о новом игроке
                    for (let client of wss.clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN && players[playerId].status !== "in_game") {
                            client.send(JSON.stringify({
                                type: 'player_joined',
                                id: playerId,
                                nickname: players[playerId].nickname,
                                character: players[playerId].character,
                                x: data.x,
                                y: data.y,
                                flip: false
                            }));
                        }
                    }
                    break;
                    
                case 'move':
                    if (players[playerId]) {
                        players[playerId].x = data.x;
                        players[playerId].y = data.y;
                        players[playerId].flip = data.flip;
                        players[playerId].timestamp = Date.now();
                        
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
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
                    const chatMessage = data.message;
                    const chatNickname = data.nickname;
                    
                    console.log(`💬 Chat: ${chatNickname}: ${chatMessage}`);
                    
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'chat',
                                nickname: chatNickname,
                                message: chatMessage
                            }));
                        }
                    }
                    break;
                
                case 'damage':
                    const targetId = data.target_id;
                    const damage = data.damage;
                    const attackerId = data.attacker_id;
                    
                    console.log(`⚔️ Damage: ${attackerId} нанес урон ${damage} игроку ${targetId}`);
                    
                    if (players[targetId]) {
                        players[targetId].hp = (players[targetId].hp || 100) - damage;
                        players[targetId].timestamp = Date.now();
                        console.log(`❤️ HP игрока ${targetId}: ${players[targetId].hp}`);
                    }
                    
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'damage',
                                target_id: targetId,
                                damage: damage,
                                attacker_id: attackerId
                            }));
                        }
                    }
                    break;
                
                case 'death':
                    const deadId = data.id;
                    console.log(`💀 Death: ${deadId}`);
                    
                    delete players[deadId];
                    
                    for (let client of wss.clients) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'death',
                                id: deadId
                            }));
                        }
                    }
                    break;
                
                case 'reset_room':
                    console.log(`🔄 Сброс комнаты по запросу ${playerId}`);
                    
                    for (let id in players) {
                        if (id !== playerId) {
                            delete players[id];
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'room_reset',
                        status: 'ok'
                    }));
                    break;
                
                case 'leave_lobby':
                    console.log(`👋 Игрок ${playerId} покидает лобби и переходит в игру`);
                    
                    if (players[playerId]) {
                        players[playerId].status = "in_game";
                        players[playerId].timestamp = Date.now();
                        
                        // Оповещаем всех, что игрок покинул лобби
                        for (let client of wss.clients) {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'player_left',
                                    id: playerId,
                                    nickname: players[playerId].nickname
                                }));
                            }
                        }
                    }
                    break;
                    
                case 'player_status':
                    if (players[playerId]) {
                        players[playerId].status = data.status;
                        console.log(`📌 Игрок ${playerId} изменил статус на ${data.status}`);
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
            console.log(`👋 Player left: ${playerId} (${playerNickname})`);
            
            delete players[playerId];
            
            for (let client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'player_left',
                        id: playerId,
                        nickname: playerNickname
                    }));
                }
            }
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🧹 Автоматическая очистка старых игроков активна (каждые 10 секунд)`);
});
