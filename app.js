const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const menu = document.getElementById('menu');
const lobby = document.getElementById('lobby');
const gameShell = document.getElementById('gameShell');
const statusEl = document.getElementById('status');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const lobbyRoster = document.getElementById('lobbyRoster');

const W = 1000, H = 520, CEM = 90, PR = 16, BR = 10;
const BALL_RETURN_DELAY = 1800, BALL_RETURN_SPEED = 0.75;
let peer, hostConnection, isHost = false, roomId = '', localId = '', connections = new Map();
let players = [], ball = { x:500,y:260,vx:0,vy:0,owner:null,hot:false,lastTeam:null,throwerId:null,ignoreThrowerUntil:0,outsideSince:null,returning:false };
let keys = {}, mouse = {x:500,y:260,down:false,charge:0}, lastTouchAim = null;
let score = {red:0,blue:0}, matchOver = false, winner = null, gamePhase = 'menu', last = performance.now(), sendCounter = 0, botSequence = 1;
let renderedLobbySignature = '';

const qsRoom = new URLSearchParams(location.search).get('room');
if (qsRoom) roomInput.value = qsRoom.toUpperCase();

function setStatus(text) { statusEl.textContent = text; }
function cleanName() { return (nameInput.value.trim() || 'Jogador').slice(0,16); }
function randomRoom() { return Math.random().toString(36).slice(2,8).toUpperCase(); }

function showLobby() {
  menu.hidden = true;
  gameShell.hidden = true;
  lobby.hidden = false;
  renderLobby();
}

function showGame() {
  menu.hidden = true;
  lobby.hidden = true;
  gameShell.hidden = false;
  document.getElementById('roomInfo').textContent='Sala '+roomId;
  document.getElementById('restartBtn').hidden = !isHost;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function renderLobby() {
  const signature=JSON.stringify({host:isHost,players:players.map(p=>[p.id,p.name,p.team,p.isBot])});
  document.getElementById('lobbyRoom').textContent='Código da sala: '+roomId;
  document.getElementById('hostLobbyControls').hidden=!isHost;
  document.getElementById('lobbyStatus').textContent=isHost
    ? 'Escolha os times e inicie quando todos estiverem prontos.'
    : 'Aguardando o anfitrião organizar os times e iniciar a partida.';
  if(signature===renderedLobbySignature) return;
  renderedLobbySignature=signature;
  lobbyRoster.innerHTML=players.map(p=>`<div class="lobby-player"><span>${escapeHTML(p.name)}${p.isBot?' (bot)':''}</span>${isHost
    ? `<select data-team-id="${escapeHTML(p.id)}" aria-label="Time de ${escapeHTML(p.name)}"><option value="blue"${p.team==='blue'?' selected':''}>Azul</option><option value="red"${p.team==='red'?' selected':''}>Vermelho</option></select>`
    : `<strong>${p.team==='blue'?'Azul':'Vermelho'}</strong>`}</div>`).join('');
  const bots=players.filter(p=>p.isBot).length;
  document.getElementById('botCount').textContent=`Bots: ${bots} • Vagas: ${12-players.length}`;
  document.getElementById('addBotBtn').disabled=players.length>=12;
  document.getElementById('removeBotBtn').disabled=bots===0;
  const counts=teamCounts();
  document.getElementById('startBtn').disabled=players.length===0||!counts.red||!counts.blue;
}

function createRoom() {
  if (typeof Peer !== 'function') {
    setStatus('Falha ao carregar o sistema de salas. Atualize a página.');
    return;
  }
  const createBtn=document.getElementById('createBtn');
  createBtn.disabled=true;
  isHost = true;
  roomId = randomRoom();
  localId = 'p-host';
  setStatus('Criando sala...');
  peer = new Peer('queimada-' + roomId);
  peer.on('open', () => {
    createBtn.disabled=false;
    initHost();
    gamePhase='lobby';
    showLobby();
    history.replaceState({}, '', '?room=' + roomId);
  });
  peer.on('connection', acceptConnection);
  peer.on('error', err => {
    createBtn.disabled=false;
    setStatus('Não foi possível criar a sala: ' + (err.type||'erro de conexão'));
  });
  setTimeout(() => {
    if (!gameShell.hidden) return;
    if (!peer || peer.destroyed) {
      createBtn.disabled=false;
      setStatus('Não foi possível conectar ao servidor de salas. Atualize a página.');
    }
  },8000);
}

function joinRoom() {
  roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) return setStatus('Digite o código da sala');
  isHost = false;
  localId = 'p-' + Math.random().toString(36).slice(2,10);
  setStatus('Conectando...');
  peer = new Peer();
  peer.on('open', () => {
    hostConnection = peer.connect('queimada-' + roomId, { reliable:true });
    hostConnection.on('open', () => {
      hostConnection.send({type:'join', id:localId, name:cleanName()});
      document.getElementById('lobbyRoom').textContent='Conectado à sala '+roomId+'; aguardando o anfitrião.';
      menu.hidden=true;
      lobby.hidden=false;
    });
    hostConnection.on('data', data => {
      if (data.type === 'state') {
        players = restorePlayerTimers(data.players);
        ball = data.ball;
        score = data.score;
        matchOver = data.matchOver;
        winner = data.winner;
        gamePhase=data.phase;
        if(gamePhase==='lobby') showLobby();
        else if(gamePhase==='game') showGame();
      } else if(data.type==='rejected') {
        setStatus(data.reason);
        hostConnection.close();
        menu.hidden=false;
        lobby.hidden=true;
      }
    });
    hostConnection.on('close', () => setStatus('Conexão com o anfitrião perdida'));
  });
  peer.on('error', err => setStatus('Sala não encontrada ou sem acesso: ' + err.type));
}

