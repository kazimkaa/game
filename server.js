const WebSocket = require('ws');
const http = require('http');

// ============================================
// 1. НАСТРОЙКА СЕРВЕРА
// ============================================

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Сервер работает! Используйте WebSocket для подключения.');
});

const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// ============================================
// 2. ХРАНИЛИЩЕ ДАННЫХ
// ============================================

const players = new Map();        // id -> данные игрока
const gameState = {
    status: 'lobby',              // lobby | countdown | playing | finished
    countdown: 15,
    timer: 300,                   // 5 минут
    blueTowerHp: 100,
    redTowerHp: 100,
    creeps: [],
    blueBarracksHp: 100,
    redBarracksHp: 100,
    blueBarracksDestroyed: false,
    redBarracksDestroyed: false,
    winner: 0
};

let countdownInterval = null;
let gameTimerInterval = null;
let playerCheckInterval = null;  // <--- ДОБАВЛЕНО

// ============================================
// 3. ЗАПУСК СЕРВЕРА
// ============================================

server.listen(PORT, () => {
    console.log(`🚀 Сервер на порту ${PORT}`);
    console.log(`📍 ws://localhost:${PORT}`);
    console.log(`👥 Ожидание игроков...`);
});

// ============================================
// 4. ОБРАБОТКА ПОДКЛЮЧЕНИЙ
// ============================================

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`✅ Клиент подключился: ${clientIP}`);
    
    ws.playerData = {
        id: null,
        nickname: null,
        character: 1,
        x: 0,
        y: 0,
        flip: false,
        team: 0,
        hp: 100,
        isDead: false,
        inGame: false
    };
    
    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            console.log(`📩 [${ws.playerData.nickname || '???'}] Получено:`, data.type);
            handleMessage(ws, data);
        } catch (e) {
            console.log(`⚠️ Ошибка: ${e.message}`);
        }
    });
    
    ws.on('close', () => {
        handleDisconnect(ws);
    });
    
    ws.on('error', (error) => {
        console.log(`⚠️ Ошибка сокета: ${error.message}`);
    });
});

// ============================================
// 5. ОБРАБОТКА СООБЩЕНИЙ
// ============================================

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
        case 'chat':
            handleChat(ws, data);
            break;
        case 'level_ready':
            handleLevelReady(ws, data);
            break;
        case 'player_damage':
            handlePlayerDamage(ws, data);
            break;
        case 'town_damage':
            handleTownDamage(ws, data);
            break;
        case 'barracks_damage':
            handleBarracksDamage(ws, data);
            break;
        case 'creep_damage':
            handleCreepDamage(ws, data);
            break;
        case 'respawn':
            handleRespawn(ws, data);
            break;
        case 'force_start':
            handleForceStart(ws, data);
            break;
        default:
            console.log(`⚠️ Неизвестный тип: ${type}`);
    }
}

// ============================================
// 6. ОБРАБОТЧИКИ СОБЫТИЙ
// ============================================

