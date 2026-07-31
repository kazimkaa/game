const http = require("http");
const { WebSocketServer } = require("ws");

// ПРОСТОЙ СЕРВЕР БЕЗ КОЛЛИЗИИ

const PORT = 3000;
const HOST = "0.0.0.0";

console.log("=== ПРОСТОЙ GAME SERVER ===");
console.log(`Запуск на ${HOST}:${PORT}`);

// HTTP сервер для health check
const server = http.createServer((req, res) => {
    console.log("HTTP запрос:", req.url);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Simple Game Server Online");
});

// WebSocket сервер
const wss = new WebSocketServer({ server });

// Хранилище игроков
const players = new Map();
let playerIdCounter = 1;

// Запуск сервера
server.listen(PORT, HOST, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`Ожидание подключений...`);
});

// Обработка подключений
wss.on("connection", (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`🔌 Новое подключение от ${clientIP}`);
    
    ws.id = null;
    ws.isAlive = true;
    
    // Проверка соединения
    ws.on("pong", () => {
        ws.isAlive = true;
    });
    
    // Обработка сообщений
    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(`📨 Сообщение от ${ws.id || "unknown"}:`, message.type);
            
            handleMessage(ws, message);
        } catch (e) {
            console.error("❌ Ошибка парсинга:", e.message);
        }
    });
    
    // Обработка отключения
    ws.on("close", () => {
        console.log(`🚪 Отключение: ${ws.id || "unknown"}`);
        if (ws.id && players.has(ws.id)) {
            const player = players.get(ws.id);
            
            // Сообщаем всем об отключении
            broadcast({
                type: "player_left",
                id: ws.id
            });
            
            players.delete(ws.id);
            console.log(`👋 Игрок ${player.nickname} покинул игру. Всего: ${players.size}`);
        }
    });
    
    // Обработка ошибок
    ws.on("error", (error) => {
        console.error("❌ WebSocket ошибка:", error.message);
    });
});

// Проверка активности соединений
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log("💀 Удаление неактивного клиента");
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Обработка сообщений
function handleMessage(ws, message) {
    switch (message.type) {
        case "join":
            handleJoin(ws, message);
            break;
        case "move":
            handleMove(ws, message);
            break;
        case "level_ready":
            handleLevelReady(ws, message);
            break;
        case "player_damage":
            handlePlayerDamage(ws, message);
            break;
        case "town_damage":
            handleTownDamage(ws, message);
            break;
        case "barracks_damage":
            handleBarracksDamage(ws, message);
            break;
        case "respawn":
            handleRespawn(ws, message);
            break;
        case "ping":
            send(ws, { type: "pong" });
            break;
        default:
            console.log("⚠️ Неизвестный тип:", message.type);
    }
}

// Обработка JOIN
function handleJoin(ws, message) {
    const id = message.id || `player_${playerIdCounter++}`;
    const nickname = message.nickname || "Player";
    const character = message.character || 1;
    
    // Если игрок уже существует
    if (players.has(id)) {
        console.log(`🔄 Переподключение: ${id}`);
        const existing = players.get(id);
        existing.ws = ws;
        ws.id = id;
        
        // Отправляем текущее состояние
        send(ws, {
            type: "init",
            my_team: existing.team,
            players: getPlayersList(id)
        });
        
        return;
    }
    
    // Распределение по командам
    let team1 = 0;
    let team2 = 0;
    for (const p of players.values()) {
        if (p.team === 1) team1++;
        if (p.team === 2) team2++;
    }
    const team = team1 <= team2 ? 1 : 2;
    
    // Создаём игрока
    const player = {
        id: id,
        ws: ws,
        nickname: nickname,
        character: character,
        team: team,
        x: team === 1 ? 300 : 1600,
        y: 450,
        flip: false,
        hp: 100,
        dead: false
    };
    
    players.set(id, player);
    ws.id = id;
    
    console.log(`✅ Игрок ${nickname} (${id}) присоединился! Команда: ${team}. Всего: ${players.size}`);
    
    // Отправляем инициализацию игроку
    send(ws, {
        type: "init",
        my_team: team,
        players: getPlayersList(id)
    });
    
    // Сообщаем всем о новом игроке
    broadcast({
        type: "player_joined",
        id: id,
        x: player.x,
        y: player.y,
        flip: false,
        nickname: nickname,
        character: character,
        team: team
    }, ws);
    
    // Проверяем начало игры
    checkGameStart();
}

