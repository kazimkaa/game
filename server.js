const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const lobbyPlayers = {};
const gamePlayers = {};
const clientRoom = new Map();

let town1_hp = 1000;
let town2_hp = 1000;

let countdownActive = false;
let countdownValue = 15;
let countdownInterval = null;

const PLAYER_MAX_HP = 100;

app.get('/', (req, res) => res.send('Multiplayer Server Active'));

function broadcastToRoom(room, data) {
    const packet = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && clientRoom.get(client) === room) {
            client.send(packet);
        }
    });
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
    console.log("Игра начинается!");

    Object.keys(lobbyPlayers).forEach(id => {
        gamePlayers[id] = {
            ...lobbyPlayers[id],
            hp: PLAYER_MAX_HP
        };
        delete lobbyPlayers[id];
    });

    assignTeams();
    town1_hp = 1000;
    town2_hp = 1000;

    wss.clients.forEach(client => {
        if (clientRoom.get(client) === 'lobby') {
            clientRoom.set(client, 'game');
            client.send(JSON.stringify({ type: 'start_game' }));
        }
    });
}

wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const room = clientRoom.get(ws);

            switch (data.type) {

                case 'join':
                    playerId = data.id;
                    clientRoom.set(ws, 'lobby');
                    lobbyPlayers[playerId] = {
                        nickname: data.nickname || "Player",
                        character: data.character || 1,
                        x: data.x, y: data.y, flip: false
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

                        console.log(`Лобби (${playersCount} чел.). Отсчет пошел.`);
                        broadcastToRoom('lobby', { type: 'countdown_start', time: countdownValue });

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
                    break;

                case 'move':
                    const list = room === 'lobby' ? lobbyPlayers : gamePlayers;
                    if (list[playerId]) {
                        list[playerId].x = data.x;
                        list[playerId].y = data.y;
                        list[playerId].flip = data.flip;

                        const movePacket = JSON.stringify({
                            type: 'player_moved',
                            id: playerId,
                            x: data.x, y: data.y,
                            flip: data.flip
                        });

                        wss.clients.forEach(c => {
                            if (c !== ws && c.readyState === WebSocket.OPEN && clientRoom.get(c) === room) {
                                c.send(movePacket);
                            }
                        });
                    }
                    break;

                case 'chat':
                    broadcastToRoom(room, { type: 'chat', nickname: data.nickname, message: data.message });
                    break;

                // --- УРОН ПО ИГРОКАМ ---
                case 'player_damage': {
                    const attacker = gamePlayers[playerId];
                    const target = gamePlayers[data.target_id];

                    if (!attacker || !target) {
                        console.log(`[player_damage] Не найден: attacker=${playerId}, target=${data.target_id}`);
                        break;
                    }
                    if (attacker.team === target.team) {
                        console.log(`[player_damage] Нельзя бить союзника`);
                        break;
                    }

                    const damage = Math.min(Math.max(parseInt(data.damage) || 0, 0), 200);
                    target.hp = Math.max(0, (target.hp ?? PLAYER_MAX_HP) - damage);

                    console.log(`[player_damage] ${playerId} -> ${data.target_id}: -${damage} HP (осталось: ${target.hp})`);

                    broadcastToRoom('game', {
                        type: 'player_damage',
                        target_id: data.target_id,
                        damage: damage,
                        new_hp: target.hp,
                        attacker_id: playerId
                    });
                    break;
                }

                // --- УРОН ПО БАШНЯМ ---
                case 'town_damage': {
                    if (!gamePlayers[playerId]) break;
                    const team = gamePlayers[playerId].team;

                    if ((data.town_id === 1 && team === 1) || (data.town_id === 2 && team === 2)) {
                        console.log(`[town_damage] Нельзя бить свою башню`);
                        break;
                    }

                    const dmg = Math.min(Math.max(parseInt(data.damage) || 0, 0), 200);

                    if (data.town_id === 1) town1_hp = Math.max(0, town1_hp - dmg);
                    else town2_hp = Math.max(0, town2_hp - dmg);

                    const new_hp = data.town_id === 1 ? town1_hp : town2_hp;
                    console.log(`[town_damage] Башня ${data.town_id}: -${dmg} HP (осталось: ${new_hp})`);

                    broadcastToRoom('game', {
                        type: 'town_damage',
                        town_id: data.town_id,
                        damage: dmg,
                        new_hp: new_hp
                    });

                    if (town1_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 2 });
                    else if (town2_hp <= 0) broadcastToRoom('game', { type: 'game_over', winner: 1 });
                    break;
                }

                case 'level_ready':
                    if (!gamePlayers[playerId]) return;
                    const others = {};
                    for (let id in gamePlayers) {
                        if (id !== playerId) others[id] = gamePlayers[id];
                    }
                    ws.send(JSON.stringify({
                        type: 'init_game',
                        players: others,
                        my_team: gamePlayers[playerId].team,
                        town1_hp: town1_hp,
                        town2_hp: town2_hp
                    }));
                    break;
            }
        } catch (e) {
            console.log("Ошибка обработки сообщения:", e);
        }
    });

    ws.on('close', () => {
        if (playerId) {
            console.log(`Игрок ${playerId} покинул сеть.`);
            delete lobbyPlayers[playerId];
            delete gamePlayers[playerId];

            broadcastToRoom('game', { type: 'player_left', id: playerId });

            if (Object.keys(lobbyPlayers).length < 2 && countdownInterval) {
                console.log("Игрок вышел, отсчет остановлен.");
                clearInterval(countdownInterval);
                countdownInterval = null;
                countdownActive = false;
                broadcastToRoom('lobby', { type: 'countdown_cancel' });
            }
        }
    });
});

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
