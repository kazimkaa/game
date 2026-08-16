const WebSocket = require('ws');
const http = require('http');

// ============================================================
// 1. НАСТРОЙКА СЕРВЕРА
// ============================================================

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Сервер работает! Используйте WebSocket для подключения.');
});

const wss = new WebSocket.Server({
    server
});

const PORT = process.env.PORT || 3000;


// ============================================================
// 2. ХРАНИЛИЩЕ
// ============================================================

const players = new Map();

const gameState = {
    status: 'lobby',

    countdown: 15,

    timer: 300,

    blueTowerHp: 100,
    redTowerHp: 100,

    blueBarracksHp: 100,
    redBarracksHp: 100,

    blueBarracksDestroyed: false,
    redBarracksDestroyed: false,

    creeps: [],

    winner: 0
};


let countdownInterval = null;
let gameTimerInterval = null;
let playerCheckInterval = null;


// ============================================================
// 3. ЗАПУСК
// ============================================================

server.listen(PORT, () => {

    console.log('========================================');
    console.log('🚀 SERVER STARTED');
    console.log(`📡 PORT: ${PORT}`);
    console.log(`📍 ws://localhost:${PORT}`);
    console.log('👥 Ожидание игроков...');
    console.log('========================================');

});


// ============================================================
// 4. ПОДКЛЮЧЕНИЕ CLIENT
// ============================================================

wss.on('connection', (ws, req) => {

    const clientIP = req.socket.remoteAddress;

    console.log('');
    console.log('========================================');
    console.log('🟢 НОВОЕ ПОДКЛЮЧЕНИЕ');
    console.log(`📡 IP: ${clientIP}`);
    console.log('========================================');


    // --------------------------------------------------------
    // Данные игрока
    // --------------------------------------------------------

    ws.playerData = {

        id: null,

        nickname: 'Player',

        character: 1,

        x: 0,

        y: 500,

        flip: false,

        team: 0,

        hp: 100,

        isDead: false,

        inGame: false

    };


    console.log('✅ playerData создан');


    // --------------------------------------------------------
    // MESSAGE
    // --------------------------------------------------------

    ws.on('message', (raw) => {

        try {

            const data = JSON.parse(raw);

            console.log(
                `📩 MESSAGE: ${data.type}`
            );

            handleMessage(ws, data);

        } catch (error) {

            console.log(
                `❌ JSON ERROR: ${error.message}`
            );

        }

    });


    // --------------------------------------------------------
    // CLOSE
    // --------------------------------------------------------

    ws.on('close', () => {

        console.log('🔴 WebSocket закрыт');

        handleDisconnect(ws);

    });


    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    ws.on('error', (error) => {

        console.log(
            `⚠️ WebSocket ERROR: ${error.message}`
        );

    });

});


// ============================================================
// 5. MESSAGE ROUTER
// ============================================================

function handleMessage(ws, data) {

    if (!data || !data.type) {

        console.log('⚠️ Сообщение без type');

        return;
    }


    switch (data.type) {

        case 'join':

            handleJoin(ws, data);

            break;


        case 'move':

            handleMove(ws, data);

            break;


        case 'ping':

            ws.send(JSON.stringify({
                type: 'pong'
            }));

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

            console.log(
                `⚠️ UNKNOWN MESSAGE: ${data.type}`
            );

            break;
    }

}


// ============================================================
// 6. JOIN
// ============================================================