function handleJoin(ws, data) {
    const id = data.id;
    const nickname = data.nickname || 'Player';
    const character = data.character || 1;
    const x = data.x || 0;
    const y = data.y || 0;
    
    console.log(`📥 JOIN от ${nickname} (${id})`);
    
    if (players.has(id)) {
        ws.send(JSON.stringify({ type: 'error', message: 'ID занят' }));
        return;
    }
    
    ws.playerData.id = id;
    ws.playerData.nickname = nickname;
    ws.playerData.character = character;
    ws.playerData.x = x;
    ws.playerData.y = y;
    ws.playerData.team = players.size % 2 === 0 ? 1 : 2;
    
    players.set(id, ws.playerData);
    
    console.log(`👤 Игрок: ${nickname} (${id}) команда ${ws.playerData.team}`);
    console.log(`📊 Всего игроков: ${players.size}`);
    
    ws.send(JSON.stringify({
        type: 'join_success',
        id: id,
        team: ws.playerData.team
    }));
    
    broadcastToAll({
        type: 'player_joined',
        id: id,
        nickname: nickname,
        character: character,
        x: x,
        y: y,
        flip: false,
        team: ws.playerData.team
    });
    
    broadcastPlayerList();
    
    // Проверяем, можно ли начать обратный отсчёт
    checkCountdown();
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

function handleChat(ws, data) {
    const sender = ws.playerData.nickname || 'Неизвестный';
    const message = data.message || '';
    
    if (!message) return;
    
    console.log(`💬 [${sender}]: ${message}`);
    
    broadcastToAll({
        type: 'chat',
        sender: sender,
        message: message
    });
}

function handleLevelReady(ws, data) {
    ws.playerData.inGame = true;
    console.log(`🎮 ${ws.playerData.nickname} ГОТОВ К ИГРЕ!`);
    console.log(`📊 Всего игроков: ${players.size}`);
    console.log(`📊 Готовых игроков: ${getReadyPlayers()}`);
    
    players.forEach((p, id) => {
        console.log(`   - ${p.nickname}: ${p.inGame ? '✅ ГОТОВ' : '❌ НЕ ГОТОВ'}`);
    });
    
    checkAllReady();
}

function handlePlayerDamage(ws, data) {
    const targetId = data.target_id;
    const damage = data.damage || 10;
    
    if (!players.has(targetId)) return;
    
    const target = players.get(targetId);
    target.hp -= damage;
    
    if (target.hp <= 0) {
        target.hp = 0;
        target.isDead = true;
        broadcastToAll({
            type: 'player_damage',
            target_id: targetId,
            new_hp: 0
        });
        setTimeout(() => {
            respawnPlayer(targetId);
        }, 3000);
    } else {
        broadcastToAll({
            type: 'player_damage',
            target_id: targetId,
            new_hp: target.hp
        });
    }
}

function handleTownDamage(ws, data) {
    const townId = data.town_id;
    const damage = data.damage || 10;
    
    if (townId === 1) {
        gameState.blueTowerHp -= damage;
        if (gameState.blueTowerHp <= 0) {
            gameState.blueTowerHp = 0;
            endGame(2);
        }
        broadcastToAll({
            type: 'town_damage',
            town_id: 1,
            damage: damage,
            new_hp: gameState.blueTowerHp
        });
    } else {
        gameState.redTowerHp -= damage;
        if (gameState.redTowerHp <= 0) {
            gameState.redTowerHp = 0;
            endGame(1);
        }
        broadcastToAll({
            type: 'town_damage',
            town_id: 2,
            damage: damage,
            new_hp: gameState.redTowerHp
        });
    }
}

function handleBarracksDamage(ws, data) {
    const barracksId = data.barracks_id;
    const damage = data.damage || 10;
    
    if (barracksId === 1) {
        gameState.blueBarracksHp -= damage;
        if (gameState.blueBarracksHp <= 0) {
            gameState.blueBarracksHp = 0;
            gameState.blueBarracksDestroyed = true;
            broadcastToAll({
                type: 'barracks_destroyed',
                barracks_id: 1
            });
        }
        broadcastToAll({
            type: 'barracks_damage',
            barracks_id: 1,
            new_hp: gameState.blueBarracksHp
        });
    } else {
        gameState.redBarracksHp -= damage;
        if (gameState.redBarracksHp <= 0) {
            gameState.redBarracksHp = 0;
            gameState.redBarracksDestroyed = true;
            broadcastToAll({
                type: 'barracks_destroyed',
                barracks_id: 2
            });
        }
        broadcastToAll({
            type: 'barracks_damage',
            barracks_id: 2,
            new_hp: gameState.redBarracksHp
        });
    }
}

function handleCreepDamage(ws, data) {
    const creepId = data.id;
    const newHp = data.new_hp;
    
    broadcastToAll({
        type: 'creep_damage',
        id: creepId,
        new_hp: newHp
    });
}

function handleRespawn(ws, data) {
    const id = data.id;
    respawnPlayer(id);
}

function respawnPlayer(id) {
    if (!players.has(id)) return;
    
    const player = players.get(id);
    player.hp = 100;
    player.isDead = false;
    player.x = player.team === 1 ? -1500 : 2690;
    player.y = 450;
    
    broadcastToAll({
        type: 'respawn',
        id: id,
        x: player.x,
        y: player.y,
        hp: player.hp
    });
}

// ============================================
// 7. ОБРАТНЫЙ ОТСЧЁТ И ЗАПУСК ИГРЫ
// ============================================

function checkCountdown() {
    if (gameState.status !== 'lobby') {
        console.log(`⏳ Статус не lobby: ${gameState.status}`);
        return;
    }
    
    const readyPlayers = getReadyPlayers();
    console.log(`🔍 checkCountdown: готовых=${readyPlayers}, всего=${players.size}`);
    
    if (readyPlayers >= 2) {
        console.log(`✅ ЗАПУСКАЕМ ОБРАТНЫЙ ОТСЧЁТ!`);
        startCountdown();
    } else {
        console.log(`⏳ Ждём ещё игроков (готово ${readyPlayers})`);
        cancelCountdown();
    }
}

function getReadyPlayers() {
    let count = 0;
    players.forEach((p) => {
        if (p.inGame) count++;
    });
    return count;
}

function getAlivePlayers() {  // <--- НОВАЯ ФУНКЦИЯ
    let count = 0;
    players.forEach((p) => {
        if (!p.isDead) count++;
    });
    return count;
}

function checkAllReady() {
    if (gameState.status === 'playing' || gameState.status === 'finished') {
        console.log(`⏳ Игра уже ${gameState.status}, пропускаем`);
        return;
    }
    
    const totalPlayers = players.size;
    const readyPlayers = getReadyPlayers();
    
    console.log(`🔍 ПРОВЕРКА ЗАПУСКА: всего=${totalPlayers}, готово=${readyPlayers}`);
    console.log(`   - totalPlayers >= 2: ${totalPlayers >= 2}`);
    console.log(`   - readyPlayers === totalPlayers: ${readyPlayers === totalPlayers}`);
    
    if (totalPlayers >= 2 && readyPlayers === totalPlayers) {
        console.log(`✅ УСЛОВИЕ ВЫПОЛНЕНО! Запускаем игру...`);
        startCountdown();
    } else {
        console.log(`⏳ Условие НЕ выполнено`);
    }
}

function startCountdown() {
    if (countdownInterval) {
        console.log(`⏳ Отсчёт уже идёт`);
        return;
    }
    
    console.log(`⏱️ ЗАПУСК ОБРАТНОГО ОТСЧЁТА!`);
    gameState.status = 'countdown';
    gameState.countdown = 15;
    
    broadcastToAll({
        type: 'countdown_start',
        time: gameState.countdown
    });
    
    countdownInterval = setInterval(() => {
        gameState.countdown--;
        console.log(`⏱️ Обратный отсчёт: ${gameState.countdown}`);
        broadcastToAll({
            type: 'countdown_update',
            time: gameState.countdown
        });
        
        if (gameState.countdown <= 0) {
            console.log(`🚀 ОТСЧЁТ ЗАКОНЧЕН! ЗАПУСКАЕМ ИГРУ!`);
            clearInterval(countdownInterval);
            countdownInterval = null;
            startGame();
        }
    }, 1000);
}

function cancelCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        gameState.status = 'lobby';
        broadcastToAll({
            type: 'countdown_cancel'
        });
        console.log(`⏸ Обратный отсчёт ОТМЕНЁН`);
    }
}

