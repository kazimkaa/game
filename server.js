// server.js
// WebSocket сервер для Godot MOBA игры

const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");


// ================== CONFIG ==================

const PORT = process.env.PORT || 3000;

const MIN_PLAYERS_TO_START = 2;
const COUNTDOWN_SECONDS = 15;

const TICK_RATE = 100;

const PLAYER_HP = 100;

const TOWN_HP = 1000;
const BARRACKS_HP = 500;

const CREEP_HP = 80;
const CREEP_SPEED = 40;
const CREEP_DAMAGE = 10;

const PLAYER_DAMAGE = 20;

const ATTACK_RANGE = 60;


// ================== MAP ==================

const TEAM1_SPAWN = {
    x:300,
    y:450
};

const TEAM2_SPAWN = {
    x:1600,
    y:450
};


const TOWN = {
    1:{
        x:200,
        hp:TOWN_HP
    },

    2:{
        x:1700,
        hp:TOWN_HP
    }
};


const BARRACKS = {

    1:{
        x:500,
        hp:BARRACKS_HP,
        destroyed:false
    },

    2:{
        x:1400,
        hp:BARRACKS_HP,
        destroyed:false
    }

};


// ================== STATE ==================

const players = new Map();

const creeps = new Map();

let nextCreepId = 1;


let gameState = "lobby";

let countdownTimer = null;

let gameTickTimer = null;

let creepSpawnTimer = null;


// ================== SERVER ==================

const server = http.createServer((req,res)=>{

    res.writeHead(200,{
        "Content-Type":"text/plain"
    });

    res.end(
        "Godot game server running"
    );

});


const wss = new WebSocketServer({
    server
});


server.listen(PORT,()=>{

    console.log(
        "[SERVER] Started on",
        PORT
    );

});



// ================== NETWORK ==================

function send(ws,data){

    if(!ws)
        return;


    if(ws.readyState === WebSocket.OPEN){

        ws.send(
            JSON.stringify(data)
        );

    }

}



function broadcast(data,except=null){

    for(const p of players.values()){

        if(p.ws!==except){

            send(
                p.ws,
                data
            );

        }

    }

}



// ================== PLAYERS ==================

function getPlayers(){

    let result={};


    for(const [id,p] of players){

        result[id]={

            id:p.id,

            nickname:p.nickname,

            character:p.character,

            team:p.team,

            hp:p.hp,

            x:p.x,

            y:p.y,

            flip:p.flip,

            dead:p.dead

        };

    }


    return result;

}



function assignTeam(){

    let t1=0;
    let t2=0;


    for(const p of players.values()){

        if(p.team===1)
            t1++;

        if(p.team===2)
            t2++;

    }


    if(t1<=t2)
        return 1;


    return 2;

}



function spawnPosition(team){

    if(team===1)
        return TEAM1_SPAWN;


    return TEAM2_SPAWN;

}// ================== CONNECTION ==================

wss.on("connection",(ws)=>{


    console.log("[SERVER] New player connected");


    ws.playerId=null;


    ws.on("message",(raw)=>{


        let data;


        try{

            data=JSON.parse(
                raw.toString()
            );

        }
        catch(e){

            console.log(
                "[SERVER] Bad JSON"
            );

            return;

        }



        handleMessage(
            ws,
            data
        );


    });



    ws.on("close",()=>{


        if(!ws.playerId)
            return;



        console.log(
            "[SERVER] Player disconnected:",
            ws.playerId
        );



        players.delete(
            ws.playerId
        );



        broadcast({

            type:"player_left",

            id:ws.playerId

        });



        broadcast({

            type:"players_list",

            players:getPlayers()

        });



        checkCancelCountdown();


    });



    ws.on("error",(err)=>{

        console.log(
            "[SERVER] Socket error",
            err.message
        );

    });


});




// ================== MESSAGE HANDLER ==================

function handleMessage(ws,data){


    switch(data.type){


        case "join":

            joinPlayer(
                ws,
                data
            );

        break;



        case "move":

            movePlayer(
                ws,
                data
            );

        break;



        case "ping":

            send(ws,{
                type:"pong"
            });

        break;



        case "level_ready":

            levelReady(
                ws,
                data
            );

        break;



        case "player_damage":

            playerDamage(
                data
            );

        break;



        case "town_damage":

            townDamage(
                data
            );

        break;



        case "barracks_damage":

            barracksDamage(
                data
            );

        break;



        default:

            console.log(
                "[SERVER] Unknown:",
                data.type
            );

    }


}