// Получение списка игроков
function getPlayersList(excludeId = null) {
    const result = {};
    for (const [id, p] of players) {
        if (id === excludeId) continue;
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

// Обработка движения
function handleMove(ws, message) {
    const player = players.get(ws.id);
    if (!player) return;
    
    player.x = message.x;
    player.y = message.y;
    player.flip = message.flip;
    
    broadcast({
        type: "player_moved",
        id: player.id,
        x: player.x,
        y: player.y,
        flip: player.flip
    }, ws);
}

// Обработка level_ready
function handleLevelReady(ws, message) {
    const player = players.get(ws.id);
    if (!player) return;
    
    player.x = message.x;
    player.y = message.y;
    console.log(`🎮 Игрок ${player.nickname} готов`);
}

// Обработка урона игроку
function handlePlayerDamage(ws, message) {
    const attacker = players.get(ws.id);
    const target = players.get(message.target_id);
    
    if (!attacker || !target) return;
    if (target.team === attacker.team) return;
    if (target.dead) return;
    
    const damage = message.damage || 25;
    target.hp -= damage;
    
    if (target.hp <= 0) {
        target.hp = 0;
        target.dead = true;
        console.log(`💀 Игрок ${target.nickname} убит`);
    }
    
    broadcast({
        type: "player_damage",
        target_id: target.id,
        new_hp: target.hp
    });
    
    if (target.dead) {
        broadcast({
            type: "respawn",
            id: target.id,
            x: target.team === 1 ? 300 : 1600,
            y: 450,
            hp: 100
        });
        
        // Воскрешение через 5 секунд
        setTimeout(() => {
            if (!players.has(target.id)) return;
            
            target.hp = 100;
            target.dead = false;
            
            broadcast({
                type: "player_damage",
                target_id: target.id,
                new_hp: 100
            });
            
            console.log(`✨ Игрок ${target.nickname} воскрес`);
        }, 5000);
    }
}

// Обработка урона городу
function handleTownDamage(ws, message) {
    const player = players.get(ws.id);
    if (!player) return;
    
    const town = message.town_id;
    const damage = message.damage || 10;
    
    console.log(`🏰 Город ${town} получил ${damage} урона от ${player.nickname}`);
    
    broadcast({
        type: "town_damage",
        town_id: town,
        damage: damage,
        new_hp: 100 // упрощено
    });
}

// Обработка урона казарме
function handleBarracksDamage(ws, message) {
    const id = message.barracks_id;
    const damage = message.damage || 10;
    
    console.log(`🏠 Казарма ${id} получила ${damage} урона`);
    
    broadcast({
        type: "barracks_damage",
        barracks_id: id,
        new_hp: 100 // упрощено
    });
}

// Обработка воскрешения
function handleRespawn(ws, message) {
    const player = players.get(ws.id);
    if (!player) return;
    
    player.hp = 100;
    player.dead = false;
    player.x = player.team === 1 ? 300 : 1600;
    player.y = 450;
    
    send(ws, {
        type: "respawn",
        id: player.id,
        x: player.x,
        y: player.y,
        hp: player.hp
    });
}

// Проверка начала игры
let countdownTimer = null;
let gameState = "lobby";

function checkGameStart() {
    if (gameState === "lobby" && players.size >= 2) {
        console.log("⏱️ Достаточно игроков! Обратный отсчёт...");
        startCountdown();
    }
}

function startCountdown() {
    gameState = "countdown";
    let time = 15;
    
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
        
        console.log(`⏱️ Обратный отсчёт: ${time} сек`);
        
        if (time <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            startGame();
        }
    }, 1000);
}

function startGame() {
    gameState = "playing";
    console.log("🚀 ИГРА НАЧАЛАСЬ!");
    
    broadcast({
        type: "start_game"
    });
    
    broadcast({
        type: "init_game",
        players: getPlayersList(),
        town1_hp: 1000,
        town2_hp: 1000,
        barracks1_hp: 500,
        barracks2_hp: 500,
        barracks1_destroyed: false,
        barracks2_destroyed: false
    });
}

// Отправка сообщения
function send(ws, data) {
    if (ws.readyState === 1) { // WebSocket.OPEN
        try {
            ws.send(JSON.stringify(data));
        } catch (e) {
            console.error("❌ Ошибка отправки:", e.message);
        }
    }
}

// Рассылка всем
function broadcast(data, exceptWs = null) {
    let count = 0;
    for (const player of players.values()) {
        if (player.ws !== exceptWs) {
            send(player.ws, data);
            count++;
        }
    }
    console.log(`📢 Рассылка ${data.type} → ${count} клиентов`);
}

// Обработка ошибок процесса
process.on("uncaughtException", (error) => {
    console.error("💥 Неперехваченное исключение:", error.message);
});

process.on("unhandledRejection", (reason) => {
    console.error("💥 Unhandled Rejection:", reason);
});

console.log("⏳ Ожидание подключений...");
