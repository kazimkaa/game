const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};
const clientRoom = new Map();
const clientId = new Map();
const creeps = {};
let creepIdCounter = 0;
let creepSpawnInterval = null;
let creepMoveInterval = null;

let town1_hp = 1000;
let town2_hp = 1000;

let barracks1_hp = 500;
let barracks2_hp = 500;
let barracks1_destroyed = false;
let barracks2_destroyed = false;

let countdownActive = false;
let countdownValue = 15;
let countdownInterval = null;

const PLAYER_MAX_HP = 100;

app.get('/', (req, res) => res.send('Multiplayer Server Active'));
app.use(express.static('public'));

function broadcastToRoom(room, data) {
    const packet = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === room) {
            client.send(packet);
        }
    });
}

function spawnCreep(team) {
    if ((team === 1 && barracks1_destroyed) || (team === 2 && barracks2_destroyed)) {
        return;
    }
    creepIdCounter++;
    const creepId = `creep_${creepIdCounter}`;
    creeps[creepId] = { 
        id: creepId, 
        team: team, 
        x: (team === 1 ? -830.0 : 1950.0), 
        y: (team === 1 ? 463.0 : 462.0), 
        hp: 30,
        targetX: (team === 1 ? 1600 : 300),
        speed: 1
    };
    broadcastToRoom('game', { type: 'creep_spawn', ...creeps[creepId] });
}

function moveCreeps() {
    for (let creepId in creeps) {
        const creep = creeps[creepId];
        if (creep.x < creep.targetX) {
            creep.x += creep.speed;
        } else if (creep.x > creep.targetX) {
            creep.x -= creep.speed;
        }
        broadcastToRoom('game', { type: 'creep_move', id: creepId, x: creep.x, y: creep.y });
    }
}

function assignTeams() {
    const ids = Object.keys(gamePlayers);
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    ids.forEach((id, i) => {
        gamePlayers[id].team = (i < Math.ceil(ids.length / 2)) ? 1 : 2;
    });
}

function stopGameIntervals() {
    if (creepSpawnInterval) {
        clearInterval(creepSpawnInterval);
        creepSpawnInterval = null;
    }
    if (creepMoveInterval) {
        clearInterval(creepMoveInterval);
        creepMoveInterval = null;
    }
}

function startGameForAll() {
    stopGameIntervals();
    
    for (let id in creeps) delete creeps[id];
    creepIdCounter = 0;
    
    Object.keys(lobbyPlayers).forEach(id => {
        gamePlayers[id] = { ...lobbyPlayers[id], hp: PLAYER_MAX_HP, is_dead: false };
        delete lobbyPlayers[id];
    });
    
    assignTeams();
    town1_hp = 1000;
    town2_hp = 1000;
    barracks1_hp = 500;
    barracks2_hp = 500;
    barracks1_destroyed = false;
    barracks2_destroyed = false;
    
    spawnCreep(1);
    spawnCreep(2);
    creepSpawnInterval = setInterval(() => {
        spawnCreep(1);
        spawnCreep(2);
    }, 30000);
    
    creepMoveInterval = setInterval(moveCreeps, 100);
    
    wss.clients.forEach(client => {
        if (clientRoom.get(client) === 'lobby') {
            clientRoom.set(client, 'game');
            client.send(JSON.stringify({ type: 'start_game' }));
        }
    });
}

