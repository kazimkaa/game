// sync/playerSync.js
const { broadcast, send, playersObject } = require('../utils/helpers');

class PlayerSync {
    constructor(wss, players, state) {
        this.wss = wss;
        this.players = players;
        this.state = state;
        this.syncInterval = null;
        this.isRunning = false;
    }

    /**
     * Запускает периодическую синхронизацию игроков
     * @param {number} interval - интервал в мс (по умолчанию 100)
     */
    start(interval = 100) {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log('[PlayerSync] 🔄 Запущена синхронизация игроков');
        
        this.syncInterval = setInterval(() => {
            this.syncAll();
        }, interval);
    }

    /**
     * Останавливает синхронизацию
     */
    stop() {
        this.isRunning = false;
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('[PlayerSync] ⏹ Синхронизация игроков остановлена');
        }
    }

    /**
     * Отправляет полный список игроков всем
     */
    syncAll() {
        if (this.state.status !== 'playing' && this.state.status !== 'lobby') return;
        
        broadcast(this.wss, {
            type: 'players_sync',
            players: playersObject(this.players)
        });
    }

    /**
     * Отправляет полный список игроков конкретному клиенту
     */
    syncToClient(ws) {
        send(ws, {
            type: 'players_sync',
            players: playersObject(this.players)
        });
    }

    /**
     * Отправляет обновление позиции игрока всем
     */
    syncPlayerMove(playerId, x, y, flip) {
        broadcast(this.wss, {
            type: 'player_moved',
            id: playerId,
            x: x,
            y: y,
            flip: flip
        });
    }

    /**
     * Отправляет обновление HP игрока всем
     */
    syncPlayerDamage(playerId, newHp) {
        broadcast(this.wss, {
            type: 'player_damage',
            target_id: playerId,
            new_hp: newHp
        });
    }

    /**
     * Отправляет событие респавна всем
     */
    syncPlayerRespawn(playerId, x, y, hp) {
        broadcast(this.wss, {
            type: 'respawn',
            id: playerId,
            x: x,
            y: y,
            hp: hp
        });
    }

    /**
     * Отправляет событие выхода игрока всем
     */
    syncPlayerLeft(playerId) {
        broadcast(this.wss, {
            type: 'player_left',
            id: playerId
        });
    }

    /**
     * Отправляет событие входа игрока всем (кроме отправителя)
     */
    syncPlayerJoined(player, excludeWs = null) {
        broadcast(this.wss, {
            type: 'player_joined',
            id: player.id,
            nickname: player.nickname,
            character: player.character,
            x: player.x,
            y: player.y,
            flip: player.flip,
            team: player.team,
            hp: player.hp
        }, excludeWs);
    }
}

module.exports = PlayerSync;
