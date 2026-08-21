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
// ANIMATION SYNC SETTINGS
// ============================================================

const ANIMATION_SYNC_INTERVAL = 50;

// ============================================================
// PLAYER HP / REGEN SETTINGS
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
const CREEP_SPEED = 80;
const CREEP_DAMAGE = 20;
const CREEP_ATTACK_RANGE = 80;
const CREEP_ATTACK_COOLDOWN = 1000; // 1 секунда между атаками
const CREEP_BARRACKS_ATTACK_RANGE = 160;
const CREEP_SEARCH_RANGE = 380;
const CREEP_UPDATE_INTERVAL = 50;
const CREEP_SYNC_INTERVAL = 100;
const CREEP_ATTACK_ANIMATION_DURATION = 500; // Длительность анимации атаки

// ВАЖНО: Правильные координаты для Godot
const GROUND_Y = 0; // Земля в Godot (Y=0)

// ============================================================
// PLAYERS / STATE
// ============================================================

const players = new Map();
const state = {};

let countdownTimer = null;
let gameTimer = null;
let playerCheckTimer = null;
let creepTimer = null;
let playerRegenTimer = null;
let animationSyncTimer = null;
let creepUpdateTimer = null;
let creepSyncTimer = null;

// ============================================================
// STATE
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
    nextCreepId: 1,
    animationTick: 0,
    animations: [],
    lastCreepUpdate: null
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
  console.log('');
  console.log('CREEP SETTINGS:');
  console.log('  SPAWN INTERVAL:', CREEP_SPAWN_INTERVAL, 'ms');
  console.log('  MAX HP:', CREEP_MAX_HP);
  console.log('  SPEED:', CREEP_SPEED);
  console.log('  DAMAGE:', CREEP_DAMAGE);
  console.log('  ATTACK RANGE:', CREEP_ATTACK_RANGE);
  console.log('  ATTACK COOLDOWN:', CREEP_ATTACK_COOLDOWN, 'ms');
  console.log('  GROUND Y:', GROUND_Y);
  console.log('==========================================');
  console.log('');
});

// ============================================================
// KEEP ALIVE
// ============================================================

setInterval(() => {
  console.log(`[SERVER] alive | players=${players.size} | status=${state.status} | creeps=${state.creeps.length}`);
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
    console.log('[SERVER] Ошибка отправки:', error.message);
  }
}

function broadcast(message, exclude = null) {
  const json = JSON.stringify(message);
  
  wss.clients.forEach(ws => {
    if (ws !== exclude && open(ws)) {
      try {
        ws.send(json);
      } catch (_) {}
    }
  });
}

function spawn(team, respawn = false) {
  return {
    x: team === 1 ? -1500 : 2690,
    y: GROUND_Y
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
    if (p.inGame) count++;
  });
  
  return count;
}

// ============================================================
// ANIMATION SYNC HELPERS
// ============================================================

function syncAnimation(animData) {
  if (!animData || typeof animData !== 'object') return null;
  
  const animation = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    tick: state.animationTick,
    serverTime: Date.now(),
    type: animData.type || 'custom',
    data: animData.data || {},
    sourceId: animData.sourceId || '',
    targetId: animData.targetId || ''
  };
  
  state.animations.push(animation);
  
  if (state.animations.length > 100) {
    state.animations.shift();
  }
  
  broadcast({
    type: 'animation_sync',
    animation: animation
  });
  
  return animation;
}

function broadcastAnimation(type, data, sourceId = '', targetId = '') {
  return syncAnimation({
    type: type,
    data: data,
    sourceId: sourceId,
    targetId: targetId
  });
}

// ============================================================
// CREEP HELPERS
// ============================================================

function getCreepData(creep) {
  return {
    id: creep.id,
    team: creep.team,
    hp: creep.hp,
    maxHp: creep.maxHp,
    x: creep.x,
    y: creep.y,
    targetId: creep.targetId,
    isAttacking: creep.isAttacking,
    isDead: creep.isDead,
    speed: creep.speed,
    damage: creep.damage,
    attackRange: creep.attackRange,
    barracksAttackRange: creep.barracksAttackRange,
    direction: creep.direction,
    animation: creep.animation
  };
}