function acceptConnection(conn) {
  conn.on('open', () => { connections.set(conn.peer, conn); });
  conn.on('data', data => {
    if (data.type === 'join') {
      if(gamePhase!=='lobby') {
        conn.send({type:'rejected',reason:'A partida já começou. Entre na próxima sala.'});
        return;
      }
      if(players.length>=12) {
        conn.send({type:'rejected',reason:'A sala está cheia (máximo de 12 participantes).'});
        return;
      }
      const counts = teamCounts();
      const team = counts.red <= counts.blue ? 'red' : 'blue';
      players.push(makePlayer(data.id, data.name, team, false));
      conn.playerId = data.id;
      renderLobby();
      conn.on('close', () => removePlayer(data.id));
    } else if (data.type === 'input') {
      const p = players.find(x => x.id === data.id);
      if (p) { p.input = data.input; p.aim = data.aim; }
    } else if (data.type === 'defend') {
      activateDefense(players.find(x => x.id === data.id));
    }
  });
}

function teamCounts() {
  return players.reduce((a,p) => { a[p.team]++; return a; }, {red:0,blue:0});
}

function makePlayer(id,name,team,isBot=false) {
  const base = team === 'red' ? 300 : 700;
  const redN = players.filter(p=>p.team==='red').length;
  const blueN = players.filter(p=>p.team==='blue').length;
  const n = team === 'red' ? redN : blueN;
  return { id,name,team,isBot, x:base+(isBot?(n%3)*18:0), y:[260,120,400,180,340,260][n%6], vx:0,vy:0,inCemetery:false,dying:false,reintegrationAt:0,input:{},aim:null,defendingUntil:0,defendCooldownRemaining:0,botThrowAt:0,botTargetId:null };
}

function initHost() {
  players = [];
  players.push(makePlayer(localId, cleanName(), 'red', false));
  addLobbyBot('blue');
  addLobbyBot('red');
  ball = {x:500,y:260,vx:0,vy:0,owner:null,hot:false,lastTeam:null,throwerId:null,ignoreThrowerUntil:0,outsideSince:null,returning:false};
}

function addLobbyBot(team) {
  if(players.length>=12) return;
  const bot=makePlayer('bot-'+botSequence,'Bot '+botSequence,team,true);
  botSequence++;
  players.push(bot);
}

function addBotToSmallerTeam() {
  if(!isHost||gamePhase!=='lobby'||players.length>=12) return;
  const counts=teamCounts();
  addLobbyBot(counts.red<=counts.blue?'red':'blue');
  renderedLobbySignature='';
  renderLobby();
}

function removeLobbyBot() {
  if(!isHost||gamePhase!=='lobby') return;
  const index=players.findLastIndex ? players.findLastIndex(p=>p.isBot) : players.map(p=>p.isBot).lastIndexOf(true);
  if(index<0) return;
  players.splice(index,1);
  renderedLobbySignature='';
  renderLobby();
}

