// server.js — сервер для Godot-клиента (см. network.gd)
// Запуск: node server.js
// На Render нужен package.json с зависимостью "ws" и скриптом "start": "node server.js"

const http = require("http");
const { WebSocketServer } = require("ws");

// ================== КОНСТАНТЫ ==================
const PORT = process.env.PORT || 3000;

const MIN_PLAYERS_TO_START = 2;      // сколько игроков нужно, чтобы начать отсчёт
const COUNTDOWN_SECONDS = 15;

const TOWN_MAX_HP = 1000;
const BARRACKS_MAX_HP = 500;

const TEAM1_SPAWN = { x: 300, y: 450 };
const TEAM2_SPAWN = { x: 1600, y: 450 };

// позиции построек на карте (для крипов/ИИ)
const TOWN1_X = 200;
const TOWN2_X = 1700;
const BARRACKS1_X = 500;
const BARRACKS2_X = 1400;

const CREEP_MAX_HP = 80;
const CREEP_SPEED = 40;              // юниты в секунду
const CREEP_SPAWN_INTERVAL_MS = 15000;
const CREEP_DAMAGE = 10;             // урон крипа по строению за тик
const CREEP_HIT_RANGE = 40;
const TICK_MS = 100;

// ================== СОСТОЯНИЕ ИГРЫ ==================
// players: id -> { id, ws, nickname, character, x, y, flip, team, hp, is_dead }
const players = new Map();

// creeps: id -> { id, team, x, y, hp }
const creeps = new Map();
let nextCreepId = 1;

let matchState = "lobby"; // 'lobby' | 'countdown' | 'playing' | 'finished'
let nextTeam = 1;         // для чередования команд при джойне

let town1_hp = TOWN_MAX_HP;
let town2_hp = TOWN_MAX_HP;
let barracks1_hp = BARRACKS_MAX_HP;
let barracks2_hp = BARRACKS_MAX_HP;
let barracks1_destroyed = false;
let barracks2_destroyed = false;

let countdownInterval = null;
let countdownValue = 0;
let creepSpawnInterval = null;
let gameTickInterval = null;

// ================== HTTP + WS ==================
const httpServer = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("Game server is running\n");
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
	console.log(`[SERVER] Listening on port ${PORT}`);
});

wss.on("connection", (ws) => {
	console.log("[SERVER] New connection");
	ws.playerId = null;

	ws.on("message", (raw) => {
		let data;
		try {
			data = JSON.parse(raw.toString());
		} catch (e) {
			console.log("[SERVER] Bad JSON:", raw.toString());
			return;
		}
		handleMessage(ws, data);
	});

	ws.on("close", () => {
		if (ws.playerId) {
			console.log("[SERVER] Player left:", ws.playerId);
			players.delete(ws.playerId);
			broadcast({ type: "player_left", id: ws.playerId });
			maybeCancelCountdown();
		}
	});

	ws.on("error", (err) => {
		console.log("[SERVER] Socket error:", err.message);
	});
});

// ================== ВСПОМОГАТЕЛЬНЫЕ ==================
function send(ws, data) {
	if (ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify(data));
	}
}

function broadcast(data, exceptWs = null) {
	for (const p of players.values()) {
		if (p.ws !== exceptWs) {
			send(p.ws, data);
		}
	}
}

function assignTeam() {
	const team = nextTeam;
	nextTeam = nextTeam === 1 ? 2 : 1;
	return team;
}

function publicPlayersDict(excludeId = null) {
	const dict = {};
	for (const p of players.values()) {
		if (p.id === excludeId) continue;
		dict[p.id] = {
			id: p.id,
			nickname: p.nickname,
			character: p.character,
			x: p.x,
			y: p.y,
			flip: p.flip,
			hp: p.hp,
			is_dead: p.is_dead,
			team: p.team
		};
	}
	return dict;
}

// ================== ОБРАБОТКА СООБЩЕНИЙ ==================
function handleMessage(ws, data) {
	const type = data.type;

	switch (type) {
		case "join":
			handleJoin(ws, data);
			break;
		case "move":
			handleMove(ws, data);
			break;
		case "chat":
			handleChat(ws, data);
			break;
		case "level_ready":
			handleLevelReady(ws, data);
			break;
		case "town_damage":
			handleTownDamage(ws, data);
			break;
		case "barracks_damage":
			handleBarracksDamage(ws, data);
			break;
		case "player_damage":
			handlePlayerDamage(ws, data);
			break;
		case "creep_damage":
			handleCreepDamage(ws, data);
			break;
		case "respawn":
			handleRespawn(ws, data);
			break;
		default:
			console.log("[SERVER] Unknown message type:", type);
	}
}

