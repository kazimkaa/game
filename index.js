// index.js
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
// REST OF FUNCTIONS (move, damage, respawn, etc.)
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

    state
