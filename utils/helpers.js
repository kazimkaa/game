// utils/helpers.js
const WebSocket = require('ws');

/**
 * Проверяет открыто ли соединение
 */
function open(ws) {
    return ws && ws.readyState === WebSocket.OPEN;
}

/**
 * Отправляет сообщение клиенту
 */
function send(ws, message) {
    if (!open(ws)) return;
    try {
        ws.send(JSON.stringify(message));
    } catch (error) {
        console.log('[Helpers] ❌ Ошибка отправки:', error.message);
    }
}

/**
 * Рассылает сообщение всем клиентам
 */
function broadcast(wss, message, exclude = null) {
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
    
    if (sentCount > 0) {
        console.log(`[Helpers] 📤 Отправлено ${sentCount} клиентам: ${message.type || 'unknown'}`);
    }
    return sentCount;
}

/**
 * Создает объект со всеми игроками для синхронизации
 */
function playersObject(players) {
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

/**
 * Возвращает позицию спавна для команды
 */
function spawn(team, respawn = false) {
    return {
        x: team === 1 ? -1500 : 2690,
        y: 0
    };
}

/**
 * Подсчитывает количество готовых игроков
 */
function readyCount(players) {
    let count = 0;
    players.forEach(p => {
        if (p.inGame) count++;
    });
    return count;
}

module.exports = {
    open,
    send,
    broadcast,
    playersObject,
    spawn,
    readyCount
};
