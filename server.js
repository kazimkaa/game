const http = require('http');
const WebSocket = require('ws');


// ============================================================
// SERVER
// ============================================================

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;


// ============================================================
// GAME SETTINGS
// ============================================================

const COUNTDOWN_TIME = 60;
const GAME_TIME = 600;


// ============================================================
// PLAYER SETTINGS
// ============================================================

const PLAYER_MAX_HP = 100;

const PLAYER_REGEN_DELAY = 3000;
const PLAYER_REGEN_AMOUNT = 5;
const PLAYER_REGEN_INTERVAL = 500;

const PLAYER_RESPAWN_DELAY = 3000;


// ============================================================
// CREEP SETTINGS
// ============================================================

const CREEP_SPAWN_INTERVAL = 5000;
const CREEP_MAX_HP = 80;


// ============================================================
// MAP SPAWN
// ============================================================

const TEAM_1_SPAWN_X = -1500;
const TEAM_2_SPAWN_X = 2690;

const PLAYER_SPAWN_Y = 500;
const PLAYER_RESPAWN_Y = 450;

const TEAM_1_CREEP_X = -1400;
const TEAM_2_CREEP_X = 2590;

const CREEP_Y = 450;


// ============================================================
// PLAYERS
// ============================================================

const players = new Map();


// ============================================================
// GAME STATE
// ============================================================

const state = {};


// ============================================================
// TIMERS
// ============================================================

let countdownTimer = null;
let gameTimer = null;
let playerCheckTimer = null;
let creepTimer = null;
let playerRegenTimer = null;


// ============================================================
// RESET STATE
// ============================================================

function resetState() {

    Object.assign(state, {

        status: 'lobby',

        countdown: COUNTDOWN_TIME,

        timer: GAME_TIME,

        winner: 0,

        blueTowerHp: 1000,

        redTowerHp: 1000,

        blueBarracksHp: 500,

        redBarracksHp: 500,

        blueBarracksDestroyed: false,

        redBarracksDestroyed: false,

        creeps: [],

        nextCreepTeam: 1,

        nextCreepId: 1

    });

}


resetState();


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
// WEBSOCKET SERVER
// ============================================================

const wss = new WebSocket.Server({
    server: server,
    maxPayload: 1024 * 1024
});


// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, '0.0.0.0', () => {

    console.log('');
    console.log('==========================================');
    console.log('GAME SERVER STARTED');
    console.log('==========================================');
    console.log('PORT:', PORT);
    console.log('MAX PLAYERS:', MAX_PLAYERS);
    console.log('MIN PLAYERS:', MIN_PLAYERS);
    console.log('COUNTDOWN:', COUNTDOWN_TIME, 'seconds');
    console.log('GAME TIME:', GAME_TIME, 'seconds');
    console.log('GAME TIME:', GAME_TIME / 60, 'minutes');
    console.log('');
    console.log('PLAYER MAX HP:', PLAYER_MAX_HP);
    console.log('PLAYER REGEN DELAY:', PLAYER_REGEN_DELAY, 'ms');
    console.log('PLAYER REGEN AMOUNT:', PLAYER_REGEN_AMOUNT);
    console.log('PLAYER REGEN INTERVAL:', PLAYER_REGEN_INTERVAL, 'ms');
    console.log('PLAYER RESPAWN DELAY:', PLAYER_RESPAWN_DELAY, 'ms');
    console.log('');
    console.log('CREEP HP:', CREEP_MAX_HP);
    console.log('CREEP SPAWN:', CREEP_SPAWN_INTERVAL, 'ms');
    console.log('==========================================');
    console.log('');

});


// ============================================================
// KEEP ALIVE
// ============================================================

setInterval(() => {

    console.log(
        `[SERVER] alive | players=${players.size} | status=${state.status} | timer=${state.timer}`
    );

}, 30000);


// ============================================================
// HELPERS
// ============================================================

function open(ws) {

    return (
        ws &&
        ws.readyState === WebSocket.OPEN
    );

}


// ============================================================
// SEND
// ============================================================

function send(ws, message) {

    if (!open(ws)) {
        return;
    }

    try {

        ws.send(
            JSON.stringify(message)
        );

    } catch (error) {

        console.log(
            '[SERVER] Ошибка отправки:',
            error.message
        );

    }

}


// ============================================================
// BROADCAST
// ============================================================

