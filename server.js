const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const players = new Map();
const state = { status: 'lobby', timer: 300, blueTowerHp: 100, redTowerHp: 100, blueBarracksHp: 100, redBarracksHp: 100, blueBarracksDestroyed: false, redBarracksDestroyed: false };
let gameTimer, playerCheck;
const spawn = team => ({ x: team === 1 ? -1500 : 2690, y: 500 });

const server = http.createServer((_, res) => res.end('WebSocket server is running'));
const wss = new WebSocket.Server({ server });
server.listen(PORT, () => console.log(`WebSocket: ws://localhost:${PORT}`));

const send = (ws, msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
const broadcast = (msg, exclude) => {
  const json = JSON.stringify(msg);
  wss.clients.forEach(ws => ws !== exclude && ws.readyState === WebSocket.OPEN && ws.send(json));
};
const playerList = () => Object.fromEntries([...players].map(([id, p]) => [id, {
  nickname: p.nickname, character: p.character, x: p.x, y: p.y, flip: p.flip, team: p.team, hp: p.hp, isDead: p.isDead
}]));
const broadcastList = () => broadcast({ type: 'players_list', players: playerList() });

wss.on('connection', ws => {
  ws.playerData = { id: null, nickname: 'Player', character: 1, x: 0, y: 500, flip: false, team: 0, hp: 100, isDead: false };
  ws.on('message', raw => {
    try { handle(ws, JSON.parse(raw)); } catch { send(ws, { type: 'error', message: 'Некорректный JSON' }); }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', console.error);
});

function handle(ws, data) {
  const handlers = { join, move, chat, player_damage: damagePlayer, town_damage: damageTower, barracks_damage: damageBarracks, creep_damage: creepDamage, respawn: (_, d) => respawn(d.id), force_start: startGame };
  if (data.type === 'ping') return send(ws, { type: 'pong' });
  handlers[data.type]?.(ws, data);
}

function join(ws, data) {
  const id = String(data.id || '');
  if (!id || players.has(id)) return send(ws, { type: 'error', message: !id ? 'ID отсутствует' : 'ID занят' });
  const blue = [...players.values()].filter(p => p.team === 1).length;
  const red = players.size - blue;
  const team = blue <= red ? 1 : 2;
  Object.assign(ws.playerData, { id, nickname: data.nickname || 'Player', character: Number(data.character) || 1, team, ...spawn(team) });
  players.set(id, ws.playerData);
  const p = ws.playerData;
  send(ws, { type: 'join_success', id, team, x: p.x, y: p.y, character: p.character });
  send(ws, { type: 'players_list', players: playerList() });
  broadcast({ type: 'player_joined', id, nickname: p.nickname, character: p.character, x: p.x, y: p.y, flip: false, team }, ws);
  broadcastList();

  // Без ожидания level_ready и countdown: персонажи появляются сразу.
  if (players.size >= 2 && state.status !== 'playing') startGame();
}

function move(ws, d) {
  const p = players.get(ws.playerData.id);
  if (!p) return;
  Object.assign(p, { x: Number(d.x) || 0, y: Number(d.y) || 0, flip: !!d.flip });
  broadcast({ type: 'player_moved', id: p.id, x: p.x, y: p.y, flip: p.flip }, ws);
}
function chat(ws, d) { if (d.message) broadcast({ type: 'chat', sender: ws.playerData.nickname, message: d.message }); }
function damagePlayer(_, d) {
  const p = players.get(d.target_id); if (!p) return;
  p.hp = Math.max(0, p.hp - (Number(d.damage) || 10));
  if (!p.hp) { p.isDead = true; setTimeout(() => respawn(p.id), 3000); }
  broadcast({ type: 'player_damage', target_id: p.id, new_hp: p.hp });
}
function respawn(id) {
  const p = players.get(id); if (!p) return;
  Object.assign(p, { hp: 100, isDead: false, ...spawn(p.team), y: 450 });
  broadcast({ type: 'respawn', id, x: p.x, y: p.y, hp: p.hp });
}
function damageTower(_, d) {
  const blue = Number(d.town_id) === 1, key = blue ? 'blueTowerHp' : 'redTowerHp';
  state[key] = Math.max(0, state[key] - (Number(d.damage) || 10));
  broadcast({ type: 'town_damage', town_id: blue ? 1 : 2, damage: Number(d.damage) || 10, new_hp: state[key] });
  if (!state[key]) endGame(blue ? 2 : 1);
}
function damageBarracks(_, d) {
  const blue = Number(d.barracks_id) === 1, hp = blue ? 'blueBarracksHp' : 'redBarracksHp', destroyed = blue ? 'blueBarracksDestroyed' : 'redBarracksDestroyed';
  state[hp] = Math.max(0, state[hp] - (Number(d.damage) || 10));
  if (!state[hp] && !state[destroyed]) { state[destroyed] = true; broadcast({ type: 'barracks_destroyed', barracks_id: blue ? 1 : 2 }); }
  broadcast({ type: 'barracks_damage', barracks_id: blue ? 1 : 2, new_hp: state[hp] });
}
function creepDamage(_, d) { broadcast({ type: 'creep_damage', id: d.id, new_hp: d.new_hp }); }

function startGame() {
  if (state.status === 'playing' || players.size < 2) return;
  state.status = 'playing'; state.timer = 300;
  const playersData = playerList();
  wss.clients.forEach(ws => {
    const p = players.get(ws.playerData?.id); if (p) send(ws, { type: 'init_game', players: playersData, my_team: p.team, town1_hp: state.blueTowerHp, town2_hp: state.redTowerHp, barracks1_hp: state.blueBarracksHp, barracks2_hp: state.redBarracksHp, barracks1_destroyed: state.blueBarracksDestroyed, barracks2_destroyed: state.redBarracksDestroyed });
  });
  broadcast({ type: 'start_game' });
  clearInterval(gameTimer); clearInterval(playerCheck);
  gameTimer = setInterval(() => --state.timer <= 0 && endGame(0), 1000);
  playerCheck = setInterval(checkPlayers, 3000);
}
function checkPlayers() {
  if (state.status !== 'playing') return;
  const alive = [...players.values()].filter(p => !p.isDead), teams = new Set(alive.map(p => p.team));
  if (players.size < 2) endGame(players.size ? [...players.values()][0].team : 0);
  else if (teams.size === 1) endGame([...teams][0]);
}
function endGame(winner) {
  if (state.status !== 'playing') return;
  state.status = 'finished'; clearInterval(gameTimer); clearInterval(playerCheck);
  broadcast({ type: 'game_over', winner_team: winner });
  setTimeout(reset, 5000);
}
function reset() {
  Object.assign(state, { status: 'lobby', timer: 300, blueTowerHp: 100, redTowerHp: 100, blueBarracksHp: 100, redBarracksHp: 100, blueBarracksDestroyed: false, redBarracksDestroyed: false });
  players.forEach(p => Object.assign(p, { hp: 100, isDead: false, ...spawn(p.team), y: 450 }));
  broadcast({ type: 'reset_lobby' }); broadcastList();
}
function leave(ws) {
  const { id } = ws.playerData; if (!id || !players.delete(id)) return;
  broadcast({ type: 'player_left', id }); broadcastList(); checkPlayers();
}