function getAllCreepsData() {
  return state.creeps.map(creep => getCreepData(creep));
}

function broadcastCreepUpdate(creep) {
  broadcast({
    type: 'creep_update',
    creep: getCreepData(creep)
  });
}

function broadcastAllCreeps() {
  broadcast({
    type: 'creeps_sync',
    creeps: getAllCreepsData()
  });
}

function calculateDistance(obj1, obj2) {
  return Math.abs(obj1.x - obj2.x);
}

function getAttackRangeForCreep(creep, target) {
  if (target.type === 'barracks') {
    return creep.barracksAttackRange;
  }
  return creep.attackRange;
}

function findTargetForCreep(creep) {
  const targets = [];
  
  // Игроки (приоритет 1)
  players.forEach((player, playerId) => {
    if (player.team !== creep.team && !player.isDead) {
      const distance = Math.abs(player.x - creep.x);
      if (distance <= creep.searchRange) {
        targets.push({
          id: playerId,
          type: 'player',
          x: player.x,
          y: GROUND_Y,
          team: player.team,
          priority: 1,
          distance: distance
        });
      }
    }
  });
  
  // Крипы противника (приоритет 2)
  state.creeps.forEach(otherCreep => {
    if (otherCreep.team !== creep.team && !otherCreep.isDead && otherCreep.id !== creep.id) {
      const distance = Math.abs(otherCreep.x - creep.x);
      if (distance <= creep.searchRange) {
        targets.push({
          id: otherCreep.id,
          type: 'creep',
          x: otherCreep.x,
          y: GROUND_Y,
          team: otherCreep.team,
          priority: 2,
          distance: distance
        });
      }
    }
  });
  
  // Казармы (приоритет 3)
  if (creep.team === 1 && !state.redBarracksDestroyed) {
    const distance = Math.abs(1500 - creep.x);
    if (distance <= creep.searchRange) {
      targets.push({
        id: 'red_barracks',
        type: 'barracks',
        x: 1500,
        y: GROUND_Y,
        team: 2,
        priority: 3,
        distance: distance
      });
    }
  } else if (creep.team === 2 && !state.blueBarracksDestroyed) {
    const distance = Math.abs(-1500 - creep.x);
    if (distance <= creep.searchRange) {
      targets.push({
        id: 'blue_barracks',
        type: 'barracks',
        x: -1500,
        y: GROUND_Y,
        team: 1,
        priority: 3,
        distance: distance
      });
    }
  }
  
  // Башни (приоритет 4)
  if (creep.team === 1) {
    const distance = Math.abs(2690 - creep.x);
    if (distance <= creep.searchRange) {
      targets.push({
        id: 'red_tower',
        type: 'tower',
        x: 2690,
        y: GROUND_Y,
        team: 2,
        priority: 4,
        distance: distance
      });
    }
  } else {
    const distance = Math.abs(-1500 - creep.x);
    if (distance <= creep.searchRange) {
      targets.push({
        id: 'blue_tower',
        type: 'tower',
        x: -1500,
        y: GROUND_Y,
        team: 1,
        priority: 4,
        distance: distance
      });
    }
  }
  
  // Сортируем по приоритету, затем по расстоянию
  targets.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.distance - b.distance;
  });
  
  return targets.length > 0 ? targets[0] : null;
}

function moveCreepTowards(creep, target, deltaTime) {
  const dx = target.x - creep.x;
  const moveX = Math.sign(dx) * creep.speed * deltaTime;
  
  // Не проходим сквозь цель
  if (Math.abs(dx) > Math.abs(moveX)) {
    creep.x += moveX;
  } else {
    creep.x = target.x;
  }
  
  creep.y = GROUND_Y;
  creep.direction = dx > 0 ? 1 : -1;
}

