const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

// ================= КОНФИГУРАЦИЯ =================

const PORT = 3000;
const HOST = "0.0.0.0"; // Слушаем на всех интерфейсах

const MAX_PLAYERS = 8;
const MIN_PLAYERS_TO_START = 2;
const COUNTDOWN_SECONDS = 15;

const PLAYER_HP = 100;
const TOWN_HP = 1000;
const BARRACKS_HP = 500;

const TEAM1_SPAWN = { x: 300, y: 450 };
const TEAM2_SPAWN = { x: 1600, y: 450 };

const TICK = 100;

// ================= СОСТОЯНИЕ СЕРВЕРА =================

const players = new Map();
const creeps = new Map();

let nextCreepId = 1;
let gameState = "lobby"; // lobby, countdown, playing, finished
let countdownTimer = null;
let creepTimer = null;

let town1_hp = TOWN_HP;
let town2_hp = TOWN_HP;
let barracks1_hp = BARRACKS_HP;
let barracks2_hp = BARRACKS_HP;
let barracks1_destroyed = false;
let barracks2_destroyed = false;

// ================= ЛОГИРОВАНИЕ =================

function log(message, type = "INFO") {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

// ================= СОЗДАНИЕ HTTP СЕРВЕРА =================

const server = http.createServer((req, res) => {
    log(`HTTP запрос: ${req.method} ${req.url}`, "HTTP");
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Game Server Online");
});

// ================= СОЗДАНИЕ WebSocket СЕРВЕРА =================

const wss = new WebSocketServer({ server });

wss.on("listening", () => {
    log(`Сервер запущен на ${HOST}:${PORT}`, "SERVER");
});

server.listen(PORT, HOST, () => {
    log(`HTTP сервер слушает на порту ${PORT}`, "SERVER");
});

// ================= ОБРАБОТКА ПОДКЛЮЧЕНИЙ =================

wss.on("connection", (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    log(`Новое подключение от ${clientIP}`, "CONNECTION");
    
    ws.playerId = null;
    ws.isAlive = true;
    
    // Обработка пинга для поддержания соединения
    ws.on("pong", () => {
        ws.isAlive = true;
    });
    
    // Обработка сообщений
    ws.on("message", (raw) => {
        handleMessage(ws, raw);
    });
    
    // Обработка отключения
    ws.on("close", () => {
        log(`Клиент отключился: ${ws.playerId || "unknown"}`, "CONNECTION");
        if (ws.playerId) {
            removePlayer(ws.playerId);
        }
    });
    
    // Обработка ошибок
    ws.on("error", (error) => {
        log(`Ошибка WebSocket: ${error.message}`, "ERROR");
    });
});

// ================= ПРОВЕРКА АКТИВНОСТИ СОЕДИНЕНИЙ =================

const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            log("Удаление неактивного клиента", "CLEANUP");
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on("close", () => {
    clearInterval(interval);
});

// ================= ОБРАБОТКА СООБЩЕНИЙ =================

function handleMessage(ws, raw) {
    let data;
    
    try {
        data = JSON.parse(raw.toString());
    } catch (e) {
        log(`Ошибка парсинга JSON: ${e.message}`, "ERROR");
        return;
    }
    
    const messageType = data.type || "unknown";
    log(`Получено сообщение: ${messageType} от ${ws.playerId || "unknown"}`, "MESSAGE");
    
    switch (data.type) {
        case "join":
            handleJoin(ws, data);
            break;
        case "move":
            handleMove(ws, data);
            break;
        case "level_ready":
            handleLevelReady(ws, data);
            break;
        case "player_damage":
            handlePlayerDamage(ws, data);
            break;
        case "town_damage":
            handleTownDamage(ws, data);
            break;
        case "barracks_damage":
            handleBarracksDamage(ws, data);
            break;
        case "respawn":
            handleRespawn(ws);
            break;
        case "ping":
            send(ws, { type: "pong" });
            break;
        default:
            log(`Неизвестный тип сообщения: ${data.type}`, "WARNING");
    }
}

// ================= ОБРАБОТКА JOIN =================

function handleJoin(ws, data) {
    const id = data.id;
    
    if (!id) {
        log("JOIN без ID", "WARNING");
        return;
    }
    
    // Проверка на максимум игроков
    if (players.size >= MAX_PLAYERS) {
        log("Сервер полон", "WARNING");
        send(ws, { type: "system_message", message: "Server full" });
        return;
    }
    
    // Переподключение существующего игрока
    if (players.has(id)) {
        log(`Переподключение игрока: ${id}`, "RECONNECT");
        const existingPlayer = players.get(id);
        existingPlayer.ws = ws;
        ws.playerId = id;
        
        // Отправляем текущее состояние
        send(ws, {
            type: "init",
            my_team: existingPlayer.team,
            players: getPlayers(id)
        });
        
        if (gameState === "playing") {
            send(ws, {
                type: "init_game",
                players: getPlayers(),
                town1_hp: town1_hp,
                town2_hp: town2_hp,
                barracks1_hp: barracks1_hp,
                barracks2_hp: barracks2_hp,
                barracks1_destroyed: barracks1_destroyed,
                barracks2_destroyed: barracks2_destroyed
            });
        }
        
        return;
    }
    
    // Создание нового игрока
    const team = getTeam();
    const spawn = team === 1 ? TEAM1_SPAWN : TEAM2_SPAWN;
    
    const player = {
        id: id,
        ws: ws,
        nickname: data.nickname || "Player",
        character: data.character || 1,
        team: team,
        x: spawn.x,
        y: spawn.y,
        flip: false,
        hp: PLAYER_HP,
        dead: false
    };
    
    players.set(id, player);
    ws.playerId = id;
    
    log(`Игрок присоединился: ${player.nickname} (${id}), команда: ${team}`, "JOIN");
    
    // Отправляем новому игроку инициализацию
    send(ws, {
        type: "init",
        my_team: team,
        players: getPlayers(id)
    });
    
    // Сообщаем всем о новом игроке
    broadcast({
        type: "player_joined",
        id: id,
        x: player.x,
        y: player.y,
        flip: false,
        nickname: player.nickname,
        character: player.character,
        team: player.team
    }, ws);
    
    // Проверяем начало игры
    checkStart();
}

// ================= РАСПРЕДЕЛЕНИЕ КОМАНД =================

function getTeam() {
    let t1 = 0;
    let t2 = 0;
    
    for (const p of players.values()) {
        if (p.team === 1) t1++;
        if (p.team === 2) t2++;
    }
    
    return t1 <= t2 ? 1 : 2;
}

// ================= ПОЛУЧЕНИЕ СПИСКА ИГРОКОВ =================

function getPlayers(exclude = null) {
    const result = {};
    
    for (const [id, p] of players) {
        if (id === exclude) continue;
        
        result[id] = {
            id: p.id,
            nickname: p.nickname,
            character: p.character,
            team: p.team,
            x: p.x,
            y: p.y,
            flip: p.flip,
            hp: p.hp
        };
    }
    
    return result;
}

// ================= ОБРАБОТКА ДВИЖЕНИЯ =================

function handleMove(ws, data) {
    const p = players.get(ws.playerId);
    if (!p) return;
    
    p.x = data.x;
    p.y = data.y;
    p.flip = data.flip;
    
    broadcast({
        type: "player_moved",
        id: p.id,
        x: p.x,
        y: p.y,
        flip: p.flip
    }, ws);
}

// ================= ОБРАБОТКА READY =================

function handleLevelReady(ws, data) {
    const p = players.get(ws.playerId);
    if (!p) return;
    
    p.x = data.x;
    p.y = data.y;
    
    log(`Игрок ${p.nickname} готов`, "GAME");
}

// ================= ОТПРАВКА СООБЩЕНИЯ =================

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(data));
        } catch (e) {
            log(`Ошибка отправки: ${e.message}`, "ERROR");
        }
    }
}

