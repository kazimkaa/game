// sync/index.js
const PlayerSync = require('./playerSync');
const BotSync = require('./botSync');
const CreepSync = require('./creepSync');
const AnimationSync = require('./animationSync');
const { send } = require('../utils/helpers');  // ← ДОБАВИТЬ ЭТУ СТРОКУ

class SyncManager {
    constructor(wss, players, state) {
        this.wss = wss;
        this.players = players;
        this.state = state;
        
        this.playerSync = new PlayerSync(wss, players, state);
        this.botSync = new BotSync(wss, state);
        this.creepSync = new CreepSync(wss, state);
        this.animationSync = new AnimationSync(wss, state);
        
        this.isRunning = false;
    }

    startAll() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[SyncManager] 🚀 Запуск всех синхронизаций');
        this.playerSync.start(100);
        this.botSync.start();
        this.creepSync.start();
        this.animationSync.start();
    }

    stopAll() {
        this.isRunning = false;
        console.log('[SyncManager] ⏹ Остановка всех синхронизаций');
        this.playerSync.stop();
        this.botSync.stop();
        this.creepSync.stop();
        this.animationSync.stop();
    }

    syncAllToClient(ws) {
        this.playerSync.syncToClient(ws);
        this.botSync.syncToClient(ws);
        this.creepSync.syncToClient(ws);
        console.log('[SyncManager] 📤 Отправлена полная синхронизация клиенту');
    }

    syncAllToAll() {
        this.playerSync.syncAll();
        this.botSync.syncAll();
        this.creepSync.syncAll();
    }
}

module.exports = SyncManager;