function broadcast(message, exclude = null) {

    let json = '';

    try {

        json = JSON.stringify(message);

    } catch (error) {

        console.log(
            '[SERVER] Ошибка JSON:',
            error.message
        );

        return;
    }


    wss.clients.forEach(ws => {

        if (
            ws !== exclude &&
            open(ws)
        ) {

            try {

                ws.send(json);

            } catch (error) {

                console.log(
                    '[SERVER] Broadcast error:',
                    error.message
                );

            }

        }

    });

}


// ============================================================
// SPAWN POSITION
// ============================================================

function spawn(team, respawn = false) {

    return {

        x:
            team === 1
                ? TEAM_1_SPAWN_X
                : TEAM_2_SPAWN_X,

        y:
            respawn
                ? PLAYER_RESPAWN_Y
                : PLAYER_SPAWN_Y

    };

}


// ============================================================
// PLAYERS OBJECT
// ============================================================

function playersObject() {

    const result = {};

    players.forEach((p, id) => {

        result[id] = {

            nickname: p.nickname,

            character: p.character,

            x: p.x,

            y: p.y,

            flip: p.flip,

            team: p.team,

            hp: p.hp,

            isDead: p.isDead

        };

    });

    return result;

}


// ============================================================
// SEND PLAYER LIST
// ============================================================

function sendPlayerList(ws) {

    send(ws, {

        type: 'players_list',

        players: playersObject()

    });

}


// ============================================================
// BROADCAST PLAYER LIST
// ============================================================

function broadcastPlayerList() {

    broadcast({

        type: 'players_list',

        players: playersObject()

    });

}


// ============================================================
// READY COUNT
// ============================================================

function readyCount() {

    let count = 0;

    players.forEach(p => {

        if (p.inGame) {
            count++;
        }

    });

    return count;

}


// ============================================================
// TEAM COUNTS
// ============================================================

function getTeamCounts() {

    let team1 = 0;
    let team2 = 0;

    players.forEach(p => {

        if (p.team === 1) {
            team1++;
        }

        if (p.team === 2) {
            team2++;
        }

    });

    return {
        team1: team1,
        team2: team2
    };

}


// ============================================================
// CONNECTION
// ============================================================

wss.on('connection', ws => {

    console.log('');
    console.log('[WS] Новое WebSocket подключение');


    ws.playerData = {

        id: '',

        nickname: 'Player',

        character: 1,

        x: 0,

        y: PLAYER_SPAWN_Y,

        flip: false,

        team: 0,

        hp: PLAYER_MAX_HP,

        isDead: false,

        inGame: false,

        lastDamageTime: Date.now()

    };


    // ========================================================
    // MESSAGE
    // ========================================================

    ws.on('message', raw => {

        try {

            const text = raw.toString();

            if (!text) {
                return;
            }

            const data = JSON.parse(text);

            route(ws, data);

        } catch (error) {

            console.log(
                '[WS] Ошибка обработки сообщения:',
                error.message
            );

            send(ws, {

                type: 'error',

                message: 'Некорректный JSON'

            });

        }

    });


    // ========================================================
    // CLOSE
    // ========================================================

    ws.on('close', () => {

        console.log(
            '[WS] Соединение закрыто:',
            ws.playerData?.id || 'unknown'
        );

        disconnect(ws);

    });


    // ========================================================
    // ERROR
    // ========================================================

    ws.on('error', error => {

        console.log(
            '[WS] Ошибка:',
            error.message
        );

    });

});


// ============================================================
// ROUTER
// ============================================================

function route(ws, data) {

    if (!data || typeof data !== 'object') {
        return;
    }

    const type = data.type;


    // ========================================================
    // PING
    // ========================================================

    if (type === 'ping') {

        send(ws, {
            type: 'pong'
        });

        return;
    }


    // ========================================================
    // JOIN
    // ========================================================

    if (type === 'join') {

        join(ws, data);

        return;
    }


    // ========================================================
    // MOVE
    // ========================================================

    if (type === 'move') {

        move(ws, data);

        return;
    }


    // ========================================================
    // CHAT
    // ========================================================

    if (type === 'chat') {

        chat(ws, data);

        return;
    }


    // ========================================================
    // LEVEL READY
    // ========================================================

    if (type === 'level_ready') {

        level_ready(ws);

        return;
    }


    // ========================================================
    // FORCE START
    // ========================================================

    if (type === 'force_start') {

        force_start(ws);

        return;
    }


    // ========================================================
    // PLAYER DAMAGE
    // ========================================================

    if (type === 'player_damage') {

        playerDamage(ws, data);

        return;
    }


    // ========================================================
    // TOWN DAMAGE
    // ========================================================

    if (type === 'town_damage') {

        towerDamage(ws, data);

        return;
    }


    // ========================================================
    // BARRACKS DAMAGE
    // ========================================================

    if (type === 'barracks_damage') {

        barracksDamage(ws, data);

        return;
    }


    // ========================================================
    // CREEP DAMAGE
    // ========================================================

    if (type === 'creep_damage') {

        creepDamage(ws, data);

        return;
    }


    // ========================================================
    // RESPAWN
    // ========================================================

    if (type === 'respawn') {

        respawn(
            String(data.id || '')
        );

        return;
    }


    console.log(
        '[SERVER] Неизвестный тип:',
        type
    );

}


