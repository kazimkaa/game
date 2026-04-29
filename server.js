const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};
const clientRoom = new Map();
const creeps = {}; // storage for creeps
let creepIdCounter = 0; // unique ID counter for creeps
let creepSpawnInterval = null; // FIXED: one interval for all games

let town1_hp = 1000;
let town2_hp = 1000;

// Barracks state
let barracks1_hp = 500;
let barracks2_hp = 500;
let barracks1_destroyed = false;
let barracks2_destroyed = false;

let countdownActive = false;
let countdownValue = 15;
let countdownInterval = null;

const PLAYER_MAX_HP = 100;

app.get('/', (req, res) => res.send('Multiplayer Server Active'));
app.use(express.static('public')); // Add static files

function broadcastToRoom(room, data) {
    const packet = JSON.stringify(data);
    let sentCount = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === room) {
            client.send(packet);
            sentCount++;
        }
    });
    console.log("Broadcast to room '" + room + "' sent to " + sentCount + " clients. Data: " + data.type);
}

// Function to spawn creep
function spawnCreep(team) {
    if ((team === 1 && barracks1_destroyed) || (team === 2 && barracks2_destroyed)) {
        console.log("Cannot spawn creep for team " + team + " - barracks destroyed!");
        return; // Check if barracks is destroyed
    }
    console.log("Spawning creep for team " + team + " at positions: x=" + (team === 1 ? -830.0 : 1950.0) + ", y=" + (team === 1 ? 463.0 : 462.0));
    creepIdCounter++;
    const creepId = `creep_${creepIdCounter}`;
    creeps[creepId] = { 
        id: creepId, 
        team: team, 
        x: (team === 1 ? -830.0 : 1950.0), 
        y: (team === 1 ? 463.0 : 462.0), 
        hp: 30, // Increased creep health
        targetX: (team === 1 ? 1600 : 300), // Target - enemy base
        speed: 1 // Movement speed
    };
    broadcastToRoom('game', { type: 'creep_spawn', ...creeps[creepId] });
}

