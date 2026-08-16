const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const players = new Map();
const state = {};
let countdownTimer = null, gameTimer = null, playerCheckTimer = null, creepTimer = null;

function resetState() {
  Object.assign(state, {
    status: 'lobby', countdown: 15, timer: 300, winner: 0,
    blueTowerHp: 1000, redTowerHp: 1000,
    blueBarracksHp: 100, redBarracksHp: 100,
    blueBarracksDestroyed: false, redBarracksDestroyed: false,
    creeps: [], nextCreepTeam: 1, nextCreepId: 1
  });
}
resetState();

const server = http.createServer((_, res) => res.end('WebSocket game server'));
const wss = new WebSocket.Server({ server });
server.listen(PORT, () => console.log(`Game server: ws://0.0.0.0:${PORT}`));

const open = ws => ws && ws.readyState === WebSocket.OPEN;
const send = (ws, message) => { if (open(ws)) ws.send(JSON.stringify(message)); };
function broadcast(message, exclude = null) {
  const json = JSON.stringify(message);
  wss.clients.forEach(ws => { if (ws !== exclude && open(ws)) ws.send(json); });
}
function spawn(team, respawn = false) { return { x: team === 1 ? -1500 : 2690, y: respawn ? 450 : 500 }; }
function playersObject() {
  return Object.fromEntries([...players].map(([id, p]) => [id, {
    nickname: p.nickname, character: p.character, x: p.x, y: p.y,
    flip: p.flip, team: p.team, hp: p.hp, isDead: p.isDead
  }]));
}
function sendPlayerList(ws) { send(ws, { type: 'players_list', players: playersObject() }); }
function broadcastPlayerList() { broadcast({ type: 'players_list', players: playersObject() }); }
function readyCount() { return [...players.values()].filter(p => p.inGame).length; }

wss.on('connection', ws => {
  ws.playerData = { id: '', nickname: 'Player', character: 1, x: 0, y: 500, flip: false, team: 0, hp: 100, isDead: false, inGame: false };
  ws.on('message', raw => {
    try { route(ws, JSON.parse(raw.toString())); }
    catch { send(ws, { type: 'error', message: 'Некорректный JSON' }); }
  });
  ws.on('close', () => disconnect(ws));
  ws.on('error', () => {});
});

function route(ws, data) {
  const handlers = {
    join, move, chat, level_ready, force_start,
    player_damage: playerDamage, town_damage: towerDamage,
    barracks_damage: barracksDamage, creep_damage: creepDamage,
    respawn: (_, data) => respawn(data.id)
  };
  if (data?.type === 'ping') return send(ws, { type: 'pong' });
  if (handlers[data?.type]) handlers[data.type](ws, data);
}

function join(ws, data) {
  const id = String(data.id || '');
  if (!id || players.has(id)) return send(ws, { type: 'error', message: id ? 'ID занят' : 'ID отсутствует' });
  const blue = [...players.values()].filter(p => p.team === 1).length;
  const team = blue <= players.size - blue ? 1 : 2;
  Object.assign(ws.playerData, { id, nickname: String(data.nickname || 'Player').slice(0, 32), character: Number(data.character) === 2 ? 2 : 1, team, ...spawn(team) });
  players.set(id, ws.playerData);
  const p = ws.playerData;
  send(ws, { type: 'join_success', id, team, x: p.x, y: p.y, character: p.character });
  sendPlayerList(ws);
  broadcast({ type: 'player_joined', id, nickname: p.nickname, character: p.character, x: p.x, y: p.y, flip: p.flip, team }, ws);
  broadcastPlayerList();
}

function level_ready(ws) {
  const p = players.get(ws.playerData.id);
  if (!p || state.status === 'playing') return;
  p.inGame = true;
  checkAllReady();
}
function move(ws, data) {
  const p = players.get(ws.playerData.id); if (!p || p.isDead) return;
  p.x = Number(data.x) || 0; p.y = Number(data.y) || 0; p.flip = !!data.flip;
  broadcast({ type: 'player_moved', id: p.id, x: p.x, y: p.y, flip: p.flip }, ws);
}
function chat(ws, data) {
  const p = players.get(ws.playerData.id); const message = String(data.message || '').trim();
  if (p && message) broadcast({ type: 'chat', sender: p.nickname, message: message.slice(0, 300) });
}

// Матч начинается только когда сервер получил level_ready от двух игроков.
function checkAllReady() {
  if (state.status === 'lobby' && players.size >= 2 && readyCount() >= 2) startCountdown();
}
function startCountdown() {
  if (countdownTimer || state.status === 'playing') return;
  state.status = 'countdown'; state.countdown = 15;
  broadcast({ type: 'countdown_start', time: state.countdown });
  countdownTimer = setInterval(() => {
    state.countdown--;
    broadcast({ type: 'countdown_update', time: state.countdown });
    if (state.countdown <= 0) { clearInterval(countdownTimer); countdownTimer = null; startGame(); }
  }, 1000);
}
function cancelCountdown() {
  if (!countdownTimer) return;
  clearInterval(countdownTimer); countdownTimer = null;
  state.status = 'lobby'; state.countdown = 15;
  broadcast({ type: 'countdown_cancel' });
}
function force_start(ws) {
  if (players.size < 2) return send(ws, { type: 'chat', sender: 'СИСТЕМА', message: 'Нужно минимум 2 игрока.' });
  players.forEach(p => p.inGame = true);
  startCountdown();
}

