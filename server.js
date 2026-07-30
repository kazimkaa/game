// server.js — сервер для Godot-клиента
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

// ================== КОНСТАНТЫ ==================
const PORT = process.env.PORT || 3000;

const MIN_PLAYERS_TO_START = 2;
const COUNTDOWN_SECONDS = 15;

const TOWN_MAX_HP = 1000;
const BARRACKS_MAX_HP = 500;

const TEAM1_SPAWN = { x: 300, y: 450 };
const TEAM2_SPAWN = { x: 1600, y: 450 };

const TOWN1_X = 200;
const TOWN2_X = 1700;
const BARRACKS1_X = 500;
const BARRACKS2_X = 1400;

const CREEP_MAX_HP = 80;
const CREEP_SPEED = 40;
const CREEP_SPAWN_INTERVAL_MS = 15000;
const CREEP_DAMAGE = 10;
const CREEP_HIT_RANGE = 40;
const TICK_MS = 100;

const PING_INTERVAL_MS = 10000;
const DISCONNECT_TIMEOUT_MS = 5000;

// ================== СОСТОЯНИЕ ==================
const players = new Map();
const creeps = new Map();
let nextCreepId = 1;

let matchState = "lobby"; // lobby | countdown | playing | finished
let countdownValue = 0;
let countdownInterval = null;
let creepSpawnInterval = null;
let gameTickInterval = null;
let pingInterval = null;

let town1_hp = TOWN_MAX_HP;
let town2_hp = TOWN_MAX_HP;
let barracks1_hp = BARRACKS_MAX_HP;
let barracks2_hp = BARRACKS_MAX_HP;
let barracks1_destroyed = false;
let barracks2_destroyed = false;

// ================== HTTP + WS ==================
const httpServer = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("Game server is running\n");
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
	console.log(`[SERVER] Listening on port ${PORT}`);
	startPingLoop();
});

wss.on("connection", (ws) => {
	console.log("[SERVER] New connection");
	ws.playerId = null;
	ws.isAlive = true;
	ws.disconnectTimer = null;

	ws.on("pong", () => {
		ws.isAlive = true;
		if (ws.disconnectTimer) {
			clearTimeout(ws.disconnectTimer);
			ws.disconnectTimer = null;
			console.log("[SERVER] Player reconnected:", ws.playerId);
		}
	});

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
		console.log("[SERVER] Connection closed for:", ws.playerId);
		if (ws.playerId) {
			ws.disconnectTimer = setTimeout(() => {
				console.log("[SERVER] Player timed out, removing:", ws.playerId);
				removePlayer(ws.playerId);
			}, DISCONNECT_TIMEOUT_MS);
		}
	});

	ws.on("error", (err) => {
		console.log("[SERVER] Socket error:", err.message);
		removePlayer(ws.playerId);
	});
});

// ================== ПИНГ ==================
function startPingLoop() {
	if (pingInterval) return;
	pingInterval = setInterval(() => {
		for (const [id, p] of players) {
			try {
				if (!p.ws.isAlive) {
					console.log("[SERVER] Dead connection detected:", id);
					p.ws.terminate();
					removePlayer(id);
					continue;
				}
				p.ws.isAlive = false;
				p.ws.ping();
			} catch (e) {
				console.log("[SERVER] Ping error for", id, e.message);
			}
		}
	}, PING_INTERVAL_MS);
}

// ================== УДАЛЕНИЕ ИГРОКА ==================
function removePlayer(id) {
	if (!id) return;
	if (!players.has(id)) return;

	const player = players.get(id);
	console.log(`[SERVER] Player removed: player.nickname({player.nickname} (player.nickname({id})`);

	if (player.ws && player.ws.disconnectTimer) {
		clearTimeout(player.ws.disconnectTimer);
		player.ws.disconnectTimer = null;
	}

	players.delete(id);
	broadcast({
		type: "player_left",
		id: id,
		nickname: player.nickname
	});

	broadcast({
		type: "players_list",
		players: getPlayersList()
	});

	maybeCancelCountdown();

	if (players.size === 0) {
		resetToLobby();
	}
}

// ================== ВСПОМОГАТЕЛЬНЫЕ ==================
function send(ws, data) {
	try {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(data));
		} else {
			console.log("[SERVER] send skipped, socket not open:", data.type);
		}
	} catch (e) {
		console.error("[SERVER] send error:", e);
	}
}

function broadcast(data, exceptWs = null) {
	for (const p of players.values()) {
		if (p.ws !== exceptWs) send(p.ws, data);
	}
}

function getPlayersList() {
	const list = {};
	for (const [id, p] of players) {
		list[id] = {
			id: p.id,
			nickname: p.nickname,
			character: p.character,
			team: p.team,
			hp: p.hp,
			is_dead: p.is_dead,
			x: p.x,
			y: p.y,
			flip: p.flip
		};
	}
	return list;
}

function assignTeam() {
	let t1 = 0, t2 = 0;
	for (const p of players.values()) {
		if (p.team === 1) t1++;
		else if (p.team === 2) t2++;
	}

	if (t1 === 0 && t2 > 0) return 1;
	if (t2 === 0 && t1 > 0) return 2;
	if (t1 < t2) return 1;
	if (t2 < t1) return 2;
	return 1;
}

function publicPlayersDict(excludeId = null) {
	const dict = {};
	for (const [id, p] of players) {
		if (id === excludeId) continue;
		dict[id] = {
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
	switch (data.type) {
		case "join": handleJoin(ws, data); break;
		case "move": handleMove(ws, data); break;
		case "chat": handleChat(ws, data); break;
		case "level_ready": handleLevelReady(ws, data); break;
		case "town_damage": handleTownDamage(ws, data); break;
		case "barracks_damage": handleBarracksDamage(ws, data); break;
		case "player_damage": handlePlayerDamage(ws, data); break;
		case "creep_damage": handleCreepDamage(ws, data); break;
		case "respawn": handleRespawn(ws, data); break;
		case "ping": handlePing(ws, data); break;
		default: console.log("[SERVER] Unknown message type:", data.type);
	}
}

// ================== ОБРАБОТЧИКИ ==================
function handleJoin(ws, data) {
	const id = data.id;
	if (!id) return;

	if (players.has(id)) {
		console.log("[SERVER] Reconnect detected for:", id);
		const old = players.get(id);
		if (old.ws !== ws) {
			old.ws.terminate();
		}
		players.delete(id);
	}

	if (matchState === "playing" || matchState === "finished") {
		send(ws, {
			type: "system_message",
			message: "Игра уже идёт, подождите следующего матча."
		});
		return;
	}

	ws.playerId = id;
	ws.isAlive = true;
	if (ws.disconnectTimer) {
		clearTimeout(ws.disconnectTimer);
		ws.disconnectTimer = null;
	}

	const team = assignTeam();
	const player = {
		id,
		ws,
		nickname: data.nickname || "Player",
		character: data.character || 1,
		x: data.x || 0,
		y: data.y || 0,
		flip: false,
		team: team,
		hp: 100,
		is_dead: false
	};
	players.set(id, player);

	console.log(`[SERVER] player.nicknamejoinedas{player.nickname} joined asplayer.nicknamejoinedas{id}, team player.team.Total:{player.team}. Total:player.team.Total:{players.size}`);

	send(ws, {
		type: "init",
		players: publicPlayersDict(id),
		my_team: player.team
	});

	broadcast({
		type
