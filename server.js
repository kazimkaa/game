const colyseus = require('colyseus');
const { Schema, type } = require('@colyseus/schema');
const express = require('express');
const http = require('http');

// Определяем состояние игрока (нужно для Colyseus)
class Player extends Schema {
    constructor(id, x, y, flip) {
        super();
        this.id = id;
        this.x = x;
        this.y = y;
        this.flip = flip;
    }
}
type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("boolean")(Player.prototype, "flip");

class GameRoom extends colyseus.Room {
    onCreate(options) {
        this.setState({ players: {} });
        console.log("Комната создана");
    }
    
    onJoin(client, options) {
        this.state.players[client.sessionId] = new Player(client.sessionId, 200, 200, false);
        console.log("Игрок подключился:", client.sessionId);
        
        // Отправляем новому игроку всех существующих
        const playersData = {};
        for (let id in this.state.players) {
            const p = this.state.players[id];
            playersData[id] = { x: p.x, y: p.y, flip: p.flip };
        }
        client.send("init", playersData);
        
        // Сообщаем всем о новом игроке
        this.broadcast("player_joined", {
            id: client.sessionId,
            x: 200,
            y: 200,
            flip: false
        }, { except: client });
    }
    
    onLeave(client, consented) {
        console.log("Игрок отключился:", client.sessionId);
        delete this.state.players[client.sessionId];
        this.broadcast("player_left", client.sessionId);
    }
    
    onMessage(client, message) {
        if (message.type === "move" && this.state.players[client.sessionId]) {
            this.state.players[client.sessionId].x = message.x;
            this.state.players[client.sessionId].y = message.y;
            this.state.players[client.sessionId].flip = message.flip;
            
            this.broadcast("player_moved", {
                id: client.sessionId,
                x: message.x,
                y: message.y,
                flip: message.flip
            });
        }
    }
}

const app = express();
const server = http.createServer(app);
const gameServer = new colyseus.Server({ server });
gameServer.define('game_room', GameRoom);

const PORT = process.env.PORT || 2567;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