// ============================================================
// JOIN
// ============================================================

function join(ws, data) {

    const id = String(
        data.id || ''
    ).trim();


    if (!id) {

        send(ws, {

            type: 'error',

            message: 'ID отсутствует'

        });

        return;
    }


    // ========================================================
    // GAME LOCK
    // ========================================================

    if (
        state.status === 'playing' ||
        state.status === 'countdown'
    ) {

        send(ws, {

            type: 'error',

            message: 'Игра уже началась'

        });

        return;
    }


    // ========================================================
    // MAX PLAYERS
    // ========================================================

    if (
        players.size >= MAX_PLAYERS &&
        !players.has(id)
    ) {

        send(ws, {

            type: 'error',

            message: 'Лобби заполнено'

        });

        return;
    }


    // ========================================================
    // DUPLICATE ID
    // ========================================================

    if (players.has(id)) {

        send(ws, {

            type: 'error',

            message: 'ID занят'

        });

        return;
    }


    // ========================================================
    // TEAM
    // ========================================================

    const teams = getTeamCounts();

    let team = 1;

    if (teams.team1 > teams.team2) {

        team = 2;

    } else if (teams.team1 === teams.team2) {

        team =
            players.size % 2 === 0
                ? 1
                : 2;

    }


    // ========================================================
    // CHARACTER
    // ========================================================

    let character = Number(
        data.character
    );

    if (
        character !== 1 &&
        character !== 2
    ) {

        character = 1;

    }


    // ========================================================
    // SPAWN
    // ========================================================

    const position = spawn(team);


    // ========================================================
    // PLAYER
    // ========================================================

    const player = {

        id: id,

        nickname:
            String(
                data.nickname || 'Player'
            ).slice(0, 32),

        character: character,

        x: position.x,

        y: position.y,

        flip: false,

        team: team,

        hp: PLAYER_MAX_HP,

        isDead: false,

        inGame: false,

        lastDamageTime: Date.now()

    };


    players.set(
        id,
        player
    );


    ws.playerData = player;


    console.log('');
    console.log('==========================================');
    console.log('[JOIN] НОВЫЙ ИГРОК');
    console.log('[JOIN] ID:', id);
    console.log('[JOIN] Nickname:', player.nickname);
    console.log('[JOIN] Character:', player.character);
    console.log('[JOIN] Team:', player.team);
    console.log('[JOIN] Spawn:', player.x, player.y);
    console.log('[JOIN] Players:', players.size);
    console.log('==========================================');
    console.log('');


    // ========================================================
    // JOIN SUCCESS
    // ========================================================

    send(ws, {

        type: 'join_success',

        id: id,

        team: team,

        x: player.x,

        y: player.y,

        character: player.character,

        hp: player.hp,

        nickname: player.nickname

    });


    // ========================================================
    // PLAYER LIST
    // ========================================================

    sendPlayerList(ws);


    // ========================================================
    // PLAYER JOINED
    // ========================================================

    broadcast({

        type: 'player_joined',

        id: id,

        nickname: player.nickname,

        character: player.character,

        x: player.x,

        y: player.y,

        flip: player.flip,

        team: player.team,

        hp: player.hp

    }, ws);


    broadcastPlayerList();


    console.log(
        `[JOIN] ${id} полностью готов`
    );

}


// ============================================================
// LEVEL READY
// ============================================================

function level_ready(ws) {

    const id = ws.playerData?.id;

    if (!id) {
        return;
    }

    const p = players.get(id);

    if (!p) {
        return;
    }

    if (state.status === 'playing') {
        return;
    }

    p.inGame = true;


    console.log(
        `[READY] ${id} готов | ready=${readyCount()} players=${players.size}`
    );


    checkAllReady();

}