function shuffleTeams() {
  if(!isHost||gamePhase!=='lobby') return;
  const shuffled=players.slice();
  for(let i=shuffled.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
  }
  shuffled.forEach((p,index)=>{p.team=index%2===0?'red':'blue';});
  renderedLobbySignature='';
  renderLobby();
}

function startMatch() {
  if(!isHost||gamePhase!=='lobby') return;
  const counts=teamCounts();
  if(!counts.red||!counts.blue) return;
  const positions=[260,120,400,180,340,220];
  const indices={red:0,blue:0};
  players.forEach(p=>{
    const index=indices[p.team]++;
    p.x=p.team==='red'?300:700;
    p.y=positions[index%positions.length];
    p.vx=0;p.vy=0;p.inCemetery=false;p.dying=false;p.reintegrationAt=0;
    p.defendingUntil=0;p.defendCooldownRemaining=0;p.aim=null;p.input={};
    p.botThrowAt=0;p.botTargetId=null;
  });
  const firstOwner=players.find(p=>p.team==='red'&&!p.isBot)||players.find(p=>p.team==='red');
  ball={x:500,y:260,vx:0,vy:0,owner:firstOwner,hot:false,lastTeam:null,throwerId:null,ignoreThrowerUntil:0,outsideSince:null,returning:false};
  score={red:0,blue:0};
  matchOver=false;
  winner=null;
  gamePhase='game';
  renderedLobbySignature='';
  showGame();
}

function reopenLobby() {
  if(!isHost||gamePhase!=='game') return;
  gamePhase='lobby';
  matchOver=false;
  winner=null;
  ball={x:500,y:260,vx:0,vy:0,owner:null,hot:false,lastTeam:null,throwerId:null,ignoreThrowerUntil:0,outsideSince:null,returning:false};
  players.forEach(p=>{
    p.vx=0;p.vy=0;p.inCemetery=false;p.dying=false;p.reintegrationAt=0;
    p.defendingUntil=0;p.defendCooldownRemaining=0;p.aim=null;p.input={};
    p.botThrowAt=0;p.botTargetId=null;
  });
  renderedLobbySignature='';
  showLobby();
}

function localPlayer() { return players.find(p => p.id === localId); }

window.addEventListener('keydown', e => {
  const key=e.key.toLowerCase();
  keys[key]=true;
  if ((key==='shift'||key==='e') && !e.repeat) activateDefenseInput();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX-r.left)*W/r.width; mouse.y=(e.clientY-r.top)*H/r.height;
});
canvas.addEventListener('mousedown', () => { mouse.down=true; });
window.addEventListener('mouseup', () => {
  if (mouse.down) throwFromLocal();
  mouse.down=false; mouse.charge=0;
});

function getLocalInput() {
  return { up:!!(keys.w||keys.arrowup), down:!!(keys.s||keys.arrowdown), left:!!(keys.a||keys.arrowleft), right:!!(keys.d||keys.arrowright) };
}

function cappedAim(p, tx, ty) {
  const dx=tx-p.x, dy=ty-p.y;
  const length=Math.hypot(dx,dy);
  const max=220;
  if(length<=max) return {x:tx,y:ty};
  const scale=max/(length||1);
  return {x:p.x+dx*scale,y:p.y+dy*scale};
}

function throwFromLocal() {
  const p = localPlayer();
  if (!p || ball.owner !== p) return;
  let tx=mouse.x, ty=mouse.y;
  if (lastTouchAim) { tx=lastTouchAim.x; ty=lastTouchAim.y; }
  const aim=cappedAim(p,tx,ty);
  tx=aim.x; ty=aim.y;
  const throwData={tx,ty,speed:7+mouse.charge*11};
  if (isHost) throwBall(p,tx,ty,throwData.speed); else hostConnection.send({type:'input',id:localId,input:getLocalInput(),aim:throwData});
}

function throwBall(p,tx,ty,speed) {
  if (ball.owner !== p) return;
  const a=Math.atan2(ty-p.y,tx-p.x);
  const finalSpeed=p.inCemetery ? speed/3 : speed;
  ball.owner=null; ball.hot=true; ball.lastTeam=p.team;
  ball.throwerId=p.id;ball.ignoreThrowerUntil=performance.now()+250;
  ball.outsideSince=null; ball.returning=false;
  ball.vx=Math.cos(a)*finalSpeed; ball.vy=Math.sin(a)*finalSpeed;
}