function startGame() {
    gameState.status = 'playing';
    gameState.timer = 300;
    gameState.blueTowerHp = 100;
    gameState.redTowerHp = 100;
    gameState.blueBarracksHp = 100;
    gameState.redBarracksHp = 100;
    gameState.blueBarracksDestroyed = false;
    gameState.redBarracksDestroyed = false;
    
    const playersData = {};
    players.forEach((p, id) => {
        playersData[id] = {
            nickname: p.nickname,
            character: p.character,
            x: p.x,
            y: p.y,
            team: p.team,
            hp: p.hp
        };
    });
    
    broadcastToAll({
        type: 'init_game',
        players: playersData,
        my_team: 0,
        town1_hp: gameState.blueTowerHp,
        town2_hp: gameState.redTowerHp,
        barracks1_hp: gameState.blueBarracksHp,
        barracks2_hp: gameState.redBarracksHp,
        barracks1_destroyed: gameState.blueBarracksDestroyed,
        barracks2_destroyed: gameState.redBarracksDestroyed
    });
    
    broadcastToAll({
        type: 'start_game'
    });
    
    console.log('🎮 ИГРА НАЧАЛАСЬ!');
    
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
    }
    gameTimerInterval = setInterval(() => {
        gameState.timer--;
        if (gameState.timer <= 0) {
            endGame(0);
        }
    }, 1000);
    
    // ============================================
    // ЗАПУСКАЕМ ПРОВЕРКУ ИГРОКОВ КАЖДЫЕ 3 СЕКУНДЫ
    // ============================================
    if (playerCheckInterval) {
        clearInterval(playerCheckInterval);
    }
    playerCheckInterval = setInterval(() => {
        checkPlayersCount();
    }, 3000);
}

