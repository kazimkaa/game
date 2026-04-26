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

// Функция очистки старых игроков (по времени)
function clearOldPlayers() {
    const now = Date.now();
    let removed = 0;
    
    for (let id in players) {
        // Если игрок старше 30 секунд и он не активен
        if (players[id].timestamp && (now - players[id].timestamp > 30000)) {
            console.log(`🗑️ Удаляю старого игрока: ${id} (${players[id].nickname})`);
            
            // Оповещаем всех об удалении
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
                    
                    // Добавляем timestamp при подключении
                    players[playerId] = { 
                        x: data.x, 
                        y: data.y, 
                        flip: data.flip || false,
                        nickname: data.nickname || "Player",
                        character: data.character,
                        hp: 100,
                        timestamp: Date.now()  // ВАЖНО: добавляем время подключения
                    };
                    console.log(`✅ Player joined: ${playerId} (${players[playerId].nickname})`);
                    
                    // Отправляем новому игроку всех существующих
                    const allPlayers = {};
                    for (let id in players) {
                        if (id !== playerId) {
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
                    
                    // Оповещаем всех остальных о новом игроке
                    for (let client of wss.clients) {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
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
                        players[playerId].timestamp = Date.now(); // Обновляем время активности
                        
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
                
                // НОВЫЙ ОБРАБОТЧИК ДЛЯ СБРОСА КОМНАТЫ
                case 'reset_room':
                    console.log(`🔄 Сброс комнаты по запросу ${playerId}`);
                    
                    // Удаляем всех игроков
                    for (let id in players) {
                        if (id !== playerId) {
                            delete players[id];
                        }
                    }
                    
                    // Подтверждаем сброс
                    ws.send(JSON.stringify({
                        type: 'room_reset',
                        status: 'ok'
                    }));
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
