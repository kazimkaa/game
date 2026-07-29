extends CharacterBody2D

const SPEED = 300.0
const JUMP_VELOCITY = -450.0
const GRAVITY = 980.0
const MAX_HP = 100
const RESPAWN_TIME = 5.0
const ATTACK_DAMAGE = 25
const ATTACK_RANGE = 200.0
const ATTACK_COOLDOWN = 0.8

var current_anim: AnimatedSprite2D = null
var is_local: bool = false
var player_id: String = ""
var player_nickname: String = ""
var is_spawning: bool = true
var flip_h: bool = false
var team: int = 0
var character_type: int = 1

var hp: int = MAX_HP
var is_dead: bool = false
var is_attacking: bool = false
var attack_cooldown: float = 0.0

var target_position: Vector2 = Vector2.ZERO
var is_moving_to_target: bool = false
var sync_speed: float = 15.0

var hp_bar: ProgressBar
var hp_label: Label
var respawn_label: Label
var touch_input = {"left": false, "right": false, "jump": false}
var original_modulate: Color = Color.WHITE

# ✅ СЛУЧАЙНЫЙ ЦВЕТ ДЛЯ ИГРОКА
var player_color: Color = Color.WHITE

var client = null

func setup(id: String, local: bool, nickname: String, anim_node: AnimatedSprite2D, net_client = null):
	client = net_client
	
	player_id = id
	is_local = local
	player_nickname = nickname
	current_anim = anim_node
	character_type = Global.selected_character if local else 1
	
	# ✅ ГЕНЕРИРУЕМ СЛУЧАЙНЫЙ ЦВЕТ
	player_color = Color(randf(), randf(), randf())
	
	if current_anim.get_parent() == self:
		remove_child(current_anim)
	add_child(current_anim)
	current_anim.position = Vector2(0, 0)
	original_modulate = current_anim.modulate
	
	# ✅ ПРИМЕНЯЕМ ЦВЕТ
	current_anim.modulate = player_color
	
	add_to_group("players")
	add_to_group("enemies")
	
	current_anim.visible = true
	if current_anim.sprite_frames.has_animation("spawn"):
		current_anim.play("spawn")
		await current_anim.animation_finished
	current_anim.play("idle")
	
	is_spawning = false
	_create_ui(nickname)
	
	if is_local:
		var camera = Camera2D.new()
		camera.enabled = true
		camera.zoom = Vector2(1, 1)
		add_child(camera)

func _update_team_color():
	# ✅ УБРАНО — больше не меняем цвет по команде
	pass

func _create_ui(nickname):
	var ui_container = VBoxContainer.new()
	ui_container.position = Vector2(-50, -100)
	ui_container.custom_minimum_size = Vector2(100, 40)
	add_child(ui_container)
	
	# ✅ НИКНЕЙМ РУССКИЙ И ЦВЕТНОЙ
	var label = Label.new()
	label.text = nickname
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_color_override("font_color", player_color)  # ✅ ЦВЕТНОЙ НИК
	ui_container.add_child(label)
	
	hp_bar = ProgressBar.new()
	hp_bar.max_value = MAX_HP
	hp_bar.value = hp
	hp_bar.custom_minimum_size = Vector2(100, 10)
	hp_bar.show_percentage = false
	ui_container.add_child(hp_bar)
	
	hp_label = Label.new()
	hp_label.text = str(hp) + "/" + str(MAX_HP)
	hp_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hp_label.add_theme_font_size_override("font_size", 12)
	ui_container.add_child(hp_label)
	
	respawn_label = Label.new()
	respawn_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	respawn_label.add_theme_font_size_override("font_size", 16)
	respawn_label.modulate = Color.YELLOW
	respawn_label.visible = false
	ui_container.add_child(respawn_label)

func update_hp_from_server(new_hp: int):
	hp = clamp(new_hp, 0, MAX_HP)
	_update_ui()
	if hp <= 0:
		die()

func _update_ui():
	if hp_bar:
		hp_bar.value = hp
		var p = float(hp) / MAX_HP
		hp_bar.modulate = Color.GREEN if p > 0.5 else (Color.YELLOW if p > 0.25 else Color.RED)
	if hp_label:
		hp_label.text = str(hp) + "/" + str(MAX_HP)

func die():
	if is_dead:
		return
	is_dead = true
	set_physics_process(false)
	velocity = Vector2.ZERO
	collision_layer = 0
	collision_mask = 0
	visible = false
	
	if is_local:
		_start_respawn_countdown()

