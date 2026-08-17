const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

const players = new Map();

const state = {
  status: 'lobby',
  countdown: 15,
  timer: 300,
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


// ============================================================
// HTTP
// ============================================================

const server = http.createServer((req, res) => {

  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8'
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
  server: server
});


// ============================================================
// SERVER START
// ============================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Started on port ${PORT}`);
});


// ============================================================
// KEEP ALIVE
// ============================================================

setInterval(() => {
  console.log(
    `[SERVER] alive | players: ${players.size} | status: ${state.status}`
  );
}, 30000);


// ============================================================
// HELPERS
// ============================================================

function open(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function send(ws, message) {
  if (!open(ws)) return;

  try {
    ws.send(JSON.stringify(message));
  } catch (error) {
    console.log('[SERVER] Send error:', error.message);
  }
}

function broadcast(message, exclude = null) {

  const json = JSON.stringify(message);

  wss.clients.forEach(ws => {

    if (
      ws !== exclude &&
      ws.readyState === WebSocket.OPEN
    ) {
      try {
        ws.send(json);
      } catch (_) {}
    }

  });
}

function spawn(team, respawn = false) {

  return {
    x: team === 1 ? -1500 : 2690,
    y: respawn ? 450 : 500
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

function readyCount() {

  let count = 0;

  players.forEach(p => {
    if (p.inGame) {
      count++;
    }
  });

  return count;
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


// ============================================================
// CONNECTION
// ============================================================

wss.on('connection', ws => {

  console.log('[SERVER] New connection');

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


  // ----------------------------------------------------------
  // MESSAGE
  // ----------------------------------------------------------

  ws.on('message', raw => {

    try {

      const data = JSON.parse(raw.toString());

      route(ws, data);

    } catch (error) {

      console.log(
        '[SERVER] JSON error:',
        error.message
      );

      send(ws, {
        type: 'error',
        message: 'Некорректный JSON'
      });

    }

  });


  // ----------------------------------------------------------
  // CLOSE
  // ----------------------------------------------------------

  ws.on('close', () => {

    console.log(
      `[SERVER] Connection closed | id=${ws.playerData.id}`
    );

    disconnect(ws);

  });


  ws.on('error', error => {

    console.log(
      '[SERVER] WebSocket error:',
      error.message
    );

  });

});


// ============================================================
// ROUTER
// ============================================================

function route(ws, data) {

  if (!data || !data.type) {
    return;
  }

  if (data.type === 'ping') {

    send(ws, {
      type: 'pong'
    });

    return;
  }


  switch (data.type) {

    case 'join':
      join(ws, data);
      break;

    case 'move':
      move(ws, data);
      break;

    case 'chat':
      chat(ws, data);
      break;

    case 'level_ready':
      levelReady(ws);
      break;

    case 'force_start':
      forceStart(ws);
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

  }

}


// ============================================================
// JOIN
// ============================================================

function join(ws, data) {

  // ----------------------------------------------------------
  // ID
  // ----------------------------------------------------------

  const id = String(data.id || '');

  if (!id) {

    send(ws, {
      type: 'error',
      message: 'ID отсутствует'
    });

    return;
  }


  if (players.has(id)) {

    send(ws, {
      type: 'error',
      message: 'ID занят'
    });

    return;
  }


  // ----------------------------------------------------------
  // MAX PLAYERS
  // ----------------------------------------------------------

  if (players.size >= MAX_PLAYERS) {

    send(ws, {
      type: 'error',
      message: 'Лобби заполнено'
    });

    return;
  }


  // ----------------------------------------------------------
  // НЕЛЬЗЯ ВОЙТИ В ИГРУ
  // ----------------------------------------------------------

  if (state.status === 'playing') {

    send(ws, {
      type: 'error',
      message: 'Игра уже началась'
    });

    return;
  }


  // ----------------------------------------------------------
  // TEAM
  // ----------------------------------------------------------

  let team1 = 0;
  let team2 = 0;

  players.forEach(p => {

    if (p.team === 1) {
      team1++;
    } else if (p.team === 2) {
      team2++;
    }

  });


  const team = team1 <= team2 ? 1 : 2;


  // ----------------------------------------------------------
  // CHARACTER
  // ----------------------------------------------------------

  const character =
    Number(data.character) === 2
      ? 2
      : 1;


  // ----------------------------------------------------------
  // SPAWN
  // ----------------------------------------------------------

  const position = spawn(team);


  // ----------------------------------------------------------
  // CREATE PLAYER
  // ----------------------------------------------------------

  const p = {

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


  // ----------------------------------------------------------
  // SAVE PLAYER
  // ----------------------------------------------------------

  players.set(id, p);

  ws.playerData = p;


  console.log(
    `[SERVER] PLAYER CREATED IMMEDIATELY | id=${id} | team=${team} | x=${p.x} | y=${p.y}`
  );


  // ==========================================================
  // ВАЖНО:
  // СНАЧАЛА ОТПРАВЛЯЕМ ПЕРСОНАЖА
  // ==========================================================

  send(ws, {

    type: 'join_success',

    id: p.id,

    team: p.team,

    x: p.x,

    y: p.y,

    character: p.character,

    nickname: p.nickname,

    flip: p.flip,

    hp: p.hp

  });


  // ==========================================================
  // ОТДЕЛЬНАЯ КОМАНДА СОЗДАНИЯ ИГРОКА
  // ==========================================================

  send(ws, {

    type: 'spawn_player',

    id: p.id,

    nickname: p.nickname,

    character: p.character,

    x: p.x,

    y: p.y,

    flip: p.flip,

    team: p.team,

    hp: p.hp,

    isDead: false

  });


  // ==========================================================
  // СПИСОК ИГРОКОВ
  // ==========================================================

  sendPlayerList(ws);


  // ==========================================================
  // СООБЩАЕМ ДРУГИМ
  // ==========================================================

  broadcast({

    type: 'player_joined',

    id: p.id,

    nickname: p.nickname,

    character: p.character,

    x: p.x,

    y: p.y,

    flip: p.flip,

    team: p.team,

    hp: p.hp

  }, ws);


  // ==========================================================
  // ОБНОВЛЯЕМ СПИСОК ВСЕМ
  // ==========================================================

  broadcastPlayerList();

}


// ============================================================
// LEVEL READY
// ============================================================

function levelReady(ws) {

  const p = players.get(ws.playerData.id);

  if (!p) {
    return;
  }

  if (state.status === 'playing') {
    return;
  }

  p.inGame = true;

  console.log(
    `[SERVER] level_ready | ${p.id} | ready=${readyCount()}`
  );

  checkAllReady();

}


// ============================================================
// MOVE
// ============================================================

function move(ws, data) {

  const p = players.get(ws.playerData.id);

  if (!p || p.isDead) {
    return;
  }

  p.x = Number(data.x) || 0;
  p.y = Number(data.y) || 0;
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

  const p = players.get(ws.playerData.id);

  if (!p) {
    return;
  }

  const message =
    String(data.message || '').trim();

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

  if (
    state.status === 'lobby' &&
    players.size >= MIN_PLAYERS &&
    readyCount() >= MIN_PLAYERS
  ) {

    console.log(
      '[SERVER] Two players ready -> countdown'
    );

    startCountdown();

  }

}


// ============================================================
// COUNTDOWN
// ============================================================

function startCountdown() {

  if (
    countdownTimer ||
    state.status === 'playing'
  ) {
    return;
  }

  state.status = 'countdown';
  state.countdown = 15;


  broadcast({

    type: 'countdown_start',

    time: state.countdown

  });


  countdownTimer = setInterval(() => {

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

    clearInterval(countdownTimer);

    countdownTimer = null;

  }

  state.status = 'lobby';
  state.countdown = 15;


  broadcast({

    type: 'countdown_cancel'

  });

}


// ============================================================
// FORCE START
// ============================================================

function forceStart(ws) {

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
  state.timer = 300;


  const data = playersObject();


  // ----------------------------------------------------------
  // ИНИЦИАЛИЗАЦИЯ ИГРЫ
  // ----------------------------------------------------------

  wss.clients.forEach(ws => {

    const p =
      players.get(ws.playerData?.id);

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


  broadcast({
    type: 'start_game'
  });


  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);


  gameTimer = setInterval(() => {

    state.timer--;

    if (state.timer <= 0) {
      endGame(0);
    }

  }, 1000);


  playerCheckTimer =
    setInterval(checkPlayers, 3000);


  creepTimer =
    setInterval(spawnCreep, 5000);

}


// ============================================================
// CREEP
// ============================================================

function spawnCreep() {

  if (state.status !== 'playing') {
    return;
  }


  const team =
    state.nextCreepTeam;


  state.nextCreepTeam =
    team === 1 ? 2 : 1;


  const creep = {

    id: `creep_${state.nextCreepId++}`,

    team: team,

    hp: 80,

    x: team === 1 ? -1400 : 2590,

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

  const id =
    String(data.target_id || '');

  const p =
    players.get(id);


  if (
    !p ||
    p.isDead ||
    state.status !== 'playing'
  ) {
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
    players.get(String(id || ''));


  if (
    !p ||
    state.status !== 'playing'
  ) {
    return;
  }


  const position =
    spawn(p.team, true);


  p.hp = 100;
  p.isDead = false;
  p.x = position.x;
  p.y = position.y;


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

    town_id: blue ? 1 : 2,

    new_hp: state[key]

  });


  if (state[key] <= 0) {

    endGame(
      blue ? 2 : 1
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


  if (
    state[hpKey] <= 0 &&
    !state[deadKey]
  ) {

    state[deadKey] = true;


    broadcast({

      type: 'barracks_destroyed',

      barracks_id: blue ? 1 : 2

    });

  }


  broadcast({

    type: 'barracks_damage',

    barracks_id: blue ? 1 : 2,

    new_hp: state[hpKey]

  });

}


// ============================================================
// CREEP DAMAGE
// ============================================================

function creepDamage(_, data) {

  if (state.status !== 'playing') {
    return;
  }


  const id =
    String(data.id || '');


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
        item => item.id !== creep.id
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
      players.size
        ? [...players.values()][0].team
        : 0;


    endGame(remaining);

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


  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);


  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;


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


  setTimeout(resetGame, 5000);

}


// ============================================================
// RESET
// ============================================================

function resetGame() {

  clearInterval(countdownTimer);
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);


  countdownTimer = null;
  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;


  state.status = 'lobby';
  state.countdown = 15;
  state.timer = 300;
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


  players.forEach(p => {

    const position =
      spawn(p.team, true);

    p.inGame = false;
    p.hp = 100;
    p.isDead = false;
    p.x = position.x;
    p.y = position.y;

  });


  broadcast({
    type: 'reset_lobby'
  });


  broadcastPlayerList();

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


  if (!players.delete(id)) {
    return;
  }


  console.log(
    `[SERVER] Player disconnected: ${id}`
  );


  broadcast({

    type: 'player_left',

    id: id

  });


  broadcastPlayerList();


  if (
    state.status === 'countdown' &&
    players.size < MIN_PLAYERS
  ) {

    cancelCountdown();

  }


  if (state.status === 'playing') {

    checkPlayers();

  }

}


// ============================================================
// SHUTDOWN
// ============================================================

process.on('SIGINT', () => {

  clearInterval(countdownTimer);
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);

  process.exit(0);

});