function handleJoin(ws, data) {
	const id = data.id;
	if (!id) return;

	ws.playerId = id;

	const player = {
		id,
		ws,
		nickname: data.nickname || "Player",
		character: data.character || 1,
		x: data.x || 0,
		y: data.y || 0,
		flip: false,
		team: assignTeam(),
		hp: 100,
		is_dead: false
	};
	players.set(id, player);

	console.log(`[SERVER] ${player.nickname} joined as ${id}, team ${player.team}`);

	// новому игроку — список остальных
	send(ws, { type: "init", players: publicPlayersDict(id) });

	// остальным — о новом игроке
	broadcast(
		{
			type: "player_joined",
			id,
			x: player.x,
			y: player.y,
			flip: player.flip,
			nickname: player.nickname,
			character: player.character
		},
		ws
	);

	maybeStartCountdown();
}

function handleMove(ws, data) {
	const player = players.get(ws.playerId);
	if (!player) return;
	player.x = data.x;
	player.y = data.y;
	player.flip = data.flip;
	broadcast(
		{ type: "player_moved", id: player.id, x: player.x, y: player.y, flip: player.flip },
		ws
	);
}

function handleChat(ws, data) {
	broadcast({
		type: "chat",
		nickname: data.nickname || "???",
		message: data.message || ""
	});
}

function handleLevelReady(ws, data) {
	const player = players.get(ws.playerId);
	if (!player) return;

	player.x = data.x;
	player.y = data.y;
	player.flip = data.flip;

	send(ws, {
		type: "init_game",
		players: publicPlayersDict(player.id),
		my_team: player.team,
		town1_hp,
		town2_hp,
		barracks1_hp,
		barracks2_hp,
		barracks1_destroyed,
		barracks2_destroyed
	});
}

function handleTownDamage(ws, data) {
	if (matchState !== "playing") return;
	const townId = Number(data.town_id);
	const damage = Number(data.damage) || 0;

	if (townId === 1) {
		town1_hp = Math.max(0, town1_hp - damage);
		broadcast({ type: "town_damage", town_id: 1, damage, new_hp: town1_hp });
		if (town1_hp <= 0) endGame(2);
	} else if (townId === 2) {
		town2_hp = Math.max(0, town2_hp - damage);
		broadcast({ type: "town_damage", town_id: 2, damage, new_hp: town2_hp });
		if (town2_hp <= 0) endGame(1);
	}
}

function handleBarracksDamage(ws, data) {
	if (matchState !== "playing") return;
	const barracksId = Number(data.barracks_id);
	const damage = Number(data.damage) || 0;
	dealBarracksDamage(barracksId, damage);
}

function dealBarracksDamage(barracksId, damage) {
	if (barracksId === 1 && !barracks1_destroyed) {
		barracks1_hp = Math.max(0, barracks1_hp - damage);
		broadcast({ type: "barracks_damage", barracks_id: 1, new_hp: barracks1_hp });
		if (barracks1_hp <= 0) {
			barracks1_destroyed = true;
			broadcast({ type: "barracks_destroyed", barracks_id: 1 });
		}
	} else if (barracksId === 2 && !barracks2_destroyed) {
		barracks2_hp = Math.max(0, barracks2_hp - damage);
		broadcast({ type: "barracks_damage", barracks_id: 2, new_hp: barracks2_hp });
		if (barracks2_hp <= 0) {
			barracks2_destroyed = true;
			broadcast({ type: "barracks_destroyed", barracks_id: 2 });
		}
	}
}

function handlePlayerDamage(ws, data) {
	if (matchState !== "playing") return;
	const target = players.get(data.target_id);
	if (!target || target.is_dead) return;

	const damage = Number(data.damage) || 0;
	target.hp = Math.max(0, target.hp - damage);
	if (target.hp <= 0) target.is_dead = true;

	broadcast({ type: "player_damage", target_id: target.id, new_hp: target.hp });
}

function handleCreepDamage(ws, data) {
	const creep = creeps.get(data.creep_id);
	if (!creep) return;

	const damage = Number(data.damage) || 0;
	creep.hp = Math.max(0, creep.hp - damage);

	if (creep.hp <= 0) {
		creeps.delete(creep.id);
		broadcast({ type: "creep_destroy", id: creep.id });
	} else {
		broadcast({ type: "creep_damage", id: creep.id, new_hp: creep.hp });
	}
}

