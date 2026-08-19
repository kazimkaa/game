const http = require('http');
const WebSocket = require('ws');

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

// ============================================================
// CREEP SETTINGS
// ============================================================

const CREEP_SPAWN_INTERVAL = 5000;
const CREEP_MAX_HP = 80;

// ============================================================
// PLAYERS / STATE
// ============================================================

const players = new Map();

const state = {
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
};

let countdownTimer = null;
let gameTimer = null;
let playerCheckTimer = null;
let creepTimer = null;
let playerRegenTimer = null;

// ============================================================
// RESET STATE
// ============================================================

function resetState() {

  state.status = 'lobby';

  state.countdown = COUNTDOWN_TIME;
  state.timer = GAME_TIME;
  state.winner = 0;

  state.blueTowerHp = 1000;
  state.redTowerHp = 1000;

  state.blueBarracksHp = 500;
  state.redBarracksHp = 500;

  state.blueBarracksDestroyed = false;
  state.redBarracksDestroyed = false;

  state.creeps = [];

  state.nextCreepTeam = 1;
  state.nextCreepId = 1;
}

// ============================================================
// HTTP
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
// SERVER START
// ============================================================

server.listen(PORT, '0.0.0.0', () => {

  console.log('');
  console.log('==========================================');
  console.log('GAME SERVER STARTED');
  console.log('PORT:', PORT);
  console.log('MAX PLAYERS:', MAX_PLAYERS);
  console.log('MIN PLAYERS:', MIN_PLAYERS);
  console.log('COUNTDOWN:', COUNTDOWN_TIME);
  console.log('GAME TIME:', GAME_TIME);
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

  players.forEach((p, id) => {

    console.log(
      `[SERVER] player=${id} team=${p.team} ws=${p.ws ? 'YES' : 'NO'}`
    );

  });

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
    return false;
  }

  try {

    ws.send(JSON.stringify(message));

    return true;

  } catch (error) {

    console.log(
      '[SERVER] SEND ERROR:',
      error.message
    );

    return false;
  }
}

// ============================================================
// BROADCAST
// ============================================================

function broadcast(message, exclude = null) {

  const json = JSON.stringify(message);

  wss.clients.forEach(ws => {

    if (
      ws !== exclude &&
      open(ws)
    ) {

      try {

        ws.send(json);

      } catch (error) {

        console.log(
          '[SERVER] BROADCAST ERROR:',
          error.message
        );

      }
    }

  });
}

// ============================================================
// BROADCAST ONLY JOINED PLAYERS
// ============================================================

function broadcastToPlayers(message, exclude = null) {

  const json = JSON.stringify(message);

  players.forEach(player => {

    const ws = player.ws;

    if (
      ws &&
      ws !== exclude &&
      open(ws)
    ) {

      try {

        ws.send(json);

      } catch (error) {

        console.log(
          '[SERVER] PLAYER BROADCAST ERROR:',
          error.message
        );

      }

    }

  });
}

// ============================================================
// SPAWN
// ============================================================

