const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ============ ДАННЫЕ ============
const lobbyPlayers = {};        // { id: { nickname, character, x, y, flip } }
const gamePlayers = {};         // { id: { nickname, character, x, y, flip, team, hp, is_dead } }
const clientRoom = new Map();   // ws -> 'lobby' или 'game'
const clientId = new Map();     // ws -> player_id
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
const CREEP_HP = 30;

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

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
        hp: CREEP_HP,
        targetX: (team === 1 ? 1600 : 300),
        speed: 1
    };
    broadcastToRoom('game', { type: 'creep_spawn', ...creeps[creepId] });
}

function moveCreeps() {
    for (let creepId in creeps) {
        const creep = creeps[creepId];
        const dx = creep.targetX - creep.x;
        if (Math.abs(dx) > creep.speed) {
            creep.x += (dx > 0 ? creep.speed : -creep.speed);
            broadcastToRoom('game', { type: 'creep_move', id: creepId, x: creep.x, y: creep.y });
        } else {
            const targetTown = creep.team === 1 ? 2 : 1;
            const damage = 10;

            if (targetTown === 1) {
                town1_hp = Math.max(0, town1_hp - damage);
                broadcastToRoom('game', { type: 'town_damage', town_id: 1, damage: damage, new_hp: town1_hp });
            } else {
                town2_hp = Math.max(0, town2_hp - damage);
                broadcastToRoom('game', { type: 'town_damage', town_id: 2, damage: damage, new_hp: town2_hp });
            }

            delete creeps[creepId];
            broadcastToRoom('game', { type: 'creep_destroy', id: creepId });

            if (town1_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 2 });
            else if (town2_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 1 });
        }
    }
}

function assignTeams() {
    const ids = Object.keys(gamePlayers);
    if (ids.length === 2) {
        gamePlayers[ids[0]].team = 1;
        gamePlayers[ids[1]].team = 2;
        return;
    }
    // Если больше 2 игроков - случайное распределение
    const shuffled = ids.sort(() => Math.random() - 0.5);
    shuffled.forEach((id, i) => {
        gamePlayers[id].team = (i < Math.ceil(shuffled.length / 2)) ? 1 : 2;
    });
}

function startGameForAll() {
    console.log('[SERVER] GAME STARTING');

    // Перемещаем игроков из лобби в игру
    Object.keys(lobbyPlayers).forEach(id => {
        gamePlayers[id] = {
            ...lobbyPlayers[id],
            hp: PLAYER_MAX_HP,
            is_dead: false
        };
        delete lobbyPlayers[id];
    });

    assignTeams();

    // Сбрасываем состояние
    town1_hp = 1000;
    town2_hp = 1000;
    barracks1_hp = 500;
    barracks2_hp = 500;
    barracks1_destroyed = false;
    barracks2_destroyed = false;

    // Очищаем крипов
    for (let id in creeps) delete creeps[id];
    if (creepSpawnInterval) clearInterval(creepSpawnInterval);
    if (creepMoveInterval) clearInterval(creepMoveInterval);

    // Запускаем крипов
    spawnCreep(1);
    spawnCreep(2);
    creepSpawnInterval = setInterval(() => { spawnCreep(1); spawnCreep(2); }, 30000);
    creepMoveInterval = setInterval(moveCreeps, 100);

    // Переводим всех в игру
    wss.clients.forEach(client => {
        if (clientRoom.get(client) === 'lobby') {
            clientRoom.set(client, 'game');
            client.send(JSON.stringify({ type: 'start_game' }));
        }
    });

    // Отправляем каждому игроку данные
    wss.clients.forEach(client => {
        if (clientRoom.get(client) === 'game' && client.readyState === WebSocket.OPEN) {
            const pid = clientId.get(client);
            if (pid && gamePlayers[pid]) {
                const others = {};
                for (let id in gamePlayers) {
                    if (id !== pid) others[id] = gamePlayers[id];
                }
                const currentCreeps = {};
                for (let id in creeps) currentCreeps[id] = creeps[id];

                client.send(JSON.stringify({
                    type: 'init_game',
                    players: others,
                    my_team: gamePlayers[pid].team,
                    town1_hp: town1_hp,
                    town2_hp: town2_hp,
                    barracks1_hp: barracks1_hp,
                    barracks2_hp: barracks2_hp,
                    barracks1_destroyed: barracks1_destroyed,
                    barracks2_destroyed: barracks2_destroyed,
                    creeps: currentCreeps
                }));
            }
        }
    });

    console.log(`[SERVER] Game started with ${Object.keys(gamePlayers).length} players`);
}