// ================== JOIN ==================

function joinPlayer(ws,data){


    if(!data.id)
        return;



    if(players.has(data.id)){


        console.log(
            "[SERVER] Reconnect:",
            data.id
        );


        players.delete(
            data.id
        );


    }



    if(gameState==="playing"){


        send(ws,{

            type:"system_message",

            message:"Game already started"

        });


        return;

    }



    const team =
        assignTeam();



    const pos =
        spawnPosition(team);



    const player={


        id:data.id,


        ws:ws,


        nickname:
            data.nickname ||
            "Player",


        character:
            data.character ||
            1,


        team:team,


        x:pos.x,


        y:pos.y,


        flip:false,


        hp:PLAYER_HP,


        dead:false


    };



    players.set(
        player.id,
        player
    );


    ws.playerId=
        player.id;



    console.log(
        "[SERVER] Player joined:",
        player.nickname,
        "team",
        team
    );




    send(ws,{

        type:"init",

        players:getPlayers(),

        my_team:team

    });





    broadcast({

        type:"player_joined",

        id:player.id,

        nickname:player.nickname,

        character:player.character,

        team:player.team,

        x:player.x,

        y:player.y,

        flip:false

    },ws);




    broadcast({

        type:"players_list",

        players:getPlayers()

    });



    checkStartCountdown();


}





// ================== MOVE ==================

function movePlayer(ws,data){


    const p =
        players.get(
            ws.playerId
        );



    if(!p)
        return;



    if(typeof data.x==="number")
        p.x=data.x;


    if(typeof data.y==="number")
        p.y=data.y;



    p.flip =
        !!data.flip;




    broadcast({

        type:"player_moved",

        id:p.id,

        x:p.x,

        y:p.y,

        flip:p.flip

    },ws);


}// ================== GAME START ==================

function checkStartCountdown(){

    if(gameState!=="lobby")
        return;


    if(players.size < MIN_PLAYERS_TO_START)
        return;



    gameState="countdown";

    let time =
        COUNTDOWN_SECONDS;



    broadcast({

        type:"countdown_start",

        time:time

    });



    countdownTimer=setInterval(()=>{


        time--;



        if(time<=0){


            clearInterval(
                countdownTimer
            );


            startGame();


            return;

        }



        broadcast({

            type:"countdown_update",

            time:time

        });



    },1000);


}





function checkCancelCountdown(){


    if(gameState!=="countdown")
        return;



    if(players.size>=MIN_PLAYERS_TO_START)
        return;



    clearInterval(
        countdownTimer
    );



    gameState="lobby";



    broadcast({

        type:"countdown_cancel"

    });


}





// ================== START MATCH ==================

function startGame(){


    gameState="playing";



    for(const p of players.values()){


        const pos =
            spawnPosition(
                p.team
            );


        p.x=pos.x;
        p.y=pos.y;

        p.hp=PLAYER_HP;
        p.dead=false;


    }




    broadcast({

        type:"start_game"

    });



    broadcast({

        type:"init_game",

        players:getPlayers(),

        town1_hp:TOWN[1].hp,

        town2_hp:TOWN[2].hp,

        barracks1_hp:BARRACKS[1].hp,

        barracks2_hp:BARRACKS[2].hp,

        barracks1_destroyed:
            BARRACKS[1].destroyed,

        barracks2_destroyed:
            BARRACKS[2].destroyed

    });



    gameTickTimer=setInterval(
        gameTick,
        TICK_RATE
    );



    creepSpawnTimer=setInterval(
        spawnWave,
        15000
    );


}




// ================== CREEPS ==================

function spawnWave(){


    createCreep(
        1,
        550,
        450
    );


    createCreep(
        2,
        1350,
        450
    );


}




function createCreep(team,x,y){


    const id =
        nextCreepId++;



    const creep={


        id:id,

        team:team,

        x:x,

        y:y,

        hp:CREEP_HP

    };



    creeps.set(
        id,
        creep
    );



    broadcast({

        type:"creep_spawn",

        id:id,

        team:team,

        x:x,

        y:y,

        hp:CREEP_HP

    });


}






