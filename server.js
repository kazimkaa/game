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
const CREEP_ATTACK_COOLDOWN = 1000;
const CREEP_BARRACKS_ATTACK_RANGE = 160;
const CREEP_SEARCH_RANGE = 380;
const CREEP_SYNC_INTERVAL = 100;

// ============================================================
// BOT SETTINGS
// ============================================================
const BOT_MAX_HP = 80;
const BOT_SPEED = 100;
const BOT_DAMAGE = 15;
const BOT_ATTACK_RANGE = 70;
const BOT_ATTACK_COOLDOWN = 1500;
const BOT_LIFETIME = 30000;
const BOT_SYNC_INTERVAL = 100;
const MAX_BOTS_PER_PLAYER = 3;
const BOT_DESTROY_DELAY = 5000;

const GROUND_Y = 0;

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
let creepSyncTimer = null;
let botSyncTimer = null;
let botLifeTimer = null;

// ============================================================
// BOT SYNCHRONIZATION FUNCTIONS
// ============================================================

// 1. ОБНОВЛЕНИЕ ПОЗИЦИИ БОТА
function botPosition(ws, data) {
    console.log('[BOT-POS] 📍 ===== НАЧАЛО ОБНОВЛЕНИЯ ПОЗИЦИИ =====');
    console.log(`[BOT-POS] 📥 Данные: ${JSON.stringify(data)}`);
    
    const ownerId = ws.playerData?.id;
    console.log(`[BOT-POS] 👤 ownerId: ${ownerId}`);
    
    if (!ownerId) {
        console.log('[BOT-POS] ❌ Ошибка: нет ownerId');
        return;
    }

    const botId = String(data.bot_id || '');
    const x = Number(data.x);
    const y = Number(data.y);
    const flip = !!data.flip;

    console.log(`[BOT-POS] 📊 botId=${botId}, x=${x}, y=${y}, flip=${flip}`);

    if (!botId) {
        console.log('[BOT-POS] ❌ Ошибка: пустой botId');
        return;
    }

    if (!state.bots) {
        console.log('[BOT-POS] ❌ state.bots не инициализирован');
        return;
    }

    // 🔥 НАЙТИ БОТА
    const bot = state.bots.find(b => b.id === botId);
    if (!bot) {
        console.log(`[BOT-POS] ❌ Бот не найден: ${botId}`);
        return;
    }

    console.log(`[BOT-POS] 🎯 Бот найден: ${botId}, владелец: ${bot.owner_id}`);

    // Проверка владельца
    if (bot.owner_id !== ownerId) {
        console.log(`[BOT-POS] ❌ Владелец не совпадает: бот.owner=${bot.owner_id}, запрос.owner=${ownerId}`);
        return;
    }

    // ============================================================
    // 🔥 ГЛАВНАЯ ПРОВЕРКА: Бот НЕ ДОЛЖЕН ТЕЛЕПОРТИРОВАТЬСЯ К ИГРОКУ
    // ============================================================
    
    // 1. Находим игрока-владельца
    const owner = state.players.find(p => p.id === ownerId);
    
    if (owner) {
        // 2. Расстояние между ботом и игроком
        const distToOwner = Math.sqrt(
            Math.pow(x - owner.x, 2) + 
            Math.pow(y - owner.y, 2)
        );
        
        console.log(`[BOT-POS] 📏 Расстояние до владельца: ${distToOwner.toFixed(2)}px`);
        
        // 🔥 3. МИНИМАЛЬНОЕ расстояние между ботом и игроком (50px)
        const MIN_DIST_TO_OWNER = 50;
        
        if (distToOwner < MIN_DIST_TO_OWNER) {
            console.log(`[BOT-POS] ⚠️ Бот слишком близко к игроку! ${distToOwner.toFixed(2)}px < ${MIN_DIST_TO_OWNER}px`);
            console.log(`[BOT-POS] 🛑 ИГНОРИРУЕМ обновление позиции (бот прилип к игроку)`);
            
            // ❌ НЕ ОБНОВЛЯЕМ ПОЗИЦИЮ!
            // Отправляем владельцу корректную позицию бота (старую)
            const correctionData = {
                type: 'bot_position_update',
                bot_id: bot.id,
                x: bot.x,
                y: bot.y,
                flip: bot.flip || false,
                _correction: true
            };
            
            // Отправляем только владельцу
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify(correctionData));
                console.log(`[BOT-POS] 📤 Отправлена корректирующая позиция бота: (${bot.x.toFixed(2)}, ${bot.y.toFixed(2)})`);
            }
            return;
        }
        
        // 4. Проверка на СЛИШКОМ БОЛЬШОЕ перемещение (телепортация)
        const dx = x - bot.x;
        const dy = y - bot.y;
        const moveDistance = Math.sqrt(dx * dx + dy * dy);
        const MAX_MOVE_DISTANCE = 300; // пикселей за один шаг
        
        if (moveDistance > MAX_MOVE_DISTANCE) {
            console.log(`[BOT-POS] ⚠️ Слишком большое перемещение! ${moveDistance.toFixed(2)}px > ${MAX_MOVE_DISTANCE}px`);
            console.log(`[BOT-POS] 🛑 ИГНОРИРУЕМ обновление позиции (попытка телепортации)`);
            
            const correctionData = {
                type: 'bot_position_update',
                bot_id: bot.id,
                x: bot.x,
                y: bot.y,
                flip: bot.flip || false,
                _correction: true
            };
            
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify(correctionData));
            }
            return;
        }
        
        // 🔥 5. ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Бот не должен прыгать (резкое изменение Y)
        const dyJump = Math.abs(y - bot.y);
        if (dyJump > 100) {
            console.log(`[BOT-POS] ⚠️ Слишком большой прыжок! dy=${dyJump.toFixed(2)}px > 100px`);
            console.log(`[BOT-POS] 🛑 ИГНОРИРУЕМ обновление позиции (попытка прыжка)`);
            
            const correctionData = {
                type: 'bot_position_update',
                bot_id: bot.id,
                x: bot.x,
                y: bot.y,
                flip: bot.flip || false,
                _correction: true
            };
            
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify(correctionData));
            }
            return;
        }
    }

    // ============================================================
    // ✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ - ОБНОВЛЯЕМ ПОЗИЦИЮ
    // ============================================================
    
    const oldX = bot.x;
    const oldY = bot.y;
    bot.x = x;
    bot.y = y;
    bot.flip = flip;

    console.log(`[BOT-POS] ✅ Позиция обновлена: (${oldX.toFixed(2)},${oldY.toFixed(2)}) -> (${x.toFixed(2)},${y.toFixed(2)})`);

    // Рассылаем ВСЕМ клиентам
    const broadcastData = {
        type: 'bot_position_update',
        bot_id: bot.id,
        x: bot.x,
        y: bot.y,
        flip: bot.flip
    };
    
    console.log(`[BOT-POS] 📤 Рассылка: ${JSON.stringify(broadcastData)}`);
    broadcast(broadcastData, ws);
}