// ================= РАССЫЛКА ВСЕМ =================

function broadcast(data, except = null) {
    let sentCount = 0;
    
    for (const p of players.values()) {
        if (p.ws === except) continue;
        send(p.ws, data);
        sentCount++;
    }
    
    log(`Рассылка ${data.type} ${sentCount} клиентам`, "BROADCAST");
}

// ================= ПРОВЕРКА НАЧАЛА ИГРЫ =================

function checkStart() {
    if (gameState === "lobby" && players.size >= MIN_PLAYERS_TO_START) {
        log(`Достаточно игроков (${players.size}), запуск обратного отсчёта`, "GAME");
        startCountdown();
    }
}

// ================= ОБРАТНЫЙ ОТСЧЁТ =================

function startCountdown() {
    gameState = "countdown";
    let time = COUNTDOWN_SECONDS;
    
    broadcast({
        type: "countdown_start",
        time: time
    });
    
    countdownTimer = setInterval(() => {
        time--;
        
        broadcast({
            type: "countdown_update",
            time: time
        });
        
        log(`Обратный отсчёт: ${time} сек`, "GAME");
        
        if (time <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            startGame();
        }
    }, 1000);
}

// ================= НАЧАЛО ИГРЫ =================

function startGame() {
    gameState = "playing";
    log("ИГРА НАЧАЛАСЬ!", "GAME");
    
    broadcast({
        type: "start_game"
    });
    
    broadcast({
        type: "init_game",
        players: getPlayers(),
        town1_hp: town1_hp,
        town2_hp: town2_hp,
        barracks1_hp: barracks1_hp,
        barracks2_hp: barracks2_hp,
        barracks1_destroyed: barracks1_destroyed,
        barracks2_destroyed: barracks2_destroyed
    });
    
    startCreeps();
}

