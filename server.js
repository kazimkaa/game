// Подключаем библиотеку WebSocket
const WebSocket = require('ws');
// Подключаем модуль HTTP (нужен для работы с render.com)
const http = require('http');

// Создаем HTTP-сервер
const server = http.createServer((req, res) => {
    // Отвечаем на HTTP-запросы (для проверки, что сервер жив)
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket сервер работает! Используйте ws:// для подключения.');
});

// Создаем WebSocket-сервер и ПРИКРЕПЛЯЕМ его к HTTP-серверу
const wss = new WebSocket.Server({ server });

// Определяем порт (render.com задает его через переменную окружения)
const PORT = process.env.PORT || 8080;

// Запускаем сервер
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📍 Адрес: ws://localhost:${PORT}`);
    console.log('🔄 Ожидание WebSocket-подключений...');
});

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

// Когда кто-то подключается
wss.on('connection', (ws, req) => {
    // Получаем IP-адрес клиента
    const clientIP = req.socket.remoteAddress;
    console.log(`🔌 НОВОЕ ПОДКЛЮЧЕНИЕ от ${clientIP}`);
    console.log(`👥 Всего подключено: ${wss.clients.size} клиентов`);
    
    // Отправляем приветственное сообщение
    const welcomeMessage = JSON.stringify({
        type: 'welcome',
        message: 'Добро пожаловать на игровой сервер!',
        timestamp: new Date().toISOString()
    });
    ws.send(welcomeMessage);
    console.log(`📤 Отправлено приветствие клиенту ${clientIP}`);

    // Когда получаем сообщение от клиента
    ws.on('message', (message) => {
        console.log(`📩 Получено сообщение от ${clientIP}: ${message.toString()}`);
        
        try {
            // Пробуем распарсить JSON
            const data = JSON.parse(message);
            console.log(`📋 Данные:`, JSON.stringify(data, null, 2));
            
            // Отправляем ответ (эхо)
            const response = JSON.stringify({
                type: 'echo',
                received: data,
                timestamp: new Date().toISOString()
            });
            ws.send(response);
            console.log(`📤 Отправлен ответ клиенту ${clientIP}`);
            
        } catch (e) {
            console.log(`⚠️ Ошибка парсинга JSON от ${clientIP}: ${e.message}`);
            // Отправляем ошибку клиенту
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Неверный формат JSON'
            }));
        }
    });

    // Когда клиент отключается
    ws.on('close', () => {
        console.log(`🔌 ОТКЛЮЧЕНИЕ клиента ${clientIP}`);
        console.log(`👥 Всего подключено: ${wss.clients.size} клиентов`);
    });

    // Обработка ошибок сокета
    ws.on('error', (error) => {
        console.log(`⚠️ Ошибка сокета для ${clientIP}: ${error.message}`);
    });
});

// Обработка ошибок сервера
wss.on('error', (error) => {
    console.log(`⚠️ Ошибка сервера: ${error.message}`);
});

// Обработка закрытия сервера
process.on('SIGINT', () => {
    console.log('🛑 Сервер остановлен вручную');
    process.exit();
});