// 2. СОЗДАНИЕ БОТА
function botSpawn(ws, data) {
    console.log('[BOT-SPAWN] 🚀 ===== НАЧАЛО СОЗДАНИЯ БОТА =====');
    console.log(`[BOT-SPAWN] 📥 Входящие данные: ${JSON.stringify(data)}`);
    console.log(`[BOT-SPAWN] 📊 state.status: ${state.status}`);
    console.log(`[BOT-SPAWN] 📊 state.bots.length: ${state.bots ? state.bots.length : 0}`);
    console.log(`[BOT-SPAWN] 📊 Всего игроков: ${players.size}`);
    
    const ownerId = ws.playerData?.id;
    console.log(`[BOT-SPAWN] 👤 ownerId: ${ownerId}`);
    
    if (!ownerId) {
        console.log('[BOT-SPAWN] ❌ Ошибка: нет ownerId');
        return;
    }

    const p = players.get(ownerId);
    if (!p) {
        console.log(`[BOT-SPAWN] ❌ Игрок не найден: ${ownerId}`);
        console.log(`[BOT-SPAWN] 📋 Список игроков: ${JSON.stringify([...players.keys()])}`);
        return;
    }

    console.log(`[BOT-SPAWN] 👤 Игрок найден: ${ownerId}, ник: ${p.nickname}, команда: ${p.team}, статус: ${p.isDead ? 'мертв' : 'жив'}`);

    // ПРОВЕРКА - ТОЛЬКО В ИГРЕ
    if (state.status !== 'playing') {
        console.log(`[BOT-SPAWN] ❌ Игра не началась: status=${state.status}`);
        send(ws, { type: 'error', message: 'Игра не началась' });
        return;
    }

    const botId = String(data.bot_id || `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`);
    const x = Number(data.x || p.x);
    const y = Number(data.y || p.y);
    const team = Number(data.team || p.team);
    const hp = Number(data.hp) || BOT_MAX_HP;

    console.log(`[BOT-SPAWN] 📊 Данные бота: id=${botId}, x=${x}, y=${y}, team=${team}, hp=${hp}`);

    // Проверяем лимит ботов
    const playerBots = state.bots ? state.bots.filter(b => b.owner_id === ownerId && !b.isDead) : [];
    console.log(`[BOT-SPAWN] 📊 Ботов у игрока: ${playerBots.length}/${MAX_BOTS_PER_PLAYER}`);
    
    if (playerBots.length >= MAX_BOTS_PER_PLAYER) {
        console.log(`[BOT-SPAWN] ❌ Лимит ботов для игрока ${ownerId}: ${playerBots.length}/${MAX_BOTS_PER_PLAYER}`);
        send(ws, { type: 'error', message: `Достигнут лимит ботов (${MAX_BOTS_PER_PLAYER})` });
        return;
    }

    // Проверяем существование
    const existingBot = state.bots ? state.bots.find(b => b.id === botId) : null;
    if (existingBot) {
        console.log(`[BOT-SPAWN] ⚠️ Бот уже существует: ${botId}, обновляем`);
        existingBot.x = x;
        existingBot.y = y;
        existingBot.team = team;
        existingBot.hp = hp;
        existingBot.isDead = false;
        
        broadcast({
            type: 'bot_spawn_sync',
            bot: {
                id: existingBot.id,
                owner_id: existingBot.owner_id,
                team: existingBot.team,
                hp: existingBot.hp,
                maxHp: existingBot.maxHp || BOT_MAX_HP,
                x: existingBot.x,
                y: existingBot.y,
                flip: existingBot.flip || false
            }
        });
        return;
    }

    // Создаём бота
    if (!state.bots) {
        state.bots = [];
        console.log('[BOT-SPAWN] 📦 state.bots был пуст, создан новый массив');
    }

    const bot = {
        id: botId,
        owner_id: ownerId,
        team: team,
        hp: hp,
        maxHp: BOT_MAX_HP,
        x: x,
        y: y,
        flip: false,
        isDead: false,
        spawnTime: Date.now(),
        lastUpdate: Date.now()
    };

    state.bots.push(bot);
    console.log(`[BOT-SPAWN] ✅ Бот добавлен в state: ${botId}`);
    console.log(`[BOT-SPAWN] 📋 Всего ботов в state: ${state.bots.length}`);

    const spawnData = {
        type: 'bot_spawn_sync',
        bot: {
            id: bot.id,
            owner_id: bot.owner_id,
            team: bot.team,
            hp: bot.hp,
            maxHp: bot.maxHp,
            x: bot.x,
            y: bot.y,
            flip: bot.flip
        }
    };
    
    console.log(`[BOT-SPAWN] 📤 Рассылка создания бота всем: ${JSON.stringify(spawnData)}`);
    
    let clientsCount = 0;
    wss.clients.forEach(client => {
        if (open(client)) clientsCount++;
    });
    console.log(`[BOT-SPAWN] 📊 Открытых клиентов: ${clientsCount}`);
    
    broadcast(spawnData);
    console.log(`[BOT-SPAWN] ✅ Бот ${bot.id} успешно создан игроком ${ownerId}`);
    
    const checkBot = state.bots.find(b => b.id === botId);
    console.log(`[BOT-SPAWN] 🔍 Проверка: бот ${botId} ${checkBot ? 'найден' : 'НЕ НАЙДЕН'} в state`);
    
    logBotsState();
}