// ============================================
// 7.1. ПРОВЕРКА КОЛИЧЕСТВА ИГРОКОВ
// ============================================

function checkPlayersCount() {
    if (gameState.status !== 'playing') return;
    
    const alivePlayers = getAlivePlayers();
    const totalPlayers = players.size;
    
    console.log(`👥 Проверка игроков: живых=${alivePlayers}, всего=${totalPlayers}`);
    
    // ЕСЛИ В ИГРЕ МЕНЬШЕ 2 ИГРОКОВ - ЗАКАНЧИВАЕМ
    if (totalPlayers < 2) {
        console.log(`⚠️ В игре меньше 2 игроков (${totalPlayers})! Завершаем игру...`);
        
        broadcastToAll({
            type: 'chat',
            sender: '🛠️ [СИСТЕМА]',
            message: `⚠️ Игра завершена! Недостаточно игроков (${totalPlayers})`
        });
        
        // Определяем победителя
        let winner = 0;
        if (totalPlayers === 1) {
            // Если остался 1 игрок - он победитель
            players.forEach((p) => {
                winner = p.team;
            });
        }
        
        endGame(winner);
        return;
    }
    
    // ЕСЛИ В КОМАНДЕ НЕТ ИГРОКОВ - ДРУГАЯ КОМАНДА ПОБЕЖДАЕТ
    let hasBlue = false;
    let hasRed = false;
    
    players.forEach((p) => {
        if (p.team === 1 && !p.isDead) hasBlue = true;
        if (p.team === 2 && !p.isDead) hasRed = true;
    });
    
    if (!hasBlue && hasRed) {
        console.log(`🔵 Синяя команда не имеет живых игроков! Побеждает красная!`);
        broadcastToAll({
            type: 'chat',
            sender: '🛠️ [СИСТЕМА]',
            message: '🔴 Все игроки синей команды мертвы! Побеждает красная команда!'
        });
        endGame(2);
        return;
    }
    
    if (!hasRed && hasBlue) {
        console.log(`🔴 Красная команда не имеет живых игроков! Побеждает синяя!`);
        broadcastToAll({
            type: 'chat',
            sender: '🛠️ [СИСТЕМА]',
            message: '🔵 Все игроки красной команды мертвы! Побеждает синяя команда!'
        });
        endGame(1);
        return;
    }
}

// ============================================
// 8. ПРИНУДИТЕЛЬНЫЙ ЗАПУСК (F2)
// ============================================

function handleForceStart(ws, data) {
    console.log(`🔥 ПРИНУДИТЕЛЬНЫЙ ЗАПУСК ОТ ${ws.playerData.nickname}`);
    
    if (players.size < 2) {
        ws.send(JSON.stringify({ 
            type: 'chat', 
            sender: '🛠️ [СИСТЕМА]', 
            message: '❌ Нужно минимум 2 игрока для запуска!' 
        }));
        return;
    }
    
    // Принудительно делаем всех готовыми
    players.forEach((p) => {
        p.inGame = true;
    });
    
    console.log(`🔥 ПРИНУДИТЕЛЬНЫЙ ЗАПУСК! Все игроки готовы`);
    
    broadcastToAll({
        type: 'chat',
        sender: '🛠️ [СИСТЕМА]',
        message: '🔥 ПРИНУДИТЕЛЬНЫЙ ЗАПУСК ИГРЫ!'
    });
    
    // Отменяем текущий отсчёт, если есть
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    
    startCountdown();
}

