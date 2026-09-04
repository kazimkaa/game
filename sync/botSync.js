// sync/botSync.js
const { broadcast, send } = require('../utils/helpers');
const { BOT_MAX_HP, BOT_DESTROY_DELAY, BOT_SYNC_INTERVAL } = require('../config/settings');

class BotSync {
    constructor(wss, state) {
        this.wss = wss;
        this.state = state;
        this.syncInterval = null;
        this.lifeTimer = null;
        this.isRunning = false;
    }

    /**
     * Запускает синхронизацию ботов
     */
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log('[BotSync] 🤖 Запущена синхронизация ботов');

        // Периодическая синхронизация всех ботов
        this.syncInterval = setInterval(() => {
            this.syncAll();
        }, BOT_SYNC_INTERVAL);

        // Проверка времени жизни ботов
        this.lifeTimer = setInterval(() => {
            this.checkBotLifetime();
        }, 5000);
    }

    /**
     * Останавливает синхронизацию
     */
    stop() {
        this.isRunning = false;
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        if (this.lifeTimer) {
            clearInterval(this.lifeTimer);
            this.lifeTimer = null;
        }
        console.log('[BotSync] ⏹ Синхронизация ботов остановлена');
    }

    /**
     * Отправляет всех живых ботов всем клиентам
     */
    syncAll() {
        if (!this.state.bots || this.state.bots.length === 0) return;

        const aliveBots = this.state.bots.filter(b => !b.isDead);
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

        broadcast(this.wss, {
            type: 'bots_sync',
            bots: botsData
        });
    }

    /**
     * Отправляет всех ботов конкретному клиенту
     */
    syncToClient(ws) {
        if (!this.state.bots) {
            send(ws, { type: 'bots_sync', bots: [] });
            return;
        }

        const aliveBots = this.state.bots.filter(b => !b.isDead);
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

        send(ws, {
            type: 'bots_sync',
            bots: botsData
        });
    }

    /**
     * Отправляет событие спавна бота всем
     */
    syncBotSpawn(bot) {
        broadcast(this.wss, {
            type: 'bot_spawn_sync',
            bot: {
                id: bot.id,
                owner_id: bot.owner_id,
                team: bot.team,
                hp: bot.hp,
                maxHp: bot.maxHp || BOT_MAX_HP,
                x: bot.x,
                y: bot.y,
                flip: bot.flip || false
            }
        });
    }

    /**
     * Отправляет обновление позиции бота всем
     */
    syncBotPosition(botId, x, y, flip) {
        broadcast(this.wss, {
            type: 'bot_position_update',
            bot_id: botId,
            x: x,
            y: y,
            flip: flip || false
        });
    }

    /**
     * Отправляет обновление HP бота всем
     */
    syncBotDamage(botId, newHp, attackerId = '') {
        broadcast(this.wss, {
            type: 'bot_damage_sync',
            bot_id: botId,
            new_hp: newHp,
            attacker_id: attackerId
        });
    }

    /**
     * Отправляет событие уничтожения бота всем
     */
    syncBotDestroy(botId) {
        broadcast(this.wss, {
            type: 'bot_destroy_sync',
            bot_id: botId
        });
    }

    /**
     * Проверяет время жизни ботов и уничтожает старых
     */
    checkBotLifetime() {
        if (this.state.status !== 'playing') return;
        if (!this.state.bots) return;

        const now = Date.now();
        const { BOT_LIFETIME } = require('../config/settings');

        this.state.bots.forEach(bot => {
            if (bot.isDead) return;
            if (now - bot.spawnTime > BOT_LIFETIME) {
                console.log(`[BotSync] ⏰ Бот ${bot.id} истек (${BOT_LIFETIME/1000} сек)`);
                // Уничтожаем бота
                this.destroyBot(bot.id, 'timeout');
            }
        });
    }

    /**
     * Уничтожает бота с задержкой
     */
    destroyBot(botId, reason = 'manual') {
        const bot = this.state.bots.find(b => b.id === botId);
        if (!bot || bot.isDead) return;

        bot.isDead = true;
        console.log(`[BotSync] 💀 Бот ${botId} уничтожен (${reason})`);

        this.syncBotDestroy(botId);

        setTimeout(() => {
            const index = this.state.bots.findIndex(b => b.id === botId);
            if (index !== -1) {
                this.state.bots.splice(index, 1);
                console.log(`[BotSync] 🗑️ Бот ${botId} удален из памяти`);
            }
        }, BOT_DESTROY_DELAY);
    }

    /**
     * Наносит урон боту
     */
    damageBot(botId, damage, attackerId = '') {
        const bot = this.state.bots.find(b => b.id === botId);
        if (!bot || bot.isDead) return;

        const oldHp = bot.hp;
        bot.hp = Math.max(0, bot.hp - damage);
        bot.lastUpdate = Date.now();

        console.log(`[BotSync] 💥 Бот ${botId}: ${oldHp} -> ${bot.hp}`);

        this.syncBotDamage(botId, bot.hp, attackerId);

        if (bot.hp <= 0) {
            this.destroyBot(botId, 'damage');
        }

        return bot.hp;
    }

    /**
     * Обновляет позицию бота с проверками
     */
    updateBotPosition(botId, x, y, flip, ownerId) {
        const bot = this.state.bots.find(b => b.id === botId);
        if (!bot || bot.isDead) return false;

        // Проверка владельца
        if (bot.owner_id !== ownerId) {
            console.log(`[BotSync] ❌ Владелец не совпадает: ${bot.owner_id} vs ${ownerId}`);
            return false;
        }

        // Проверка на телепортацию
        const dx = x - bot.x;
        const dy = y - bot.y;
        const moveDistance = Math.sqrt(dx * dx + dy * dy);
        const MAX_MOVE_DISTANCE = 500;

        if (moveDistance > MAX_MOVE_DISTANCE) {
            console.log(`[BotSync] ⚠️ Слишком большое перемещение: ${moveDistance}px`);
            return false;
        }

        bot.x = x;
        bot.y = y;
        bot.flip = flip || false;
        bot.lastUpdate = Date.now();

        this.syncBotPosition(botId, bot.x, bot.y, bot.flip);
        return true;
    }
}

module.exports = BotSync;