// 3. УРОН ПО БОТУ
function botDamage(ws, data) {
    console.log('[BOT-DAMAGE] 💥 Начало обработки урона по боту');
    console.log(`[BOT-DAMAGE] 📥 Данные: ${JSON.stringify(data)}`);
    
    const botId = String(data.bot_id || '');
    const damage = Number(data.damage) || 10;
    const attackerId = String(data.attacker_id || '');

    console.log(`[BOT-DAMAGE] 📊 botId=${botId}, damage=${damage}, attacker=${attackerId}`);

    if (!botId) {
        console.log('[BOT-DAMAGE] ❌ Ошибка: пустой botId');
        return;
    }

    const bot = state.bots ? state.bots.find(b => b.id === botId) : null;
    if (!bot) {
        console.log(`[BOT-DAMAGE] ❌ Бот не найден: ${botId}`);
        return;
    }

    if (bot.isDead) {
        console.log(`[BOT-DAMAGE] ⚠️ Бот уже мёртв: ${botId}`);
        return;
    }

    const oldHp = bot.hp;
    bot.hp = Math.max(0, bot.hp - damage);
    bot.lastUpdate = Date.now();

    console.log(`[BOT-DAMAGE] 💔 HP изменено: ${oldHp} -> ${bot.hp}`);

    broadcast({
        type: 'bot_damage_sync',
        bot_id: bot.id,
        new_hp: bot.hp,
        attacker_id: attackerId
    });

    if (bot.hp <= 0) {
        bot.isDead = true;
        console.log(`[BOT-DAMAGE] 💀 Бот умер: ${botId}`);
        
        broadcast({
            type: 'bot_destroy_sync',
            bot_id: bot.id
        });

        setTimeout(() => {
            const index = state.bots.findIndex(b => b.id === botId);
            if (index !== -1) {
                state.bots.splice(index, 1);
                console.log(`[BOT-DAMAGE] 🗑️ Бот ${botId} удалён из state`);
            }
        }, BOT_DESTROY_DELAY);
    }
}

