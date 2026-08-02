const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Сервер работает! Используйте WebSocket для подключения.');
});

const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

const players = new Map();

server.listen(PORT, () => {
    console.log(`🚀 Сервер на порту ${PORT}`);
    console.log(`📍 ws://localhost:${PORT}`);
});

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`✅ Клиент подключился: ${clientIP}`);
    
    ws.playerData = {
        id: null,
        nickname: null,
        x: 0,
        y: 0,
        flip: false,
        team: 0,
        hp: 100
    };
    
    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            handleMessage(ws, data);
        } catch (e) {
            console.log(`⚠️ Ошибка: ${e.message}`);
        }
    });
    
    ws.on('close', () => {
        const id = ws.playerData.id;
        if (id && players.has(id)) {
            players.delete(id);
            broadcastPlayerList();
        }
        console.log(`❌ Отключился: ${ws.playerData.nickname || 'Неизвестный'}`);
    });
});

function handleMessage(ws, data) {
    const type = data.type;
    
    switch (type) {
        case 'join':
            handleJoin(ws, data);
            break;
        case 'move':
            handleMove(ws, data);
            break;
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        default:
            console.log(`⚠️ Неизвестный тип: ${type}`);
    }
}

function handleJoin(ws, data) {
    const id = data.id;
    const nickname = data.nickname || 'Player';
    
    if (players.has(id)) {
        ws.send(JSON.stringify({ type: 'error', message: 'ID занят' }));
        return;
    }
    
    ws.playerData.id = id;
    ws.playerData.nickname = nickname;
    ws.playerData.x = data.x || 0;
    ws.playerData.y = data.y || 0;
    ws.playerData.team = players.size % 2 + 1;
    
    players.set(id, ws.playerData);
    
    console.log(`👤 Игрок: ${nickname} (${id}) команда ${ws.playerData.team}`);
    
    ws.send(JSON.stringify({
        type: 'join_success',
        id: id,
        team: ws.playerData.team
    }));
    
    broadcastToAll({
        type: 'player_joined',
        id: id,
        nickname: nickname,
        x: ws.playerData.x,
        y: ws.playerData.y,
        flip: false,
        team: ws.playerData.team
    });
    
    broadcastPlayerList();
}

function handleMove(ws, data) {
    const id = ws.playerData.id;
    if (!id) return;
    
    ws.playerData.x = data.x;
    ws.playerData.y = data.y;
    ws.playerData.flip = data.flip;
    
    broadcastToAll({
        type: 'player_moved',
        id: id,
        x: data.x,
        y: data.y,
        flip: data.flip
    }, ws);
}

function broadcastToAll(message, exclude = null) {
    const json = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    });
}

function broadcastPlayerList() {
    const data = {};
    players.forEach((p, id) => {
        data[id] = {
            nickname: p.nickname,
            x: p.x,
            y: p.y,
            flip: p.flip,
            team: p.team,
            hp: p.hp
        };
    });
    
    broadcastToAll({
        type: 'players_list',
        players: data
    });
}