// ================= УРОН ИГРОКУ =================

function handlePlayerDamage(ws, data) {
    const attacker = players.get(ws.playerId);
    if (!attacker) return;
    
    const target = players.get(data.target_id);
    if (!target) return;
    
    if (target.team === attacker.team) return;
    if (target.dead) return;
    
    const damage = data.damage || 25;
    target.hp -= damage;
    
    if (target.hp <= 0) {
        target.hp = 0;
        target.dead = true;
    }
    
    broadcast({
        type: "player_damage",
        target_id: target.id,
        new_hp: target.hp
    });
    
    log(`Игрок ${attacker.nickname} нанёс ${damage} урона ${target.nickname}`, "COMBAT");
    
    if (target.dead) {
        broadcast({
            type: "respawn",
            id: target.id,
            x: target.team === 1 ? TEAM1_SPAWN.x : TEAM2_SPAWN.x,
            y: 450,
            hp: 100
        });
        
        setTimeout(() => {
            if (!players.has(target.id)) return;
            
            target.hp = 100;
            target.dead = false;
            
            broadcast({
                type: "player_damage",
                target_id: target.id,
                new_hp: 100
            });
            
            log(`Игрок ${target.nickname} воскрес`, "GAME");
        }, 5000);
    }
}

// ================= ВОСКРЕШЕНИЕ =================

function handleRespawn(ws) {
    const p = players.get(ws.playerId);
    if (!p) return;
    
    p.hp = 100;
    p.dead = false;
    
    p.x = p.team === 1 ? TEAM1_SPAWN.x : TEAM2_SPAWN.x;
    p.y = 450;
    
    send(ws, {
        type: "respawn",
        id: p.id,
        x: p.x,
        y: p.y,
        hp: p.hp
    });
}

// ================= УРОН ГОРОДУ =================

function handleTownDamage(ws, data) {
    const p = players.get(ws.playerId);
    if (!p) return;
    
    const town = data.town_id;
    const damage = data.damage || 10;
    
    if (town === 1) {
        town1_hp -= damage;
        if (town1_hp < 0) town1_hp = 0;
    } else {
        town2_hp -= damage;
        if (town2_hp < 0) town2_hp = 0;
    }
    
    broadcast({
        type: "town_damage",
        town_id: town,
        damage: damage,
        new_hp: town === 1 ? town1_hp : town2_hp
    });
    
    log(`Город ${town} получил ${damage} урона, HP: ${town === 1 ? town1_hp : town2_hp}`, "COMBAT");
    
    checkWin();
}

// ================= УРОН КАЗАРМЕ =================

function handleBarracksDamage(ws, data) {
    const id = data.barracks_id;
    const damage = data.damage || 10;
    let hp;
    
    if (id === 1) {
        barracks1_hp -= damage;
        if (barracks1_hp <= 0) {
            barracks1_hp = 0;
            barracks1_destroyed = true;
        }
        hp = barracks1_hp;
    } else {
        barracks2_hp -= damage;
        if (barracks2_hp <= 0) {
            barracks2_hp = 0;
            barracks2_destroyed = true;
        }
        hp = barracks2_hp;
    }
    
    broadcast({
        type: "barracks_damage",
        barracks_id: id,
        new_hp: hp
    });
    
    if (hp <= 0) {
        broadcast({
            type: "barracks_destroyed",
            barracks_id: id
        });
        log(`Казарма ${id} уничтожена`, "GAME");
    }
}

// ================= КРИПЫ =================

function startCreeps() {
    if (creepTimer) return;
    
    creepTimer = setInterval(() => {
        if (gameState !== "playing") return;
        
        spawnCreep(1);
        spawnCreep(2);
        
        log("Спавн крипов", "GAME");
    }, 15000);
}

