const http = require('http');
const WebSocket = require('ws');
const config = require('./config/settings');
const SyncManager = require('./sync');
const { broadcast, send, playersObject, spawn, readyCount, open } = require('./utils/helpers');
const Logger = require('./utils/logger');

const logger = new Logger('GAME');

// ============================================================
// INIT STATE
// ============================================================
const players = new Map();
const state = {
    status: 'lobby',
    countdown: config.COUNTDOWN_TIME,
    timer: config.GAME_TIME,
    winner: 0,
    blueTowerHp: 1000,
    redTowerHp: 1000,
    blueBarracksHp: 500,
    redBarracksHp: 500,
    blueBarracksDestroyed: false,
    redBarracksDestroyed: false,
    creeps: [],
    bots: [],
    nextCreepTeam: 1,
    nextCreepId: 1,
    animationTick: 0,
    animations: []
};

let countdownTimer = null;
let gameTimer = null;
let playerCheckTimer = null;
let creepTimer = null;
let playerRegenTimer = null;

// ============================================================
// HTTP SERVER
// ============================================================
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache'
        });
        res.end('OK');
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('WebSocket game server');
});

// ============================================================
// WEBSOCKET
// ============================================================
const wss = new WebSocket.Server({
    server: server,
    maxPayload: 1024 * 1024
});

// ============================================================
// SYNC MANAGER
// ============================================================
const syncManager = new SyncManager(wss, players, state);

// ============================================================
// START SERVER
// ============================================================
server.listen(config.PORT, '0.0.0.0', () => {
    logger.info('==========================================');
    logger.info('GAME SERVER STARTED');
    logger.info(`PORT: ${config.PORT}`);
    logger.info(`MAX PLAYERS: ${config.MAX_PLAYERS}`);
    logger.info(`MIN PLAYERS: ${config.MIN_PLAYERS}`);
    logger.info('==========================================');
});

// ============================================================
// KEEP ALIVE
// ============================================================
setInterval(() => {
    logger.game(`alive | players=${players.size} | status=${state.status} | creeps=${state.creeps.length} | bots=${state.bots ? state.bots.length : 0}`);
}, 30000);

// ============================================================
// FUNCTIONS
// ============================================================

function sendPlayerList(ws) {
    send(ws, {
        type: 'players_list',
        players: playersObject(players)
    });
}

function broadcastPlayerList() {
    broadcast(wss, {
        type: 'players_list',
        players: playersObject(players)
    });
}

function checkAllReady() {
    if (state.status !== 'lobby') return;
    if (players.size < config.MIN_PLAYERS) return;
    if (readyCount(players) < config.MIN_PLAYERS) return;

    logger.game('Все готовы. Запускаем countdown.');
    startCountdown();
}

function startCountdown() {
    if (countdownTimer) return;
    if (state.status === 'playing') return;

    state.status = 'countdown';
    state.countdown = config.COUNTDOWN_TIME;

    broadcast(wss, {
        type: 'countdown_start',
        time: state.countdown
    });

    logger.game(`Countdown started: ${state.countdown} seconds`);

    countdownTimer = setInterval(() => {
        if (state.status !== 'countdown') {
            clearInterval(countdownTimer);
            countdownTimer = null;
            return;
        }

        if (players.size < config.MIN_PLAYERS || readyCount(players) < config.MIN_PLAYERS) {
            logger.game('Недостаточно игроков. Countdown отменён.');
            cancelCountdown();
            return;
        }

        state.countdown--;
        broadcast(wss, {
            type: 'countdown_update',
            time: state.countdown
        });

        if (state.countdown <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            startGame();
        }
    }, 1000);
}

function cancelCountdown() {
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }

    state.status = 'lobby';
    state.countdown = config.COUNTDOWN_TIME;

    broadcast(wss, {
        type: 'countdown_cancel'
    });

    logger.game('Countdown отменён');
}

