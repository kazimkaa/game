// sync/creepSync.js
const { broadcast } = require('../utils/helpers');
const { CREEP_SYNC_INTERVAL } = require('../config/settings');

class CreepSync {
    constructor(wss, state) {
        this.wss = wss;
        this.state = state;
        this.syncInterval = null;
        this.isRunning = false;
    }

    /**
     * Запускает синхронизацию крипов
     */
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log('[CreepSync] 🐛 Запущена синхронизация крипов');

        this.syncInterval = setInterval(() => {
            this.syncAll();
        }, CREEP_SYNC_INTERVAL);
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
        console.log('[CreepSync] ⏹ Синхронизация крипов остановлена');
    }

    /**
     * Отправляет всех крипов всем клиентам
     */
    syncAll() {
        if (this.state.status !== 'playing') return;
        if (!this.state.creeps || this.state.creeps.length === 0) return;

        broadcast(this.wss, {
            type: 'creeps_sync',
            creeps: this.getAllCreepsData()
        });
    }

    /**
     * Отправляет всех крипов конкретному клиенту
     */
    syncToClient(ws) {
        if (!this.state.creeps) {
            send(ws, { type: 'creeps_sync', creeps: [] });
            return;
        }

        send(ws, {
            type: 'creeps_sync',
            creeps: this.getAllCreepsData()
        });
    }

    /**
     * Отправляет событие спавна крипа всем
     */
    syncCreepSpawn(creep) {
        broadcast(this.wss, {
            type: 'creep_spawn',
            creep: this.getCreepData(creep)
        });
    }

    /**
     * Отправляет обновление позиции крипа всем
     */
    syncCreepPosition(creepId, x, y, direction) {
        broadcast(this.wss, {
            type: 'creep_position_update',
            id: creepId,
            x: x,
            y: y,
            direction: direction
        });
    }

    /**
     * Отправляет обновление HP крипа всем
     */
    syncCreepDamage(creepId, newHp) {
        broadcast(this.wss, {
            type: 'creep_damage',
            id: creepId,
            new_hp: newHp
        });
    }

    /**
     * Отправляет событие уничтожения крипа всем
     */
    syncCreepDestroy(creepId) {
        broadcast(this.wss, {
            type: 'creep_destroy',
            id: creepId
        });
    }

    /**
     * Возвращает данные одного крипа
     */
    getCreepData(creep) {
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

    /**
     * Возвращает данные всех крипов
     */
    getAllCreepsData() {
        return this.state.creeps.map(creep => this.getCreepData(creep));
    }
}

module.exports = CreepSync;