// 4. УНИЧТОЖЕНИЕ БОТА
function botDestroy(ws, data) {
    console.log('[BOT-DESTROY] 🗑️ Начало уничтожения бота');
    console.log(`[BOT-DESTROY] 📥 Данные: ${JSON.stringify(data)}`);
    
    const botId = String(data.bot_id || '');
    const ownerId = ws.playerData?.id;

    console.log(`[BOT-DESTROY] 📊 botId=${botId}, owner=${ownerId}`);

    if (!botId) {
        console.log('[BOT-DESTROY] ❌ Ошибка: пустой botId');
        return;
    }

    const bot = state.bots ? state.bots.find(b => b.id === botId) : null;
    if (!bot) {
        console.log(`[BOT-DESTROY] ❌ Бот не найден: ${botId}`);
        return;
    }

    if (bot.owner_id !== ownerId) {
        console.log(`[BOT-DESTROY] ❌ Владелец не совпадает: ${bot.owner_id} vs ${ownerId}`);
        return;
    }

    bot.isDead = true;
    console.log(`[BOT-DESTROY] 💀 Бот помечен как мёртвый: ${botId}`);

    broadcast({
        type: 'bot_destroy_sync',
        bot_id: bot.id
    });

    setTimeout(() => {
        const index = state.bots.findIndex(b => b.id === botId);
        if (index !== -1) {
            state.bots.splice(index, 1);
            console.log(`[BOT-DESTROY] 🗑️ Бот ${botId} удалён из state`);
        }
    }, BOT_DESTROY_DELAY);
}