function sendToCemetery(p) {
  p.inCemetery=true; p.vx=p.vy=0;
  p.x=p.team==='red'?W-CEM/2:CEM/2; p.y=H/2;
}
function constrain(p) {
  let minX,maxX;
  if (!p.inCemetery) {
    if(p.team==='red'){minX=CEM+PR;maxX=W/2-PR}else{minX=W/2+PR;maxX=W-CEM-PR}
  } else {
    if(p.team==='red'){minX=W-CEM+PR;maxX=W-PR}else{minX=PR;maxX=CEM-PR}
  }
  p.x=Math.max(minX,Math.min(maxX,p.x)); p.y=Math.max(PR,Math.min(H-PR,p.y));
}

function removePlayer(id) {
  const i=players.findIndex(p=>p.id===id);
  if(i>=0) players.splice(i,1);
  if(gamePhase==='lobby'){renderedLobbySignature='';renderLobby();}
}

function activateDefense(p) {
  if (!p || p.inCemetery || p.dying) return;
  const now=performance.now();
  if (p.defendCooldownRemaining>0) return;
  if (now < (p.defendingUntil||0)) return;
  p.defendingUntil=now+3000;
  p.defendCooldownRemaining=3000;
}

function activateDefenseInput() {
  if (isHost) activateDefense(localPlayer());
  else if (hostConnection?.open) hostConnection.send({type:'defend',id:localId});
}

function catchBall(p) {
  ball.owner=p;
  ball.hot=false;
  ball.vx=0;
  ball.vy=0;
  ball.throwerId=null;
  ball.ignoreThrowerUntil=0;
  ball.outsideSince=null;
  ball.returning=false;
  if(p.isBot){
    const targets=players.filter(other=>other.team!==p.team&&!other.inCemetery);
    p.botThrowAt=performance.now()+700;
    p.botTargetId=targets.length?targets[Math.floor(Math.random()*targets.length)].id:null;
  }else{
    p.botThrowAt=0;
    p.botTargetId=null;
  }
}

function tryDefend(p) {
  if (!ball.owner || p.inCemetery || p.dying) return;
  const now=performance.now();
  if (now >= (p.defendingUntil||0)) return;
  if (ball.owner.team === p.team) return;
  if (Math.hypot(ball.x-p.x, ball.y-p.y) <= PR*2) {
    catchBall(p);
  }
}

function beginElimination(p) {
  if (p.dying || p.inCemetery) return;
  p.dying=true;
  p.reintegrationAt=performance.now()+5000;
  p.vx=0;
  p.vy=0;
  checkVictory();
}

function updateReintegration(now) {
  players.forEach(p => {
    if (p.dying && now >= p.reintegrationAt) {
      p.dying=false;
      p.reintegrationAt=0;
      sendToCemetery(p);
    }
  });
}

function updateHost(dt) {
  if (matchOver) return;
  const now=performance.now();
  updateReintegration(now);
  const elapsedMs=dt*1000/60;
  players.forEach(p => {
    if (p.defendCooldownRemaining>0 && now>=(p.defendingUntil||0) && ball.owner && ball.owner.team!==p.team) {
      p.defendCooldownRemaining=Math.max(0,p.defendCooldownRemaining-elapsedMs);
    }
  });
  if(mouse.down && ball.owner===localPlayer()) mouse.charge=Math.min(1,mouse.charge+0.03);

  players.forEach(p => {
    if (p.dying) { p.vx=0; p.vy=0; return; }
    if (p.isBot) updateBot(p);
    else {
      let input=p.input;
      if(p.id===localId) input=getLocalInput();
      const acc=.24;
      if(input?.up)p.vy-=acc; if(input?.down)p.vy+=acc;
      if(input?.left)p.vx-=acc; if(input?.right)p.vx+=acc;
      const movingSpeed=Math.hypot(p.vx,p.vy);
      const maxSpeed=p.inCemetery?1.55:3.1;
      if(movingSpeed>maxSpeed){p.vx=p.vx/movingSpeed*maxSpeed;p.vy=p.vy/movingSpeed*maxSpeed;}
      if(p.aim?.tx!==undefined) { throwBall(p,p.aim.tx,p.aim.ty,p.aim.speed); p.aim=null; }
    }
    p.vx*=.965; p.vy*=.965; p.x+=p.vx; p.y+=p.vy; constrain(p);
  });

  if(ball.owner) {
    const p=ball.owner;
    ball.x=p.x+(p.team==='red'?14:-14); ball.y=p.y;
    players.forEach(defender=>tryDefend(defender));
  } else {
    ball.x+=ball.vx; ball.y+=ball.vy; ball.vx*=.985; ball.vy*=.985;
    if(ball.y<BR||ball.y>H-BR){ball.vy*=-.8;ball.y=Math.max(BR,Math.min(H-BR,ball.y));}
    if(ball.x<BR||ball.x>W-BR){ball.vx*=-.8;ball.x=Math.max(BR,Math.min(W-BR,ball.x));}
    if(Math.hypot(ball.vx,ball.vy)<4.5) ball.hot=false;
    updateBallReturn(dt, now);

    for (const p of players) {
      if(p.dying || (p.id===ball.throwerId&&now<ball.ignoreThrowerUntil) || Math.hypot(ball.x-p.x,ball.y-p.y)>=PR+BR) continue;
      if(ball.hot && ball.lastTeam!==p.team && !p.inCemetery) {
        if(now<(p.defendingUntil||0)) catchBall(p);
        else {
          beginElimination(p);
          ball.hot=false;
          ball.vx*=-.3;
          ball.vy*=-.3;
        }
        break;
      }
      if(!ball.hot || ball.lastTeam===p.team) {
        catchBall(p);
        break;
      }
    }
  }
}