function dealCreepDamage(creep, target) {
  if (target.type === 'player') {
    const player = players.get(target.id);
    if (player && !player.isDead) {
      player.hp = Math.max(0, player.hp - creep.damage);
      player.lastDamageTime = Date.now();
      
      broadcast({
        type: 'player_damage',
        target_id: player.id,
        new_hp: player.hp
      });
      
      if (player.hp <= 0) {
        player.isDead = true;
        
        broadcast({
          type: 'player_damage',
          target_id: player.id,
          new_hp: 0
        });
        
        setTimeout(() => {
          const currentPlayer = players.get(player.id);
          if (currentPlayer && currentPlayer.isDead && state.status === 'playing') {
            respawn(currentPlayer.id);
          }
        }, 3000);
      }
    }
  } else if (target.type === 'creep') {
    const targetCreep = state.creeps.find(c => c.id === target.id);
    if (targetCreep && !targetCreep.isDead) {
      targetCreep.hp = Math.max(0, targetCreep.hp - creep.damage);
      
      broadcast({
        type: 'creep_damage',
        id: targetCreep.id,
        new_hp: targetCreep.hp
      });
      
      if (targetCreep.hp <= 0) {
        targetCreep.isDead = true;
      }
    }
  } else if (target.type === 'barracks') {
    if (target.team === 1) {
      state.blueBarracksHp = Math.max(0, state.blueBarracksHp - creep.damage);
      
      broadcast({
        type: 'barracks_damage',
        barracks_id: 1,
        new_hp: state.blueBarracksHp
      });
      
      if (state.blueBarracksHp <= 0 && !state.blueBarracksDestroyed) {
        state.blueBarracksDestroyed = true;
        broadcast({
          type: 'barracks_destroyed',
          barracks_id: 1
        });
      }
    } else {
      state.redBarracksHp = Math.max(0, state.redBarracksHp - creep.damage);
      
      broadcast({
        type: 'barracks_damage',
        barracks_id: 2,
        new_hp: state.redBarracksHp
      });
      
      if (state.redBarracksHp <= 0 && !state.redBarracksDestroyed) {
        state.redBarracksDestroyed = true;
        broadcast({
          type: 'barracks_destroyed',
          barracks_id: 2
        });
      }
    }
  } else if (target.type === 'tower') {
    if (target.team === 1) {
      state.blueTowerHp = Math.max(0, state.blueTowerHp - creep.damage);
      
      broadcast({
        type: 'tower_damage',
        town_id: 1,
        new_hp: state.blueTowerHp
      });
      
      if (state.blueTowerHp <= 0) {
        endGame(2);
      }
    } else {
      state.redTowerHp = Math.max(0, state.redTowerHp - creep.damage);
      
      broadcast({
        type: 'tower_damage',
        town_id: 2,
        new_hp: state.redTowerHp
      });
      
      if (state.redTowerHp <= 0) {
        endGame(1);
      }
    }
  }
}

// ============================================================
// UPDATE CREEPS (SERVER AUTHORITATIVE) - ИСПРАВЛЕННАЯ ВЕРСИЯ
// ============================================================