// 5. ПОЛУЧЕНИЕ ВСЕХ БОТОВ
function getBotsSync(ws) {
    console.log('[BOT-SYNC] 🔄 Запрос синхронизации ботов');
    
    if (!state.bots || state.bots.length === 0) {
        console.log('[BOT-SYNC] 📭 Нет ботов для синхронизации');
        send(ws, { type: 'bots_sync', bots: [] });
        return;
    }

    const botsData = state.bots
        .filter(b => !b.isDead)
        .map(b => ({
            id: b.id,
            owner_id: b.owner_id,
            team: b.team,
            hp: b.hp,
            maxHp: b.maxHp || BOT_MAX_HP,
            x: b.x,
            y: b.y,
            flip: b.flip || false
        }));

    console.log(`[BOT-SYNC] 📊 Отправка ${botsData.length} ботов`);
    send(ws, { type: 'bots_sync', bots: botsData });
}

// 6. ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ
function syncBotsToAll() {
    if (!state.bots || state.bots.length === 0) return;

    const aliveBots = state.bots.filter(b => !b.isDead);
    if (aliveBots.length === 0) return;

    const botsData = aliveBots.map(b => ({
        id: b.id,
        owner_id: b.owner_id,
        team: b.team,
        hp: b.hp,
        maxHp: b.maxHp || BOT_MAX_HP,
        x: b.x,
        y: b.y,
        flip: b.flip || false
    }));

    broadcast({ type: 'bots_sync', bots: botsData });
}

// 7. ЛОГИРОВАНИЕ
function logBotsState() {
    console.log('========================================');
    console.log('[BOT-STATE] 📊 СТАТУС БОТОВ');
    console.log(`[BOT-STATE] Всего ботов: ${state.bots ? state.bots.length : 0}`);
    
    if (state.bots) {
        const aliveBots = state.bots.filter(b => !b.isDead);
        console.log(`[BOT-STATE] Живых ботов: ${aliveBots.length}`);
        
        if (aliveBots.length > 0) {
            console.log('[BOT-STATE] Живые боты:');
            aliveBots.forEach((b, i) => {
                console.log(`  ${i+1}. ID: ${b.id}, Владелец: ${b.owner_id}, Команда: ${b.team}, HP: ${b.hp}/${b.maxHp}, Позиция: (${b.x}, ${b.y})`);
            });
        }
    }
    console.log('========================================');
}

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
    bots: [],
    nextCreepTeam: 1,
    nextCreepId: 1,
    animationTick: 0,
    animations: []
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
  console.log('==========================================');
  console.log('');
});

// ============================================================
// KEEP ALIVE
// ============================================================
setInterval(() => {
  console.log(`[SERVER] alive | players=${players.size} | status=${state.status} | creeps=${state.creeps.length} | bots=${state.bots ? state.bots.length : 0}`);
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
  let sentCount = 0;
  wss.clients.forEach(ws => {
    if (ws !== exclude && open(ws)) {
      try {
        ws.send(json);
        sentCount++;
      } catch (_) {}
    }
  });
  console.log(`[BROADCAST] 📤 Отправлено ${sentCount} клиентам: ${message.type || 'unknown'}`);
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
    direction: creep.direction
  };
}

function getAllCreepsData() {
  return state.creeps.map(creep => getCreepData(creep));
}