function updateBallReturn(dt, now) {
  const outsideLeft=ball.x<CEM;
  const outsideRight=ball.x>W-CEM;
  if (!outsideLeft && !outsideRight) {
    ball.outsideSince=null;
    ball.returning=false;
    return;
  }

  if (ball.outsideSince===null) ball.outsideSince=now;
  if (!ball.returning && now-ball.outsideSince>=BALL_RETURN_DELAY) {
    ball.returning=true;
    ball.hot=false;
    ball.vx=0;
    ball.vy=0;
  }
  if (!ball.returning) return;

  const targetX=outsideLeft?CEM:W-CEM;
  const distance=targetX-ball.x;
  const step=Math.min(Math.abs(distance),BALL_RETURN_SPEED*dt);
  ball.x+=Math.sign(distance)*step;
  if (step>=Math.abs(distance)) {
    ball.outsideSince=null;
    ball.returning=false;
  }
}

function updateBot(p) {
  if(ball.owner===p) {
    const enemies=players.filter(e=>e.team!==p.team&&!e.inCemetery);
    if(!p.botThrowAt) {
      p.botThrowAt=performance.now()+700;
      p.botTargetId=enemies.length?enemies[Math.floor(Math.random()*enemies.length)].id:null;
    }
    if(performance.now()<p.botThrowAt) return;
    if(enemies.length) {
      const target=players.find(e=>e.id===p.botTargetId&&!e.inCemetery)||enemies[Math.floor(Math.random()*enemies.length)];
      const aim=cappedAim(p,target.x+(Math.random()*18-9),target.y+(Math.random()*18-9));
      throwBall(p,aim.x,aim.y,9+Math.random()*3);
    }
    p.botThrowAt=0;
    p.botTargetId=null;
  } else if(!ball.owner&&!ball.hot) {
    const a=Math.atan2(ball.y-p.y,ball.x-p.x); p.vx+=Math.cos(a)*.28; p.vy+=Math.sin(a)*.28;
  } else {
    if(ball.owner && ball.owner.team!==p.team && Math.hypot(ball.x-p.x,ball.y-p.y)<PR*2) activateDefense(p);
    if(p.inCemetery) return;
    p.vx+=(Math.random()-.5)*.35; p.vy+=(Math.random()-.5)*.35;
  }
}

function checkVictory() {
  if(matchOver) return;
  const activeRed=players.filter(p=>p.team==='red'&&!p.inCemetery&&!p.dying);
  const activeBlue=players.filter(p=>p.team==='blue'&&!p.inCemetery&&!p.dying);
  if(!activeBlue.length&&activeRed.length){score.red++;winner='red';matchOver=true;}
  else if(!activeRed.length&&activeBlue.length){score.blue++;winner='blue';matchOver=true;}
  else if(!activeRed.length&&!activeBlue.length){winner=null;matchOver=true;}
}