wss.on('connection', (ws) => {
    let playerId = null;
    
    ws.on('message', data => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'join') {
                playerId = message.id;
                clientId.set(ws, playerId);
                clientRoom.set(ws, 'lobby');
                
                lobbyPlayers[playerId] = { 
                    nickname: message.nickname || "Player", 
                    character: message.character || 1, 
                    x: message.x, 
                    y: message.y, 
                    flip: false 
                };
                
                const playersInLobby = {};
                for (let id in lobbyPlayers) {
                    if (id !== playerId) playersInLobby[id] = lobbyPlayers[id];
                }
                ws.send(JSON.stringify({ type: 'init', players: playersInLobby }));
                broadcastToRoom('lobby', { type: 'player_joined', id: playerId, ...lobbyPlayers[playerId] });
                
                const playersCount = Object.keys(lobbyPlayers).length;
                if (playersCount >= 2 && !countdownActive) {
                    countdownActive = true;
                    countdownValue = 15;
                    broadcastToRoom('lobby', { type: 'countdown_start', time: countdownValue });
                    
                    if (countdownInterval) clearInterval(countdownInterval);
                    countdownInterval = setInterval(() => {
                        countdownValue--;
                        if (countdownValue <= 0) {
                            clearInterval(countdownInterval);
                            countdownInterval = null;
                            countdownActive = false;
                            startGameForAll();
                        } else {
                            broadcastToRoom('lobby', { type: 'countdown_update', time: countdownValue });
                        }
                    }, 1000);
                }
                return;
            }
            
            const pid = clientId.get(ws);
            if (!pid) return;
            
            switch (message.type) {
                case 'move':
                    const room = clientRoom.get(ws);
                    const list = room === 'lobby' ? lobbyPlayers : gamePlayers;
                    if (list[pid]) {
                        list[pid].x = message.x;
                        list[pid].y = message.y;
                        list[pid].flip = message.flip;
                        broadcastToRoom(room, { type: 'player_moved', id: pid, x: message.x, y: message.y, flip: message.flip });
                    }
                    break;
                    
                case 'chat':
                    broadcastToRoom(clientRoom.get(ws), { type: 'chat', nickname: message.nickname, message: message.message });
                    break;
                    
                case 'player_damage': {
                    const attacker = gamePlayers[pid];
                    const target = gamePlayers[message.target_id];
                    if (!attacker || !target || attacker.team === target.team || target.is_dead) break;
                    const damage = Math.min(Math.max(parseInt(message.damage) || 0, 0), 200);
                    target.hp = Math.max(0, (target.hp ?? PLAYER_MAX_HP) - damage);
                    broadcastToRoom('game', { type: 'player_damage', target_id: message.target_id, damage: damage, new_hp: target.hp, attacker_id: pid });
                    if (target.hp <= 0) target.is_dead = true;
                    break;
                }
                    
                case 'creep_damage': {
                    const creep = creeps[message.creep_id];
                    if (creep) {
                        creep.hp -= message.damage;
                        broadcastToRoom('game', { type: 'creep_damage', id: message.creep_id, new_hp: creep.hp });
                        if (creep.hp <= 0) {
                            delete creeps[message.creep_id];
                            broadcastToRoom('game', { type: 'creep_destroy', id: message.creep_id });
                        }
                    }
                    break;
                }
                    
                case 'town_damage': {
                    const player = gamePlayers[pid];
                    if (!player) break;
                    if ((message.town_id === 1 && player.team === 1) || (message.town_id === 2 && player.team === 2)) break;
                    const dmg = Math.min(Math.max(parseInt(message.damage) || 0, 0), 200);
                    if (message.town_id === 1) town1_hp = Math.max(0, town1_hp - dmg);
                    else town2_hp = Math.max(0, town2_hp - dmg);
                    const new_hp = message.town_id === 1 ? town1_hp : town2_hp;
                    broadcastToRoom('game', { type: 'town_damage', town_id: message.town_id, damage: dmg, new_hp: new_hp });
                    if (town1_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 2 });
                    else if (town2_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 1 });
                    break;
                }
                    
                case 'barracks_damage': {
                    const player = gamePlayers[pid];
                    if (!player) break;
                    if ((message.barracks_id === 1 && player.team === 1) || (message.barracks_id === 2 && player.team === 2)) break;
                    const dmg = Math.min(Math.max(parseInt(message.damage) || 0, 0), 200);
                    
                    if (message.barracks_id === 1) {
                        barracks1_hp = Math.max(0, barracks1_hp - dmg);
                        if (barracks1_hp <= 0 && !barracks1_destroyed) {
                            barracks1_destroyed = true;
                            broadcastToRoom('game', { type: 'barracks_destroyed', barracks_id: 1 });
                        }
                        broadcastToRoom('game', { type: 'barracks_damage', barracks_id: 1, damage: dmg, new_hp: barracks1_hp });
                    } else {
                        barracks2_hp = Math.max(0, barracks2_hp - dmg);
                        if (barracks2_hp <= 0 && !barracks2_destroyed) {
                            barracks2_destroyed = true;
                            broadcastToRoom('game', { type: 'barracks_destroyed', barracks_id: 2 });
                        }
                        broadcastToRoom('game', { type: 'barracks_damage', barracks_id: 2, damage: dmg, new_hp: barracks2_hp });
                    }
                    break;
                }
                    
                case 'respawn': {
                    const player = gamePlayers[pid];
                    if (!player) break;
                    player.hp = PLAYER_MAX_HP;
                    player.is_dead = false;
                    const spawnX = player.team === 1 ? 300 : 1600;
                    broadcastToRoom('game', { type: 'respawn', id: pid, x: spawnX, y: 450, hp: PLAYER_MAX_HP });
                    break;
                }
                    
                case 'level_ready': {
                    const player = gamePlayers[pid];
                    if (!player) return;
                    const others = {};
                    for (let id in gamePlayers) {
                        if (id !== pid) others[id] = gamePlayers[id];
                    }
                    const currentCreeps = {};
                    for (let id in creeps) currentCreeps[id] = creeps[id];
                    ws.send(JSON.stringify({
                        type: 'init_game',
                        players: others,
                        my_team: player.team,
                        town1_hp: town1_hp,
                        town2_hp: town2_hp,
                        barracks1_hp: barracks1_hp,
                        barracks2_hp: barracks2_hp,
                        barracks1_destroyed: barracks1_destroyed,
                        barracks2_destroyed: barracks2_destroyed,
                        creeps: currentCreeps
                    }));
                    break;
                }
            }
        } catch (e) {}
    });
    
    ws.on('close', () => {
        const pid = clientId.get(ws);
        if (pid) {
            delete lobbyPlayers[pid];
            delete gamePlayers[pid];
            broadcastToRoom('game', { type: 'player_left', id: pid });
            broadcastToRoom('lobby', { type: 'player_left', id: pid });
            
            if (Object.keys(lobbyPlayers).length < 2 && countdownActive) {
                if (countdownInterval) {
                    clearInterval(countdownInterval);
                    countdownInterval = null;
                }
                countdownActive = false;
                broadcastToRoom('lobby', { type: 'countdown_cancel' });
            }
        }
        clientId.delete(ws);
        clientRoom.delete(ws);
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0');