// ============================================
// 9. ЗАВЕРШЕНИЕ ИГРЫ
// ============================================

function endGame(winnerTeam) {
    if (gameState.status === 'finished') return;
    
    gameState.status = 'finished';
    gameState.winner = winnerTeam;
    
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
        gameTimerInterval = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    if (playerCheckInterval) {  // <--- ДОБАВЛЕНО
        clearInterval(playerCheckInterval);
        playerCheckInterval = null;
    }
    
    const winnerText = winnerTeam === 0 ? 'НИЧЬЯ!' : `Команда ${winnerTeam} ПОБЕДИЛА!`;
    console.log(`🏆 ${winnerText}`);
    
    broadcastToAll({
        type: 'chat',
        sender: '🛠️ [СИСТЕМА]',
        message: `🏆 ${winnerText}`
    });
    
    broadcastToAll({
        type: 'game_over',
        winner_team: winnerTeam
    });
    
    setTimeout(() => {
        resetGame();
    }, 5000);
}

function resetGame() {
    gameState.status = 'lobby';
    gameState.countdown = 15;
    gameState.timer = 300;
    gameState.blueTowerHp = 100;
    gameState.redTowerHp = 100;
    gameState.blueBarracksHp = 100;
    gameState.redBarracksHp = 100;
    gameState.blueBarracksDestroyed = false;
    gameState.redBarracksDestroyed = false;
    gameState.winner = 0;
    
    players.forEach((p) => {
        p.inGame = false;
        p.hp = 100;
        p.isDead = false;
        p.x = 0;
        p.y = 0;
    });
    
    broadcastToAll({
        type: 'reset_lobby'
    });
    
    broadcastPlayerList();
    console.log('🔄 Игра сброшена, возврат в лобби');
}

// ============================================
// 10. ОТКЛЮЧЕНИЕ ИГРОКА
// ============================================

function handleDisconnect(ws) {
    const id = ws.playerData.id;
    const nickname = ws.playerData.nickname || 'Неизвестный';
    
    if (id && players.has(id)) {
        players.delete(id);
        broadcastPlayerList();
        broadcastToAll({
            type: 'player_left',
            id: id
        });
        
        // ЕСЛИ ИГРА В ПРОЦЕССЕ - ПРОВЕРЯЕМ КОЛИЧЕСТВО ИГРОКОВ
        if (gameState.status === 'playing') {
            console.log(`⚠️ Игрок ${nickname} вышел во время игры!`);
            broadcastToAll({
                type: 'chat',
                sender: '🛠️ [СИСТЕМА]',
                message: `⚠️ Игрок ${nickname} покинул игру!`
            });
            // Проверяем количество игроков сразу
            checkPlayersCount();
        }
    }
    
    console.log(`❌ Отключился: ${nickname}`);
    
    if (players.size < 2 && gameState.status !== 'playing') {
        cancelCountdown();
    }
}

// ============================================
// 11. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

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
            character: p.character,
            x: p.x,
            y: p.y,
            flip: p.flip,
            team: p.team,
            hp: p.hp,
            isDead: p.isDead || false
        };
    });
    
    broadcastToAll({
        type: 'players_list',
        players: data
    });
}

// ============================================
// 12. ОБРАБОТКА ОСТАНОВКИ СЕРВЕРА
// ============================================

process.on('SIGINT', () => {
    console.log('🛑 Сервер остановлен');
    if (countdownInterval) clearInterval(countdownInterval);
    if (gameTimerInterval) clearInterval(gameTimerInterval);
    if (playerCheckInterval) clearInterval(playerCheckInterval);
    process.exit();
});
