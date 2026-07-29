extends Node

const SERVER_URL = "wss://game-2-slja.onrender.com/"

var socket := WebSocketPeer.new()
var connected := false
var my_session_id := ""
var last_state := -1
var join_sent := false

var reconnect_timer := 0.0
const RECONNECT_DELAY := 5.0
var is_reconnecting := false

# --- СИГНАЛЫ ---
signal connection_changed(status, message)
signal init_players(players_data)
signal init_game_players(players_data, my_team, town1_hp, town2_hp, creeps_data)
signal player_joined(id, x, y, flip, nickname, character)
signal player_moved(id, x, y, flip)
signal player_left(id)
signal system_message_received(message)
signal chat_message_received(sender_name, message)
signal countdown_start(time)
signal countdown_update(time)
signal countdown_cancel()
signal start_game
signal town_damage(town_id, damage, new_hp)
signal player_damage_received(target_id, new_hp)
signal player_respawned(id, x, y, hp)
signal game_over(winner)
signal game_timer_update(time_left)
signal room_reset

# BARRACKS SIGNALS
signal barracks_damage_received(barracks_id, new_hp)
signal barracks_destroyed(barracks_id)

# CREEP SIGNALS
signal creep_spawned(id, team, x, y, hp)
signal creep_damaged(id, new_hp)
signal creep_destroyed(id)

func _ready():
	print("[NET] Starting network connection...")
	connect_to_server()

func _log(msg):
	print("[NET] ", msg)

func connect_to_server():
	is_reconnecting = false
	connected = false
	print("[NET] Attempting to connect to: ", SERVER_URL)
	if socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		socket.close()
	var err = socket.connect_to_url(SERVER_URL)
	if err != OK:
		print("[NET] Socket connection error: ", err)
		_on_connection_failed("Ошибка сокета: " + str(err))
	else:
		print("[NET] Connection attempt initiated")
		connection_changed.emit("connecting", "Подключение...")

func disconnect_from_server():
	socket.close()
	connected = false
	last_state = -1
	my_session_id = ""

func _on_connection_failed(reason):
	connected = false
	is_reconnecting = true
	reconnect_timer = RECONNECT_DELAY
	print("[NET] Connection failed: ", reason)

func join():
	print("NET: join() called, socket state: ", socket.get_ready_state())
	if socket.get_ready_state() != WebSocketPeer.STATE_OPEN: 
		print("NET: Socket not open, cannot join")
		return
	connected = true
	if my_session_id == "":
		my_session_id = "player_" + str(Time.get_ticks_msec()) + "_" + str(randi())
	print("NET: Sending join message for ", my_session_id, " nickname: ", Global.player_nickname)
	_send({
		"type": "join",
		"id": my_session_id,
		"nickname": Global.player_nickname,
		"character": Global.selected_character,
		"x": 500, "y": 300
	})
	connection_changed.emit("connected", "OK")

func _process(delta):
	socket.poll()
	var state = socket.get_ready_state()
	if state != last_state:
		print("NET: Socket state changed from ", last_state, " to ", state)
		if state == WebSocketPeer.STATE_OPEN: 
			print("NET: Socket opened, calling join()")
			join()
		elif state == WebSocketPeer.STATE_CLOSED and last_state != -1:
			print("NET: Socket closed")
			_on_connection_failed("Connection lost")
		last_state = state
	
	if state == WebSocketPeer.STATE_OPEN and not connected and my_session_id == "":
		print("NET: Socket open but not joined, forcing join()")
		join()

	if is_reconnecting:
		reconnect_timer -= delta
		if reconnect_timer <= 0: connect_to_server()

	while socket.get_available_packet_count() > 0:
		var packet = socket.get_packet().get_string_from_utf8()
		var data = JSON.parse_string(packet)
		if data: _handle(data)

func _send(data: Dictionary):
	var json_data = JSON.stringify(data)
	_debug("SENDING: " + json_data)
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(json_data)

# --- ОТПРАВКА ---
func send_join():
	if join_sent:
		_debug("Join already sent, skipping")
		return
		
	if my_session_id == "":
		my_session_id = "player_" + str(Time.get_ticks_msec()) + "_" + str(randi())
	_debug("Generated session ID: " + my_session_id)
	
	_debug("Sending join message for " + my_session_id)
	join_sent = true
	_send({
		"type": "join",
		"id": my_session_id,
		"nickname": Global.player_nickname,
		"character": Global.selected_character,
		"x": 500, "y": 300
	})

