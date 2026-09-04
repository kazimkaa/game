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

    start(interval = 100) {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[PlayerSync] 🔄 Запущена синхронизация игроков');
        
        this.syncInterval = setInterval(() => {
            this.syncAll();
        }, interval);
    }

    stop() {
        this.isRunning = false;
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('[PlayerSync] ⏹ Синхронизация игроков остановлена');
        }
    }

    syncAll() {
        if (this.state.status !== 'playing' && this.state.status !== 'lobby') return;
        
        const players = playersObject(this.players);
        const count = Object.keys(players).length;
        
        if (count > 0) {
            console.log(`[PlayerSync] 📤 Отправка синхронизации ${count} игроков`);
        }
        
        broadcast(this.wss, {
            type: 'players_sync',
            players: players
        });
    }

    syncToClient(ws) {
        const players = playersObject(this.players);
        const count = Object.keys(players).length;
        
        console.log(`[PlayerSync] 📤 Отправка ${count} игроков клиенту`);
        
        send(ws, {
            type: 'players_sync',
            players: players
        });
    }

    syncPlayerMove(playerId, x, y, flip) {
        broadcast(this.wss, {
            type: 'player_moved',
            id: playerId,
            x: x,
            y: y,
            flip: flip
        });
    }

    syncPlayerDamage(playerId, newHp) {
        broadcast(this.wss, {
            type: 'player_damage',
            target_id: playerId,
            new_hp: newHp
        });
    }

    syncPlayerRespawn(playerId, x, y, hp) {
        broadcast(this.wss, {
            type: 'respawn',
            id: playerId,
            x: x,
            y: y,
            hp: hp
        });
    }

    syncPlayerLeft(playerId) {
        broadcast(this.wss, {
            type: 'player_left',
            id: playerId
        });
    }

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