function startGame() {
    if (players.size < config.MIN_PLAYERS) {
        cancelCountdown();
        return;
    }

    state.status = 'playing';
    state.timer = config.GAME_TIME;

    const now = Date.now();
    players.forEach(p => {
        p.hp = config.PLAYER_MAX_HP;
        p.isDead = false;
        p.lastDamageTime = now;
    });

    state.bots = [];
    state.creeps = [];

    const data = playersObject(players);

    wss.clients.forEach(ws => {
        const id = ws.playerData?.id;
        const p = players.get(id);
        if (!p) return;

        send(ws, {
            type: 'init_game',
            players: data,
            my_team: p.team,
            town1_hp: state.blueTowerHp,
            town2_hp: state.redTowerHp,
            barracks1_hp: state.blueBarracksHp,
            barracks2_hp: state.redBarracksHp,
            barracks1_destroyed: state.blueBarracksDestroyed,
            barracks2_destroyed: state.redBarracksDestroyed
        });
    });

    broadcast(wss, { type: 'start_game' });
    broadcast(wss, { type: 'countdown_update', time: state.timer });

    // ЗАПУСКАЕМ ВСЕ СИНХРОНИЗАЦИИ
    syncManager.startAll();

    clearInterval(gameTimer);
    clearInterval(playerCheckTimer);
    clearInterval(creepTimer);
    clearInterval(playerRegenTimer);

    gameTimer = null;
    playerCheckTimer = null;
    creepTimer = null;
    playerRegenTimer = null;

    gameTimer = setInterval(() => {
        if (state.status !== 'playing') {
            clearInterval(gameTimer);
            gameTimer = null;
            return;
        }

        state.timer--;
        if (state.timer < 0) state.timer = 0;

        broadcast(wss, { type: 'countdown_update', time: state.timer });

        if (state.timer <= 0) {
            clearInterval(gameTimer);
            gameTimer = null;
            endGame(0);
        }
    }, 1000);

    playerCheckTimer = setInterval(checkPlayers, 3000);
    playerRegenTimer = setInterval(regeneratePlayers, config.PLAYER_REGEN_INTERVAL);
    creepTimer = setInterval(spawnCreep, config.CREEP_SPAWN_INTERVAL);

    logger.game('ИГРА НАЧАЛАСЬ');
}

// ============================================================
// MOVE
// ============================================================

function move(ws, data) {
    const id = ws.playerData?.id;
    if (!id) return;

    const p = players.get(id);
    if (!p || p.isDead) return;

    const x = Number(data.x);
    const y = Number(data.y);

    if (Number.isFinite(x)) p.x = x;
    if (Number.isFinite(y)) p.y = y;
    p.flip = !!data.flip;

    // Используем синхронизацию через syncManager
    syncManager.playerSync.syncPlayerMove(p.id, p.x, p.y, p.flip);
}

// ============================================================
// SPAWN CREEP
// ============================================================

function spawnCreep() {
    if (state.status !== 'playing') return;

    const team = state.nextCreepTeam;

    if (team === 1 && state.blueBarracksDestroyed) {
        state.nextCreepTeam = 2;
        return;
    }

    if (team === 2 && state.redBarracksDestroyed) {
        state.nextCreepTeam = 1;
        return;
    }

    const creep = {
        id: `creep_${state.nextCreepId++}`,
        team: team,
        hp: config.CREEP_MAX_HP,
        maxHp: config.CREEP_MAX_HP,
        x: team === 1 ? -1400 : 2590,
        y: config.GROUND_Y,
        direction: team === 1 ? 1 : -1
    };

    state.creeps.push(creep);
    state.nextCreepTeam = team === 1 ? 2 : 1;

    syncManager.creepSync.syncCreepSpawn(creep);
}

// ============================================================
// REGENERATE PLAYERS
// ============================================================

function regeneratePlayers() {
    if (state.status !== 'playing') return;

    const now = Date.now();
    players.forEach(p => {
        if (p.isDead) return;
        if (p.hp >= config.PLAYER_MAX_HP) {
            p.hp = config.PLAYER_MAX_HP;
            return;
        }

        const elapsed = now - Number(p.lastDamageTime || now);
        if (elapsed < config.PLAYER_REGEN_DELAY) return;

        const oldHp = p.hp;
        p.hp = Math.min(config.PLAYER_MAX_HP, p.hp + config.PLAYER_REGEN_AMOUNT);

        if (p.hp === oldHp) return;

        syncManager.playerSync.syncPlayerDamage(p.id, p.hp);
    });
}

// ============================================================
// PLAYER DAMAGE
// ============================================================

