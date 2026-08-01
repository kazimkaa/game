const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

console.log('WebSocket сервер запущен на порту 8080');

// Храним всех игроков
const players = new Map();

wss.on('connection', (ws) => {
    console.log('Новый игрок подключился');
    
    // Отправляем приветствие
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Добро пожаловать на сервер!'
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Получено:', data);
            
            // Эхо-ответ (или обработка)
            ws.send(JSON.stringify({
                type: 'echo',
                received: data
            }));
            
            // Если это авторизация - запоминаем игрока
            if (data.type === 'auth') {
                players.set(ws, data.player_name);
                console.log('Игрок авторизован:', data.player_name);
            }
            
        } catch (e) {
            console.error('Ошибка парсинга:', e);
        }
    });
    
    ws.on('close', () => {
        const name = players.get(ws) || 'Неизвестный';
        console.log('Игрок отключился:', name);
        players.delete(ws);
    });
});