function broadcastAllCreeps() {
  broadcast({
    type: 'creeps_sync',
    creeps: getAllCreepsData()
  });
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
    hp: CREEP_MAX_HP,
    maxHp: CREEP_MAX_HP,
    x: team === 1 ? -1400 : 2590,
    y: GROUND_Y,
    direction: team === 1 ? 1 : -1
  };

  state.creeps.push(creep);
  state.nextCreepTeam = team === 1 ? 2 : 1;

  broadcast({
    type: 'creep_spawn',
    creep: getCreepData(creep)
  });

  console.log(`[CREEP] Спавн крипа ${creep.id} для команды ${team}`);
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
    console.log('[SERVER] 🤖 Обработка bot_spawn');
    botSpawn(ws, data);
    return;
  }

  if (type === 'bot_position') {
    console.log('[SERVER] 📍 Обработка bot_position');
    botPosition(ws, data);
    return;
  }

  if (type === 'bot_damage') {
    console.log('[SERVER] 💥 Обработка bot_damage');
    botDamage(ws, data);
    return;
  }

  if (type === 'bot_destroy') {
    console.log('[SERVER] 🗑️ Обработка bot_destroy');
    botDestroy(ws, data);
    return;
  }

  if (type === 'summon_bot') {
    console.log('[SERVER] 🚀 Обработка summon_bot');
    summonBot(ws, data);
    return;
  }

  if (type === 'get_bots') {
    console.log('[SERVER] 📋 Обработка get_bots');
    getBotsSync(ws);
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

  console.log('[SERVER] ❌ Неизвестный тип:', type);
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

  if (state.bots && state.bots.length > 0) {
    const aliveBots = state.bots.filter(b => !b.isDead);
    if (aliveBots.length > 0) {
      const botsData = aliveBots.map(b => ({
        id: b.id,
        owner_id: b.owner_id,
        team: b.team,
        hp: b.hp,
        maxHp: b.maxHp,
        x: b.x,
        y: b.y,
        flip: b.flip || false
      }));
      
      send(ws, {
        type: 'bots_sync',
        bots: botsData
      });
      console.log(`[JOIN] Отправлено ${botsData.length} ботов новому игроку`);
    }
  }

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

  console.log('[GAME] Все готовы. Запускаем countdown.');
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

  state.bots = [];
  state.creeps = [];

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

  broadcast({ type: 'start_game' });
  broadcast({ type: 'countdown_update', time: state.timer });

  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);
  clearInterval(playerRegenTimer);
  clearInterval(animationSyncTimer);
  clearInterval(creepSyncTimer);
  clearInterval(botSyncTimer);
  clearInterval(botLifeTimer);

  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;
  playerRegenTimer = null;
  animationSyncTimer = null;
  creepSyncTimer = null;
  botSyncTimer = null;
  botLifeTimer = null;

  gameTimer = setInterval(() => {
    if (state.status !== 'playing') {
      clearInterval(gameTimer);
      gameTimer = null;
      return;
    }

    state.timer--;
    if (state.timer < 0) state.timer = 0;

    broadcast({ type: 'countdown_update', time: state.timer });

    if (state.timer <= 0) {
      clearInterval(gameTimer);
      gameTimer = null;
      endGame(0);
    }
  }, 1000);

  playerCheckTimer = setInterval(checkPlayers, 3000);
  playerRegenTimer = setInterval(regeneratePlayers, PLAYER_REGEN_INTERVAL);
  creepTimer = setInterval(spawnCreep, CREEP_SPAWN_INTERVAL);

  creepSyncTimer = setInterval(() => {
    if (state.status === 'playing') {
      broadcastAllCreeps();
    }
  }, CREEP_SYNC_INTERVAL);

  botSyncTimer = setInterval(() => {
    if (state.status === 'playing') {
      syncBotsToAll();
    }
  }, BOT_SYNC_INTERVAL);

  botLifeTimer = setInterval(() => {
    if (state.status !== 'playing') return;

    const now = Date.now();
    if (state.bots) {
      state.bots.forEach(bot => {
        if (bot.isDead) return;
        if (now - bot.spawnTime > BOT_LIFETIME) {
          console.log(`[BOT-LIFE] Бот ${bot.id} истек (${BOT_LIFETIME/1000} сек)`);
          botDamage(null, { bot_id: bot.id, damage: 99999 });
        }
      });
    }
  }, 5000);

  animationSyncTimer = setInterval(() => {
    if (state.status !== 'playing') return;

    state.animationTick++;
    broadcast({
      type: 'animation_tick',
      tick: state.animationTick,
      serverTime: Date.now()
    });
  }, ANIMATION_SYNC_INTERVAL);

  console.log('[GAME] ИГРА НАЧАЛАСЬ');
  console.log(`[GAME] state.bots инициализирован: ${state.bots ? 'да' : 'нет'}`);
}