function startGame() {
  if (players.size < 2) return cancelCountdown();
  state.status = 'playing'; state.timer = 300;
  const data = playersObject();
  wss.clients.forEach(ws => {
    const p = players.get(ws.playerData?.id);
    if (p) send(ws, { type: 'init_game', players: data, my_team: p.team, town1_hp: state.blueTowerHp, town2_hp: state.redTowerHp, barracks1_hp: state.blueBarracksHp, barracks2_hp: state.redBarracksHp, barracks1_destroyed: state.blueBarracksDestroyed, barracks2_destroyed: state.redBarracksDestroyed });
  });
  broadcast({ type: 'start_game' });
  clearInterval(gameTimer); clearInterval(playerCheckTimer);
  gameTimer = setInterval(() => { if (--state.timer <= 0) endGame(0); }, 1000);
  playerCheckTimer = setInterval(checkPlayers, 3000);
  clearInterval(creepTimer);
  creepTimer = setInterval(spawnCreep, 5000); // Один крип каждые 5 секунд.
}

function spawnCreep() {
  if (state.status !== 'playing') return;
  const team = state.nextCreepTeam;
  state.nextCreepTeam = team === 1 ? 2 : 1;
  const creep = { id: `creep_${state.nextCreepId++}`, team, hp: 80, x: team === 1 ? -1400 : 2590, y: 450 };
  state.creeps.push(creep);
  broadcast({ type: 'creep_spawn', creep });
}

function playerDamage(_, data) {
  const p = players.get(String(data.target_id || '')); if (!p || p.isDead || state.status !== 'playing') return;
  p.hp = Math.max(0, p.hp - Math.max(0, Number(data.damage) || 10));
  broadcast({ type: 'player_damage', target_id: p.id, new_hp: p.hp });
  if (!p.hp) { p.isDead = true; setTimeout(() => respawn(p.id), 3000); }
}
function respawn(id) {
  const p = players.get(String(id || '')); if (!p || state.status !== 'playing') return;
  Object.assign(p, { hp: 100, isDead: false, ...spawn(p.team, true) });
  broadcast({ type: 'respawn', id: p.id, x: p.x, y: p.y, hp: p.hp });
}
function towerDamage(_, data) {
  if (state.status !== 'playing') return;
  const blue = Number(data.town_id) === 1, key = blue ? 'blueTowerHp' : 'redTowerHp';
  const damage = Math.max(0, Number(data.damage) || 10);
  state[key] = Math.max(0, state[key] - damage);
  broadcast({ type: 'tower_damage', town_id: blue ? 1 : 2, new_hp: state[key] });
  if (!state[key]) endGame(blue ? 2 : 1);
}
function barracksDamage(_, data) {
  if (state.status !== 'playing') return;
  const blue = Number(data.barracks_id) === 1, hpKey = blue ? 'blueBarracksHp' : 'redBarracksHp', deadKey = blue ? 'blueBarracksDestroyed' : 'redBarracksDestroyed';
  state[hpKey] = Math.max(0, state[hpKey] - Math.max(0, Number(data.damage) || 10));
  if (!state[hpKey] && !state[deadKey]) { state[deadKey] = true; broadcast({ type: 'barracks_destroyed', barracks_id: blue ? 1 : 2 }); }
  broadcast({ type: 'barracks_damage', barracks_id: blue ? 1 : 2, new_hp: state[hpKey] });
}
function creepDamage(_, data) {
  if (state.status !== 'playing') return;
  const creep = state.creeps.find(item => item.id === String(data.id || ''));
  if (!creep) return;
  creep.hp = Math.max(0, creep.hp - Math.max(0, Number(data.damage) || 10));
  broadcast({ type: 'creep_damage', id: creep.id, new_hp: creep.hp });
  if (!creep.hp) {
    state.creeps = state.creeps.filter(item => item !== creep);
    broadcast({ type: 'creep_destroy', id: creep.id });
  }
}

function checkPlayers() {
  if (state.status !== 'playing') return;
  if (players.size < 2) return endGame(players.size ? [...players.values()][0].team : 0);
  const teams = new Set([...players.values()].filter(p => !p.isDead).map(p => p.team));
  if (teams.size === 1) endGame([...teams][0]);
}
function endGame(winner) {
  if (state.status !== 'playing') return;
  state.status = 'finished'; state.winner = winner;
  clearInterval(gameTimer); clearInterval(playerCheckTimer); clearInterval(creepTimer);
  gameTimer = playerCheckTimer = creepTimer = null;
  const result = winner === 0 ? 'НИЧЬЯ!' : `ПОБЕДА КОМАНДЫ ${winner}!`;
  broadcast({ type: 'chat', sender: 'СИСТЕМА', message: result });
  broadcast({ type: 'game_over', winner_team: winner });
  broadcast({ type: 'game_end', winner }); // Совместимость с текущим Net.gd.
  setTimeout(resetGame, 5000);
}
function resetGame() {
  resetState();
  players.forEach(p => Object.assign(p, { inGame: false, hp: 100, isDead: false, ...spawn(p.team, true) }));
  broadcast({ type: 'reset_lobby' }); broadcastPlayerList();
}
function disconnect(ws) {
  const id = ws.playerData?.id; if (!id || !players.delete(id)) return;
  broadcast({ type: 'player_left', id }); broadcastPlayerList();
  // При уходе во время отсчёта и остатке менее 2 игроков отсчёт отменяется.
  if (state.status === 'countdown' && players.size < 2) cancelCountdown();
  if (state.status === 'playing') checkPlayers();
}
process.on('SIGINT', () => { clearInterval(countdownTimer); clearInterval(gameTimer); clearInterval(playerCheckTimer); clearInterval(creepTimer); process.exit(0); })
