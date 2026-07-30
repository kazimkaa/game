// server.js
// Godot WebSocket MOBA server

const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");


// ================= CONFIG =================

const PORT = 3000;

const MAX_PLAYERS = 8;

const MIN_PLAYERS_TO_START = 2;

const COUNTDOWN_SECONDS = 15;


const PLAYER_HP = 100;

const TOWN_HP = 1000;

const BARRACKS_HP = 500;


const TEAM1_SPAWN = {
	x:300,
	y:450
};


const TEAM2_SPAWN = {
	x:1600,
	y:450
};



const TICK = 100;



// ================= STATE =================


const players = new Map();

const creeps = new Map();


let nextCreepId = 1;


let gameState="lobby";


let countdown=null;


let countdownTimer=null;


let creepTimer=null;



let town1_hp=TOWN_HP;
let town2_hp=TOWN_HP;


let barracks1_hp=BARRACKS_HP;
let barracks2_hp=BARRACKS_HP;


let barracks1_destroyed=false;
let barracks2_destroyed=false;





// ================= SERVER =================


const server=http.createServer(
(req,res)=>{

	res.writeHead(
		200,
		{
			"Content-Type":"text/plain"
		}
	);

	res.end(
		"Godot server online"
	);

});



const wss=new WebSocketServer({
	server
});



server.listen(
	PORT,
	()=>{
		console.log(
			"[SERVER] START",
			PORT
		);
	}
);





// ================= CONNECTION =================


wss.on(
	"connection",
	ws=>{


		console.log(
			"[SERVER] connection"
		);


		ws.playerId=null;



		ws.on(
			"message",
			raw=>{


				let data;


				try{

					data=JSON.parse(
						raw.toString()
					);

				}
				catch(e){

					return;

				}



				handleMessage(
					ws,
					data
				);

			}
		);



		ws.on(
			"close",
			()=>{


				if(ws.playerId){

					removePlayer(
						ws.playerId
					);

				}

			}
		);


	}
);
// ================= MESSAGE HANDLER =================


function handleMessage(ws,data){


	switch(data.type){


		case "join":
			handleJoin(ws,data);
			break;


		case "move":
			handleMove(ws,data);
			break;


		case "level_ready":
			handleLevelReady(ws,data);
			break;


		case "player_damage":
			handlePlayerDamage(ws,data);
			break;


		case "town_damage":
			handleTownDamage(ws,data);
			break;


		case "barracks_damage":
			handleBarracksDamage(ws,data);
			break;


		case "respawn":
			handleRespawn(ws);
			break;


		case "ping":

			send(ws,{
				type:"pong"
			});

			break;

	}

}







// ================= JOIN =================


function handleJoin(ws,data){


	if(players.size>=MAX_PLAYERS){

		send(ws,{
			type:"system_message",
			message:"Server full"
		});

		return;

	}



	const id=data.id;


	if(!id)
		return;



	// reconnect

	if(players.has(id)){

		players.get(id).ws=ws;

		ws.playerId=id;

		return;

	}





	const team=getTeam();



	const spawn =
	team===1
	?
	TEAM1_SPAWN
	:
	TEAM2_SPAWN;




	const player={


		id:id,


		ws:ws,


		nickname:data.nickname || "Player",


		character:data.character || 1,


		team:team,


		x:spawn.x,


		y:spawn.y,


		flip:false,


		hp:PLAYER_HP,


		dead:false


	};



	players.set(
		id,
		player
	);


	ws.playerId=id;



	console.log(
		"[SERVER] join:",
		player.nickname,
		id,
		"team",
		team
	);





	// отправляем новому игроку список

	send(ws,{

		type:"init",

		my_team:team,

		players:getPlayers(id)

	});






	// сообщаем другим

	broadcast({

		type:"player_joined",

		id:id,

		x:player.x,

		y:player.y,

		flip:false,

		nickname:player.nickname,

		character:player.character,

		team:player.team

	},ws);





	checkStart();

}







// ================= TEAM =================


function getTeam(){


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








// ================= PLAYERS LIST =================


function getPlayers(exclude=null){


	let result={};



	for(const [id,p] of players){


		if(id===exclude)
			continue;



		result[id]={


			id:p.id,

			nickname:p.nickname,

			character:p.character,

			team:p.team,

			x:p.x,

			y:p.y,

			flip:p.flip,

			hp:p.hp


		};


	}



	return result;

}








// ================= MOVE =================


function handleMove(ws,data){


	const p=players.get(ws.playerId);


	if(!p)
		return;



	p.x=data.x;

	p.y=data.y;

	p.flip=data.flip;



	broadcast({

		type:"player_moved",

		id:p.id,

		x:p.x,

		y:p.y,

		flip:p.flip


	},ws);

}








// ================= LEVEL READY =================


function handleLevelReady(ws,data){


	const p=players.get(ws.playerId);


	if(!p)
		return;


	p.x=data.x;

	p.y=data.y;


}







// ================= BROADCAST =================


function broadcast(data,except=null){


	for(const p of players.values()){


		if(p.ws===except)
			continue;


		send(
			p.ws,
			data
		);

	}

}






function send(ws,data){


	if(
		ws &&
		ws.readyState===WebSocket.OPEN
	){

		ws.send(
			JSON.stringify(data)
		);

	}

}