// ============================================================
// MOVE
// ============================================================

function move(ws, data) {

    const id = ws.playerData?.id;

    if (!id) {
        return;
    }

    const p = players.get(id);

    if (!p) {
        return;
    }

    if (p.isDead) {
        return;
    }


    const x = Number(data.x);
    const y = Number(data.y);


    if (Number.isFinite(x)) {
        p.x = x;
    }

    if (Number.isFinite(y)) {
        p.y = y;
    }


    p.flip = !!data.flip;


    broadcast({

        type: 'player_moved',

        id: p.id,

        x: p.x,

        y: p.y,

        flip: p.flip

    }, ws);

}


// ============================================================
// CHAT
// ============================================================

function chat(ws, data) {

    const id = ws.playerData?.id;

    const p = players.get(id);

    if (!p) {
        return;
    }


    const message = String(
        data.message || ''
    ).trim();


    if (!message) {
        return;
    }


    broadcast({

        type: 'chat',

        sender: p.nickname,

        message:
            message.slice(0, 300)

    });

}


// ============================================================
// READY CHECK
// ============================================================

function checkAllReady() {

    if (state.status !== 'lobby') {
        return;
    }


    if (players.size < MIN_PLAYERS) {
        return;
    }


    if (readyCount() < MIN_PLAYERS) {
        return;
    }


    console.log(
        '[GAME] Все готовы. Запускаем countdown на 60 секунд.'
    );


    startCountdown();

}


// ============================================================
// COUNTDOWN
// ============================================================

function startCountdown() {

    if (countdownTimer) {
        return;
    }


    if (state.status === 'playing') {
        return;
    }


    if (players.size < MIN_PLAYERS) {
        return;
    }


    state.status = 'countdown';

    state.countdown = COUNTDOWN_TIME;


    broadcast({

        type: 'countdown_start',

        time: state.countdown

    });


    console.log(
        `[GAME] Countdown started: ${state.countdown} seconds`
    );


    countdownTimer = setInterval(() => {

        if (state.status !== 'countdown') {

            clearInterval(countdownTimer);

            countdownTimer = null;

            return;
        }


        if (
            players.size < MIN_PLAYERS ||
            readyCount() < MIN_PLAYERS
        ) {

            console.log(
                '[GAME] Недостаточно игроков. Countdown отменён.'
            );

            cancelCountdown();

            return;
        }


        state.countdown--;


        broadcast({

            type: 'countdown_update',

            time: state.countdown

        });


        console.log(
            `[COUNTDOWN] ${state.countdown}`
        );


        if (state.countdown <= 0) {

            clearInterval(countdownTimer);

            countdownTimer = null;

            startGame();

        }

    }, 1000);

}


// ============================================================
// CANCEL COUNTDOWN
// ============================================================

function cancelCountdown() {

    if (countdownTimer) {

        clearInterval(
            countdownTimer
        );

        countdownTimer = null;

    }


    state.status = 'lobby';

    state.countdown = COUNTDOWN_TIME;


    broadcast({

        type: 'countdown_cancel'

    });


    console.log(
        '[GAME] Countdown отменён'
    );

}


// ============================================================
// FORCE START
// ============================================================

function force_start(ws) {

    if (players.size < MIN_PLAYERS) {

        send(ws, {

            type: 'chat',

            sender: 'СИСТЕМА',

            message:
                'Нужно минимум 2 игрока.'

        });

        return;
    }


    players.forEach(p => {

        p.inGame = true;

    });


    startCountdown();

}


// ============================================================
// START GAME
// ============================================================