function playerDamage(_, data) {
    if (state.status !== 'playing') return;

    const id = String(data.target_id || '');
    const p = players.get(id);
    if (!p || p.isDead) return;

    const damage = Math.max(0, Number(data.damage) || 10);

    p.hp = Math.max(0, p.hp - damage);
    p.lastDamageTime = Date.now();

    syncManager.playerSync.syncPlayerDamage(p.id, p.hp);

    if (p.hp <= 0) {
        p.hp = 0;
        p.isDead = true;

        setTimeout(() => {
            const currentPlayer = players.get(p.id);
            if (!currentPlayer) return;
            if (state.status !== 'playing') return;
            if (!currentPlayer.isDead) return;
            respawn(currentPlayer.id);
        }, 3000);
    }
}

// ============================================================
// RESPAWN
// ============================================================

function respawn(id) {
    const p = players.get(String(id || ''));
    if (!p) return;
    if (state.status !== 'playing') return;
    if (!p.isDead) return;

    const position = spawn(p.team, true);

    p.hp = config.PLAYER_MAX_HP;
    p.isDead = false;
    p.x = position.x;
    p.y = position.y;
    p.flip = false;
    p.lastDamageTime = Date.now();

    syncManager.playerSync.syncPlayerRespawn(p.id, p.x, p.y, p.hp);
}

// ============================================================
// END GAME
// ============================================================

function endGame(winner) {
    if (state.status !== 'playing') return;

    state.status = 'finished';
    state.winner = winner;
    state.timer = 0;

    clearInterval(gameTimer);
    clearInterval(playerCheckTimer);
    clearInterval(creepTimer);
    clearInterval(playerRegenTimer);

    gameTimer = null;
    playerCheckTimer = null;
    creepTimer = null;
    playerRegenTimer = null;

    // ОСТАНАВЛИВАЕМ СИНХРОНИЗАЦИИ
    syncManager.stopAll();

    broadcast(wss, {
        type: 'countdown_update',
        time: 0
    });

    broadcast(wss, {
        type: 'game_over',
        winner_team: winner
    });

    logger.game(`ИГРА ЗАКОНЧЕНА | WINNER: ${winner}`);

    setTimeout(resetGame, 5000);
}

// ============================================================
// RESET GAME
// ============================================================

function resetGame() {
    state.status = 'lobby';
    state.countdown = config.COUNTDOWN_TIME;
    state.timer = config.GAME_TIME;
    state.winner = 0;
    state.blueTowerHp = 1000;
    state.redTowerHp = 1000;
    state.blueBarracksHp = 500;
    state.redBarracksHp = 500;
    state.blueBarracksDestroyed = false;
    state.redBarracksDestroyed = false;
    state.creeps = [];
    state.bots = [];
    state.nextCreepTeam = 1;
    state.nextCreepId = 1;
    state.animationTick = 0;
    state.animations = [];

    players.forEach(p => {
        const position = spawn(p.team, true);
        Object.assign(p, {
            inGame: false,
            hp: config.PLAYER_MAX_HP,
            isDead: false,
            x: position.x,
            y: position.y,
            flip: false,
            lastDamageTime: Date.now()
        });
    });

    broadcast(wss, {
        type: 'reset_lobby'
    });

    broadcastPlayerList();
    logger.game('Лобби сброшено');
}

// ============================================================
// CHECK PLAYERS
// ============================================================

function checkPlayers() {
    if (state.status !== 'playing') return;

    if (players.size < config.MIN_PLAYERS) {
        const remaining = players.size > 0 ? [...players.values()][0] : null;
        endGame(remaining ? remaining.team : 0);
    }
}

// ============================================================
// DISCONNECT
// ============================================================

function disconnect(ws) {
    const id = ws.playerData?.id;
    if (!id) return;
    if (!players.has(id)) return;

    if (state.bots) {
        state.bots = state.bots.filter(b => b.owner_id !== id);
    }
    players.delete(id);

    logger.network(`Покинул: ${id} | players=${players.size}`);

    syncManager.playerSync.syncPlayerLeft(id);
    broadcastPlayerList();

    if (state.bots && state.bots.length > 0) {
        syncManager.botSync.syncAll();
    }

    if (state.status === 'countdown' && (players.size < config.MIN_PLAYERS || readyCount(players) < config.MIN_PLAYERS)) {
        cancelCountdown();
    }

    if (state.status === 'playing') {
        checkPlayers();
    }
}