function broadcast() {
  sendCounter++;
  if(sendCounter%2) return;
  const now=performance.now();
  const publicPlayers=players.map(p=>{
    const {defendingUntil,reintegrationAt,...publicPlayer}=p;
    return {
      ...publicPlayer,
      defendingRemaining:Math.max(0,(defendingUntil||0)-now),
      reintegrationRemaining:Math.max(0,(reintegrationAt||0)-now),
      input:{},
      aim:null,
      botTargetId:null
    };
  });
  const publicBall={...ball,owner:ball.owner?publicPlayers.find(p=>p.id===ball.owner.id)||null:null};
  const state={type:'state',phase:gamePhase,players:publicPlayers,ball:publicBall,score,matchOver,winner};
  connections.forEach(conn=>{ if(conn.open) conn.send(state); });
}

function restorePlayerTimers(publicPlayers) {
  const receivedAt=performance.now();
  return publicPlayers.map(({defendingRemaining=0,reintegrationRemaining=0,...p})=>({
    ...p,
    defendingUntil:receivedAt+defendingRemaining,
    reintegrationAt:receivedAt+reintegrationRemaining
  }));
}

function draw() {
  ctx.fillStyle='#538a4b'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#45753e'; ctx.fillRect(0,0,CEM,H); ctx.fillRect(W-CEM,0,CEM,H);
  ctx.strokeStyle='rgba(255,255,255,.75)'; ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.moveTo(CEM,0);ctx.lineTo(CEM,H);ctx.moveTo(W-CEM,0);ctx.lineTo(W-CEM,H);ctx.stroke();
  ctx.beginPath();ctx.arc(W/2,H/2,60,0,Math.PI*2);ctx.stroke();

  const lp=localPlayer();
  if(mouse.down&&lp&&ball.owner===lp){const aim=cappedAim(lp,mouse.x,mouse.y);ctx.strokeStyle='#ffdd59b0';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(lp.x,lp.y);ctx.lineTo(aim.x,aim.y);ctx.stroke();}

  players.forEach(p=>{
    const now=performance.now();
    if(p.dying){
      const remaining=Math.max(0,(p.reintegrationAt||now)-now);
      ctx.save();ctx.globalAlpha=.12+Math.max(0,remaining/5000)*.88;
      ctx.beginPath();ctx.arc(p.x,p.y,PR*(.3+remaining/5000*.7),0,Math.PI*2);ctx.fillStyle='#e9edf3';ctx.fill();
      ctx.restore();
      return;
    }
    ctx.beginPath();ctx.arc(p.x,p.y,PR,0,Math.PI*2);
    const defending=now<(p.defendingUntil||0);
    ctx.fillStyle=defending?(p.team==='red'?'#60a5fa':'#93c5fd'):(p.team==='red'?'#e55039':'#3c6382');ctx.fill();
    ctx.lineWidth=p.id===localId?4:2;ctx.strokeStyle=p.id===localId?'#f6b93b':'#fff';ctx.stroke();
    if(defending){ctx.beginPath();ctx.arc(p.x,p.y,PR*2,0,Math.PI*2);ctx.strokeStyle='#60a5fa';ctx.lineWidth=3;ctx.setLineDash([6,5]);ctx.stroke();ctx.setLineDash([]);}
    const remaining=p.defendCooldownRemaining||0;
    if(p.id===localId && remaining>0){ctx.beginPath();ctx.arc(p.x,p.y,PR+7,0,Math.PI*2);ctx.strokeStyle='#94a3b8';ctx.lineWidth=3;ctx.stroke();}
    ctx.fillStyle='#fff';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(p.name,p.x,p.y-PR-6);
  });
  ctx.beginPath();ctx.arc(ball.x,ball.y,BR,0,Math.PI*2);ctx.fillStyle=ball.hot?'#ffdd59':'#fff';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#111';ctx.stroke();

  ctx.fillStyle='#fff';ctx.font='700 24px system-ui';ctx.textAlign='center';ctx.fillText(score.blue+'  AZUL',W/2-90,34);ctx.fillText(score.red+'  VERMELHO',W/2+90,34);
  if(matchOver){
    ctx.fillStyle='rgba(8,15,25,.78)';ctx.fillRect(0,H/2-46,W,92);
    ctx.fillStyle='#fff';ctx.font='800 30px system-ui';
    ctx.fillText(winner==='red'?'TIME VERMELHO VENCEU':winner==='blue'?'TIME AZUL VENCEU':'EMPATE',W/2,H/2+10);
  }
  document.getElementById('score').textContent='AZUL '+score.blue+' — '+score.red+' VERMELHO';
  const abilityPlayer=localPlayer();
  const now=performance.now();
  const defendActive=now<(abilityPlayer?.defendingUntil||0);
  const defendRemaining=Math.max(0,(abilityPlayer?.defendCooldownRemaining||0)/1000);
  const ability=document.getElementById('abilityStatus');
  if(defendActive){
    ability.textContent='DEFENDENDO • '+Math.max(0,(abilityPlayer.defendingUntil-now)/1000).toFixed(1)+'s';
    ability.style.color='#60a5fa';
    document.getElementById('defendBtn')?.classList.remove('cooldown');
  }else if(defendRemaining>0){
    ability.textContent='Defesa: '+defendRemaining.toFixed(1)+'s';
    ability.style.color='#94a3b8';
    document.getElementById('defendBtn')?.classList.add('cooldown');
  }else{
    ability.textContent='SHIFT/E: defender';
    ability.style.color='#93c5fd';
    document.getElementById('defendBtn')?.classList.remove('cooldown');
  }
}