function handleJoin(ws, data) {

    const id = String(data.id || '');

    const nickname =
        data.nickname ||
        'Player';

    const character =
        Number(data.character || 1);


    if (!id) {

        console.log('❌ JOIN без ID');

        ws.send(JSON.stringify({

            type: 'error',

            message: 'ID отсутствует'

        }));

        return;
    }


    console.log('');
    console.log('========================================');
    console.log('📥 JOIN');
    console.log(`👤 Nickname: ${nickname}`);
    console.log(`🆔 ID: ${id}`);
    console.log(`🎭 Character: ${character}`);
    console.log('========================================');


    // --------------------------------------------------------
    // Если ID уже существует
    // --------------------------------------------------------

    if (players.has(id)) {

        console.log(
            `⚠️ ID ${id} уже существует`
        );


        ws.send(JSON.stringify({

            type: 'error',

            message: 'ID занят'

        }));


        return;
    }


    // --------------------------------------------------------
    // Команды
    // --------------------------------------------------------

    let blueCount = 0;
    let redCount = 0;


    players.forEach((player) => {

        if (player.team === 1) {

            blueCount++;

        }

        if (player.team === 2) {

            redCount++;

        }

    });


    let team = 1;


    if (players.size === 0) {

        team = 1;

    } else if (players.size === 1) {

        team = 2;

    } else {

        if (blueCount <= redCount) {

            team = 1;

        } else {

            team = 2;

        }

    }


    // --------------------------------------------------------
    // Позиция
    // --------------------------------------------------------

    let spawnX = 0;
    let spawnY = 500;


    if (team === 1) {

        spawnX = -1500;

    } else {

        spawnX = 2690;

    }


    // --------------------------------------------------------
    // Записываем данные
    // --------------------------------------------------------

    ws.playerData.id = id;

    ws.playerData.nickname = nickname;

    ws.playerData.character = character;

    ws.playerData.x = spawnX;

    ws.playerData.y = spawnY;

    ws.playerData.flip = false;

    ws.playerData.team = team;

    ws.playerData.hp = 100;

    ws.playerData.isDead = false;

    ws.playerData.inGame = false;


    // --------------------------------------------------------
    // Добавляем игрока
    // --------------------------------------------------------

    players.set(
        id,
        ws.playerData
    );


    console.log(
        `👤 Игрок зарегистрирован: ${nickname}`
    );

    console.log(
        `🆔 ID: ${id}`
    );

    console.log(
        `🏳️ TEAM: ${team}`
    );

    console.log(
        `📍 SPAWN: ${spawnX}, ${spawnY}`
    );

    console.log(
        `👥 PLAYERS: ${players.size}`
    );


    // ========================================================
    // САМОЕ ВАЖНОЕ
    // СРАЗУ ОТПРАВЛЯЕМ JOIN SUCCESS
    // ========================================================

    sendToPlayer(ws, {

        type: 'join_success',

        id: id,

        team: team,

        x: spawnX,

        y: spawnY,

        character: character

    });


    console.log(
        `📤 join_success отправлен ${nickname}`
    );


    // ========================================================
    // СРАЗУ ОТПРАВЛЯЕМ СПИСОК ИГРОКОВ
    // ========================================================

    sendPlayerListTo(ws);


    console.log(
        `📤 players_list отправлен ${nickname}`
    );


    // ========================================================
    // УВЕДОМЛЯЕМ ОСТАЛЬНЫХ
    // ========================================================

    broadcastToAll({

        type: 'player_joined',

        id: id,

        nickname: nickname,

        character: character,

        x: spawnX,

        y: spawnY,

        flip: false,

        team: team

    }, ws);


    console.log(
        `📢 player_joined broadcast`
    );


    // ========================================================
    // ВСЕМ НОВЫЙ СПИСОК
    // ========================================================

    broadcastPlayerList();


    // ========================================================
    // ПРОВЕРКА ИГРЫ
    // ========================================================

    checkCountdown();


    console.log('========================================');
    console.log('✅ JOIN COMPLETE');
    console.log('========================================');
    console.log('');

}


// ============================================================
// 7. MOVE
// ============================================================

function handleMove(ws, data) {

    const id = ws.playerData.id;

    if (!id) {

        return;
    }


    if (!players.has(id)) {

        return;
    }


    const player = players.get(id);


    player.x = Number(data.x || 0);

    player.y = Number(data.y || 0);

    player.flip = Boolean(data.flip);


    broadcastToAll({

        type: 'player_moved',

        id: id,

        x: player.x,

        y: player.y,

        flip: player.flip

    }, ws);

}