function handleRespawn(ws, data) {
	const player = players.get(ws.playerId);
	if (!player) return;

	const spawn = player.team === 1 ? TEAM1_SPAWN : TEAM2_SPAWN;
	player.hp = 100;
	player.is_dead = false;
	player.x = spawn.x;
	player.y = spawn.y;

	broadcast({ type: "respawn", id: player.id, x: player.x, y: player.y, hp: player.hp });
}

// ================== ЛОББИ / СТАРТ МАТЧА ==================
function maybeStartCountdown() {
	if (matchState !== "lobby") return;
	if (players.size < MIN_PLAYERS_TO_START) return;

	matchState = "countdown";
	countdownValue = COUNTDOWN_SECONDS;
	broadcast({ type: "countdown_start", time: countdownValue });

	countdownInterval = setInterval(() => {
		countdownValue -= 1;
		if (countdownValue > 0) {
			broadcast({ type: "countdown_update", time: countdownValue });
		} else {
			clearInterval(countdownInterval);
			countdownInterval = null;
			startGame();
		}
	}, 1000);
}

function maybeCancelCountdown() {
	if (matchState === "countdown" && players.size < MIN_PLAYERS_TO_START) {
		clearInterval(countdownInterval);
		countdownInterval = null;
		matchState = "lobby";
		broadcast({ type: "countdown_cancel" });
	}
}

function startGame() {
	matchState = "playing";
	resetMatchState();
	broadcast({ type: "start_game" });

	creepSpawnInterval = setInterval(spawnCreepWave, CREEP_SPAWN_INTERVAL_MS);
	gameTickInterval = setInterval(gameTick, TICK_MS);

	// первая волна сразу
	spawnCreepWave();
}

function resetMatchState() {
	town1_hp = TOWN_MAX_HP;
	town2_hp = TOWN_MAX_HP;
	barracks1_hp = BARRACKS_MAX_HP;
	barracks2_hp = BARRACKS_MAX_HP;
	barracks1_destroyed = false;
	barracks2_destroyed = false;
	creeps.clear();

	for (const player of players.values()) {
		player.hp = 100;
		player.is_dead = false;
	}
}

function endGame(winnerTeam) {
	matchState = "finished";
	clearInterval(creepSpawnInterval);
	clearInterval(gameTickInterval);
	creepSpawnInterval = null;
	gameTickInterval = null;

	broadcast({ type: "game_over", winner: winnerTeam });

	// небольшая пауза перед возвратом в лобби
	setTimeout(() => {
		matchState = "lobby";
		creeps.clear();
		broadcast({ type: "system_message", message: "Возврат в лобби..." });
	}, 8000);
}

// ================== КРИПЫ ==================
function spawnCreepWave() {
	if (matchState !== "playing") return;
	spawnCreep(1);
	spawnCreep(2);
}

function spawnCreep(team) {
	const id = "creep_" + nextCreepId++;
	const spawn = team === 1 ? TEAM1_SPAWN : TEAM2_SPAWN;
	const creep = { id, team, x: spawn.x, y: spawn.y, hp: CREEP_MAX_HP };
	creeps.set(id, creep);
	broadcast({ type: "creep_spawn", id, team, x: creep.x, y: creep.y, hp: creep.hp });
}

function gameTick() {
	if (matchState !== "playing") return;
	const dt = TICK_MS / 1000;

	for (const creep of creeps.values()) {
		const dir = creep.team === 1 ? 1 : -1;
		creep.x += dir * CREEP_SPEED * dt;

		// крип team1 идёт направо на постройки team2, и наоборот
		if (creep.team === 1) {
			if (!barracks2_destroyed && Math.abs(creep.x - BARRACKS2_X) < CREEP_HIT_RANGE) {
				dealBarracksDamage(2, CREEP_DAMAGE);
			} else if (barracks2_destroyed && Math.abs(creep.x - TOWN2_X) < CREEP_HIT_RANGE) {
				town2_hp = Math.max(0, town2_hp - CREEP_DAMAGE);
				broadcast({ type: "town_damage", town_id: 2, damage: CREEP_DAMAGE, new_hp: town2_hp });
				if (town2_hp <= 0) endGame(1);
			}
		} else {
			if (!barracks1_destroyed && Math.abs(creep.x - BARRACKS1_X) < CREEP_HIT_RANGE) {
				dealBarracksDamage(1, CREEP_DAMAGE);
			} else if (barracks1_destroyed && Math.abs(creep.x - TOWN1_X) < CREEP_HIT_RANGE) {
				town1_hp = Math.max(0, town1_hp - CREEP_DAMAGE);
				broadcast({ type: "town_damage", town_id: 1, damage: CREEP_DAMAGE, new_hp: town1_hp });
				if (town1_hp <= 0) endGame(2);
			}
		}
	}
}