function startGame() {

    if (players.size < MIN_PLAYERS) {

        cancelCountdown();

        return;
    }


    state.status = 'playing';

    state.timer = GAME_TIME;

    state.winner = 0;


    // ========================================================
    // RESET GAME OBJECTS
    // ========================================================

    state.blueTowerHp = 1000;
    state.redTowerHp = 1000;

    state.blueBarracksHp = 500;
    state.redBarracksHp = 500;

    state.blueBarracksDestroyed = false;
    state.redBarracksDestroyed = false;

    state.creeps = [];

    state.nextCreepTeam = 1;
    state.nextCreepId = 1;


    // ========================================================
    // RESET PLAYERS
    // ========================================================

    const now = Date.now();


    players.forEach(p => {

        const position =
            spawn(
                p.team,
                false
            );


        p.hp = PLAYER_MAX_HP;

        p.isDead = false;

        p.x = position.x;

        p.y = position.y;

        p.flip = false;

        p.inGame = true;

        p.lastDamageTime = now;

    });


    const data =
        playersObject();


    // ========================================================
    // INIT GAME
    // ========================================================

    wss.clients.forEach(ws => {

        const id =
            ws.playerData?.id;

        const p =
            players.get(id);


        if (!p) {
            return;
        }


        send(ws, {

            type: 'init_game',

            players: data,

            my_team: p.team,

            town1_hp:
                state.blueTowerHp,

            town2_hp:
                state.redTowerHp,

            barracks1_hp:
                state.blueBarracksHp,

            barracks2_hp:
                state.redBarracksHp,

            barracks1_destroyed:
                state.blueBarracksDestroyed,

            barracks2_destroyed:
                state.redBarracksDestroyed

        });

    });


    // ========================================================
    // START GAME
    // ========================================================

    broadcast({

        type: 'start_game'

    });


    // ========================================================
    // INITIAL TIMER
    // ========================================================

    broadcast({

        type: 'countdown_update',

        time: state.timer

    });


    // ========================================================
    // CLEAR OLD TIMERS
    // ========================================================

    clearInterval(gameTimer);
    clearInterval(playerCheckTimer);
    clearInterval(creepTimer);
    clearInterval(playerRegenTimer);


    gameTimer = null;
    playerCheckTimer = null;
    creepTimer = null;
    playerRegenTimer = null;


    // ========================================================
    // GAME TIMER
    // ========================================================

    gameTimer = setInterval(() => {

        if (state.status !== 'playing') {

            clearInterval(gameTimer);

            gameTimer = null;

            return;
        }


        state.timer--;


        if (state.timer < 0) {
            state.timer = 0;
        }


        broadcast({

            type: 'countdown_update',

            time: state.timer

        });


        console.log(
            `[GAME TIMER] ${formatTime(state.timer)}`
        );


        if (state.timer <= 0) {

            clearInterval(gameTimer);

            gameTimer = null;

            endGame(0);

        }

    }, 1000);


    // ========================================================
    // PLAYER CHECK
    // ========================================================

    playerCheckTimer =
        setInterval(
            checkPlayers,
            3000
        );


    // ========================================================
    // PLAYER REGEN
    // ========================================================

    playerRegenTimer =
        setInterval(
            regeneratePlayers,
            PLAYER_REGEN_INTERVAL
        );


    // ========================================================
    // CREEPS
    // ========================================================

    creepTimer =
        setInterval(
            spawnCreep,
            CREEP_SPAWN_INTERVAL
        );


    console.log('');
    console.log('==========================================');
    console.log('[GAME] ИГРА НАЧАЛАСЬ');
    console.log('[GAME] Duration:', GAME_TIME, 'seconds');
    console.log('[GAME] Duration:', GAME_TIME / 60, 'minutes');
    console.log('[GAME] Timer:', formatTime(state.timer));
    console.log('[GAME] Player HP:', PLAYER_MAX_HP);
    console.log('[GAME] Player regen enabled');
    console.log('[GAME] Regen:', PLAYER_REGEN_AMOUNT);
    console.log('[GAME] Regen delay:', PLAYER_REGEN_DELAY);
    console.log('[GAME] Creeps enabled');
    console.log('==========================================');
    console.log('');

}


// ============================================================
// PLAYER REGENERATION
// ============================================================

function regeneratePlayers() {

    if (state.status !== 'playing') {
        return;
    }


    const now = Date.now();


    players.forEach(p => {

        // ----------------------------------------------------
        // DEAD
        // ----------------------------------------------------

        if (p.isDead) {
            return;
        }


        // ----------------------------------------------------
        // FULL HP
        // ----------------------------------------------------

        if (p.hp >= PLAYER_MAX_HP) {

            p.hp = PLAYER_MAX_HP;

            return;
        }


        // ----------------------------------------------------
        // TIME AFTER DAMAGE
        // ----------------------------------------------------

        const elapsed =
            now -
            Number(
                p.lastDamageTime || now
            );


        // ----------------------------------------------------
        // REGEN DELAY
        // ----------------------------------------------------

        if (
            elapsed <
            PLAYER_REGEN_DELAY
        ) {

            return;
        }


        // ----------------------------------------------------
        // REGEN
        // ----------------------------------------------------

        const oldHp = p.hp;


        p.hp =
            Math.min(
                PLAYER_MAX_HP,
                p.hp + PLAYER_REGEN_AMOUNT
            );


        if (p.hp === oldHp) {
            return;
        }


        console.log(
            `[REGEN] ${p.id}: ${oldHp} -> ${p.hp}`
        );


        broadcast({

            type: 'player_damage',

            target_id: p.id,

            new_hp: p.hp

        });

    });

}


