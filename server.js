const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};
const clientRoom = new Map();

// HP башен
let town1_hp = 1000;
let town2_hp = 1000;

// Таймер лобби
let countdownActive = false;
let countdownValue = 60;
let countdownInterval = null;

app.get('/', (req, res) => {
    res.send('WebSocket server works!');
});

function assignTeams() {
    const players = Object.keys(gamePlayers);
    for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
    }
    
    const half = Math.ceil(players.length / 2);
    
    for (let i = 0; i < players.length; i++) {
        const id = players[i];
        const team = i < half ? 1 : 2;
        gamePlayers[id].team = team;
        console.log(`   ${gamePlayers[id].nickname} -> Команда ${team}`);
    }
}

function startCountdown() {
    if (countdownActive) return;
    
    const playersCount = Object.keys(lobbyPlayers).length;
    if (playersCount < 2) return;
    
    countdownActive = true;
    countdownValue = 60;
    
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
    console.log(`   📤 Отправка всем в игре: ${data.type}`);
    let sent = 0;
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'game') {
            client.send(JSON.stringify(data));
            sent++;
        }
    }
    console.log(`   ✅ Отправлено ${sent} клиентам`);
}

function startGameForAll() {
    console.log("🎮 STARTGAMEFORALL");
    
    const playersToMove = [...Object.keys(lobbyPlayers)];
    
    for (let id of playersToMove) {
        if (lobbyPlayers[id]) {
            gamePlayers[id] = { ...lobbyPlayers[id] };
            delete lobbyPlayers[id];
        }
    }
    
    assignTeams();
    
    town1_hp = 1000;
    town2_hp = 1000;
    
    for (let client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === 'lobby') {
            clientRoom.set(client, 'game');
            
            client.send(JSON.stringify({
                type: 'start_game'
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
            
            // Не логируем движение игрока
            if (data.type !== 'move') {
                console.log("📨 Received:", data.type, data.id || '');
            }
            
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
                    console.log(`📍 ${playerNickname} загрузил уровень`);
                    
                    const otherPlayers = {};
                    for (let id in gamePlayers) {
                        if (id !== playerId) {
                            otherPlayers[id] = {
                                nickname: gamePlayers[id].nickname,
                                character: gamePlayers[id].character,
                                x: gamePlayers[id].x,
                                y: gamePlayers[id].y,
                                flip: gamePlayers[id].flip,
                                team: gamePlayers[id].team
                            };
                        }
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'init_game',
                        players: otherPlayers,
                        my_team: gamePlayers[playerId].team,
                        town1_hp: town1_hp,
                        town2_hp: town2_hp
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
                    
                case 'town_damage':
                    console.log(`\n🏰 ======================== TOWN_DAMAGE ========================`);
                    console.log(`📨 Получено сообщение:`, data);
                    console.log(`Игрок ID: ${playerId}`);
                    console.log(`Игрок имя: ${playerNickname}`);
                    console.log(`Комната: ${clientRoom.get(ws)}`);
                    
                    if (!gamePlayers[playerId]) {
                        console.log(`❌ ОШИБКА: Игрок НЕ в игре!`);
                        console.log(`🏰 ============================================================\n`);
                        break;
                    }
                    
                    const attackerTeam = gamePlayers[playerId].team;
                    const townId = data.town_id;
                    const damage = data.damage || 0;
                    
                    console.log(`⚔️ Команда: ${attackerTeam}, Башня: ${townId}, Урон: ${damage}`);
                    
                    if ((townId === 1 && attackerTeam === 1) || (townId === 2 && attackerTeam === 2)) {
                        console.log(`❌ БЛОКИРОВАН: атака на свою башню!`);
                        console.log(`🏰 ============================================================\n`);
                        break;
                    }
                    
                    console.log(`✅ АТАКА РАЗРЕШЕНА`);
                    console.log(`ДО: Башня 1=${town1_hp}, Башня 2=${town2_hp}`);
                    
                    if (townId === 1) {
                        town1_hp = Math.max(0, town1_hp - damage);
                    } else if (townId === 2) {
                        town2_hp = Math.max(0, town2_hp - damage);
                    }
                    
                    console.log(`ПОСЛЕ: Башня 1=${town1_hp}, Башня 2=${town2_hp}`);
                    
                    const damageMsg = {
                        type: 'town_damage',
                        town_id: townId,
                        damage: damage,
                        new_hp: townId === 1 ? town1_hp : town2_hp
                    };
                    console.log(`📤 Отправляю:`, damageMsg);
                    broadcastToGame(damageMsg);
                    
                    if (town1_hp <= 0) {
                        console.log("🏆 ПОБЕДА! Команда 2 выиграла!");
                        broadcastToGame({ type: 'game_over', winner: 2 });
                    } else if (town2_hp <= 0) {
                        console.log("🏆 ПОБЕДА! Команда 1 выиграла!");
                        broadcastToGame({ type: 'game_over', winner: 1 });
                    }
                    console.log(`🏰 ============================================================\n`);
                    break;
                    
                case 'damage':
                    if (!gamePlayers[data.target_id]) break;
                    
                    const attacker = gamePlayers[data.attacker_id];
                    const target = gamePlayers[data.target_id];
                    
                    if (attacker && target && attacker.team !== target.team) {
                        broadcastToGame({
                            type: 'damage',
                            target_id: data.target_id,
                            damage: data.damage,
                            attacker_id: data.attacker_id
                        });
                    }
                    break;
                    
                case 'death':
                    if (gamePlayers[data.id]) delete gamePlayers[data.id];
                    broadcastToGame({ type: 'death', id: data.id });
                    break;
                    
                case 'chat':
                    broadcastToGame({
                        type: 'chat',
                        nickname: data.nickname,
                        message: data.message
                    });
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
            console.log("❌ Error:", e);
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