// ============================================================
// 8. CHAT
// ============================================================

function handleChat(ws, data) {

    const sender =
        ws.playerData.nickname ||
        'Неизвестный';


    const message =
        data.message || '';


    if (!message) {

        return;
    }


    console.log(
        `💬 [${sender}]: ${message}`
    );


    broadcastToAll({

        type: 'chat',

        sender: sender,

        message: message

    });

}


// ============================================================
// 9. LEVEL READY
// ============================================================

function handleLevelReady(ws, data) {

    const id = ws.playerData.id;


    if (!id) {

        console.log(
            '⚠️ level_ready без ID'
        );

        return;
    }


    if (!players.has(id)) {

        console.log(
            '⚠️ level_ready игрок не найден'
        );

        return;
    }


    const player = players.get(id);


    player.inGame = true;


    console.log('');
    console.log('========================================');
    console.log('🎮 LEVEL READY');
    console.log(`👤 ${player.nickname}`);
    console.log(`🆔 ${id}`);
    console.log('========================================');


    console.log(
        `📊 Всего игроков: ${players.size}`
    );

    console.log(
        `📊 Готовых: ${getReadyPlayers()}`
    );


    players.forEach((p) => {

        console.log(
            `   ${p.nickname}: ${
                p.inGame
                    ? '✅ READY'
                    : '❌ NOT READY'
            }`
        );

    });


    checkAllReady();

}


// ============================================================
// 10. PLAYER DAMAGE
// ============================================================

function handlePlayerDamage(ws, data) {

    const targetId = data.target_id;

    const damage =
        Number(data.damage || 10);


    if (!players.has(targetId)) {

        return;
    }


    const target =
        players.get(targetId);


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


// ============================================================
// 11. TOWN DAMAGE
// ============================================================

function handleTownDamage(ws, data) {

    const townId =
        Number(data.town_id);


    const damage =
        Number(data.damage || 10);


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

            new_hp:
                gameState.blueTowerHp

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

            new_hp:
                gameState.redTowerHp

        });

    }

}


// ============================================================
// 12. BARRACKS DAMAGE
// ============================================================

function handleBarracksDamage(ws, data) {

    const barracksId =
        Number(data.barracks_id);


    const damage =
        Number(data.damage || 10);


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

            new_hp:
                gameState.blueBarracksHp

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

            new_hp:
                gameState.redBarracksHp

        });

    }

}


// ============================================================
// 13. CREEP DAMAGE
// ============================================================

function handleCreepDamage(ws, data) {

    const creepId = data.id;

    const newHp = data.new_hp;


    broadcastToAll({

        type: 'creep_damage',

        id: creepId,

        new_hp: newHp

    });

}


// ============================================================
// 14. RESPAWN
// ============================================================

function handleRespawn(ws, data) {

    const id = data.id;

    respawnPlayer(id);

}


function respawnPlayer(id) {

    if (!players.has(id)) {

        return;
    }


    const player =
        players.get(id);


    player.hp = 100;

    player.isDead = false;


    if (player.team === 1) {

        player.x = -1500;

    } else {

        player.x = 2690;

    }


    player.y = 450;


    broadcastToAll({

        type: 'respawn',

        id: id,

        x: player.x,

        y: player.y,

        hp: player.hp

    });

}


// ============================================================
// 15. COUNTDOWN
// ============================================================

function checkCountdown() {

    if (gameState.status !== 'lobby') {

        return;
    }


    const readyPlayers =
        getReadyPlayers();


    console.log(
        `🔍 checkCountdown: ready=${readyPlayers}, total=${players.size}`
    );


    if (readyPlayers >= 2) {

        startCountdown();

    } else {

        cancelCountdown();

    }

}


// ============================================================
// 16. READY COUNT
// ============================================================

function getReadyPlayers() {

    let count = 0;


    players.forEach((player) => {

        if (player.inGame) {

            count++;

        }

    });


    return count;

}