function spawnCreep(team) {
    const id = "creep_" + nextCreepId++;
    
    const creep = {
        id: id,
        team: team,
        x: team === 1 ? 300 : 1600,
        y: 450,
        hp: 80
    };
    
    creeps.set(id, creep);
    
    broadcast({
        type: "creep_spawn",
        id: id,
        team: team,
        x: creep.x,
        y: creep.y,
        hp: creep.hp
    });
}

function creepTick() {
    for (const [id, c] of creeps) {
        if (c.team === 1) {
            c.x += 4;
        } else {
            c.x -= 4;
        }
        
        broadcast({
            type: "creep_move",
            id: id,
            x: c.x,
            y: c.y
        });
        
        // Дошёл до базы
        if (c.team === 1 && c.x >= 1700) {
            town2_hp -= 10;
            
            broadcast({
                type: "town_damage",
                town_id: 2,
                damage: 10,
                new_hp: town2_hp
            });
            
            removeCreep(id);
        }
        
        if (c.team === 2 && c.x <= 200) {
            town1_hp -= 10;
            
            broadcast({
                type: "town_damage",
                town_id: 1,
                damage: 10,
                new_hp: town1_hp
            });
            
            removeCreep(id);
        }
    }
    
    checkWin();
}

setInterval(creepTick, TICK);

// ================= УРОН КРИПУ =================

function handleCreepDamage(ws, data) {
    const creep = creeps.get(data.id);
    if (!creep) return;
    
    const damage = data.damage || 25;
    creep.hp -= damage;
    
    broadcast({
        type: "creep_damage",
        id: creep.id,
        new_hp: creep.hp
    });
    
    if (creep.hp <= 0) {
        removeCreep(creep.id);
    }
}

function removeCreep(id) {
    if (!creeps.has(id)) return;
    
    creeps.delete(id);
    
    broadcast({
        type: "creep_destroy",
        id: id
    });
}

// ================= ПРОВЕРКА ПОБЕДЫ =================

function checkWin() {
    if (town1_hp <= 0) {
        gameOver(2);
    }
    if (town2_hp <= 0) {
        gameOver(1);
    }
}

function gameOver(team) {
    if (gameState === "finished") return;
    
    gameState = "finished";
    log(`ИГРА ОКОНЧЕНА! Победила команда ${team}`, "GAME");
    
    broadcast({
        type: "game_over",
        winner: team
    });
    
    setTimeout(() => {
        resetGame();
    }, 10000);
}

// ================= УДАЛЕНИЕ ИГРОКА =================

function removePlayer(id) {
    const p = players.get(id);
    if (!p) return;
    
    log(`Удаление игрока: ${id}`, "PLAYER");
    
    players.delete(id);
    
    broadcast({
        type: "player_left",
        id: id
    });
    
    if (players.size === 0) {
        resetGame();
    }
}

// ================= СБРОС ИГРЫ =================

function resetGame() {
    log("Сброс игры", "GAME");
    
    gameState = "lobby";
    
    town1_hp = TOWN_HP;
    town2_hp = TOWN_HP;
    
    barracks1_hp = BARRACKS_HP;
    barracks2_hp = BARRACKS_HP;
    
    barracks1_destroyed = false;
    barracks2_destroyed = false;
    
    creeps.clear();
    
    for (const p of players.values()) {
        p.hp = 100;
        p.dead = false;
        
        p.x = p.team === 1 ? TEAM1_SPAWN.x : TEAM2_SPAWN.x;
        p.y = 450;
    }
    
    broadcast({
        type: "reset_lobby"
    });
    
    broadcast({
        type: "players_list",
        players: getPlayers()
    });
}

// ================= ОБРАБОТКА ОШИБОК ПРОЦЕССА =================

process.on("uncaughtException", (error) => {
    log(`Неперехваченное исключение: ${error.message}`, "ERROR");
    console.error(error);
});

process.on("unhandledRejection", (reason, promise) => {
    log(`Unhandled Rejection: ${reason}`, "ERROR");
});

// ================= ИНФОРМАЦИЯ ПРИ ЗАПУСКЕ =================

log("=== GAME SERVER STARTING ===", "SERVER");
log(`Node.js версия: ${process.version}`, "SERVER");
log(`Платформа: ${process.platform}`, "SERVER");
log(`Порт: ${PORT}`, "SERVER");
log(`Мин. игроков: ${MIN_PLAYERS_TO_START}`, "SERVER");
log(`Макс. игроков: ${MAX_PLAYERS}`, "SERVER");
