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
const BOT_DESTROY_DELAY = 5000; // 5 секунд


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
// BOT SYNCHRONIZATION (НОВЫЕ ФУНКЦИИ) С ОТЛАДКОЙ
// ============================================================

// ============================================================
// 1. ОБНОВЛЕНИЕ ПОЗИЦИИ БОТА
// ============================================================
function botPosition(ws, data) {
    console.log('[BOT-POS] 📍 Начало обработки позиции бота');
    console.log(`[BOT-POS] 📥 Входящие данные: ${JSON.stringify(data)}`);
    
    const ownerId = ws.playerData?.id;
    if (!ownerId) {
        console.log('[BOT-POS] ❌ Ошибка: нет ownerId');
        return;
    }

    const botId = String(data.bot_id || '');
    const x = Number(data.x);
    const y = Number(data.y);
    const flip = !!data.flip;

    console.log(`[BOT-POS] 📊 Данные: botId=${botId}, x=${x}, y=${y}, flip=${flip}, owner=${ownerId}`);

    if (!botId) {
        console.log('[BOT-POS] ❌ Ошибка: пустой botId');
        return;
    }

    // Ищем бота в state.bots
    const bot = state.bots.find(b => b.id === botId);
    if (!bot) {
        console.log(`[BOT-POS] ❌ Бот не найден в state: ${botId}`);
        console.log(`[BOT-POS] 📋 Все боты в state: ${JSON.stringify(state.bots.map(b => b.id))}`);
        return;
    }

    // Проверяем, что владелец бота - этот игрок
    if (bot.owner_id !== ownerId) {
        console.log(`[BOT-POS] ❌ Владелец не совпадает: bot.owner=${bot.owner_id}, owner=${ownerId}`);
        return;
    }

    // Обновляем позицию
    const oldX = bot.x;
    const oldY = bot.y;
    bot.x = x;
    bot.y = y;
    bot.flip = flip;

    console.log(`[BOT-POS] ✅ Позиция обновлена: ${botId} (${oldX},${oldY}) -> (${x},${y})`);

    // Рассылаем ВСЕМ игрокам
    const broadcastData = {
        type: 'bot_position_update',
        bot_id: bot.id,
        x: bot.x,
        y: bot.y,
        flip: bot.flip
    };
    
    console.log(`[BOT-POS] 📤 Рассылка позиции всем: ${JSON.stringify(broadcastData)}`);
    broadcast(broadcastData, ws);
}