// ============================================================
// SERVER PLAYER REGENERATION
// ============================================================
function regeneratePlayers() {
  if (state.status !== 'playing') return;

  const now = Date.now();
  players.forEach(p => {
    if (p.isDead) return;
    if (p.hp >= PLAYER_MAX_HP) {
      p.hp = PLAYER_MAX_HP;
      return;
    }

    const elapsed = now - Number(p.lastDamageTime || now);
    if (elapsed < PLAYER_REGEN_DELAY) return;

    const oldHp = p.hp;
    p.hp = Math.min(PLAYER_MAX_HP, p.hp + PLAYER_REGEN_AMOUNT);

    if (p.hp === oldHp) return;

    broadcast({
      type: 'player_damage',
      target_id: p.id,
      new_hp: p.hp
    });
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

  broadcast({
    type: 'player_damage',
    target_id: p.id,
    new_hp: p.hp
  });

  if (p.hp <= 0) {
    p.hp = 0;
    p.isDead = true;

    broadcast({
      type: 'player_damage',
      target_id: p.id,
      new_hp: 0
    });

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

  p.hp = PLAYER_MAX_HP;
  p.isDead = false;
  p.x = position.x;
  p.y = position.y;
  p.flip = false;
  p.lastDamageTime = Date.now();

  broadcast({
    type: 'respawn',
    id: p.id,
    x: p.x,
    y: p.y,
    hp: p.hp
  });

  broadcast({
    type: 'player_damage',
    target_id: p.id,
    new_hp: p.hp
  });
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

  broadcast({
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

  broadcast({
    type: 'barracks_damage',
    barracks_id: blue ? 1 : 2,
    new_hp: state[hpKey]
  });

  if (state[hpKey] <= 0 && !state[deadKey]) {
    state[deadKey] = true;

    broadcast({
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

  broadcast({
    type: 'creep_damage',
    id: creep.id,
    new_hp: creep.hp
  });

  if (creep.hp <= 0) {
    broadcast({
      type: 'creep_destroy',
      id: creep.id
    });
  }
}

// ============================================================
// CREEP POSITION UPDATE
// ============================================================
function creepPositionUpdate(_, data) {
  if (state.status !== 'playing') return;

  const id = String(data.id || '');
  const creep = state.creeps.find(item => item.id === id);
  if (!creep) return;

  if (data.x !== undefined) creep.x = Number(data.x);
  if (data.y !== undefined) creep.y = Number(data.y);
  if (data.direction !== undefined) creep.direction = Number(data.direction);

  broadcast({
    type: 'creep_position_update',
    id: creep.id,
    x: creep.x,
    y: creep.y,
    direction: creep.direction
  });
}

// ============================================================
// SUMMON BOT
// ============================================================
function summonBot(ws, data) {
  console.log('[SUMMON-BOT] 🚀 Призыв бота');
  
  const ownerId = String(data.player_id || ws.playerData?.id || '');
  const p = players.get(ownerId);
  if (!p) {
    send(ws, { type: 'error', message: 'Игрок не найден' });
    return;
  }

  if (state.status !== 'playing') {
    send(ws, { type: 'error', message: 'Игра не началась' });
    return;
  }

  if (p.isDead) {
    send(ws, { type: 'error', message: 'Вы мертвы' });
    return;
  }

  const x = Number(data.position?.[0] || p.x || 0);
  const y = Number(data.position?.[1] || p.y || 0);
  const team = p.team;

  if (!state.bots) {
    state.bots = [];
  }

  const bot = {
    id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    owner_id: ownerId,
    team: team,
    hp: BOT_MAX_HP,
    maxHp: BOT_MAX_HP,
    x: x,
    y: y,
    flip: false,
    isDead: false,
    spawnTime: Date.now(),
    lastUpdate: Date.now()
  };

  state.bots.push(bot);

  broadcast({
    type: 'bot_spawn_sync',
    bot: {
      id: bot.id,
      owner_id: bot.owner_id,
      team: bot.team,
      hp: bot.hp,
      maxHp: bot.maxHp,
      x: bot.x,
      y: bot.y,
      flip: bot.flip
    }
  });

  send(ws, {
    type: 'summon_bot_success',
    bot_id: bot.id,
    x: bot.x,
    y: bot.y
  });

  console.log(`[SUMMON-BOT] ✅ Бот ${bot.id} призван игроком ${ownerId}`);
  logBotsState();
}

// ============================================================
// CHECK PLAYERS
// ============================================================
function checkPlayers() {
  if (state.status !== 'playing') return;

  if (players.size < MIN_PLAYERS) {
    const remaining = players.size > 0 ? [...players.values()][0] : null;
    endGame(remaining ? remaining.team : 0);
  }
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
  clearInterval(animationSyncTimer);
  clearInterval(creepSyncTimer);
  clearInterval(botSyncTimer);
  clearInterval(botLifeTimer);

  gameTimer = null;
  playerCheckTimer = null;
  creepTimer = null;
  playerRegenTimer = null;
  animationSyncTimer = null;
  creepSyncTimer = null;
  botSyncTimer = null;
  botLifeTimer = null;

  broadcast({
    type: 'countdown_update',
    time: 0
  });

  broadcast({
    type: 'game_over',
    winner_team: winner
  });

  console.log(`[GAME] ИГРА ЗАКОНЧЕНА | WINNER: ${winner}`);

  setTimeout(resetGame, 5000);
}

// ============================================================
// RESET GAME
// ============================================================
function resetGame() {
  resetState();

  players.forEach(p => {
    const position = spawn(p.team, true);
    Object.assign(p, {
      inGame: false,
      hp: PLAYER_MAX_HP,
      isDead: false,
      x: position.x,
      y: position.y,
      flip: false,
      lastDamageTime: Date.now()
    });
  });

  broadcast({
    type: 'reset_lobby'
  });

  broadcastPlayerList();
  console.log('[GAME] Лобби сброшено');
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

  console.log(`[DISCONNECT] ${id} | players=${players.size}`);

  broadcast({
    type: 'player_left',
    id: id
  });

  broadcastPlayerList();
  syncBotsToAll();

  if (state.status === 'countdown' && (players.size < MIN_PLAYERS || readyCount() < MIN_PLAYERS)) {
    cancelCountdown();
  }

  if (state.status === 'playing') {
    checkPlayers();
  }
}

// ============================================================
// PROCESS EXIT
// ============================================================
process.on('SIGINT', () => {
  console.log('[SERVER] Остановка...');
  clearInterval(countdownTimer);
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);
  clearInterval(playerRegenTimer);
  clearInterval(animationSyncTimer);
  clearInterval(creepSyncTimer);
  clearInterval(botSyncTimer);
  clearInterval(botLifeTimer);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM');
  clearInterval(countdownTimer);
  clearInterval(gameTimer);
  clearInterval(playerCheckTimer);
  clearInterval(creepTimer);
  clearInterval(playerRegenTimer);
  clearInterval(animationSyncTimer);
  clearInterval(creepSyncTimer);
  clearInterval(botSyncTimer);
  clearInterval(botLifeTimer);
  process.exit(0);
});