func _start_respawn_countdown():
	if hp_bar: hp_bar.visible = false
	if hp_label: hp_label.visible = false
	if respawn_label: respawn_label.visible = true
	
	var timer = RESPAWN_TIME
	while timer > 0:
		if respawn_label:
			respawn_label.text = "Воскрешение через: " + str(int(ceil(timer)))
		await get_tree().create_timer(1.0).timeout
		timer -= 1.0
	_respawn()

func _respawn():
	is_dead = false
	hp = MAX_HP
	is_spawning = true
	
	var spawn_pos = Vector2(300, 450) if team == 1 else Vector2(1600, 450)
	global_position = spawn_pos
	visible = true
	collision_layer = 1
	collision_mask = 1
	
	if hp_bar:
		hp_bar.visible = true
		hp_bar.value = MAX_HP
	if hp_label:
		hp_label.visible = true
		hp_label.text = str(MAX_HP) + "/" + str(MAX_HP)
	if respawn_label:
		respawn_label.visible = false
	
	if current_anim and is_instance_valid(current_anim):
		remove_child(current_anim)
		current_anim.queue_free()
		current_anim = null
	
	var anim_path = "res://player_1.tscn" if character_type == 1 else "res://player_2.tscn"
	var new_anim = load(anim_path)
	if new_anim:
		current_anim = new_anim.instantiate()
		current_anim.position = Vector2.ZERO
		add_child(current_anim)
		current_anim.visible = true
		if current_anim.sprite_frames.has_animation("idle"):
			current_anim.play("idle")
	
	set_physics_process(true)
	is_spawning = false
	
	if is_local and client:
		client.send_respawn()

func _physics_process(delta):
	if is_dead or is_spawning:
		return
	
	if is_local:
		_local_physics(delta)
	else:
		_remote_physics(delta)

func _local_physics(delta):
	_handle_local_input()
	
	if not is_on_floor():
		velocity.y += GRAVITY * delta
	else:
		velocity.y = 0
	
	if is_on_floor() and touch_input["jump"]:
		velocity.y = JUMP_VELOCITY
		touch_input["jump"] = false
	
	if attack_cooldown > 0:
		attack_cooldown -= delta
	
	if abs(velocity.x) > 10:
		if not is_attacking and current_anim and is_instance_valid(current_anim):
			current_anim.play("run")
			current_anim.flip_h = velocity.x < 0
			flip_h = current_anim.flip_h
	else:
		if not is_attacking and current_anim and is_instance_valid(current_anim):
			current_anim.play("idle")
	
	move_and_slide()
	
	Global.player_position = global_position
	Global.player_flip = flip_h
	
	if client:
		client.send_move(global_position.x, global_position.y, flip_h)

func _handle_local_input():
	if Input.is_action_just_pressed("attack") and attack_cooldown <= 0:
		attack()
		attack_cooldown = ATTACK_COOLDOWN
	
	var dir = 0
	if Input.is_action_pressed("move_left") or touch_input["left"]:
		dir = -1
	elif Input.is_action_pressed("move_right") or touch_input["right"]:
		dir = 1
	
	if not is_attacking:
		velocity.x = dir * SPEED
	else:
		velocity.x = move_toward(velocity.x, 0, SPEED)

func _remote_physics(delta):
	if is_moving_to_target:
		global_position = global_position.lerp(target_position, sync_speed * delta)
		if global_position.distance_to(target_position) < 2.0:
			global_position = target_position
			is_moving_to_target = false

func attack():
	if is_attacking or is_dead or is_spawning:
		return
	is_attacking = true
	velocity.x = 0
	
	if current_anim and current_anim.sprite_frames.has_animation("attack"):
		current_anim.play("attack")
		await current_anim.animation_finished
		current_anim.play("idle")
	
	is_attacking = false
	_check_hits()

func _check_hits():
	var targets = get_tree().get_nodes_in_group("players") + get_tree().get_nodes_in_group("enemies")
	for other in targets:
		if other == self or not is_instance_valid(other):
			continue
		if other.is_in_group("players"):
			if other.team == self.team or other.is_dead:
				continue
			if global_position.distance_to(other.global_position) <= ATTACK_RANGE:
				if client:
					client.send_player_damage(other.player_id, ATTACK_DAMAGE)
		elif other.is_in_group("enemies"):
			if other.team == self.team:
				continue
			if global_position.distance_to(other.global_position) <= ATTACK_RANGE:
				var town_id = 1 if other.name.contains("1") else 2
				if client:
					client.send_town_damage(town_id, ATTACK_DAMAGE)

func update_flip(f):
	flip_h = f
	if current_anim:
		current_anim.flip_h = f

func set_touch_input(action, value):
	if is_local:
		touch_input[action] = value