function updateCreeps() {
  if (state.status !== 'playing') {
    return;
  }

  const now = Date.now();
  const deltaTime = Math.min((now - (state.lastCreepUpdate || now)) / 1000, 0.1);
  state.lastCreepUpdate = now;

  const creepsToRemove = [];

  state.creeps.forEach(creep => {
    if (creep.isDead) {
      creepsToRemove.push(creep);
      return;
    }

    // Обновляем кулдаун атаки
    if (creep.attackCooldown > 0) {
      creep.attackCooldown = Math.max(0, creep.attackCooldown - (deltaTime * 1000));
    }

    // Если крип в процессе атаки, проверяем таймер анимации
    if (creep.isAttacking) {
      if (Date.now() - creep.attackStartTime >= CREEP_ATTACK_ANIMATION_DURATION) {
        creep.isAttacking = false;
        creep.animation = 'run';
      } else {
        // Крип все еще в анимации атаки, не двигаемся
        return;
      }
    }

    // Находим цель
    const target = findTargetForCreep(creep);
    
    if (target) {
      creep.targetId = target.id;
      
      const distance = calculateDistance(creep, target);
      const attackRange = getAttackRangeForCreep(creep, target);
      
      if (distance <= attackRange) {
        // Атакуем цель
        if (creep.attackCooldown <= 0 && !creep.isAttacking) {
          creep.isAttacking = true;
          creep.attackCooldown = CREEP_ATTACK_COOLDOWN;
          creep.attackStartTime = Date.now();
          creep.animation = 'attack';
          
          // Наносим урон цели ОДИН РАЗ
          dealCreepDamage(creep, target);
        }
      } else {
        // Двигаемся к цели
        moveCreepTowards(creep, target, deltaTime);
        creep.isAttacking = false;
        creep.animation = 'run';
      }
    } else {
      // Нет цели - движемся к базе противника
      creep.targetId = null;
      creep.isAttacking = false;
      creep.animation = 'run';
      
      // Движение к вражеской базе
      const targetX = creep.team === 1 ? 2590 : -1400;
      const dx = targetX - creep.x;
      const moveX = Math.sign(dx) * creep.speed * deltaTime;
      
      if (Math.abs(dx) > Math.abs(moveX)) {
        creep.x += moveX;
      } else {
        creep.x = targetX;
      }
      
      creep.y = GROUND_Y;
      creep.direction = dx > 0 ? 1 : -1;
      
      // Проверяем достижение базы
      if (creep.team === 1 && creep.x >= 2590) {
        const towerTarget = {
          id: 'red_tower',
          type: 'tower',
          x: 2690,
          y: GROUND_Y,
          team: 2
        };
        dealCreepDamage(creep, towerTarget);
        creepsToRemove.push(creep);
        creep.isDead = true;
      } else if (creep.team === 2 && creep.x <= -1400) {
        const towerTarget = {
          id: 'blue_tower',
          type: 'tower',
          x: -1500,
          y: GROUND_Y,
          team: 1
        };
        dealCreepDamage(creep, towerTarget);
        creepsToRemove.push(creep);
        creep.isDead = true;
      }
    }
    
    // Отправляем обновление позиции крипа
    broadcastCreepUpdate(creep);
  });

  // Удаляем мертвых крипов
  creepsToRemove.forEach(creep => {
    state.creeps = state.creeps.filter(c => c.id !== creep.id);
    
    broadcast({
      type: 'creep_destroy',
      id: creep.id
    });
    
    broadcastAnimation(
      'creep_destroy',
      { creep_id: creep.id },
      '',
      ''
    );
  });
}

// ============================================================
// SPAWN CREEP
// ============================================================

function spawnCreep() {
  if (state.status !== 'playing') {
    return;
  }

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
    hp: CREEP_MAX_HP,
    maxHp: CREEP_MAX_HP,
    x: team === 1 ? -1400 : 2590,
    y: GROUND_Y,
    targetId: null,
    isAttacking: false,
    attackCooldown: 0,
    attackStartTime: 0,
    isDead: false,
    speed: CREEP_SPEED,
    damage: CREEP_DAMAGE,
    attackRange: CREEP_ATTACK_RANGE,
    barracksAttackRange: CREEP_BARRACKS_ATTACK_RANGE,
    searchRange: CREEP_SEARCH_RANGE,
    direction: team === 1 ? 1 : -1,
    animation: 'run',
    lastUpdateTime: Date.now()
  };

  state.creeps.push(creep);
  state.nextCreepTeam = team === 1 ? 2 : 1;

  broadcast({
    type: 'creep_spawn',
    creep: getCreepData(creep)
  });

  broadcastAnimation(
    'creep_spawn',
    { 
      creep_id: creep.id, 
      position: { x: creep.x, y: creep.y },
      team: creep.team 
    },
    '',
    ''
  );

  console.log(`[CREEP] Спавн крипа ${creep.id} для команды ${team} на X=${creep.x}`);
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
    y: GROUND_Y,
    flip: false,
    team: 0,
    hp: PLAYER_MAX_HP,
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
      console.log('[WS] Ошибка обработки сообщения:', error.message);
      send(ws, {
        type: 'error',
        message: 'Некорректный JSON'
      });
    }
  });

  ws.on('close', () => {
    console.log('[WS] Соединение закрыто:', ws.playerData?.id || 'unknown');
    disconnect(ws);
  });

  ws.on('error', error => {
    console.log('[WS] Ошибка:', error.message);
  });
});

// ============================================================
// ROUTER
// ============================================================