func send_move(x, y, flip):
	_send({"type": "move", "x": x, "y": y, "flip": flip})

func send_chat(msg: String):
	_send({"type": "chat", "nickname": Global.player_nickname, "message": msg})

func send_level_ready():
	_send({"type": "level_ready"})

func send_town_damage(town_id: int, damage: int):
	_send({"type": "town_damage", "town_id": town_id, "damage": damage})

func send_barracks_damage(barracks_id: int, damage: int):
	print("NET: Sending barracks damage - barracks_id: ", barracks_id, ", damage: ", damage)
	_send({"type": "barracks_damage", "barracks_id": barracks_id, "damage": damage})

func send_barracks_destroyed(barracks_id: int):
	print("NET: Sending barracks destroyed - barracks_id: ", barracks_id)
	_send({"type": "barracks_destroyed_client", "barracks_id": barracks_id})

func send_player_damage(target_id: String, damage: int):
	_send({"type": "player_damage", "target_id": target_id, "damage": damage})

func send_creep_damage(creep_id: String, damage: int):
	_send({"type": "creep_damage", "creep_id": creep_id, "damage": damage})

func send_respawn():
	_send({"type": "respawn"})

# --- LOCAL DEBUG ---
func _debug(msg: String):
	print("[DEBUG] " + msg)

# --- PROCESSING ---
func _handle(data: Dictionary):
	var t = data.get("type", "")
	_debug("HANDLING MESSAGE TYPE: " + t)
	match t:
		"init":
			_debug("Received init with " + str(data.get("players", {}).size()) + " players")
			init_players.emit(data.get("players", {}))
		"player_joined":
			if data.get("id", "") != my_session_id:
				print("NET: Player joined: ", data.get("nickname",""))
				player_joined.emit(data.get("id",""), data.get("x",0), data.get("y",0), data.get("flip",false), data.get("nickname",""), data.get("character",1))
		"player_moved":
			if data.get("id", "") != my_session_id:
				player_moved.emit(
					data.get("id",""), 
					data.get("x",0), 
					data.get("y",0), 
					data.get("flip",false)
				)
		"player_left":
			player_left.emit(data.get("id", ""))
		"chat":
			chat_message_received.emit(data.get("nickname",""), data.get("message",""))
		"start_game":
			start_game.emit()
		"countdown_start":
			countdown_start.emit(data.get("time", 0))
		"countdown_update":
			countdown_update.emit(data.get("time", 0))
		"countdown_cancel":
			countdown_cancel.emit()
		"init_game":
			# Новый формат от сервера
			init_game_players.emit(
				data.get("players",{}), 
				int(data.get("my_team",0)), 
				int(data.get("town1_hp",0)), 
				int(data.get("town2_hp",0)),
				data.get("creeps",{})
			)
		"town_damage":
			town_damage.emit(int(data.get("town_id",0)), int(data.get("damage",0)), int(data.get("new_hp",0)))
		"barracks_damage":
			barracks_damage_received.emit(str(data.get("barracks_id",0)), int(data.get("new_hp",0)))
		"barracks_destroyed":
			barracks_destroyed.emit(int(data.get("barracks_id",0)))
		"player_damage":
			var tid = data.get("target_id", "")
			var nhp = data.get("new_hp", null)
			if tid != "" and nhp != null:
				player_damage_received.emit(tid, int(nhp))
		"respawn":
			var respawn_id = data.get("id", "")
			var respawn_x = data.get("x", 0)
			var respawn_y = data.get("y", 0)
			var respawn_hp = data.get("hp", 150)
			player_respawned.emit(respawn_id, respawn_x, respawn_y, respawn_hp)
			print("NET: Respawn signal emitted for ", respawn_id, " HP: ", respawn_hp)
		"game_over":
			game_over.emit(data.get("winner", 0))
		"game_timer_update":
			game_timer_update.emit(data.get("time_left", 0))
		"room_reset":
			room_reset.emit()
		"creep_spawn":
			creep_spawned.emit(data.get("id"), int(data.get("team")), data.get("x"), data.get("y"), int(data.get("hp")))
		"creep_move":
			print("NET: Creep move - id: ", data.get("id"), " x: ", data.get("x"), " y: ", data.get("y"))
		"creep_damage":
			creep_damaged.emit(data.get("id"), int(data.get("new_hp")))
		"creep_destroy":
			creep_destroyed.emit(data.get("id"))
		_:
			_log("Неизвестный тип: " + t)