// ============================================================
// FORMAT TIME
// ============================================================

function formatTime(seconds) {

    const safeSeconds =
        Math.max(
            0,
            Number(seconds) || 0
        );


    const minutes =
        Math.floor(
            safeSeconds / 60
        );


    const secs =
        safeSeconds % 60;


    return (
        String(minutes).padStart(2, '0') +
        ':' +
        String(secs).padStart(2, '0')
    );

}


// ============================================================
// SPAWN CREEP
// ============================================================

function spawnCreep() {

    if (state.status !== 'playing') {
        return;
    }


    const team =
        state.nextCreepTeam;


    state.nextCreepTeam =
        team === 1
            ? 2
            : 1;


    const creep = {

        id:
            `creep_${state.nextCreepId++}`,

        team: team,

        hp: CREEP_MAX_HP,

        x:
            team === 1
                ? TEAM_1_CREEP_X
                : TEAM_2_CREEP_X,

        y: CREEP_Y

    };


    state.creeps.push(
        creep
    );


    broadcast({

        type: 'creep_spawn',

        creep: creep

    });


    console.log(
        `[CREEP] Spawn ${creep.id} team=${creep.team}`
    );

}


// ============================================================
// PLAYER DAMAGE
// ============================================================

function playerDamage(_, data) {

    if (state.status !== 'playing') {
        return;
    }


    const id =
        String(
            data.target_id || ''
        );


    const p =
        players.get(id);


    if (!p) {
        return;
    }


    if (p.isDead) {
        return;
    }


    let damage =
        Number(data.damage);


    if (!Number.isFinite(damage)) {
        damage = 10;
    }


    damage =
        Math.max(
            0,
            damage
        );


    // ========================================================
    // DAMAGE
    // ========================================================

    const oldHp = p.hp;


    p.hp =
        Math.max(
            0,
            p.hp - damage
        );


    // ========================================================
    // RESET REGEN TIMER
    // ========================================================

    p.lastDamageTime =
        Date.now();


    console.log(
        `[DAMAGE] ${p.id}: ${oldHp} -> ${p.hp} (-${damage})`
    );


    // ========================================================
    // HP SYNC
    // ========================================================

    broadcast({

        type: 'player_damage',

        target_id: p.id,

        new_hp: p.hp

    });


    // ========================================================
    // DEATH
    // ========================================================

    if (p.hp <= 0) {

        p.hp = 0;

        p.isDead = true;

        p.lastDamageTime =
            Date.now();


        console.log(
            `[DEATH] ${p.id}`
        );


        broadcast({

            type: 'player_damage',

            target_id: p.id,

            new_hp: 0

        });


        // ====================================================
        // SERVER RESPAWN
        // ====================================================

        setTimeout(() => {

            const currentPlayer =
                players.get(
                    p.id
                );


            if (!currentPlayer) {
                return;
            }


            if (state.status !== 'playing') {
                return;
            }


            if (!currentPlayer.isDead) {
                return;
            }


            respawn(
                currentPlayer.id
            );


        }, PLAYER_RESPAWN_DELAY);

    }

}


// ============================================================
// RESPAWN
// ============================================================

function respawn(id) {

    const playerId =
        String(
            id || ''
        );


    const p =
        players.get(
            playerId
        );


    if (!p) {
        return;
    }


    if (state.status !== 'playing') {
        return;
    }


    if (!p.isDead) {
        return;
    }


    const position =
        spawn(
            p.team,
            true
        );


    // ========================================================
    // NEW LIFE
    // ========================================================

    p.hp = PLAYER_MAX_HP;

    p.isDead = false;

    p.x = position.x;

    p.y = position.y;

    p.flip = false;

    p.lastDamageTime =
        Date.now();


    console.log(
        `[RESPAWN] ${p.id} | HP=${p.hp} | position=${p.x},${p.y}`
    );


    // ========================================================
    // RESPAWN
    // ========================================================

    broadcast({

        type: 'respawn',

        id: p.id,

        x: p.x,

        y: p.y,

        hp: p.hp

    });


    // ========================================================
    // HP SYNC
    // ========================================================

    broadcast({

        type: 'player_damage',

        target_id: p.id,

        new_hp: p.hp

    });


    // ========================================================
    // POSITION SYNC
    // ========================================================

    broadcast({

        type: 'player_moved',

        id: p.id,

        x: p.x,

        y: p.y,

        flip: p.flip

    });

}