// ============================================================
// 17. ALIVE COUNT
// ============================================================

function getAlivePlayers() {

    let count = 0;


    players.forEach((player) => {

        if (!player.isDead) {

            count++;

        }

    });


    return count;

}


// ============================================================
// 18. CHECK ALL READY
// ============================================================

function checkAllReady() {

    if (
        gameState.status === 'playing' ||
        gameState.status === 'finished'
    ) {

        return;

    }


    const totalPlayers =
        players.size;


    const readyPlayers =
        getReadyPlayers();


    console.log(
        `🔍 CHECK READY: ${readyPlayers}/${totalPlayers}`
    );


    if (
        totalPlayers >= 2 &&
        readyPlayers === totalPlayers
    ) {

        console.log(
            '✅ ВСЕ ИГРОКИ READY'
        );


        startCountdown();

    }

}


// ============================================================
// 19. START COUNTDOWN
// ============================================================

function startCountdown() {

    if (countdownInterval) {

        return;

    }


    console.log(
        '⏱️ ЗАПУСК COUNTDOWN'
    );


    gameState.status =
        'countdown';


    gameState.countdown =
        15;


    broadcastToAll({

        type: 'countdown_start',

        time:
            gameState.countdown

    });


    countdownInterval =
        setInterval(() => {

            gameState.countdown--;


            console.log(
                `⏱️ COUNTDOWN: ${gameState.countdown}`
            );


            broadcastToAll({

                type: 'countdown_update',

                time:
                    gameState.countdown

            });


            if (
                gameState.countdown <= 0
            ) {

                clearInterval(
                    countdownInterval
                );


                countdownInterval =
                    null;


                startGame();

            }

        }, 1000);

}


// ============================================================
// 20. CANCEL COUNTDOWN
// ============================================================

function cancelCountdown() {

    if (countdownInterval) {

        clearInterval(
            countdownInterval
        );

        countdownInterval = null;

        gameState.status =
            'lobby';


        broadcastToAll({

            type: 'countdown_cancel'

        });


        console.log(
            '⏸ COUNTDOWN ОТМЕНЁН'
        );

    }

}


// ============================================================
// 21. START GAME
// ============================================================

function startGame() {

    gameState.status =
        'playing';


    gameState.timer = 300;

    gameState.blueTowerHp = 100;
    gameState.redTowerHp = 100;

    gameState.blueBarracksHp = 100;
    gameState.redBarracksHp = 100;

    gameState.blueBarracksDestroyed = false;
    gameState.redBarracksDestroyed = false;


    console.log('');
    console.log('========================================');
    console.log('🚀 GAME START');
    console.log('========================================');


    // --------------------------------------------------------
    // Создаём players data
    // --------------------------------------------------------

    const playersData = {};


    players.forEach((player, id) => {

        playersData[id] = {

            nickname:
                player.nickname,

            character:
                player.character,

            x:
                player.x,

            y:
                player.y,

            flip:
                player.flip,

            team:
                player.team,

            hp:
                player.hp

        };

    });


    // --------------------------------------------------------
    // Отправляем каждому его team
    // --------------------------------------------------------

    wss.clients.forEach((client) => {

        if (
            client.readyState !== WebSocket.OPEN
        ) {

            return;
        }


        if (
            !client.playerData ||
            !client.playerData.id
        ) {

            return;
        }


        const playerId =
            client.playerData.id;


        const player =
            players.get(playerId);


        if (!player) {

            return;
        }


        client.send(
            JSON.stringify({

                type: 'init_game',

                players:
                    playersData,

                my_team:
                    player.team,

                town1_hp:
                    gameState.blueTowerHp,

                town2_hp:
                    gameState.redTowerHp,

                barracks1_hp:
                    gameState.blueBarracksHp,

                barracks2_hp:
                    gameState.redBarracksHp,

                barracks1_destroyed:
                    gameState.blueBarracksDestroyed,

                barracks2_destroyed:
                    gameState.redBarracksDestroyed

            })
        );


        console.log(
            `📤 init_game → ${player.nickname}`
        );

    });


    broadcastToAll({

        type: 'start_game'

    });


    console.log(
        '🎮 ИГРА НАЧАЛАСЬ!'
    );


    // --------------------------------------------------------
    // GAME TIMER
    // --------------------------------------------------------

    if (gameTimerInterval) {

        clearInterval(
            gameTimerInterval
        );

    }


    gameTimerInterval =
        setInterval(() => {

            gameState.timer--;


            if (
                gameState.timer <= 0
            ) {

                endGame(0);

            }

        }, 1000);


    // --------------------------------------------------------
    // PLAYER CHECK
    // --------------------------------------------------------

    if (playerCheckInterval) {

        clearInterval(
            playerCheckInterval
        );

    }


    playerCheckInterval =
        setInterval(() => {

            checkPlayersCount();

        }, 3000);

}