// ============ WEB SOCKET ============

wss.on('connection', (ws) => {
    console.log('[SERVER] New connection');
    let playerId = null;

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`[SERVER] Received: ${message.type}`);

            // --- JOIN ---
            if (message.type === 'join') {
                playerId = message.id;
                clientId.set(ws, playerId);
                clientRoom.set(ws, 'lobby');

                lobbyPlayers[playerId] = {
                    nickname: message.nickname || 'Player',
                    character: message.character || 1,
                    x: message.x || 500,
                    y: message.y || 300,
                    flip: false
                };

                console.log(`[SERVER] Player ${playerId} joined lobby`);

                // Отправляем новому игроку всех остальных
                const playersInLobby = {};
                for (let id in lobbyPlayers) {
                    if (id !== playerId) playersInLobby[id] = lobbyPlayers[id];
                }
                ws.send(JSON.stringify({ type: 'init', players: playersInLobby }));

                // Оповещаем всех о новом игроке
                broadcastToRoom('lobby', {
                    type: 'player_joined',
                    id: playerId,
                    ...lobbyPlayers[playerId]
                });

                // Запускаем обратный отсчет если >= 2 игроков
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

            // --- ОСТАЛЬНЫЕ СООБЩЕНИЯ ---
            const pid = clientId.get(ws);
            if (!pid) return;

            switch (message.type) {
                case 'move': {
                    const room = clientRoom.get(ws);
                    if (!room) break;

                    if (room === 'lobby') {
                        if (lobbyPlayers[pid]) {
                            lobbyPlayers[pid].x = message.x;
                            lobbyPlayers[pid].y = message.y;
                            lobbyPlayers[pid].flip = message.flip;
                            broadcastToRoom('lobby', {
                                type: 'player_moved',
                                id: pid,
                                x: message.x,
                                y: message.y,
                                flip: message.flip
                            });
                        }
                    } else if (room === 'game') {
                        if (gamePlayers[pid]) {
                            gamePlayers[pid].x = message.x;
                            gamePlayers[pid].y = message.y;
                            gamePlayers[pid].flip = message.flip;
                            broadcastToRoom('game', {
                                type: 'player_moved',
                                id: pid,
                                x: message.x,
                                y: message.y,
                                flip: message.flip
                            });
                        }
                    }
                    break;
                }

                case 'chat': {
                    broadcastToRoom(clientRoom.get(ws), {
                        type: 'chat',
                        nickname: message.nickname,
                        message: message.message
                    });
                    break;
                }

                case 'level_ready': {
                    console.log(`[SERVER] level_ready from ${pid}`);

                    // Если игрок еще не в gamePlayers - переносим
                    if (!gamePlayers[pid]) {
                        if (lobbyPlayers[pid]) {
                            gamePlayers[pid] = {
                                ...lobbyPlayers[pid],
                                hp: PLAYER_MAX_HP,
                                is_dead: false
                            };
                            delete lobbyPlayers[pid];
                        } else {
                            console.log(`[SERVER] Player ${pid} not found`);
                            break;
                        }
                    }

                    // Обновляем координаты
                    if (message.x !== undefined) {
                        gamePlayers[pid].x = message.x;
                        gamePlayers[pid].y = message.y;
                        gamePlayers[pid].flip = message.flip || false;
                    }

                    // Отправляем данные
                    const others = {};
                    for (let id in gamePlayers) {
                        if (id !== pid) others[id] = gamePlayers[id];
                    }
                    const currentCreeps = {};
                    for (let id in creeps) currentCreeps[id] = creeps[id];

                    ws.send(JSON.stringify({
                        type: 'init_game',
                        players: others,
                        my_team: gamePlayers[pid].team,
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

                case 'town_damage': {
                    if (!gamePlayers[pid]) break;
                    const team = gamePlayers[pid].team;
                    if ((message.town_id === 1 && team === 1) || (message.town_id === 2 && team === 2)) break;

                    const dmg = Math.min(Math.max(parseInt(message.damage) || 0, 0), 200);
                    if (message.town_id === 1) town1_hp = Math.max(0, town1_hp - dmg);
                    else town2_hp = Math.max(0, town2_hp - dmg);

                    broadcastToRoom('game', {
                        type: 'town_damage',
                        town_id: message.town_id,
                        damage: dmg,
                        new_hp: message.town_id === 1 ? town1_hp : town2_hp
                    });

                    if (town1_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 2 });
                    else if (town2_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 1 });
                    break;
                }

                case 'barracks_damage': {
                    if (!gamePlayers[pid]) break;
                    const team = gamePlayers[pid].team;
                    if ((message.barracks_id === 1 && team === 1) || (message.barracks_id === 2 && team === 2)) break;

                    const dmg = Math.min(Math.max(parseInt(message.damage) || 0, 0), 200);

                    if (message.barracks_id === 1 && !barracks1_destroyed) {
                        barracks1_hp = Math.max(0, barracks1_hp - dmg);
                        if (barracks1_hp <= 0) {
                            barracks1_destroyed = true;
                            broadcastToRoom('game', { type: 'barracks_destroyed', barracks_id: 1 });
                        }
                        broadcastToRoom('game', { type: 'barracks_damage', barracks_id: 1, new_hp: barracks1_hp });
                    } else if (message.barracks_id === 2 && !barracks2_destroyed) {
                        barracks2_hp = Math.max(0, barracks2_hp - dmg);
                        if (barracks2_hp <= 0) {
                            barracks2_destroyed = true;
                            broadcastToRoom('game', { type: 'barracks_destroyed', barracks_id: 2 });
                        }
                        broadcastToRoom('game', { type: 'barracks_damage', barracks_id: 2, new_hp: barracks2_hp });
                    }
                    break;
                }

                case 'player_damage': {
                    if (!gamePlayers[pid]) break;
                    const target_id = message.target_id;
                    const damage = parseInt(message.damage) || 0;

                    if (gamePlayers[target_id]) {
                        gamePlayers[target_id].hp = Math.max(0, gamePlayers[target_id].hp - damage);
                        broadcastToRoom('game', {
                            type: 'player_damage',
                            target_id: target_id,
                            new_hp: gamePlayers[target_id].hp
                        });

                        if (gamePlayers[target_id].hp <= 0) {
                            broadcastToRoom('game', {
                                type: 'player_dead',
                                id: target_id
                            });
                        }
                    }
                    break;
                }

                case 'respawn': {
                    if (!gamePlayers[pid]) break;
                    gamePlayers[pid].hp = PLAYER_MAX_HP;
                    gamePlayers[pid].is_dead = false;
                    const team = gamePlayers[pid].team;
                    const spawnX = team === 1 ? 300 : 1600;
                    broadcastToRoom('game', {
                        type: 'respawn',
                        id: pid,
                        x: spawnX,
                        y: 450,
                        hp: PLAYER_MAX_HP
                    });
                    break;
                }

                case 'creep_damage': {
                    if (!gamePlayers[pid]) break;
                    const creepId = message.creep_id;
                    if (creeps[creepId]) {
                        creeps[creepId].hp -= message.damage;
                        broadcastToRoom('game', { type: 'creep_damage', id: creepId, new_hp: creeps[creepId].hp });
                        if (creeps[creepId].hp <= 0) {
                            delete creeps[creepId];
                            broadcastToRoom('game', { type: 'creep_destroy', id: creepId });
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.log('[SERVER] Error:', e);
        }
    });

    ws.on('close', () => {
        const pid = clientId.get(ws);
        if (pid) {
            console.log(`[SERVER] Player ${pid} disconnected`);
            delete lobbyPlayers[pid];
            delete gamePlayers[pid];

            broadcastToRoom('game', { type: 'player_left', id: pid });
            broadcastToRoom('lobby', { type: 'player_left', id: pid });

            // Отменяем обратный отсчет если мало игроков
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
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});