// ============================================================
// BOT FUNCTIONS
// ============================================================

function botSpawn(ws, data) {
    const ownerId = ws.playerData?.id;
    if (!ownerId) return;

    const p = players.get(ownerId);
    if (!p) return;

    if (state.status !== 'playing') {
        send(ws, { type: 'error', message: 'Игра не началась' });
        return;
    }

    const botId = String(data.bot_id || `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`);
    const x = Number(data.x || p.x);
    const y = Number(data.y || p.y);
    const team = Number(data.team || p.team);
    const hp = Number(data.hp) || config.BOT_MAX_HP;

    const playerBots = state.bots.filter(b => b.owner_id === ownerId && !b.isDead);
    if (playerBots.length >= config.MAX_BOTS_PER_PLAYER) {
        send(ws, { type: 'error', message: `Достигнут лимит ботов (${config.MAX_BOTS_PER_PLAYER})` });
        return;
    }

    const bot = {
        id: botId,
        owner_id: ownerId,
        team: team,
        hp: hp,
        maxHp: config.BOT_MAX_HP,
        x: x,
        y: y,
        flip: false,
        isDead: false,
        spawnTime: Date.now(),
        lastUpdate: Date.now()
    };

    state.bots.push(bot);
    syncManager.botSync.syncBotSpawn(bot);
}

function botPosition(ws, data) {
    const ownerId = ws.playerData?.id;
    if (!ownerId) return;

    const botId = String(data.bot_id || '');
    const x = Number(data.x);
    const y = Number(data.y);
    const flip = !!data.flip;

    const success = syncManager.botSync.updateBotPosition(botId, x, y, flip, ownerId);
    
    if (!success) {
        const bot = state.bots.find(b => b.id === botId);
        if (bot) {
            send(ws, {
                type: 'bot_position_update',
                bot_id: bot.id,
                x: bot.x,
                y: bot.y,
                flip: bot.flip || false,
                _correction: true
            });
        }
    }
}

function botDamage(ws, data) {
    const botId = String(data.bot_id || '');
    const damage = Number(data.damage) || 10;
    const attackerId = String(data.attacker_id || '');

    syncManager.botSync.damageBot(botId, damage, attackerId);
}

function botDestroy(ws, data) {
    const ownerId = ws.playerData?.id;
    if (!ownerId) return;

    const botId = String(data.bot_id || '');
    const bot = state.bots.find(b => b.id === botId);
    if (!bot || bot.owner_id !== ownerId) return;

    syncManager.botSync.destroyBot(botId, 'manual');
}

// ============================================================
// TOWER DAMAGE
// ============================================================

function towerDamage(_, data) {
    if (state.status !== 'playing') return;

    const blue = Number(data.town_id) === 1;
    const key = blue ? 'blueTowerHp' : 'redTowerHp';
    const damage = Math.max(0, Number(data.damage) || 10);

    state[key] = Math.max(0, state[key] - damage);

    broadcast(wss, {
        type: 'tower_damage',
        town_id: blue ? 1 : 2,
        new_hp: state[key]
    });

    if (state[key] <= 0) {
        endGame(blue ? 2 : 1);
    }
}

// ============================================================
// BARRACKS DAMAGE
// ============================================================

function barracksDamage(_, data) {
    if (state.status !== 'playing') return;

    const blue = Number(data.barracks_id) === 1;
    const hpKey = blue ? 'blueBarracksHp' : 'redBarracksHp';
    const deadKey = blue ? 'blueBarracksDestroyed' : 'redBarracksDestroyed';
    const damage = Math.max(0, Number(data.damage) || 10);

    state[hpKey] = Math.max(0, state[hpKey] - damage);

    broadcast(wss, {
        type: 'barracks_damage',
        barracks_id: blue ? 1 : 2,
        new_hp: state[hpKey]
    });

    if (state[hpKey] <= 0 && !state[deadKey]) {
        state[deadKey] = true;

        broadcast(wss, {
            type: 'barracks_destroyed',
            barracks_id: blue ? 1 : 2
        });
    }
}

// ============================================================
// CREEP DAMAGE
// ============================================================

