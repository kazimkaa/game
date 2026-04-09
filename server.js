const colyseus = require('colyseus');
const express = require('express');
const http = require('http');

class GameRoom extends colyseus.Room {
    onCreate(options) {
        this.setState({ players: {} });
        console.log("Комната создана");
    }
    
    onJoin(client, options) {
        this.state.players[client.sessionId] = {
            id: client.sessionId,
            x: 200,
            y: 200,
            flip: false
        };
        console.log("Игрок подключился:", client.sessionId);
        client.send("init", this.state.players);
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
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
