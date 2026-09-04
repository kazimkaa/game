// sync/animationSync.js
const { broadcast } = require('../utils/helpers');
const { ANIMATION_SYNC_INTERVAL } = require('../config/settings');

class AnimationSync {
    constructor(wss, state) {
        this.wss = wss;
        this.state = state;
        this.syncInterval = null;
        this.isRunning = false;
        this.maxAnimations = 100;
    }

    /**
     * Запускает синхронизацию анимаций
     */
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log('[AnimationSync] 🎬 Запущена синхронизация анимаций');

        this.syncInterval = setInterval(() => {
            this.tick();
        }, ANIMATION_SYNC_INTERVAL);
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
        console.log('[AnimationSync] ⏹ Синхронизация анимаций остановлена');
    }

    /**
     * Глобальный тик анимаций
     */
    tick() {
        if (this.state.status !== 'playing') return;

        this.state.animationTick = (this.state.animationTick || 0) + 1;

        broadcast(this.wss, {
            type: 'animation_tick',
            tick: this.state.animationTick,
            serverTime: Date.now()
        });
    }

    /**
     * Создает и рассылает анимацию
     */
    syncAnimation(animData, sourceId = '', targetId = '') {
        if (!animData || typeof animData !== 'object') return null;

        const animation = {
            id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            tick: this.state.animationTick || 0,
            serverTime: Date.now(),
            type: animData.type || 'custom',
            data: animData.data || {},
            sourceId: sourceId,
            targetId: targetId
        };

        if (!this.state.animations) {
            this.state.animations = [];
        }

        this.state.animations.push(animation);

        // Ограничиваем размер истории анимаций
        if (this.state.animations.length > this.maxAnimations) {
            this.state.animations.shift();
        }

        broadcast(this.wss, {
            type: 'animation_sync',
            animation: animation
        });

        return animation;
    }

    /**
     * Рассылает пакет анимаций
     */
    syncAnimationBatch(animations) {
        if (!Array.isArray(animations) || animations.length === 0) return;

        const batch = animations.map(anim => ({
            type: anim.type || 'custom',
            data: anim.data || {},
            source_id: anim.source_id || '',
            target_id: anim.target_id || ''
        }));

        broadcast(this.wss, {
            type: 'animation_batch',
            animations: batch
        });
    }
}

module.exports = AnimationSync;
