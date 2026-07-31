// МИНИМАЛЬНЫЙ ТЕСТОВЫЙ СЕРВЕР
const http = require("http");
const { WebSocketServer } = require("ws");

console.log("=== МИНИМАЛЬНЫЙ СЕРВЕР ===");
console.log("Запуск...");

const server = http.createServer((req, res) => {
    console.log("HTTP запрос:", req.method, req.url);
    res.writeHead(200);
    res.end("OK");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
    console.log("✅✅✅ ПОДКЛЮЧЕНИЕ УСПЕШНО! ✅✅✅");
    console.log("   От:", req.socket.remoteAddress);
    console.log("   Пользовательский агент:", req.headers["user-agent"]);
    
    ws.on("message", (data) => {
        console.log("📨 Сообщение:", data.toString());
        ws.send("Echo: " + data.toString());
    });
    
    ws.on("close", () => {
        console.log("🚪 Клиент отключился");
    });
    
    ws.on("error", (error) => {
        console.error("❌ Ошибка:", error.message);
    });
    
    // Отправляем приветствие
    ws.send("Привет! Соединение установлено.");
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Сервер слушает на порту ${PORT}`);
    console.log(`HTTP: http://localhost:${PORT}`);
    console.log(`WS: ws://localhost:${PORT}`);
    console.log("\nОжидание подключений...");
});

server.on("error", (error) => {
    console.error("❌ Ошибка сервера:", error.message);
    if (error.code === "EADDRINUSE") {
        console.log("❌ Порт", PORT, "уже занят!");
        console.log("❌ Закройте другие программы на этом порту");
    }
});

console.log("⏳ Запуск сервера...");