// ============================================================
// 22. CHECK PLAYERS
// ============================================================

function checkPlayersCount() {

    if (
        gameState.status !== 'playing'
    ) {

        return;

    }


    const alivePlayers =
        getAlivePlayers();


    const totalPlayers =
        players.size;


    console.log(
        `👥 PLAYERS: alive=${alivePlayers}, total=${totalPlayers}`
    );


    if (totalPlayers < 2) {

        let winner = 0;


        if (totalPlayers === 1) {

            players.forEach((player) => {

                winner =
                    player.team;

            });

        }


        endGame(winner);

        return;

    }


    let hasBlue = false;

    let hasRed = false;


    players.forEach((player) => {

        if (
            player.team === 1 &&
            !player.isDead
        ) {

            hasBlue = true;

        }


        if (
            player.team === 2 &&
            !player.isDead
        ) {

            hasRed = true;

        }

    });


    if (!hasBlue && hasRed) {

        endGame(2);

        return;

    }


    if (!hasRed && hasBlue) {

        endGame(1);

        return;

    }

}


// ============================================================
// 23. FORCE START
// ============================================================

function handleForceStart(ws, data) {

    console.log(
        `🔥 FORCE START от ${ws.playerData.nickname}`
    );


    if (players.size < 2) {

        sendToPlayer(ws, {

            type: 'chat',

            sender: '🛠️ [СИСТЕМА]',

            message:
                '❌ Нужно минимум 2 игрока!'

        });


        return;

    }


    players.forEach((player) => {

        player.inGame = true;

    });


    if (countdownInterval) {

        clearInterval(
            countdownInterval
        );

        countdownInterval = null;

    }


    startCountdown();

}


// ============================================================
// 24. END GAME
// ============================================================

function endGame(winnerTeam) {

    if (
        gameState.status === 'finished'
    ) {

        return;

    }


    gameState.status =
        'finished';


    gameState.winner =
        winnerTeam;


    if (gameTimerInterval) {

        clearInterval(
            gameTimerInterval
        );

        gameTimerInterval = null;

    }


    if (countdownInterval) {

        clearInterval(
            countdownInterval
        );

        countdownInterval = null;

    }


    if (playerCheckInterval) {

        clearInterval(
            playerCheckInterval
        );

        playerCheckInterval = null;

    }


    const winnerText =
        winnerTeam === 0
            ? 'НИЧЬЯ!'
            : `Команда ${winnerTeam} ПОБЕДИЛА!`;


    console.log(
        `🏆 ${winnerText}`
    );


    broadcastToAll({

        type: 'chat',

        sender:
            '🛠️ [СИСТЕМА]',

        message:
            `🏆 ${winnerText}`

    });


    broadcastToAll({

        type: 'game_over',

        winner_team:
            winnerTeam

    });


    setTimeout(() => {

        resetGame();

    }, 5000);

}


// ============================================================
// 25. RESET GAME
// ============================================================