// ================== GAME LOOP ==================

function gameTick(){


    for(const creep of creeps.values()){


        if(creep.team===1){

            creep.x +=
                CREEP_SPEED *
                (TICK_RATE/1000);

        }
        else{

            creep.x -=
                CREEP_SPEED *
                (TICK_RATE/1000);

        }




        // проверяем игроков рядом

        for(const player of players.values()){


            if(player.team===creep.team)
                continue;



            const dx =
                player.x-creep.x;


            const dy =
                player.y-creep.y;


            const distance =
                Math.sqrt(
                    dx*dx+
                    dy*dy
                );



            if(distance <= ATTACK_RANGE){


                damagePlayer(
                    player,
                    CREEP_DAMAGE
                );


            }


        }



        broadcast({

            type:"creep_move",

            id:creep.id,

            x:creep.x,

            y:creep.y

        });



    }


}// ================== PLAYER DAMAGE ==================

function damagePlayer(player, damage){


    if(player.dead)
        return;



    player.hp -= damage;



    broadcast({

        type:"player_damage",

        target_id:player.id,

        new_hp:player.hp

    });




    if(player.hp<=0){


        player.dead=true;


        setTimeout(()=>{


            const pos =
                spawnPosition(
                    player.team
                );


            player.x=pos.x;

            player.y=pos.y;

            player.hp=PLAYER_HP;

            player.dead=false;



            broadcast({

                type:"respawn",

                id:player.id,

                x:player.x,

                y:player.y,

                hp:player.hp

            });



        },5000);



    }


}





// ================== PLAYER ATTACK ==================

function playerDamage(data){


    const target =
        players.get(
            data.target_id
        );


    if(!target)
        return;



    damagePlayer(
        target,
        data.damage || PLAYER_DAMAGE
    );


}







// ================== BARRACKS DAMAGE ==================

function barracksDamage(data){


    const id =
        data.barracks_id;



    if(!BARRACKS[id])
        return;



    if(BARRACKS[id].destroyed)
        return;




    BARRACKS[id].hp -=
        data.damage || 10;




    broadcast({

        type:"barracks_damage",

        barracks_id:id,

        new_hp:BARRACKS[id].hp

    });




    if(BARRACKS[id].hp<=0){



        BARRACKS[id].destroyed=true;



        broadcast({

            type:"barracks_destroyed",

            barracks_id:id

        });



    }


}






// ================== TOWN DAMAGE ==================

function townDamage(data){


    const id =
        data.town_id;



    if(!TOWN[id])
        return;



    TOWN[id].hp -=
        data.damage || 10;




    broadcast({

        type:"town_damage",

        town_id:id,

        damage:data.damage || 10,

        new_hp:TOWN[id].hp

    });




    if(TOWN[id].hp<=0){



        endGame(
            id===1 ? 2 : 1
        );


    }


}





// ================== END GAME ==================

function endGame(winner){


    if(gameState==="finished")
        return;



    gameState="finished";



    clearInterval(
        gameTickTimer
    );


    clearInterval(
        creepSpawnTimer
    );



    broadcast({

        type:"game_over",

        winner:winner

    });



    setTimeout(()=>{


        resetGame();


    },10000);



}






// ================== RESET ==================

function resetGame(){


    gameState="lobby";



    creeps.clear();



    TOWN[1].hp=TOWN_HP;

    TOWN[2].hp=TOWN_HP;



    BARRACKS[1].hp=BARRACKS_HP;

    BARRACKS[2].hp=BARRACKS_HP;



    BARRACKS[1].destroyed=false;

    BARRACKS[2].destroyed=false;




    for(const p of players.values()){


        p.hp=PLAYER_HP;

        p.dead=false;


        const pos =
            spawnPosition(
                p.team
            );


        p.x=pos.x;

        p.y=pos.y;


    }




    broadcast({

        type:"reset_lobby"

    });



    broadcast({

        type:"players_list",

        players:getPlayers()

    });



}




// ================== SERVER INFO ==================

console.log(
    "[SERVER] Ready"
);