// ============================================================
// 2. СОЗДАНИЕ БОТА
// ============================================================
// ============================================================
// 2. СОЗДАНИЕ БОТА (ИСПРАВЛЕННАЯ)
// ============================================================
function botSpawn(ws, data) {
    console.log('[BOT-SPAWN] 🚀 Начало создания бота');
    console.log(`[BOT-SPAWN] 📥 Входящие данные: ${JSON.stringify(data)}`);
    
    const ownerId = ws.playerData?.id;
    if (!ownerId) {
        console.log('[BOT-SPAWN] ❌ Ошибка: нет ownerId');
        return;
    }

    const p = players.get(ownerId);
    if (!p) {
        console.log(`[BOT-SPAWN] ❌ Игрок не найден: ${ownerId}`);
        return;
    }

    console.log(`[BOT-SPAWN] 👤 Игрок: ${ownerId}, ник: ${p.nickname}, команда: ${p.team}`);

    // Получаем данные бота (используем правильные имена полей)
    const botId = String(data.bot_id || `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`);
    const x = Number(data.x || p.x);
    const y = Number(data.y || p.y);
    const team = Number(data.team || p.team);
    const hp = Number(data.hp) || BOT_MAX_HP;

    console.log(`[BOT-SPAWN] 📊 Данные бота: id=${botId}, x=${x}, y=${y}, team=${team}, hp=${hp}`);

    // Проверяем лимит ботов
    const playerBots = state.bots.filter(b => b.owner_id === ownerId && !b.isDead);
    if (playerBots.length >= MAX_BOTS_PER_PLAYER) {
        console.log(`[BOT-SPAWN] ❌ Лимит ботов для игрока ${ownerId}: ${playerBots.length}/${MAX_BOTS_PER_PLAYER}`);
        send(ws, { type: 'error', message: `Достигнут лимит ботов (${MAX_BOTS_PER_PLAYER})` });
        return;
    }

    // Проверяем, не существует ли уже такой бот
    const existingBot = state.bots.find(b => b.id === botId);
    if (existingBot) {
        console.log(`[BOT-SPAWN] ⚠️ Бот уже существует: ${botId}, обновляем данные`);
        existingBot.x = x;
        existingBot.y = y;
        existingBot.team = team;
        existingBot.hp = hp;
        existingBot.isDead = false;
        
        // Рассылаем обновление
        const updateData = {
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
        };
        console.log(`[BOT-SPAWN] 📤 Обновление бота: ${JSON.stringify(updateData)}`);
        broadcast(updateData);
        return;
    }

    // Создаём бота в state
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
    console.log(`[BOT-SPAWN] 📋 Всего ботов: ${state.bots.length}`);

    // Рассылаем ВСЕМ о создании бота
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
    broadcast(spawnData);

    console.log(`[BOT-SPAWN] ✅ Бот ${bot.id} успешно создан игроком ${ownerId}`);
    logBotsState();
}
    // Проверяем игру
    if (state.status !== 'playing') {
        console.log(`[BOT-SPAWN] ❌ Игра не началась: status=${state.status}`);
        send(ws, { type: 'error', message: 'Игра не началась' });
        return;
    }

    // Получаем данные бота
    const botId = String(data.bot_id || `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`);
    const x = Number(data.x || p.x);
    const y = Number(data.y || p.y);
    const team = Number(data.team || p.team);
    const hp = Number(data.hp) || BOT_MAX_HP;

    console.log(`[BOT-SPAWN] 📊 Данные бота: id=${botId}, x=${x}, y=${y}, team=${team}, hp=${hp}`);

    // Проверяем лимит ботов
    const playerBots = state.bots.filter(b => b.owner_id === ownerId && !b.isDead);
    if (playerBots.length >= MAX_BOTS_PER_PLAYER) {
        console.log(`[BOT-SPAWN] ❌ Лимит ботов для игрока ${ownerId}: ${playerBots.length}/${MAX_BOTS_PER_PLAYER}`);
        send(ws, { type: 'error', message: `Достигнут лимит ботов (${MAX_BOTS_PER_PLAYER})` });
        return;
    }

    // Проверяем, не существует ли уже такой бот
    const existingBot = state.bots.find(b => b.id === botId);
    if (existingBot) {
        console.log(`[BOT-SPAWN] ⚠️ Бот уже существует: ${botId}, обновляем данные`);
        existingBot.x = x;
        existingBot.y = y;
        existingBot.team = team;
        existingBot.hp = hp;
        existingBot.isDead = false;
        
        // Рассылаем обновление
        const updateData = {
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
        };
        console.log(`[BOT-SPAWN] 📤 Обновление бота: ${JSON.stringify(updateData)}`);
        broadcast(updateData);
        return;
    }

    // Создаём бота в state
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
    console.log(`[BOT-SPAWN] 📋 Всего ботов: ${state.bots.length}`);

    // Рассылаем ВСЕМ о создании бота
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
    broadcast(spawnData);

    console.log(`[BOT-SPAWN] ✅ Бот ${bot.id} успешно создан игроком ${ownerId}`);
    logBotsState();
}

