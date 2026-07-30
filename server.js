# В network.gd добавьте обработку ping/pong
func _process(delta):
    # Отправляем ping каждые 5 секунд
    if not _ping_timer:
        _ping_timer = 0
    _ping_timer += delta
    if _ping_timer >= 5.0:
        _ping_timer = 0
        if ws and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
            ws.send_text(JSON.stringify({ "type": "ping" }))

# Обработка сообщений
func _on_websocket_message():
    var msg = ws.get_text()
    var data = JSON.parse_string(msg)
    
    match data.type:
        "pong":
            # Сервер ответил на ping
            pass
        "players_list":
            # Обновить список игроков в лобби
            update_players_list(data.players)
        "player_left":
            # Удалить игрока из сцены
            remove_player(data.id)
        "reset_lobby":
            # Сброс лобби
            reset_lobby()