function spawn(team, respawn = false) {

  return {

    x: team === 1 ? -1500 : 2690,

    y: respawn ? 450 : 500

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

      animation: p.animation,

      team: p.team,

      hp: p.hp,

      isDead: p.isDead,

      inGame: p.inGame

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

  players.forEach(player => {

    if (player.inGame) {
      count++;
    }

  });

  return count;
}

// ============================================================
// CONNECTION
// ============================================================

wss.on('connection', ws => {

  console.log('');
  console.log('==========================================');
  console.log('[WS] NEW CONNECTION');
  console.log('Total sockets:', wss.clients.size);
  console.log('==========================================');

  ws.playerData = {

    id: '',

    nickname: 'Player',

    character: 1,

    x: 0,

    y: 500,

    flip: false,

    animation: 'idle',

    team: 0,

    hp: PLAYER_MAX_HP,

    isDead: false,

    inGame: false,

    lastDamageTime: Date.now()

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

      console.log(
        `[WS] MESSAGE type=${data.type || 'unknown'} id=${data.id || ws.playerData.id || 'unknown'}`
      );

      route(ws, data);

    } catch (error) {

      console.log(
        '[WS] MESSAGE ERROR:',
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
      '[WS] CLOSED:',
      ws.playerData?.id || 'unknown'
    );

    disconnect(ws);

  });

  // ==========================================================
  // ERROR
  // ==========================================================

  ws.on('error', error => {

    console.log(
      '[WS] SOCKET ERROR:',
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

  const type = String(data.type || '');

  switch (type) {

    case 'ping':
      send(ws, {
        type: 'pong'
      });
      break;

    case 'join':
      join(ws, data);
      break;

    case 'move':
      move(ws, data);
      break;

    case 'animation':
      animation(ws, data);
      break;

    case 'chat':
      chat(ws, data);
      break;

    case 'level_ready':
      level_ready(ws);
      break;

    case 'force_start':
      force_start(ws);
      break;

    case 'player_damage':
      playerDamage(ws, data);
      break;

    case 'town_damage':
      towerDamage(ws, data);
      break;

    case 'barracks_damage':
      barracksDamage(ws, data);
      break;

    case 'creep_damage':
      creepDamage(ws, data);
      break;

    case 'respawn':
      respawn(String(data.id || ''));
      break;

    default:

      console.log(
        '[SERVER] UNKNOWN TYPE:',
        type
      );

      break;
  }
}

// ============================================================
// JOIN
// ============================================================

function join(ws, data) {

  const id = String(
    data.id || ''
  ).trim();

  // ==========================================================
  // ID CHECK
  // ==========================================================

  if (!id) {

    send(ws, {

      type: 'join_error',

      message: 'ID отсутствует'

    });

    return;
  }

  // ==========================================================
  // ALREADY JOINED ON THIS SOCKET
  // ==========================================================

  if (ws.playerData && ws.playerData.id === id) {

    console.log(
      `[JOIN] ${id} уже присоединён этим WebSocket`
    );

    sendPlayerList(ws);

    return;
  }

  // ==========================================================
  // GAME CHECK
  // ==========================================================

  if (
    state.status === 'playing' ||
    state.status === 'countdown'
  ) {

    send(ws, {

      type: 'join_error',

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

      type: 'join_error',

      message: 'Лобби заполнено'

    });

    return;
  }

  // ==========================================================
  // SAME ID FROM ANOTHER SOCKET
  // ==========================================================

  if (players.has(id)) {

    const oldPlayer = players.get(id);

    console.log(
      `[JOIN] ID ${id} уже существует`
    );

    if (
      oldPlayer &&
      oldPlayer.ws &&
      oldPlayer.ws !== ws &&
      open(oldPlayer.ws)
    ) {

      console.log(
        `[JOIN] Закрываем старое соединение ${id}`
      );

      try {

        oldPlayer.ws.close();

      } catch (_) {}

    }

    players.delete(id);
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
  // PLAYER
  // ==========================================================

  const player = {

    id: id,

    ws: ws,

    nickname: String(
      data.nickname || 'Player'
    ).slice(0, 32),

    character: character,

    x: position.x,

    y: position.y,

    flip: false,

    animation: 'idle',

    team: team,

    hp: PLAYER_MAX_HP,

    isDead: false,

    inGame: false,

    lastDamageTime: Date.now()

  };

  players.set(id, player);

  ws.playerData = player;

  // ==========================================================
  // LOG
  // ==========================================================

  console.log('');
  console.log('==========================================');
  console.log('[JOIN SUCCESS]');
  console.log('ID:', id);
  console.log('Nickname:', player.nickname);
  console.log('Character:', player.character);
  console.log('Team:', player.team);
  console.log('Spawn:', player.x, player.y);
  console.log('Players:', players.size);
  console.log('Sockets:', wss.clients.size);
  console.log('==========================================');
  console.log('');

  // ==========================================================
  // JOIN SUCCESS
  // ==========================================================

  send(ws, {

    type: 'join_success',

    id: id,

    nickname: player.nickname,

    team: team,

    x: player.x,

    y: player.y,

    flip: player.flip,

    animation: player.animation,

    character: player.character,

    hp: player.hp

  });

  // ==========================================================
  // IMPORTANT:
  // SEND FULL LIST TO NEW PLAYER
  // ==========================================================

  sendPlayerList(ws);

  // ==========================================================
  // SEND NEW PLAYER TO EVERY OLD PLAYER
  // ==========================================================

  broadcastToPlayers({

    type: 'player_joined',

    id: id,

    nickname: player.nickname,

    character: player.character,

    x: player.x,

    y: player.y,

    flip: player.flip,

    animation: player.animation,

    team: player.team,

    hp: player.hp

  }, ws);

  // ==========================================================
  // FULL LIST TO EVERYONE
  // ==========================================================

  broadcastPlayerList();

  console.log(
    `[SYNC] ${id} joined. All players=${players.size}`
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
    `[READY] ${id} | ready=${readyCount()} players=${players.size}`
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

  let animation = String(
    data.animation || 'idle'
  );

  if (animation.length > 32) {
    animation = animation.slice(0, 32);
  }

  p.animation = animation;

  broadcastToPlayers({

    type: 'player_moved',

    id: p.id,

    x: p.x,

    y: p.y,

    flip: p.flip,

    animation: p.animation

  }, ws);
}

// ============================================================
// ANIMATION ONLY
// ============================================================

function animation(ws, data) {

  const id = ws.playerData?.id;

  if (!id) {
    return;
  }

  const p = players.get(id);

  if (!p || p.isDead) {
    return;
  }

  let animationName = String(
    data.animation || 'idle'
  );

  if (animationName.length > 32) {
    animationName = animationName.slice(0, 32);
  }

  p.animation = animationName;

  broadcastToPlayers({

    type: 'player_moved',

    id: p.id,

    x: p.x,

    y: p.y,

    flip: p.flip,

    animation: p.animation

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
    '[GAME] ALL PLAYERS READY'
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

  state.status = 'countdown';

  state.countdown = COUNTDOWN_TIME;

  broadcast({

    type: 'countdown_start',

    time: state.countdown

  });

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

  state.winner = 0;

  const now = Date.now();

  players.forEach(p => {

    p.hp = PLAYER_MAX_HP;

    p.isDead = false;

    p.animation = 'idle';

    p.lastDamageTime = now;

  });

  const data = playersObject();

  // ==========================================================
  // INIT GAME INDIVIDUALLY
  // ==========================================================

  players.forEach(p => {

    send(p.ws, {

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
  // START
  // ==========================================================

  broadcast({

    type: 'start_game'

  });

  broadcast({

    type: 'countdown_update',

    time: state.timer

  });

  // ==========================================================
  // TIMERS
  // ==========================================================

  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);
  clearInterval(playerRegenTimer);

  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;
  playerRegenTimer = null;

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

    broadcast({

      type: 'countdown_update',

      time: state.timer

    });

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
  // REGEN
  // ==========================================================

  playerRegenTimer = setInterval(
    regeneratePlayers,
    PLAYER_REGEN_INTERVAL
  );

  // ==========================================================
  // CREEPS
  // ==========================================================

  creepTimer = setInterval(
    spawnCreep,
    CREEP_SPAWN_INTERVAL
  );

  console.log('');
  console.log('==========================================');
  console.log('[GAME] GAME STARTED');
  console.log('[GAME] PLAYERS:', players.size);
  console.log('[GAME] TIMER:', formatTime(state.timer));
  console.log('==========================================');
  console.log('');
}

// ============================================================
// PLAYER REGEN
// ============================================================

function regeneratePlayers() {

  if (state.status !== 'playing') {
    return;
  }

  const now = Date.now();

  players.forEach(p => {

    if (p.isDead) {
      return;
    }

    if (p.hp >= PLAYER_MAX_HP) {

      p.hp = PLAYER_MAX_HP;

      return;
    }

    const elapsed =
      now - Number(
        p.lastDamageTime || now
      );

    if (elapsed < PLAYER_REGEN_DELAY) {
      return;
    }

    const oldHp = p.hp;

    p.hp = Math.min(
      PLAYER_MAX_HP,
      p.hp + PLAYER_REGEN_AMOUNT
    );

    if (p.hp === oldHp) {
      return;
    }

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
// CREEP SPAWN
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
        ? -1400
        : 2590,

    y: 450

  };

  state.creeps.push(creep);

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

  p.lastDamageTime = Date.now();

  console.log(
    `[DAMAGE] ${p.id}: -${damage} HP=${p.hp}`
  );

  broadcast({

    type: 'player_damage',

    target_id: p.id,

    new_hp: p.hp

  });

  // ==========================================================
  // DEATH
  // ==========================================================

  if (p.hp <= 0) {

    p.hp = 0;

    p.isDead = true;

    p.animation = 'death';

    broadcast({

      type: 'player_damage',

      target_id: p.id,

      new_hp: 0

    });

    broadcast({

      type: 'player_moved',

      id: p.id,

      x: p.x,

      y: p.y,

      flip: p.flip,

      animation: 'death'

    });

    console.log(
      `[DEATH] ${p.id}`
    );

    setTimeout(() => {

      const currentPlayer =
        players.get(p.id);

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

  if (!p.isDead) {
    return;
  }

  const position =
    spawn(
      p.team,
      true
    );

  p.hp = PLAYER_MAX_HP;

  p.isDead = false;

  p.x = position.x;

  p.y = position.y;

  p.flip = false;

  p.animation = 'idle';

  p.lastDamageTime = Date.now();

  broadcast({

    type: 'respawn',

    id: p.id,

    x: p.x,

    y: p.y,

    hp: p.hp

  });

  broadcast({

    type: 'player_moved',

    id: p.id,

    x: p.x,

    y: p.y,

    flip: false,

    animation: 'idle'

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

  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);
  clearInterval(playerRegenTimer);

  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;
  playerRegenTimer = null;

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

      hp: PLAYER_MAX_HP,

      isDead: false,

      x: position.x,

      y: position.y,

      flip: false,

      animation: 'idle',

      lastDamageTime: Date.now()

    });

  });

  broadcast({

    type: 'reset_lobby'

  });

  broadcastPlayerList();

  console.log(
    '[GAME] LOBBY RESET'
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

  const player =
    players.get(id);

  if (!player) {
    return;
  }

  // ==========================================================
  // IMPORTANT:
  // Не удаляем нового игрока старым сокетом
  // ==========================================================

  if (player.ws !== ws) {

    console.log(
      `[DISCONNECT] OLD SOCKET IGNORED: ${id}`
    );

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

  if (
    state.status === 'countdown' &&
    (
      players.size < MIN_PLAYERS ||
      readyCount() < MIN_PLAYERS
    )
  ) {

    cancelCountdown();
  }

  if (state.status === 'playing') {

    checkPlayers();
  }
}

// ============================================================
// STOP TIMERS
// ============================================================

function stopTimers() {

  clearInterval(countdownTimer);
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);
  clearInterval(playerRegenTimer);

  countdownTimer = null;
  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;
  playerRegenTimer = null;
}

// ============================================================
// PROCESS EXIT
// ============================================================

process.on('SIGINT', () => {

  console.log(
    '[SERVER] STOP'
  );

  stopTimers();

  process.exit(0);
});

process.on('SIGTERM', () => {

  console.log(
    '[SERVER] SIGTERM'
  );

  stopTimers();

  process.exit(0);
});