// ============================================================
// TOWER DAMAGE
// ============================================================

function towerDamage(_, data) {

    if (state.status !== 'playing') {
        return;
    }


    const townId =
        Number(
            data.town_id
        );


    if (
        townId !== 1 &&
        townId !== 2
    ) {

        return;
    }


    const blue =
        townId === 1;


    const key =
        blue
            ? 'blueTowerHp'
            : 'redTowerHp';


    let damage =
        Number(data.damage);


    if (!Number.isFinite(damage)) {
        damage = 10;
    }


    damage =
        Math.max(
            0,
            damage
        );


    state[key] =
        Math.max(
            0,
            state[key] - damage
        );


    console.log(
        `[TOWER] town=${townId} damage=${damage} hp=${state[key]}`
    );


    broadcast({

        type: 'tower_damage',

        town_id: townId,

        new_hp: state[key]

    });


    if (state[key] <= 0) {

        endGame(
            blue
                ? 2
                : 1
        );

    }

}


// ============================================================
// BARRACKS DAMAGE
// ============================================================

function barracksDamage(_, data) {

    if (state.status !== 'playing') {
        return;
    }


    const barracksId =
        Number(
            data.barracks_id
        );


    if (
        barracksId !== 1 &&
        barracksId !== 2
    ) {

        return;
    }


    const blue =
        barracksId === 1;


    const hpKey =
        blue
            ? 'blueBarracksHp'
            : 'redBarracksHp';


    const deadKey =
        blue
            ? 'blueBarracksDestroyed'
            : 'redBarracksDestroyed';


    if (state[deadKey]) {
        return;
    }


    let damage =
        Number(data.damage);


    if (!Number.isFinite(damage)) {
        damage = 10;
    }


    damage =
        Math.max(
            0,
            damage
        );


    state[hpKey] =
        Math.max(
            0,
            state[hpKey] - damage
        );


    console.log(
        `[BARRACKS] id=${barracksId} damage=${damage} hp=${state[hpKey]}`
    );


    broadcast({

        type: 'barracks_damage',

        barracks_id: barracksId,

        new_hp: state[hpKey]

    });


    if (
        state[hpKey] <= 0 &&
        !state[deadKey]
    ) {

        state[deadKey] = true;


        broadcast({

            type: 'barracks_destroyed',

            barracks_id: barracksId

        });


        console.log(
            `[BARRACKS] DESTROYED id=${barracksId}`
        );

    }

}


// ============================================================
// CREEP DAMAGE
// ============================================================

function creepDamage(_, data) {

    if (state.status !== 'playing') {
        return;
    }


    const id =
        String(
            data.id || ''
        );


    if (!id) {
        return;
    }


    const creep =
        state.creeps.find(
            item => item.id === id
        );


    if (!creep) {
        return;
    }


    let damage =
        Number(data.damage);


    if (!Number.isFinite(damage)) {
        damage = 10;
    }


    damage =
        Math.max(
            0,
            damage
        );


    const oldHp =
        creep.hp;


    creep.hp =
        Math.max(
            0,
            creep.hp - damage
        );


    console.log(
        `[CREEP DAMAGE] ${creep.id}: ${oldHp} -> ${creep.hp}`
    );


    broadcast({

        type: 'creep_damage',

        id: creep.id,

        new_hp: creep.hp

    });


    if (creep.hp <= 0) {

        state.creeps =
            state.creeps.filter(
                item =>
                    item.id !== creep.id
            );


        broadcast({

            type: 'creep_destroy',

            id: creep.id

        });


        console.log(
            `[CREEP] DESTROYED ${creep.id}`
        );

    }

}


// ============================================================
// CHECK PLAYERS
// ============================================================

function checkPlayers() {

    if (state.status !== 'playing') {
        return;
    }


    if (players.size < MIN_PLAYERS) {

        let remaining = null;


        for (const player of players.values()) {

            if (!player.isDead) {

                remaining = player;

                break;

            }

        }


        endGame(
            remaining
                ? remaining.team
                : 0
        );

    }

}


// ============================================================
// END GAME
// ============================================================