function creepDamage(_, data) {
    if (state.status !== 'playing') return;

    const id = String(data.id || '');
    const creep = state.creeps.find(item => item.id === id);
    if (!creep) return;

    const damage = Math.max(0, Number(data.damage) || 10);
    creep.hp = Math.max(0, creep.hp - damage);

    syncManager.creepSync.syncCreepDamage(creep.id, creep.hp);

    if (creep.hp <= 0) {
        syncManager.creepSync.syncCreepDestroy(creep.id);
        const index = state.creeps.findIndex(c => c.id === creep.id);
        if (index !== -1) {
            state.creeps.splice(index, 1);
        }
    }
}

function creepPositionUpdate(_, data) {
    if (state.status !== 'playing') return;

    const id = String(data.id || '');
    const creep = state.creeps.find(item => item.id === id);
    if (!creep) return;

    if (data.x !== undefined) creep.x = Number(data.x);
    if (data.y !== undefined) creep.y = Number(data.y);
    if (data.direction !== undefined) creep.direction = Number(data.direction);

    syncManager.creepSync.syncCreepPosition(creep.id, creep.x, creep.y, creep.direction);
}

// ============================================================
// JOIN
// ============================================================

function join(ws, data) {
    const id = String(data.id || '').trim();

    if (!id) {
        send(ws, { type: 'error', message: 'ID отсутствует' });
        return;
    }

    if (state.status === 'playing' || state.status === 'countdown') {
        send(ws, { type: 'error', message: 'Игра уже началась' });
        return;
    }

    if (players.size >= config.MAX_PLAYERS && !players.has(id)) {
        send(ws, { type: 'error', message: 'Лобби заполнено' });
        return;
    }

    if (players.has(id)) {
        send(ws, { type: 'error', message: 'ID занят' });
        return;
    }

    let team1 = 0;
    let team2 = 0;

    players.forEach(player => {
        if (player.team === 1) team1++;
        if (player.team === 2) team2++;
    });

    let team = 1;
    if (team1 > team2) team = 2;

    const character = Number(data.character) === 2 ? 2 : 1;
    const position = spawn(team);

    const player = {
        id: id,
        nickname: String(data.nickname || 'Player').slice(0, 32),
        character: character,
        x: position.x,
        y: position.y,
        flip: false,
        team: team,
        hp: config.PLAYER_MAX_HP,
        isDead: false,
        inGame: false,
        lastDamageTime: Date.now()
    };

    players.set(id, player);
    ws.playerData = player;

    logger.network(`${id} зашел | Team: ${team} | Character: ${character}`);

    send(ws, {
        type: 'join_success',
        id: id,
        team: team,
        x: player.x,
        y: player.y,
        character: player.character,
        hp: player.hp
    });

    // Отправляем полную синхронизацию новому игроку
    syncManager.syncAllToClient(ws);
    sendPlayerList(ws);

    // Оповещаем всех о новом игроке
    syncManager.playerSync.syncPlayerJoined(player, ws);
    broadcastPlayerList();

    logger.network(`Новый игрок: ${id} | Всего: ${players.size}`);
}

// ============================================================
// LEVEL READY
// ============================================================

function level_ready(ws) {
    const id = ws.playerData?.id;
    if (!id) return;

    const p = players.get(id);
    if (!p) return;

    if (state.status === 'playing') return;

    p.inGame = true;
    logger.game(`${id} готов | ready=${readyCount(players)} players=${players.size}`);
    checkAllReady();
}

// ============================================================
// CHAT
// ============================================================

function chat(ws, data) {
    const id = ws.playerData?.id;
    const p = players.get(id);
    if (!p) return;

    const message = String(data.message || '').trim();
    if (!message) return;

    broadcast(wss, {
        type: 'chat',
        sender: p.nickname,
        message: message.slice(0, 300)
    });
}

// ============================================================
// FORCE START
// ============================================================

function force_start(ws) {
    if (players.size < config.MIN_PLAYERS) {
        send(ws, {
            type: 'chat',
            sender: 'СИСТЕМА',
            message: 'Нужно минимум 2 игрока.'
        });
        return;
    }

    players.forEach(p => {
        p.inGame = true;
    });

    startCountdown();
}

// ============================================================
// ROUTER
// ============================================================