// ============================================================
// 3. УРОН ПО БОТУ
// ============================================================
function botDamage(ws, data) {
    console.log('[BOT-DAMAGE] 💥 Начало обработки урона по боту');
    console.log(`[BOT-DAMAGE] 📥 Входящие данные: ${JSON.stringify(data)}`);
    
    const botId = String(data.bot_id || '');
    const damage = Number(data.damage) || 10;
    const attackerId = String(data.attacker_id || '');

    console.log(`[BOT-DAMAGE] 📊 Данные: botId=${botId}, damage=${damage}, attacker=${attackerId}`);

    if (!botId) {
        console.log('[BOT-DAMAGE] ❌ Ошибка: пустой botId');
        return;
    }

    const bot = state.bots.find(b => b.id === botId);
    if (!bot) {
        console.log(`[BOT-DAMAGE] ❌ Бот не найден: ${botId}`);
        return;
    }

    if (bot.isDead) {
        console.log(`[BOT-DAMAGE] ⚠️ Бот уже мёртв: ${botId}`);
        return;
    }

    const oldHp = bot.hp;
    // Наносим урон
    bot.hp = Math.max(0, bot.hp - damage);
    bot.lastUpdate = Date.now();

    console.log(`[BOT-DAMAGE] 💔 HP изменено: ${oldHp} -> ${bot.hp} (урон: ${damage})`);

    // Рассылаем ВСЕМ об уроне
    const damageData = {
        type: 'bot_damage_sync',
        bot_id: bot.id,
        new_hp: bot.hp,
        attacker_id: attackerId
    };
    
    console.log(`[BOT-DAMAGE] 📤 Рассылка урона всем: ${JSON.stringify(damageData)}`);
    broadcast(damageData);

    // Если бот умер
    if (bot.hp <= 0) {
        bot.isDead = true;
        console.log(`[BOT-DAMAGE] 💀 Бот умер: ${botId}`);
        
        const destroyData = {
            type: 'bot_destroy_sync',
            bot_id: bot.id
        };
        
        console.log(`[BOT-DAMAGE] 📤 Рассылка смерти бота всем: ${JSON.stringify(destroyData)}`);
        broadcast(destroyData);

        // Удаляем через 5 секунд
        console.log(`[BOT-DAMAGE] ⏳ Бот ${botId} будет удалён через ${BOT_DESTROY_DELAY/1000} секунд`);
        setTimeout(() => {
            const index = state.bots.findIndex(b => b.id === botId);
            if (index !== -1) {
                state.bots.splice(index, 1);
                console.log(`[BOT-DAMAGE] 🗑️ Бот ${botId} удалён из state`);
                logBotsState();
            }
        }, BOT_DESTROY_DELAY);
    }
}

// ============================================================
// 4. УНИЧТОЖЕНИЕ БОТА
// ============================================================
function botDestroy(ws, data) {
    console.log('[BOT-DESTROY] 🗑️ Начало уничтожения бота');
    console.log(`[BOT-DESTROY] 📥 Входящие данные: ${JSON.stringify(data)}`);
    
    const botId = String(data.bot_id || '');
    const ownerId = ws.playerData?.id;

    console.log(`[BOT-DESTROY] 📊 Данные: botId=${botId}, owner=${ownerId}`);

    if (!botId) {
        console.log('[BOT-DESTROY] ❌ Ошибка: пустой botId');
        return;
    }

    const bot = state.bots.find(b => b.id === botId);
    if (!bot) {
        console.log(`[BOT-DESTROY] ❌ Бот не найден: ${botId}`);
        return;
    }

    // Проверяем, что владелец бота - этот игрок
    if (bot.owner_id !== ownerId) {
        console.log(`[BOT-DESTROY] ❌ Владелец не совпадает: bot.owner=${bot.owner_id}, owner=${ownerId}`);
        return;
    }

    bot.isDead = true;
    console.log(`[BOT-DESTROY] 💀 Бот помечен как мёртвый: ${botId}`);

    const destroyData = {
        type: 'bot_destroy_sync',
        bot_id: bot.id
    };
    
    console.log(`[BOT-DESTROY] 📤 Рассылка уничтожения бота всем: ${JSON.stringify(destroyData)}`);
    broadcast(destroyData);

    // Удаляем через 5 секунд
    console.log(`[BOT-DESTROY] ⏳ Бот ${botId} будет удалён через ${BOT_DESTROY_DELAY/1000} секунд`);
    setTimeout(() => {
        const index = state.bots.findIndex(b => b.id === botId);
        if (index !== -1) {
            state.bots.splice(index, 1);
            console.log(`[BOT-DESTROY] 🗑️ Бот ${botId} удалён из state`);
            logBotsState();
        }
    }, BOT_DESTROY_DELAY);
}

