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
// ================= START GAME =================


function checkStart(){


	if(
		gameState==="lobby" &&
		players.size>=MIN_PLAYERS_TO_START
	){

		startCountdown();

	}

}






function startCountdown(){


	gameState="countdown";


	let time=COUNTDOWN_SECONDS;



	broadcast({

		type:"countdown_start",

		time:time

	});



	countdownTimer=setInterval(()=>{


		time--;



		broadcast({

			type:"countdown_update",

			time:time

		});



		if(time<=0){


			clearInterval(countdownTimer);

			countdownTimer=null;


			startGame();


		}


	},1000);


}







function startGame(){


	gameState="playing";



	broadcast({

		type:"start_game"

	});



	broadcast({

		type:"init_game",

		players:getPlayers(),

		town1_hp:town1_hp,

		town2_hp:town2_hp,

		barracks1_hp:barracks1_hp,

		barracks2_hp:barracks2_hp,

		barracks1_destroyed:barracks1_destroyed,

		barracks2_destroyed:barracks2_destroyed

	});



	startCreeps();

}









// ================= PLAYER DAMAGE =================


function handlePlayerDamage(ws,data){


	const attacker=players.get(ws.playerId);


	if(!attacker)
		return;



	const target=players.get(
		data.target_id
	);



	if(!target)
		return;



	if(target.team===attacker.team)
		return;



	if(target.dead)
		return;



	target.hp-=data.damage || 25;



	if(target.hp<=0){


		target.hp=0;

		target.dead=true;


	}



	broadcast({

		type:"player_damage",

		target_id:target.id,

		new_hp:target.hp

	});




	if(target.dead){


		broadcast({

			type:"respawn",

			id:target.id,

			x:
			target.team===1
			?
			TEAM1_SPAWN.x
			:
			TEAM2_SPAWN.x,


			y:450,

			hp:100

		});


		setTimeout(()=>{


			if(!players.has(target.id))
				return;



			target.hp=100;

			target.dead=false;



			broadcast({

				type:"player_damage",

				target_id:target.id,

				new_hp:100

			});



		},5000);


	}


}









// ================= RESPAWN =================


function handleRespawn(ws){


	const p=players.get(ws.playerId);


	if(!p)
		return;



	p.hp=100;

	p.dead=false;



	p.x=
	p.team===1
	?
	TEAM1_SPAWN.x
	:
	TEAM2_SPAWN.x;


	p.y=450;



	send(ws,{

		type:"respawn",

		id:p.id,

		x:p.x,

		y:p.y,

		hp:p.hp

	});


}










// ================= TOWN DAMAGE =================


function handleTownDamage(ws,data){


	const p=players.get(ws.playerId);


	if(!p)
		return;



	let town=data.town_id;



	if(town===1){

		town1_hp-=data.damage || 10;

		if(town1_hp<0)
			town1_hp=0;


	}
	else{

		town2_hp-=data.damage || 10;

		if(town2_hp<0)
			town2_hp=0;

	}




	broadcast({

		type:"town_damage",

		town_id:town,

		damage:data.damage,

		new_hp:
		town===1
		?
		town1_hp
		:
		town2_hp

	});





	checkWin();

}









// ================= BARRACKS =================


function handleBarracksDamage(ws,data){


	let id=data.barracks_id;


	let hp;



	if(id===1){


		barracks1_hp-=data.damage || 10;


		if(barracks1_hp<=0){

			barracks1_hp=0;

			barracks1_destroyed=true;


		}


		hp=barracks1_hp;


	}
	else{


		barracks2_hp-=data.damage || 10;


		if(barracks2_hp<=0){

			barracks2_hp=0;

			barracks2_destroyed=true;

		}


		hp=barracks2_hp;


	}



	broadcast({

		type:"barracks_damage",

		barracks_id:id,

		new_hp:hp

	});



	if(hp<=0){


		broadcast({

			type:"barracks_destroyed",

			barracks_id:id

		});


	}


}
// ================= CREEPS =================


function startCreeps(){


	if(creepTimer)
		return;


	creepTimer=setInterval(()=>{


		if(gameState!=="playing")
			return;



		spawnCreep(1);
		spawnCreep(2);



	},15000);


}






function spawnCreep(team){


	const id="creep_"+nextCreepId++;



	const creep={


		id:id,

		team:team,


		x:
		team===1
		?
		300
		:
		1600,


		y:450,


		hp:80


	};



	creeps.set(
		id,
		creep
	);



	broadcast({

		type:"creep_spawn",

		id:id,

		team:team,

		x:creep.x,

		y:creep.y,

		hp:creep.hp

	});


}








function creepTick(){


	for(const [id,c] of creeps){



		if(c.team===1)
			c.x+=4;
		else
			c.x-=4;



		broadcast({

			type:"creep_move",

			id:id,

			x:c.x,

			y:c.y

		});




		// дошёл до базы


		if(c.team===1 && c.x>=1700){


			town2_hp-=10;


			broadcast({

				type:"town_damage",

				town_id:2,

				damage:10,

				new_hp:town2_hp

			});


			removeCreep(id);


		}



		if(c.team===2 && c.x<=200){


			town1_hp-=10;



			broadcast({

				type:"town_damage",

				town_id:1,

				damage:10,

				new_hp:town1_hp

			});


			removeCreep(id);


		}


	}



	checkWin();

}







setInterval(
	creepTick,
	TICK
);








function handleCreepDamage(ws,data){


	const creep=creeps.get(
		data.id
	);



	if(!creep)
		return;



	creep.hp-=data.damage || 25;



	broadcast({

		type:"creep_damage",

		id:creep.id,

		new_hp:creep.hp

	});



	if(creep.hp<=0){


		removeCreep(
			creep.id
		);


	}



}







function removeCreep(id){


	if(!creeps.has(id))
		return;



	creeps.delete(id);



	broadcast({

		type:"creep_destroy",

		id:id

	});

}









// ================= WIN =================


function checkWin(){


	if(
		town1_hp<=0
	){


		gameOver(2);


	}


	if(
		town2_hp<=0
	){


		gameOver(1);


	}


}







function gameOver(team){


	if(gameState==="finished")
		return;



	gameState="finished";



	broadcast({

		type:"game_over",

		winner:team

	});



	setTimeout(()=>{


		resetGame();


	},10000);

}









// ================= REMOVE PLAYER =================


function removePlayer(id){


	const p=players.get(id);


	if(!p)
		return;



	console.log(
		"[SERVER] remove",
		id
	);



	players.delete(id);



	broadcast({

		type:"player_left",

		id:id

	});



	if(players.size===0){


		resetGame();


	}

}









// ================= RESET =================


function resetGame(){


	gameState="lobby";



	town1_hp=TOWN_HP;

	town2_hp=TOWN_HP;


	barracks1_hp=BARRACKS_HP;

	barracks2_hp=BARRACKS_HP;



	barracks1_destroyed=false;

	barracks2_destroyed=false;



	creeps.clear();



	for(const p of players.values()){


		p.hp=100;

		p.dead=false;


		p.x=
		p.team===1
		?
		TEAM1_SPAWN.x
		:
		TEAM2_SPAWN.x;


		p.y=450;


	}



	broadcast({

		type:"reset_lobby"

	});



	broadcast({

		type:"players_list",

		players:getPlayers()

	});



}