function route(ws, data) {
    if (!data || typeof data !== 'object') return;

    const type = data.type;

    // ============================================================
    // ОБРАБОТКА ЗАПРОСА СИНХРОНИЗАЦИИ (ИСПРАВЛЕНО)
    // ============================================================
    if (type === 'get_players') {
        console.log('[SERVER] 📋 Запрос синхронизации игроков от', ws.playerData?.id);
        
        const playersData = playersObject(players);
        console.log(`[SERVER] 📤 Отправка ${Object.keys(playersData).length} игроков`);
        
        send(ws, {
            type: 'players_sync',
            players: playersData
        });
        
        // Также отправляем players_list для обратной совместимости
        send(ws, {
            type: 'players_list',
            players: playersData
        });
        
        return;
    }

    if (type === 'ping') {
        send(ws, { type: 'pong' });
        return;
    }

    if (type === 'join') {
        join(ws, data);
        return;
    }

    if (type === 'move') {
        move(ws, data);
        return;
    }

    if (type === 'chat') {
        chat(ws, data);
        return;
    }

    if (type === 'level_ready') {
        level_ready(ws);
        return;
    }

    if (type === 'force_start') {
        force_start(ws);
        return;
    }

    if (type === 'player_damage') {
        playerDamage(ws, data);
        return;
    }

    if (type === 'town_damage') {
        towerDamage(ws, data);
        return;
    }

    if (type === 'barracks_damage') {
        barracksDamage(ws, data);
        return;
    }

    if (type === 'creep_damage') {
        creepDamage(ws, data);
        return;
    }

    if (type === 'creep_position_update') {
        creepPositionUpdate(ws, data);
        return;
    }

    if (type === 'respawn') {
        respawn(String(data.id || ''));
        return;
    }

    // BOT HANDLERS
    if (type === 'bot_spawn') {
        botSpawn(ws, data);
        return;
    }

    if (type === 'bot_position') {
        botPosition(ws, data);
        return;
    }

    if (type === 'bot_damage') {
        botDamage(ws, data);
        return;
    }

    if (type === 'bot_destroy') {
        botDestroy(ws, data);
        return;
    }

    if (type === 'summon_bot') {
        botSpawn(ws, data);
        return;
    }

    if (type === 'get_bots') {
        syncManager.botSync.syncToClient(ws);
        return;
    }

    if (type === 'animation_sync') {
        const animType = String(data.animation_type || 'custom');
        const animData = data.animation_data || {};
        const sourceId = String(data.source_id || ws.playerData?.id || '');
        const targetId = String(data.target_id || '');
        syncManager.animationSync.syncAnimation({ type: animType, data: animData }, sourceId, targetId);
        return;
    }

    if (type === 'animation_batch') {
        const animations = data.animations || [];
        syncManager.animationSync.syncAnimationBatch(animations);
        return;
    }

    logger.warn(`Неизвестный тип: ${type}`);
}

// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

wss.on('connection', ws => {
    logger.network('Новое WebSocket подключение');

    ws.playerData = {
        id: '',
        nickname: 'Player',
        character: 1,
        x: 0,
        y: config.GROUND_Y,
        flip: false,
        team: 0,
        hp: config.PLAYER_MAX_HP,
        isDead: false,
        inGame: false,
        lastDamageTime: Date.now()
    };

    ws.on('message', raw => {
        try {
            const text = raw.toString();
            if (!text) return;

            const data = JSON.parse(text);
            route(ws, data);
        } catch (error) {
            logger.error('Ошибка обработки сообщения:', error.message);
            send(ws, {
                type: 'error',
                message: 'Некорректный JSON'
            });
        }
    });

    ws.on('close', () => {
        disconnect(ws);
    });

    ws.on('error', error => {
        logger.error('WebSocket ошибка:', error.message);
    });
});

// ============================================================
// PROCESS EXIT
// ============================================================

process.on('SIGINT', () => {
    logger.info('Остановка сервера...');
    syncManager.stopAll();
    clearInterval(countdownTimer);
    clearInterval(gameTimer);
    clearInterval(playerCheckTimer);
    clearInterval(creepTimer);
    clearInterval(playerRegenTimer);
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM получен');
    syncManager.stopAll();
    clearInterval(countdownTimer);
    clearInterval(gameTimer);
    clearInterval(playerCheckTimer);
    clearInterval(creepTimer);
    clearInterval(playerRegenTimer);
    server.close(() => process.exit(0));
});