// ============================================================
// 5. АТАКА БОТА
// ============================================================
function botAttack(ws, data) {
    console.log('[BOT-ATTACK] ⚔️ Начало обработки атаки бота');
    console.log(`[BOT-ATTACK] 📥 Входящие данные: ${JSON.stringify(data)}`);
    
    const botId = String(data.bot_id || '');
    const targetId = String(data.target_id || '');
    const damage = Number(data.damage) || 10;
    const ownerId = ws.playerData?.id;

    console.log(`[BOT-ATTACK] 📊 Данные: botId=${botId}, targetId=${targetId}, damage=${damage}, owner=${ownerId}`);

    if (!botId) {
        console.log('[BOT-ATTACK] ❌ Ошибка: пустой botId');
        return;
    }

    const bot = state.bots.find(b => b.id === botId);
    if (!bot || bot.isDead) {
        console.log(`[BOT-ATTACK] ❌ Бот не найден или мёртв: ${botId}`);
        return;
    }

    // Проверяем владельца
    if (bot.owner_id !== ownerId) {
        console.log(`[BOT-ATTACK] ❌ Владелец не совпадает: ${bot.owner_id} vs ${ownerId}`);
        return;
    }

    // Находим цель
    const target = players.get(targetId);
    if (!target) {
        console.log(`[BOT-ATTACK] ❌ Цель не найдена: ${targetId}`);
        return;
    }

    // Проверяем, что цель не союзник
    if (target.team === bot.team) {
        console.log(`[BOT-ATTACK] ⚠️ Цель ${targetId} союзник (команда ${target.team})`);
        return;
    }

    // Наносим урон цели
    if (target.hp !== undefined) {
        const oldHp = target.hp;
        target.hp = Math.max(0, target.hp - damage);
        console.log(`[BOT-ATTACK] 💔 Урон по ${targetId}: ${oldHp} -> ${target.hp}`);
        
        // Рассылаем всем обновление HP
        broadcast({
            type: 'player_damage',
            target_id: targetId,
            new_hp: target.hp
        });
        
        // Если цель умерла
        if (target.hp <= 0) {
            console.log(`[BOT-ATTACK] 💀 Цель ${targetId} убита ботом ${botId}`);
            // Можно добавить логику смерти игрока
            broadcast({
                type: 'player_death',
                player_id: targetId,
                killer: botId
            });
        }
    }
}

// ============================================================
// 6. ОБНОВЛЕНИЕ СОСТОЯНИЯ БОТА
// ============================================================
function botStateUpdate(ws, data) {
    console.log('[BOT-STATE] 🔄 Обновление состояния бота');
    console.log(`[BOT-STATE] 📥 Входящие данные: ${JSON.stringify(data)}`);
    
    const botId = String(data.bot_id || '');
    const newState = String(data.state || 'idle');
    const ownerId = ws.playerData?.id;

    if (!botId) {
        console.log('[BOT-STATE] ❌ Ошибка: пустой botId');
        return;
    }

    const bot = state.bots.find(b => b.id === botId);
    if (!bot) {
        console.log(`[BOT-STATE] ❌ Бот не найден: ${botId}`);
        return;
    }

    if (bot.owner_id !== ownerId) {
        console.log(`[BOT-STATE] ❌ Владелец не совпадает: ${bot.owner_id} vs ${ownerId}`);
        return;
    }

    const oldState = bot.currentState || 'idle';
    bot.currentState = newState;
    bot.lastUpdate = Date.now();
    
    console.log(`[BOT-STATE] ✅ Состояние бота ${botId} обновлено: ${oldState} -> ${newState}`);
    
    // Рассылаем всем обновление состояния
    broadcast({
        type: 'bot_state_update',
        bot_id: botId,
        state: newState
    });
}

// ============================================================
// 7. ПОЛУЧЕНИЕ ВСЕХ БОТОВ ДЛЯ НОВОГО ИГРОКА
// ============================================================
function getBotsSync(ws) {
    console.log('[BOT-SYNC] 🔄 Запрос синхронизации ботов');
    
    if (!state.bots || state.bots.length === 0) {
        console.log('[BOT-SYNC] 📭 Нет ботов для синхронизации');
        send(ws, {
            type: 'bots_sync',
            bots: []
        });
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
            flip: b.flip || false,
            state: b.currentState || 'idle'
        }));

    console.log(`[BOT-SYNC] 📊 Отправка ${botsData.length} ботов игроку`);
    console.log(`[BOT-SYNC] 📋 Боты: ${JSON.stringify(botsData.map(b => b.id))}`);

    send(ws, {
        type: 'bots_sync',
        bots: botsData
    });
}