function resetGame() {

    gameState.status =
        'lobby';


    gameState.countdown =
        15;


    gameState.timer =
        300;


    gameState.blueTowerHp =
        100;


    gameState.redTowerHp =
        100;


    gameState.blueBarracksHp =
        100;


    gameState.redBarracksHp =
        100;


    gameState.blueBarracksDestroyed =
        false;


    gameState.redBarracksDestroyed =
        false;


    gameState.winner =
        0;


    players.forEach((player) => {

        player.inGame = false;

        player.hp = 100;

        player.isDead = false;

        player.x =
            player.team === 1
                ? -1500
                : 2690;

        player.y = 450;

    });


    broadcastToAll({

        type: 'reset_lobby'

    });


    broadcastPlayerList();


    console.log(
        '🔄 GAME RESET'
    );

}


// ============================================================
// 26. DISCONNECT
// ============================================================

function handleDisconnect(ws) {

    const id =
        ws.playerData.id;


    const nickname =
        ws.playerData.nickname ||
        'Неизвестный';


    if (
        id &&
        players.has(id)
    ) {

        players.delete(id);


        console.log(
            `❌ Игрок удалён: ${nickname}`
        );


        broadcastToAll({

            type: 'player_left',

            id: id

        });


        broadcastPlayerList();


        if (
            gameState.status === 'playing'
        ) {

            broadcastToAll({

                type: 'chat',

                sender:
                    '🛠️ [СИСТЕМА]',

                message:
                    `⚠️ Игрок ${nickname} покинул игру!`

            });


            checkPlayersCount();

        }

    }


    console.log(
        `👥 Осталось игроков: ${players.size}`
    );


    if (
        players.size < 2 &&
        gameState.status !== 'playing'
    ) {

        cancelCountdown();

    }

}


// ============================================================
// 27. ОТПРАВКА КОНКРЕТНОМУ ИГРОКУ
// ============================================================

function sendToPlayer(ws, message) {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {

        console.log(
            '⚠️ Нельзя отправить сообщение: socket закрыт'
        );

        return;

    }


    ws.send(
        JSON.stringify(message)
    );

}


// ============================================================
// 28. СПИСОК ИГРОКОВ ДЛЯ ОДНОГО CLIENT
// ============================================================

function sendPlayerListTo(ws) {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {

        return;

    }


    const data = {};


    players.forEach((player, id) => {

        data[id] = {

            nickname:
                player.nickname,

            character:
                player.character,

            x:
                player.x,

            y:
                player.y,

            flip:
                player.flip,

            team:
                player.team,

            hp:
                player.hp,

            isDead:
                player.isDead

        };

    });


    sendToPlayer(ws, {

        type: 'players_list',

        players:
            data

    });

}


// ============================================================
// 29. BROADCAST
// ============================================================

function broadcastToAll(
    message,
    exclude = null
) {

    const json =
        JSON.stringify(message);


    wss.clients.forEach((client) => {

        if (
            client !== exclude &&
            client.readyState === WebSocket.OPEN
        ) {

            client.send(json);

        }

    });

}


// ============================================================
// 30. BROADCAST PLAYER LIST
// ============================================================

function broadcastPlayerList() {

    const data = {};


    players.forEach((player, id) => {

        data[id] = {

            nickname:
                player.nickname,

            character:
                player.character,

            x:
                player.x,

            y:
                player.y,

            flip:
                player.flip,

            team:
                player.team,

            hp:
                player.hp,

            isDead:
                player.isDead || false

        };

    });


    broadcastToAll({

        type: 'players_list',

        players:
            data

    });

}


// ============================================================
// 31. ОСТАНОВКА
// ============================================================

process.on('SIGINT', () => {

    console.log(
        '🛑 Сервер остановлен'
    );


    if (countdownInterval) {

        clearInterval(
            countdownInterval
        );

    }


    if (gameTimerInterval) {

        clearInterval(
            gameTimerInterval
        );

    }


    if (playerCheckInterval) {

        clearInterval(
            playerCheckInterval
        );

    }


    process.exit();

});