// NEW: Function to move creeps
function moveCreeps() {
    for (let creepId in creeps) {
        const creep = creeps[creepId];
        // Simple movement towards target
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

function startGameForAll() {
    console.log("Game starting!");
    Object.keys(lobbyPlayers).forEach(id => {
        gamePlayers[id] = { ...lobbyPlayers[id], hp: PLAYER_MAX_HP };
        delete lobbyPlayers[id];
    });
    assignTeams();
    town1_hp = 1000;
    town2_hp = 1000;
    
    // Reset barracks state
    barracks1_hp = 500;
    barracks2_hp = 500;
    barracks1_destroyed = false;
    barracks2_destroyed = false;
    
    // Clear old creeps
    for (let id in creeps) delete creeps[id];
    
    // FIXED: Create only one interval for entire game
    if (creepSpawnInterval) clearInterval(creepSpawnInterval);
    
    // Spawn first creeps
    spawnCreep(1); spawnCreep(2);
    
    // Start creep spawning every 30 seconds for both teams
    creepSpawnInterval = setInterval(() => {
        spawnCreep(1); spawnCreep(2);
    }, 30000);
    
    // Start creep movement every 100ms
    setInterval(moveCreeps, 100);
    
    // Move all players to game room
    wss.clients.forEach(client => {
        if (clientRoom.get(client) === 'lobby') {
            clientRoom.set(client, 'game');
            client.send(JSON.stringify({ type: 'start_game' }));
        }
    });
}

wss.on('connection', (ws) => {
    console.log("New WebSocket connection established. Total clients: " + wss.clients.size);
    let playerId = null;

    ws.on('message', data => {
        try {
            const message = JSON.parse(data);
            console.log("Received message: " + message.type + " from client");
            
            // Handle join message first (before checking playerId)
            if (message.type === 'join') {
                playerId = message.id;
                console.log("Player " + playerId + " (" + message.nickname + ") joined lobby");
                clientRoom.set(ws, 'lobby');
                lobbyPlayers[playerId] = { nickname: message.nickname || "Player", character: message.character || 1, x: message.x, y: message.y, flip: false };
                const playersInLobby = {};
                for (let id in lobbyPlayers) { if (id !== playerId) playersInLobby[id] = lobbyPlayers[id]; }
                console.log("Sending init to " + playerId + " with " + Object.keys(playersInLobby).length + " other players");
                ws.send(JSON.stringify({ type: 'init', players: playersInLobby }));
                console.log("Broadcasting player_joined to lobby room. Total players: " + Object.keys(lobbyPlayers).length);
                broadcastToRoom('lobby', { type: 'player_joined', id: playerId, ...lobbyPlayers[playerId] });

                const playersCount = Object.keys(lobbyPlayers).length;
                if (playersCount >= 2 && !countdownActive) {
                    countdownActive = true; countdownValue = 15;
                    broadcastToRoom('lobby', { type: 'countdown_start', time: countdownValue });
                    countdownInterval = setInterval(() => {
                        countdownValue--;
                        if (countdownValue <= 0) {
                            clearInterval(countdownInterval); countdownInterval = null; countdownActive = false;
                            startGameForAll();
                        } else { broadcastToRoom('lobby', { type: 'countdown_update', time: countdownValue }); }
                    }, 1000);
                }
                return;
            }
            
            const playerId = clientRoom.get(ws);
            if (!playerId) {
                console.log("No playerId found for this client, message type: " + message.type);
                return;
            }
            
            switch (message.type) {
                case 'move':
                    const list = clientRoom.get(ws) === 'lobby' ? lobbyPlayers : gamePlayers;
                    if (list[playerId]) {
                        list[playerId].x = message.x; list[playerId].y = message.y; list[playerId].flip = message.flip;
                        const movePacket = JSON.stringify({ type: 'player_moved', id: playerId, x: message.x, y: message.y, flip: message.flip });
                        wss.clients.forEach(c => { if (c !== ws && c.readyState === WebSocket.OPEN && clientRoom.get(c) === clientRoom.get(ws)) c.send(movePacket); });
                    }
                    break;

                case 'chat':
                    broadcastToRoom(clientRoom.get(ws), { type: 'chat', nickname: message.nickname, message: message.message });
                    break;

                case 'player_damage': {
                    const attacker = gamePlayers[playerId];
                    const target = gamePlayers[message.target_id];
                    if (!attacker || !target || attacker.team === target.team || target.is_dead) break;
                    const damage = Math.min(Math.max(parseInt(message.damage) || 0, 0), 200);
                    target.hp = Math.max(0, (target.hp ?? PLAYER_MAX_HP) - damage);
                    broadcastToRoom('game', { type: 'player_damage', target_id: message.target_id, damage: damage, new_hp: target.hp, attacker_id: playerId });
                    if (target.hp <= 0) { target.is_dead = true; }
                    break;
                }

                case 'creep_damage': {
                    if (!gamePlayers[playerId]) break;
                    const creepId = message.creep_id;
                    if (creeps[creepId]) {
                        creeps[creepId].hp -= message.damage;
                        broadcastToRoom('game', { type: 'creep_damage', id: creepId, new_hp: creeps[creepId].hp });
                        if (creeps[creepId].hp <= 0) { delete creeps[creepId]; broadcastToRoom('game', { type: 'creep_destroy', id: creepId }); }
                    }
                    break;
                }

                case 'town_damage': {
                    if (!gamePlayers[playerId]) break;
                    const team = gamePlayers[playerId].team;
                    if ((message.town_id === 1 && team === 1) || (message.town_id === 2 && team === 2)) break;
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
                    if (!gamePlayers[playerId]) break;
                    const team = gamePlayers[playerId].team;
                    if ((message.barracks_id === 1 && team === 1) || (message.barracks_id === 2 && team === 2)) break;
                    const dmg = Math.min(Math.max(parseInt(message.damage) || 0, 0), 200);
                    console.log("Barracks " + message.barracks_id + " damaged by team " + team + " for " + dmg + " damage. Current HP: " + (message.barracks_id === 1 ? barracks1_hp : barracks2_hp));
                    
                    if (message.barracks_id === 1) {
                        barracks1_hp = Math.max(0, barracks1_hp - dmg);
                        if (barracks1_hp <= 0 && !barracks1_destroyed) {
                            barracks1_destroyed = true;
                            broadcastToRoom('game', { type: 'barracks_destroyed', barracks_id: 1 });
                            console.log("Barracks 1 destroyed!");
                        }
                    } else {
                        barracks2_hp = Math.max(0, barracks2_hp - dmg);
                        if (barracks2_hp <= 0 && !barracks2_destroyed) {
                            barracks2_destroyed = true;
                            broadcastToRoom('game', { type: 'barracks_destroyed', barracks_id: 2 });
                            console.log("Barracks 2 destroyed!");
                        }
                    }
                    const new_hp = message.barracks_id === 1 ? barracks1_hp : barracks2_hp;
                    broadcastToRoom('game', { type: 'barracks_damage', barracks_id: message.barracks_id, damage: dmg, new_hp: new_hp });
                    break;
                }

                case 'respawn': {
                    if (!gamePlayers[playerId]) break;
                    gamePlayers[playerId].hp = PLAYER_MAX_HP; gamePlayers[playerId].is_dead = false;
                    const team = gamePlayers[playerId].team;
                    const spawnX = team === 1 ? 300 : 1600;
                    broadcastToRoom('game', { type: 'respawn', id: playerId, x: spawnX, y: 450, hp: PLAYER_MAX_HP });
                    break;
                }

                case 'level_ready':
                    if (!gamePlayers[playerId]) return;
                    const others = {};
                    for (let id in gamePlayers) { if (id !== playerId) others[id] = gamePlayers[id]; }
                    // Send information about current creeps
                    const currentCreeps = {};
                    for (let id in creeps) currentCreeps[id] = creeps[id];
                    ws.send(JSON.stringify({ type: 'init_game', players: others, my_team: gamePlayers[playerId].team, town1_hp, town2_hp, creeps: currentCreeps }));
                    break;
            }
        } catch (e) { console.log("Error:", e); }
    });

    ws.on('close', () => {
        if (playerId) {
            delete lobbyPlayers[playerId]; delete gamePlayers[playerId];
            broadcastToRoom('game', { type: 'player_left', id: playerId });
            if (Object.keys(lobbyPlayers).length < 2 && countdownInterval) {
                clearInterval(countdownInterval); countdownInterval = null; countdownActive = false;
                broadcastToRoom('lobby', { type: 'countdown_cancel' });
            }
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => { console.log(`Server running on ${PORT}`); });