function endGame(winner) {

    if (state.status !== 'playing') {
        return;
    }


    state.status = 'finished';

    state.winner = winner;

    state.timer = 0;


    // ========================================================
    // STOP TIMERS
    // ========================================================

    clearInterval(gameTimer);
    clearInterval(playerCheckTimer);
    clearInterval(creepTimer);
    clearInterval(playerRegenTimer);


    gameTimer = null;
    playerCheckTimer = null;
    creepTimer = null;
    playerRegenTimer = null;


    // ========================================================
    // CLEAR CREEPS
    // ========================================================

    state.creeps = [];


    // ========================================================
    // TIMER 00:00
    // ========================================================

    broadcast({

        type: 'countdown_update',

        time: 0

    });


    // ========================================================
    // RESULT
    // ========================================================

    const result =
        winner === 0
            ? 'НИЧЬЯ!'
            : `ПОБЕДА КОМАНДЫ ${winner}!`;


    console.log('');
    console.log('==========================================');
    console.log('[GAME] ИГРА ЗАКОНЧЕНА');
    console.log('[GAME] WINNER:', winner);
    console.log('[GAME] RESULT:', result);
    console.log('==========================================');
    console.log('');


    // ========================================================
    // CHAT RESULT
    // ========================================================

    broadcast({

        type: 'chat',

        sender: 'СИСТЕМА',

        message: result

    });


    // ========================================================
    // GAME OVER
    // ========================================================

    broadcast({

        type: 'game_over',

        winner_team: winner

    });


    // ========================================================
    // GAME END
    // ========================================================

    broadcast({

        type: 'game_end',

        winner: winner

    });


    // ========================================================
    // RETURN TO LOBBY
    // ========================================================

    setTimeout(
        resetGame,
        5000
    );

}


// ============================================================
// RESET GAME
// ============================================================

function resetGame() {

    console.log('');
    console.log('[GAME] Сбрасываем игру...');
    console.log('');


    resetState();


    const now =
        Date.now();


    players.forEach(p => {

        const position =
            spawn(
                p.team,
                true
            );


        Object.assign(p, {

            inGame: false,

            hp: PLAYER_MAX_HP,

            isDead: false,

            x: position.x,

            y: position.y,

            flip: false,

            lastDamageTime: now

        });

    });


    broadcast({

        type: 'reset_lobby'

    });


    broadcastPlayerList();


    console.log(
        '[GAME] Лобби сброшено'
    );


    console.log(
        `[GAME] Игроков в лобби: ${players.size}`
    );

}


// ============================================================
// DISCONNECT
// ============================================================

function disconnect(ws) {

    const id =
        ws.playerData?.id;


    if (!id) {
        return;
    }


    if (!players.has(id)) {
        return;
    }


    players.delete(id);


    console.log(
        `[DISCONNECT] ${id} | players=${players.size}`
    );


    broadcast({

        type: 'player_left',

        id: id

    });


    broadcastPlayerList();


    // ========================================================
    // COUNTDOWN
    // ========================================================

    if (
        state.status === 'countdown' &&
        (
            players.size < MIN_PLAYERS ||
            readyCount() < MIN_PLAYERS
        )
    ) {

        cancelCountdown();

    }


    // ========================================================
    // GAME
    // ========================================================

    if (state.status === 'playing') {

        checkPlayers();

    }

}


// ============================================================
// PROCESS EXIT
// ============================================================

function stopAllTimers() {

    if (countdownTimer) {

        clearInterval(
            countdownTimer
        );

        countdownTimer = null;

    }


    if (gameTimer) {

        clearInterval(
            gameTimer
        );

        gameTimer = null;

    }


    if (playerCheckTimer) {

        clearInterval(
            playerCheckTimer
        );

        playerCheckTimer = null;

    }


    if (creepTimer) {

        clearInterval(
            creepTimer
        );

        creepTimer = null;

    }


    if (playerRegenTimer) {

        clearInterval(
            playerRegenTimer
        );

        playerRegenTimer = null;

    }

}


// ============================================================
// SIGINT
// ============================================================

process.on('SIGINT', () => {

    console.log(
        '[SERVER] Остановка...'
    );


    stopAllTimers();


    try {

        wss.clients.forEach(ws => {

            try {

                ws.close();

            } catch (_) {}

        });

    } catch (_) {}


    process.exit(0);

});


// ============================================================
// SIGTERM
// ============================================================

process.on('SIGTERM', () => {

    console.log(
        '[SERVER] SIGTERM'
    );


    stopAllTimers();


    try {

        wss.clients.forEach(ws => {

            try {

                ws.close();

            } catch (_) {}

        });

    } catch (_) {}


    process.exit(0);

});