function route(ws, data) {
  if (!data || typeof data !== 'object') return;
  const type = data.type;

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

  if (type === 'respawn') {
    respawn(String(data.id || ''));
    return;
  }

  if (type === 'animation_sync') {
    const animType = String(data.animation_type || 'custom');
    const animData = data.animation_data || {};
    const sourceId = String(data.source_id || ws.playerData?.id || '');
    const targetId = String(data.target_id || '');
    
    broadcastAnimation(animType, animData, sourceId, targetId);
    return;
  }

  if (type === 'animation_batch') {
    const animations = data.animations || [];
    if (Array.isArray(animations)) {
      animations.forEach(anim => {
        syncAnimation({
          type: anim.type || 'custom',
          data: anim.data || {},
          sourceId: anim.source_id || ws.playerData?.id || '',
          targetId: anim.target_id || ''
        });
      });
    }
    return;
  }

  console.log('[SERVER] Неизвестный тип:', type);
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

  if (players.size >= MAX_PLAYERS && !players.has(id)) {
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
    hp: PLAYER_MAX_HP,
    isDead: false,
    inGame: false,
    lastDamageTime: Date.now()
  };

  players.set(id, player);
  ws.playerData = player;

  console.log(`[JOIN] ${id} | Team: ${team} | Character: ${character}`);

  send(ws, {
    type: 'join_success',
    id: id,
    team: team,
    x: player.x,
    y: player.y,
    character: player.character,
    hp: player.hp
  });

  sendPlayerList(ws);

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
  console.log(`[READY] ${id} готов | ready=${readyCount()} players=${players.size}`);
  checkAllReady();
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
  if (!p) return;
  
  const message = String(data.message || '').trim();
  if (!message) return;
  
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
  if (state.status !== 'lobby') return;
  if (players.size < MIN_PLAYERS) return;
  if (readyCount() < MIN_PLAYERS) return;
  
  console.log('[GAME] Все готовы. Запускаем countdown на 60 секунд.');
  startCountdown();
}

// ============================================================
// COUNTDOWN
// ============================================================

function startCountdown() {
  if (countdownTimer) return;
  if (state.status === 'playing') return;
  
  state.status = 'countdown';
  state.countdown = COUNTDOWN_TIME;
  
  broadcast({
    type: 'countdown_start',
    time: state.countdown
  });
  
  console.log(`[GAME] Countdown started: ${state.countdown} seconds`);
  
  countdownTimer = setInterval(() => {
    if (state.status !== 'countdown') {
      clearInterval(countdownTimer);
      countdownTimer = null;
      return;
    }
    
    if (players.size < MIN_PLAYERS || readyCount() < MIN_PLAYERS) {
      console.log('[GAME] Недостаточно игроков. Countdown отменён.');
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
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  
  state.status = 'lobby';
  state.countdown = COUNTDOWN_TIME;
  
  broadcast({
    type: 'countdown_cancel'
  });
  
  console.log('[GAME] Countdown отменён');
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
  
  const now = Date.now();
  players.forEach(p => {
    p.hp = PLAYER_MAX_HP;
    p.isDead = false;
    p.lastDamageTime = now;
  });
  
  const data = playersObject();
  
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
  
  broadcast({
    type: 'start_game'
  });
  
  broadcast({
    type: 'countdown_update',
    time: state.timer
  });
  
  // Очищаем старые таймеры
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);
  clearInterval(playerRegenTimer);
  clearInterval(animationSyncTimer);
  clearInterval(creepUpdateTimer);
  clearInterval(creepSyncTimer);
  
  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;
  playerRegenTimer = null;
  animationSyncTimer = null;
  creepUpdateTimer = null;
  creepSyncTimer = null;
  
  // Запускаем игровой таймер
  gameTimer = setInterval(() => {
    if (state.status !== 'playing') {
      clearInterval(gameTimer);
      gameTimer = null;
      return;
    }
    
    state.timer--;
    if (state.timer < 0) state.timer = 0;
    
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
  
  // Проверка игроков
  playerCheckTimer = setInterval(checkPlayers, 3000);
  
  // Регенерация игроков
  playerRegenTimer = setInterval(regeneratePlayers, PLAYER_REGEN_INTERVAL);
  
  // Спавн крипов
  creepTimer = setInterval(spawnCreep, CREEP_SPAWN_INTERVAL);
  
  // Обновление позиций крипов
  creepUpdateTimer = setInterval(updateCreeps, CREEP_UPDATE_INTERVAL);
  
  // Полная синхронизация крипов
  creepSyncTimer = setInterval(() => {
    if (state.status ===