// ============================================================
// 8. ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ БОТОВ
// ============================================================
function syncBotsToAll() {
    if (!state.bots || state.bots.length === 0) {
        return;
    }

    const aliveBots = state.bots.filter(b => !b.isDead);
    if (aliveBots.length === 0) {
        return;
    }

    const botsData = aliveBots.map(b => ({
        id: b.id,
        owner_id: b.owner_id,
        team: b.team,
        hp: b.hp,
        maxHp: b.maxHp || BOT_MAX_HP,
        x: b.x,
        y: b.y,
        flip: b.flip || false,
        state: b.currentState || 'idle'
    }));

    console.log(`[BOT-SYNC] 🔄 Периодическая синхронизация ${botsData.length} ботов`);
    
    broadcast({
        type: 'bots_sync',
        bots: botsData
    });
}

// ============================================================
// 9. ОЧИСТКА МЁРТВЫХ БОТОВ
// ============================================================
function cleanupDeadBots() {
    const before = state.bots.length;
    const aliveBots = state.bots.filter(b => !b.isDead);
    
    // Проверяем, не зависли ли мёртвые боты (удаляем если прошло больше 10 секунд с момента смерти)
    const now = Date.now();
    state.bots = state.bots.filter(b => {
        if (b.isDead) {
            const deathTime = b.deathTime || b.lastUpdate || now;
            if (now - deathTime > BOT_DESTROY_DELAY + 1000) {
                return false;
            }
        }
        return true;
    });
    
    const after = state.bots.length;
    
    if (before !== after) {
        console.log(`[BOT-CLEANUP] 🧹 Удалено ${before - after} мёртвых ботов`);
    }
}

// ============================================================
// 10. ЛОГИРОВАНИЕ СОСТОЯНИЯ БОТОВ
// ============================================================
function logBotsState() {
    console.log('========================================');
    console.log('[BOT-STATE] 📊 СТАТУС БОТОВ');
    console.log(`[BOT-STATE] Всего ботов: ${state.bots.length}`);
    
    const aliveBots = state.bots.filter(b => !b.isDead);
    console.log(`[BOT-STATE] Живых ботов: ${aliveBots.length}`);
    
    const deadBots = state.bots.filter(b => b.isDead);
    console.log(`[BOT-STATE] Мёртвых ботов: ${deadBots.length}`);
    
    if (aliveBots.length > 0) {
        console.log('[BOT-STATE] Живые боты:');
        aliveBots.forEach((b, i) => {
            console.log(`  ${i+1}. ID: ${b.id}, Владелец: ${b.owner_id}, Команда: ${b.team}, HP: ${b.hp}/${b.maxHp}, Позиция: (${b.x}, ${b.y})`);
        });
    }
    
    if (deadBots.length > 0) {
        console.log('[BOT-STATE] Мёртвые боты (ожидают удаления):');
        deadBots.forEach((b, i) => {
            console.log(`  ${i+1}. ID: ${b.id}, Владелец: ${b.owner_id}`);
        });
    }
    console.log('========================================');
}

// ============================================================
// 11. ОБРАБОТЧИК СООБЩЕНИЙ ДЛЯ БОТОВ
// ============================================================
function handleBotMessage(ws, data) {
    const type = data.type;
    
    switch(type) {
        case 'bot_spawn':
            botSpawn(ws, data);
            break;
            
        case 'bot_position':
            botPosition(ws, data);
            break;
            
        case 'bot_damage':
            botDamage(ws, data);
            break;
            
        case 'bot_destroy':
            botDestroy(ws, data);
            break;
            
        case 'bot_attack':
            botAttack(ws, data);
            break;
            
        case 'bot_state_update':
            botStateUpdate(ws, data);
            break;
            
        case 'get_bots':
            getBotsSync(ws);
            break;
            
        default:
            console.log(`[BOT-HANDLER] ⚠️ Неизвестный тип для ботов: ${type}`);
            break;
    }
}

// ============================================================
// 12. ИНИЦИАЛИЗАЦИЯ
// ============================================================

// Инициализируем state.bots если его нет
if (!state.bots) {
    state.bots = [];
    console.log('[BOT-INIT] 📦 Создан массив state.bots');
}

// Периодическая очистка (каждые 30 секунд)
setInterval(() => {
    cleanupDeadBots();
}, 30000);

// Периодическая синхронизация (каждые 10 секунд)
setInterval(() => {
    syncBotsToAll();
}, 10000);

// Логирование состояния (каждые 30 секунд)
setInterval(() => {
    logBotsState();
}, 30000);