function loop(now) {
  const dt=Math.min(2,(now-last)/16.67); last=now;
  if(isHost){if(gamePhase==='game') updateHost(dt);broadcast();}
  else if(hostConnection&&gamePhase==='game'){
    const input=getLocalInput();
    hostConnection.send({type:'input',id:localId,input,aim:lastTouchAim?{tx:lastTouchAim.x,ty:lastTouchAim.y,speed:12}:null});
  }
  draw();requestAnimationFrame(loop);
}

// Mobile joystick
const joystick=document.getElementById('joystick'), stick=document.getElementById('stick');
let joy={active:false,x:0,y:0};
joystick.addEventListener('pointerdown',e=>{joy.active=true;joystick.setPointerCapture(e.pointerId);});
joystick.addEventListener('pointermove',e=>{if(!joy.active)return;const r=joystick.getBoundingClientRect();const dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);const len=Math.hypot(dx,dy)||1;const scale=Math.min(34,len)/len;joy.x=dx*scale/34;joy.y=dy*scale/34;stick.style.transform=`translate(${joy.x*34}px,${joy.y*34}px)`;keys.w=joy.y<-.35;keys.s=joy.y>.35;keys.a=joy.x<-.35;keys.d=joy.x>.35;});
joystick.addEventListener('pointerup',()=>{joy.active=false;joy.x=joy.y=0;stick.style.transform='';keys.w=keys.s=keys.a=keys.d=false;});
document.getElementById('throwBtn').addEventListener('pointerdown',()=>{mouse.down=true;lastTouchAim={x:localPlayer()?.x+(localPlayer()?.team==='red'?400:-400),y:H/2};mouse.charge=.7;});
document.getElementById('throwBtn').addEventListener('pointerup',()=>{throwFromLocal();mouse.down=false;mouse.charge=0;lastTouchAim=null;});
const defendBtn=document.getElementById('defendBtn');
defendBtn.addEventListener('pointerdown',()=>{activateDefenseInput();});
defendBtn.addEventListener('pointerup',()=>{keys.e=false;});
defendBtn.addEventListener('pointercancel',()=>{keys.e=false;});

document.getElementById('createBtn').addEventListener('click',createRoom);
document.getElementById('joinBtn').addEventListener('click',joinRoom);
document.getElementById('lobbyRoster').addEventListener('change',e=>{
  if(!isHost||gamePhase!=='lobby'||!e.target.matches('[data-team-id]')) return;
  const player=players.find(p=>p.id===e.target.dataset.teamId);
  if(player){player.team=e.target.value;renderedLobbySignature='';renderLobby();}
});
document.getElementById('addBotBtn').addEventListener('click',addBotToSmallerTeam);
document.getElementById('removeBotBtn').addEventListener('click',removeLobbyBot);
document.getElementById('shuffleBtn').addEventListener('click',shuffleTeams);
document.getElementById('startBtn').addEventListener('click',startMatch);
document.getElementById('restartBtn').addEventListener('click',reopenLobby);

async function copyInvite(button) {
  const url=new URL(location.href);
  url.searchParams.set('room',roomId);
  await navigator.clipboard?.writeText(url.href);
  button.textContent='Convite copiado!';
  setTimeout(()=>button.textContent='Copiar convite',1600);
}
document.getElementById('copyBtn').addEventListener('click',e=>copyInvite(e.currentTarget));
document.getElementById('lobbyCopyBtn').addEventListener('click',e=>copyInvite(e.currentTarget));

requestAnimationFrame(loop);
