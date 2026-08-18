const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

// ============================================================
// GAME SETTINGS
// ============================================================

// 60 секунд ожидания перед началом игры
const COUNTDOWN_TIME = 60;

// 10 минут игры
const GAME_TIME = 600;


// ============================================================
// PLAYERS / STATE
// ============================================================

const players = new Map();
const state = {};

let countdownTimer = null;
let gameTimer = null;
let playerCheckTimer = null;
let creepTimer = null;


// ============================================================
// STATE
// ============================================================

function resetState() {

  Object.assign(state, {

    status: 'lobby',

    // Обратный отсчёт перед игрой
    countdown: COUNTDOWN_TIME,

    // Таймер игры
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
// WEBSOCKET
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
  console.log('PORT:', PORT);
  console.log('MAX PLAYERS:', MAX_PLAYERS);
  console.log('MIN PLAYERS:', MIN_PLAYERS);
  console.log('COUNTDOWN:', COUNTDOWN_TIME, 'seconds');
  console.log('GAME TIME:', GAME_TIME, 'seconds');
  console.log('GAME TIME:', GAME_TIME / 60, 'minutes');
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


function broadcast(message, exclude = null) {

  const json = JSON.stringify(message);

  wss.clients.forEach(ws => {

    if (
      ws !== exclude &&
      open(ws)
    ) {

      try {

        ws.send(json);

      } catch (_) {}

    }

  });

}


function spawn(team, respawn = false) {

  return {

    x: team === 1
      ? -1500
      : 2690,

    y: respawn
      ? 450
      : 500

  };

}


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


function sendPlayerList(ws) {

  send(ws, {

    type: 'players_list',

    players: playersObject()

  });

}


function broadcastPlayerList() {

  broadcast({

    type: 'players_list',

    players: playersObject()

  });

}


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
// CONNECTION
// ============================================================

wss.on('connection', ws => {

  console.log('[WS] Новое WebSocket подключение');

  ws.playerData = {

    id: '',

    nickname: 'Player',

    character: 1,

    x: 0,

    y: 500,

    flip: false,

    team: 0,

    hp: 100,

    isDead: false,

    inGame: false

  };


  // ==========================================================
  // MESSAGE
  // ==========================================================

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


  // ==========================================================
  // CLOSE
  // ==========================================================

  ws.on('close', () => {

    console.log(
      '[WS] Соединение закрыто:',
      ws.playerData?.id || 'unknown'
    );

    disconnect(ws);

  });


  // ==========================================================
  // ERROR
  // ==========================================================

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


  // ==========================================================
  // PING
  // ==========================================================

  if (type === 'ping') {

    send(ws, {
      type: 'pong'
    });

    return;
  }


  // ==========================================================
  // JOIN
  // ==========================================================

  if (type === 'join') {

    join(ws, data);

    return;
  }


  // ==========================================================
  // MOVE
  // ==========================================================

  if (type === 'move') {

    move(ws, data);

    return;
  }


  // ==========================================================
  // CHAT
  // ==========================================================

  if (type === 'chat') {

    chat(ws, data);

    return;
  }


  // ==========================================================
  // LEVEL READY
  // ==========================================================

  if (type === 'level_ready') {

    level_ready(ws);

    return;
  }


  // ==========================================================
  // FORCE START
  // ==========================================================

  if (type === 'force_start') {

    force_start(ws);

    return;
  }


  // ==========================================================
  // PLAYER DAMAGE
  // ==========================================================

  if (type === 'player_damage') {

    playerDamage(ws, data);

    return;
  }


  // ==========================================================
  // TOWN DAMAGE
  // ==========================================================

  if (type === 'town_damage') {

    towerDamage(ws, data);

    return;
  }


  // ==========================================================
  // BARRACKS DAMAGE
  // ==========================================================

  if (type === 'barracks_damage') {

    barracksDamage(ws, data);

    return;
  }


  // ==========================================================
  // CREEP DAMAGE
  // ==========================================================

  if (type === 'creep_damage') {

    creepDamage(ws, data);

    return;
  }


  // ==========================================================
  // RESPAWN
  // ==========================================================

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


  // ==========================================================
  // НЕ ПОЗВОЛЯЕМ ВОЙТИ ВО ВРЕМЯ ИГРЫ
  // ==========================================================

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


  // ==========================================================
  // MAX PLAYERS
  // ==========================================================

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


  // ==========================================================
  // ID ЗАНЯТ
  // ==========================================================

  if (players.has(id)) {

    send(ws, {

      type: 'error',

      message: 'ID занят'

    });

    return;
  }


  // ==========================================================
  // TEAM
  // ==========================================================

  let team1 = 0;
  let team2 = 0;

  players.forEach(player => {

    if (player.team === 1) {
      team1++;
    }

    if (player.team === 2) {
      team2++;
    }

  });


  let team = 1;

  if (team1 > team2) {
    team = 2;
  }


  // ==========================================================
  // CHARACTER
  // ==========================================================

  const character =
    Number(data.character) === 2
      ? 2
      : 1;


  // ==========================================================
  // SPAWN
  // ==========================================================

  const position = spawn(team);


  // ==========================================================
  // CREATE PLAYER
  // ==========================================================

  const player = {

    id: id,

    nickname: String(
      data.nickname || 'Player'
    ).slice(0, 32),

    character: character,

    x: position.x,

    y: position.y,

    flip: false,

    team: team,

    hp: 100,

    isDead: false,

    inGame: false

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


  // ==========================================================
  // JOIN SUCCESS
  // ==========================================================

  send(ws, {

    type: 'join_success',

    id: id,

    team: team,

    x: player.x,

    y: player.y,

    character: player.character

  });


  // ==========================================================
  // PLAYER LIST
  // ==========================================================

  sendPlayerList(ws);


  // ==========================================================
  // PLAYER JOINED
  // ==========================================================

  broadcast({

    type: 'player_joined',

    id: id,

    nickname: player.nickname,

    character: player.character,

    x: player.x,

    y: player.y,

    flip: player.flip,

    team: player.team

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

  if (!p || p.isDead) {
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

    message: message.slice(0, 300)

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
// COUNTDOWN 60 SECONDS
// ============================================================

function startCountdown() {

  if (countdownTimer) {
    return;
  }


  if (state.status === 'playing') {
    return;
  }


  state.status = 'countdown';

  state.countdown = COUNTDOWN_TIME;


  // ==========================================================
  // СРАЗУ ОТПРАВЛЯЕМ 60
  // ==========================================================

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


    // Проверяем игроков
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
// START GAME
// ============================================================

function startGame() {

  if (players.size < MIN_PLAYERS) {

    cancelCountdown();

    return;
  }


  state.status = 'playing';

  state.timer = GAME_TIME;


  const data = playersObject();


  // ==========================================================
  // INIT GAME
  // ==========================================================

  wss.clients.forEach(ws => {

    const id = ws.playerData?.id;

    const p = players.get(id);

    if (!p) {
      return;
    }


    send(ws, {

      type: 'init_game',

      players: data,

      my_team: p.team,

      town1_hp: state.blueTowerHp,

      town2_hp: state.redTowerHp,

      barracks1_hp: state.blueBarracksHp,

      barracks2_hp: state.redBarracksHp,

      barracks1_destroyed:
        state.blueBarracksDestroyed,

      barracks2_destroyed:
        state.redBarracksDestroyed

    });

  });


  // ==========================================================
  // GAME START
  // ==========================================================

  broadcast({

    type: 'start_game'

  });


  // ==========================================================
  // ВАЖНО:
  // Сразу после start_game отправляем 10:00.
  //
  // Используем countdown_update, чтобы существующий
  // Net.gd уже мог передавать этот сигнал.
  // ==========================================================

  broadcast({

    type: 'countdown_update',

    time: state.timer

  });


  // ==========================================================
  // CLEAR OLD TIMERS
  // ==========================================================

  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);


  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;


  // ==========================================================
  // GAME TIMER
  // ==========================================================

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


    // ========================================================
    // ОТПРАВЛЯЕМ ОСТАВШЕЕСЯ ВРЕМЯ ВСЕМ
    // ========================================================

    broadcast({

      type: 'countdown_update',

      time: state.timer

    });


    console.log(
      `[GAME TIMER] ${formatTime(state.timer)}`
    );


    // ========================================================
    // ВРЕМЯ ЗАКОНЧИЛОСЬ
    // ========================================================

    if (state.timer <= 0) {

      clearInterval(gameTimer);

      gameTimer = null;

      endGame(0);

    }

  }, 1000);


  // ==========================================================
  // PLAYER CHECK
  // ==========================================================

  playerCheckTimer = setInterval(
    checkPlayers,
    3000
  );


  // ==========================================================
  // CREEPS
  // ==========================================================

  creepTimer = setInterval(
    spawnCreep,
    5000
  );


  console.log('');
  console.log('==========================================');
  console.log('[GAME] ИГРА НАЧАЛАСЬ');
  console.log('[GAME] Длительность:', GAME_TIME, 'секунд');
  console.log('[GAME] Длительность:', GAME_TIME / 60, 'минут');
  console.log('[GAME] Таймер:', formatTime(state.timer));
  console.log('==========================================');
  console.log('');

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

    hp: 80,

    x:
      team === 1
        ? -1400
        : 2590,

    y: 450

  };


  state.creeps.push(
    creep
  );


  broadcast({

    type: 'creep_spawn',

    creep: creep

  });

}


// ============================================================
// PLAYER DAMAGE
// ============================================================

function playerDamage(_, data) {

  if (state.status !== 'playing') {
    return;
  }


  const id = String(
    data.target_id || ''
  );


  const p = players.get(id);


  if (!p || p.isDead) {
    return;
  }


  const damage =
    Math.max(
      0,
      Number(data.damage) || 10
    );


  p.hp =
    Math.max(
      0,
      p.hp - damage
    );


  broadcast({

    type: 'player_damage',

    target_id: p.id,

    new_hp: p.hp

  });


  if (p.hp <= 0) {

    p.isDead = true;


    setTimeout(() => {

      respawn(p.id);

    }, 3000);

  }

}


// ============================================================
// RESPAWN
// ============================================================

function respawn(id) {

  const p =
    players.get(
      String(id || '')
    );


  if (!p) {
    return;
  }


  if (state.status !== 'playing') {
    return;
  }


  const position =
    spawn(
      p.team,
      true
    );


  Object.assign(p, {

    hp: 100,

    isDead: false,

    x: position.x,

    y: position.y

  });


  broadcast({

    type: 'respawn',

    id: p.id,

    x: p.x,

    y: p.y,

    hp: p.hp

  });

}


// ============================================================
// TOWER DAMAGE
// ============================================================

function towerDamage(_, data) {

  if (state.status !== 'playing') {
    return;
  }


  const blue =
    Number(data.town_id) === 1;


  const key =
    blue
      ? 'blueTowerHp'
      : 'redTowerHp';


  const damage =
    Math.max(
      0,
      Number(data.damage) || 10
    );


  state[key] =
    Math.max(
      0,
      state[key] - damage
    );


  broadcast({

    type: 'tower_damage',

    town_id:
      blue
        ? 1
        : 2,

    new_hp:
      state[key]

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


  const blue =
    Number(data.barracks_id) === 1;


  const hpKey =
    blue
      ? 'blueBarracksHp'
      : 'redBarracksHp';


  const deadKey =
    blue
      ? 'blueBarracksDestroyed'
      : 'redBarracksDestroyed';


  const damage =
    Math.max(
      0,
      Number(data.damage) || 10
    );


  state[hpKey] =
    Math.max(
      0,
      state[hpKey] - damage
    );


  broadcast({

    type: 'barracks_damage',

    barracks_id:
      blue
        ? 1
        : 2,

    new_hp:
      state[hpKey]

  });


  if (
    state[hpKey] <= 0 &&
    !state[deadKey]
  ) {

    state[deadKey] = true;


    broadcast({

      type: 'barracks_destroyed',

      barracks_id:
        blue
          ? 1
          : 2

    });

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


  const creep =
    state.creeps.find(
      item => item.id === id
    );


  if (!creep) {
    return;
  }


  const damage =
    Math.max(
      0,
      Number(data.damage) || 10
    );


  creep.hp =
    Math.max(
      0,
      creep.hp - damage
    );


  broadcast({

    type: 'creep_damage',

    id: creep.id,

    new_hp: creep.hp

  });


  if (creep.hp <= 0) {

    state.creeps =
      state.creeps.filter(
        item => item !== creep
      );


    broadcast({

      type: 'creep_destroy',

      id: creep.id

    });

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

    const remaining =
      players.size > 0
        ? [...players.values()][0]
        : null;


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


  // ==========================================================
  // STOP TIMERS
  // ==========================================================

  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);


  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;


  // ==========================================================
  // SHOW 00:00
  // ==========================================================

  broadcast({

    type: 'countdown_update',

    time: 0

  });


  const result =
    winner === 0
      ? 'НИЧЬЯ!'
      : `ПОБЕДА КОМАНДЫ ${winner}!`;


  broadcast({

    type: 'chat',

    sender: 'СИСТЕМА',

    message: result

  });


  broadcast({

    type: 'game_over',

    winner_team: winner

  });


  broadcast({

    type: 'game_end',

    winner: winner

  });


  console.log('');
  console.log('==========================================');
  console.log('[GAME] ИГРА ЗАКОНЧЕНА');
  console.log('[GAME] WINNER:', winner);
  console.log('==========================================');
  console.log('');


  setTimeout(
    resetGame,
    5000
  );

}


// ============================================================
// RESET GAME
// ============================================================

function resetGame() {

  resetState();


  players.forEach(p => {

    const position =
      spawn(
        p.team,
        true
      );


    Object.assign(p, {

      inGame: false,

      hp: 100,

      isDead: false,

      x: position.x,

      y: position.y

    });

  });


  broadcast({

    type: 'reset_lobby'

  });


  broadcastPlayerList();


  console.log(
    '[GAME] Лобби сброшено'
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


  // ==========================================================
  // CANCEL COUNTDOWN IF NOT ENOUGH PLAYERS
  // ==========================================================

  if (
    state.status === 'countdown' &&
    (
      players.size < MIN_PLAYERS ||
      readyCount() < MIN_PLAYERS
    )
  ) {

    cancelCountdown();

  }


  // ==========================================================
  // CHECK GAME
  // ==========================================================

  if (state.status === 'playing') {

    checkPlayers();

  }

}


// ============================================================
// PROCESS EXIT
// ============================================================

process.on('SIGINT', () => {

  console.log(
    '[SERVER] Остановка...'
  );


  clearInterval(countdownTimer);
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);


  countdownTimer = null;
  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;


  process.exit(0);

});


process.on('SIGTERM', () => {

  console.log(
    '[SERVER] SIGTERM'
  );


  clearInterval(countdownTimer);
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);


  process.exit(0);

});