console.log('[BOT-INIT] ✅ Система ботов инициализирована с отладкой');
console.log('[BOT-INIT] 📋 Функции:');
console.log('[BOT-INIT]   - botSpawn (создание)');
console.log('[BOT-INIT]   - botPosition (позиция)');
console.log('[BOT-INIT]   - botDamage (урон)');
console.log('[BOT-INIT]   - botDestroy (уничтожение)');
console.log('[BOT-INIT]   - botAttack (атака)');
console.log('[BOT-INIT]   - botStateUpdate (состояние)');
console.log('[BOT-INIT]   - getBotsSync (синхронизация)');
console.log('[BOT-INIT]   - syncBotsToAll (периодическая синхронизация)');
console.log('[BOT-INIT]   - cleanupDeadBots (очистка)');
console.log('[BOT-INIT]   - logBotsState (логирование)');
console.log('[BOT-INIT] 📋 Константы:');
console.log(`[BOT-INIT]   - BOT_MAX_HP: ${BOT_MAX_HP}`);
console.log(`[BOT-INIT]   - MAX_BOTS_PER_PLAYER: ${MAX_BOTS_PER_PLAYER}`);
console.log(`[BOT-INIT]   - BOT_DESTROY_DELAY: ${BOT_DESTROY_DELAY}ms`);

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
  console.log('COUNTDOWN:', COUNTDOWN_TIME, 'seconds');
  console.log('GAME TIME:', GAME_TIME, 'seconds');
  console.log('');
  console.log('CREEP SETTINGS:');
  console.log(' SPAWN INTERVAL:', CREEP_SPAWN_INTERVAL, 'ms');
  console.log(' MAX HP:', CREEP_MAX_HP);
  console.log(' SPEED:', CREEP_SPEED);
  console.log(' DAMAGE:', CREEP_DAMAGE);
  console.log(' ATTACK RANGE:', CREEP_ATTACK_RANGE);
  console.log(' ATTACK COOLDOWN:', CREEP_ATTACK_COOLDOWN, 'ms');
  console.log('');
  console.log('BOT SETTINGS:');
  console.log(' MAX HP:', BOT_MAX_HP);
  console.log(' SPEED:', BOT_SPEED);
  console.log(' DAMAGE:', BOT_DAMAGE);
  console.log(' ATTACK RANGE:', BOT_ATTACK_RANGE);
  console.log(' LIFETIME:', BOT_LIFETIME / 1000, 'seconds');
  console.log(' MAX PER PLAYER:', MAX_BOTS_PER_PLAYER);
  console.log(' GROUND Y:', GROUND_Y);
  console.log('==========================================');
  console.log('');
});

// ============================================================
// KEEP ALIVE
// ============================================================
setInterval(() => {
  console.log(`[SERVER] alive | players=${players.size} | status=${state.status} | creeps=${state.creeps.length} | bots=${state.bots.length}`);
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
// BOT HELPERS
// ============================================================
function getBotData(bot) {
  return {
    id: bot.id,
    owner_id: bot.owner_id,
    team: bot.team,
    hp: bot.hp,
    maxHp: bot.maxHp,
    x: bot.x,
    y: bot.y,
    flip: bot.flip || false,
    isDead: bot.isDead || false
  };
}

function getAllBotsData() {
  return state.bots.filter(b => !b.isDead).map(bot => getBotData(bot));
}

function broadcastAllBots() {
  broadcast({
    type: 'bots_sync',
    bots: getAllBotsData()
  });
}

function spawnBot(ownerId, team, x, y) {
  if (!ownerId) return null;
  if (state.status !== 'playing') return null;

  // Удаляем мёртвых ботов
  state.bots = state.bots.filter(b => !b.isDead);

  // Проверяем сколько ботов у этого игрока
  const ownerBots = state.bots.filter(b => b.owner_id === ownerId && !b.isDead);
  if (ownerBots.length >= MAX_BOTS_PER_PLAYER) {
    return null;
  }

  const bot = {
    id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    owner_id: ownerId,
    team: team,
    hp: BOT_MAX_HP,
    maxHp: BOT_MAX_HP,
    x: x || 0,
    y: y || 0,
    flip: false,
    isDead: false,
    spawnTime: Date.now(),
    attackCooldown: 0,
    target_id: null,
    state: 'idle' // idle, chasing, attacking, returning
  };

  state.bots.push(bot);

  broadcast({
    type: 'bot_spawn',
    bot: getBotData(bot)
  });

  broadcastAnimation(
    'bot_spawn',
    {
      bot_id: bot.id,
      position: { x: bot.x, y: bot.y },
      team: bot.team,
      owner_id: bot.owner_id
    },
    ownerId,
    ''
  );

  console.log(`[BOT] ${bot.id} призван игроком ${ownerId} для команды ${team} на X=${bot.x}`);

  return bot;
}

function damageBot(botId, damage, attackerTeam = 0) {
  const bot = state.bots.find(b => b.id === botId);
  if (!bot || bot.isDead) return false;

  // Не наносим урон своим
  if (attackerTeam !== 0 && attackerTeam === bot.team) {
    return false;
  }

  bot.hp = Math.max(0, bot.hp - damage);

  broadcast({
    type: 'bot_damage',
    bot_id: bot.id,
    new_hp: bot.hp
  });

  if (bot.hp <= 0) {
    bot.isDead = true;
    broadcast({
      type: 'bot_destroy',
      bot_id: bot.id
    });
    broadcastAnimation('bot_destroy', { bot_id: bot.id }, '', '');
    console.log(`[BOT] ${bot.id} уничтожен`);
    
    // Удаляем из списка через 5 секунд
    setTimeout(() => {
      state.bots = state.bots.filter(b => b.id !== botId);
    }, 5000);
    
    return true;
  }
  
  return false;
}

function updateBotPosition(botId, x, y, flip) {
  const bot = state.bots.find(b => b.id === botId);
  if (!bot || bot.isDead) return;

  bot.x = x;
  bot.y = y;
  bot.flip = flip || false;
}

function getBotById(botId) {
  return state.bots.find(b => b.id === botId);
}

function getBotsByOwner(ownerId) {
  return state.bots.filter(b => b.owner_id === ownerId && !b.isDead);
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
    direction: team === 1 ? 1 : -1
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
// ROUTER (ИСПРАВЛЕННАЯ ВЕРСИЯ)
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

   // ============================================================
  // BOT HANDLERS - ДОБАВЛЯЕМ ВСЕ ТИПЫ
  // ============================================================
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

  if (type === 'bot_attack') {
    console.log('[SERVER] ⚔️ Обработка bot_attack');
    botAttack(ws, data);
    return;
  }

  if (type === 'bot_state_update') {
    console.log('[SERVER] 🔄 Обработка bot_state_update');
    botStateUpdate(ws, data);
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

  // Очищаем ботов и крипов
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

  // Полная синхронизация крипов
  creepSyncTimer = setInterval(() => {
    if (state.status === 'playing') {
      broadcastAllCreeps();
    }
  }, CREEP_SYNC_INTERVAL);

  // Синхронизация ботов
  botSyncTimer = setInterval(() => {
    if (state.status === 'playing') {
      broadcastAllBots();
    }
  }, BOT_SYNC_INTERVAL);

  // Проверка жизни ботов
  botLifeTimer = setInterval(() => {
    if (state.status !== 'playing') return;

    const now = Date.now();
    state.bots.forEach(bot => {
      if (bot.isDead) return;
      if (now - bot.spawnTime > BOT_LIFETIME) {
        damageBot(bot.id, 99999);
      }
    });
  }, 5000);

  // Синхронизация анимаций
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
  console.log(`[GAME] Крипы будут спавниться каждые ${CREEP_SPAWN_INTERVAL}мс`);
  console.log(`[GAME] Боты синхронизируются каждые ${BOT_SYNC_INTERVAL}мс`);
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
    p.lastDamageTime = Date.now();

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

  broadcastAnimation('respawn', { position: { x: p.x, y: p.y } }, p.id, '');
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
// CREEP DAMAGE (от клиентов)
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
    creep.isDead = true;

    broadcast({
      type: 'creep_destroy',
      id: creep.id
    });

    broadcastAnimation('creep_destroy', { creep_id: creep.id }, '', '');
  }
}

// ============================================================
// CREEP POSITION UPDATE (от клиентов)
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
// BOT FUNCTIONS
// ============================================================
function summonBot(ws, data) {
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

  const bot = spawnBot(ownerId, team, x, y);
  if (!bot) {
    send(ws, { 
      type: 'error', 
      message: `Нельзя призвать больше ${MAX_BOTS_PER_PLAYER} ботов` 
    });
    return;
  }

  // Отправляем подтверждение владельцу
  send(ws, {
    type: 'summon_bot_success',
    bot_id: bot.id,
    x: bot.x,
    y: bot.y
  });
}

function botDamage(ws, data) {
  if (state.status !== 'playing') return;

  const botId = String(data.bot_id || '');
  const damage = Math.max(0, Number(data.damage) || 10);
  const attackerTeam = Number(data.team || 0);

  damageBot(botId, damage, attackerTeam);
}

function botPositionUpdate(ws, data) {
  if (state.status !== 'playing') return;

  const botId = String(data.bot_id || '');
  const bot = getBotById(botId);
  if (!bot) return;

  // Проверяем, что обновление от владельца бота
  const ownerId = ws.playerData?.id;
  if (ownerId !== bot.owner_id) return;

  const x = Number(data.x);
  const y = Number(data.y);
  const flip = !!data.flip;

  if (Number.isFinite(x)) bot.x = x;
  if (Number.isFinite(y)) bot.y = y;
  bot.flip = flip;

  // Отправляем обновление всем
  broadcast({
    type: 'bot_position_update',
    bot_id: bot.id,
    x: bot.x,
    y: bot.y,
    flip: bot.flip
  }, ws);
}

function botAttack(ws, data) {
  if (state.status !== 'playing') return;

  const botId = String(data.bot_id || '');
  const bot = getBotById(botId);
  if (!bot || bot.isDead) return;

  // Проверяем владельца
  const ownerId = ws.playerData?.id;
  if (ownerId !== bot.owner_id) return;

  const targetId = String(data.target_id || '');
  const damage = Number(data.damage) || BOT_DAMAGE;

  // Проверяем кулдаун
  const now = Date.now();
  if (now - bot.attackCooldown < BOT_ATTACK_COOLDOWN) return;
  bot.attackCooldown = now;

  // Ищем цель (игрок или крип)
  let targetFound = false;
  
  // Проверяем игроков
  players.forEach(p => {
    if (p.id === bot.owner_id) return;
    if (p.team === bot.team) return;
    if (p.isDead) return;
    if (p.id === targetId) {
      targetFound = true;
      const dist = Math.sqrt(Math.pow(p.x - bot.x, 2) + Math.pow(p.y - bot.y, 2));
      if (dist <= BOT_ATTACK_RANGE + 50) {
        playerDamage(ws, { target_id: p.id, damage: damage });
        broadcastAnimation('bot_attack', { 
          bot_id: bot.id, 
          target_id: p.id,
          damage: damage 
        }, bot.owner_id, '');
      }
    }
  });

  // Проверяем крипов
  if (!targetFound) {
    state.creeps.forEach(creep => {
      if (creep.team === bot.team) return;
      if (creep.isDead) return;
      if (creep.id === targetId) {
        targetFound = true;
        const dist = Math.sqrt(Math.pow(creep.x - bot.x, 2) + Math.pow(creep.y - bot.y, 2));
        if (dist <= BOT_ATTACK_RANGE + 50) {
          creepDamage(ws, { id: creep.id, damage: damage });
          broadcastAnimation('bot_attack', { 
            bot_id: bot.id, 
            target_id: creep.id,
            damage: damage 
          }, bot.owner_id, '');
        }
      }
    });
  }
}

function botStateUpdate(ws, data) {
  if (state.status !== 'playing') return;

  const botId = String(data.bot_id || '');
  const bot = getBotById(botId);
  if (!bot || bot.isDead) return;

  // Проверяем владельца
  const ownerId = ws.playerData?.id;
  if (ownerId !== bot.owner_id) return;

  const newState = String(data.state || 'idle');
  bot.state = newState;

  broadcast({
    type: 'bot_state_update',
    bot_id: bot.id,
    state: bot.state
  }, ws);
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

  const result = winner === 0 ? 'НИЧЬЯ!' : `ПОБЕДА КОМАНДЫ ${winner}!`;

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

  // Удаляем ботов игрока
  state.bots = state.bots.filter(b => b.owner_id !== id);

  players.delete(id);

  console.log(`[DISCONNECT] ${id} | players=${players.size}`);

  broadcast({
    type: 'player_left',
    id: id
  });

  broadcastPlayerList();

  // Уведомляем об удалении ботов
  broadcastAllBots();

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
