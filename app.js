const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const menu = document.getElementById('menu');
const gameShell = document.getElementById('gameShell');
const statusEl = document.getElementById('status');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');

const W = 1000, H = 520, CEM = 90, PR = 16, BR = 10;
let peer, hostConnection, isHost = false, roomId = '', localId = '', connections = new Map();
let players = [], ball = { x:500,y:260,vx:0,vy:0,owner:null,hot:false,lastTeam:null };
let keys = {}, mouse = {x:500,y:260,down:false,charge:0}, lastTouchAim = null;
let score = {red:0,blue:0}, matchOver = false, last = performance.now(), sendCounter = 0;

const qsRoom = new URLSearchParams(location.search).get('room');
if (qsRoom) roomInput.value = qsRoom.toUpperCase();

function setStatus(text) { statusEl.textContent = text; }
function cleanName() { return (nameInput.value.trim() || 'Jogador').slice(0,16); }
function randomRoom() { return Math.random().toString(36).slice(2,8).toUpperCase(); }

function showGame() { menu.hidden = true; gameShell.hidden = false; }

function createRoom() {
  isHost = true;
  roomId = randomRoom();
  localId = 'p-host';
  setStatus('Criando sala...');
  peer = new Peer('queimada-' + roomId);
  peer.on('open', () => {
    initHost();
    showGame();
    history.replaceState({}, '', '?room=' + roomId);
    document.getElementById('roomInfo').textContent = 'Sala ' + roomId;
  });
  peer.on('connection', acceptConnection);
  peer.on('error', err => setStatus('Não foi possível criar a sala: ' + err.type));
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
      showGame();
      document.getElementById('roomInfo').textContent = 'Sala ' + roomId;
    });
    hostConnection.on('data', data => {
      if (data.type === 'state') {
        players = data.players;
        ball = data.ball;
        score = data.score;
        matchOver = data.matchOver;
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
      const counts = teamCounts();
      const team = counts.red <= counts.blue ? 'red' : 'blue';
      players.push(makePlayer(data.id, data.name, team, false));
      conn.playerId = data.id;
      conn.on('close', () => removePlayer(data.id));
    } else if (data.type === 'input') {
      const p = players.find(x => x.id === data.id);
      if (p) { p.input = data.input; p.aim = data.aim; }
    }
  });
}

function teamCounts() {
  return players.reduce((a,p) => { if (!p.isBot) a[p.team]++; return a; }, {red:0,blue:0});
}

function makePlayer(id,name,team,isBot=false) {
  const base = team === 'red' ? 300 : 700;
  const redN = players.filter(p=>p.team==='red').length;
  const blueN = players.filter(p=>p.team==='blue').length;
  const n = team === 'red' ? redN : blueN;
  return { id,name,team,isBot, x:base+(isBot?(n%3)*18:0), y:[260,120,400,180,340,260][n%6], vx:0,vy:0,inCemetery:false,dying:false,reintegrationAt:0,input:{},aim:null,defendingUntil:0,defendCooldownUntil:0 };
}

function initHost() {
  players = [];
  players.push(makePlayer(localId, cleanName(), 'red', false));
  for (let i=0;i<5;i++) players.push(makePlayer('bot-r'+i,'Bot Vermelho '+(i+1),'red',true));
  for (let i=0;i<6;i++) players.push(makePlayer('bot-b'+i,'Bot Azul '+(i+1),'blue',true));
  ball = {x:500,y:260,vx:0,vy:0,owner:players[0],hot:false,lastTeam:null};
}

function localPlayer() { return players.find(p => p.id === localId); }

window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
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
  return { up:!!(keys.w||keys.arrowup), down:!!(keys.s||keys.arrowdown), left:!!(keys.a||keys.arrowleft), right:!!(keys.d||keys.arrowright), defend:!!(keys.shift||keys.e) };
}

function throwFromLocal() {
  const p = localPlayer();
  if (!p || ball.owner !== p) return;
  let tx=mouse.x, ty=mouse.y;
  if (lastTouchAim) { tx=lastTouchAim.x; ty=lastTouchAim.y; }
  const throwData={tx,ty,speed:7+mouse.charge*11};
  if (isHost) throwBall(p,tx,ty,throwData.speed); else hostConnection.send({type:'input',id:localId,input:getLocalInput(),aim:throwData});
}

function throwBall(p,tx,ty,speed) {
  if (ball.owner !== p) return;
  const a=Math.atan2(ty-p.y,tx-p.x);
  ball.owner=null; ball.hot=true; ball.lastTeam=p.team;
  ball.vx=Math.cos(a)*speed; ball.vy=Math.sin(a)*speed;
}

function sendToCemetery(p) {
  p.inCemetery=true; p.vx=p.vy=0;
  p.x=p.team==='red'?W-CEM/2:CEM/2; p.y=H/2;
}
function returnFromCemetery(p) {
  p.inCemetery=false; p.x=p.team==='red'?300:700; p.y=H/2;
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
}

function tryDefend(p) {
  if (ball.owner || p.inCemetery || p.dying) return;
  const now = performance.now();
  if (now < (p.defendingUntil || 0)) return;
  if (now < (p.defendCooldownUntil || 0)) return;
  if (Math.hypot(ball.x-p.x, ball.y-p.y) <= PR*2) {
    ball.owner=p;
    ball.hot=false;
    ball.vx=0;
    ball.vy=0;
    p.defendingUntil=now+1000;
    p.defendCooldownUntil=now+5000;
  }
}

function beginElimination(p) {
  if (p.dying || p.inCemetery) return;
  p.dying=true;
  p.reintegrationAt=performance.now()+5000;
  p.vx=0;
  p.vy=0;
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
  updateReintegration(performance.now());
  if(mouse.down && ball.owner===localPlayer()) mouse.charge=Math.min(1,mouse.charge+0.03);

  players.forEach(p => {
    if (p.dying) { p.vx=0; p.vy=0; return; }
    if (p.isBot) updateBot(p);
    else {
      let input=p.input;
      if(p.id===localId) input=getLocalInput();
      const acc=.48;
      if(input?.up)p.vy-=acc; if(input?.down)p.vy+=acc;
      if(input?.left)p.vx-=acc; if(input?.right)p.vx+=acc;
      const movingSpeed=Math.hypot(p.vx,p.vy);
      const maxSpeed=p.inCemetery?5.3:6.2;
      if(movingSpeed>maxSpeed){p.vx=p.vx/movingSpeed*maxSpeed;p.vy=p.vy/movingSpeed*maxSpeed;}
      if(input?.defend) tryDefend(p);
      if(p.aim?.tx!==undefined) { throwBall(p,p.aim.tx,p.aim.ty,p.aim.speed); p.aim=null; }
    }
    p.vx*=.965; p.vy*=.965; p.x+=p.vx; p.y+=p.vy; constrain(p);
  });

  if(ball.owner) {
    const p=ball.owner;
    ball.x=p.x+(p.team==='red'?14:-14); ball.y=p.y;
  } else {
    ball.x+=ball.vx; ball.y+=ball.vy; ball.vx*=.985; ball.vy*=.985;
    if(ball.y<BR||ball.y>H-BR){ball.vy*=-.8;ball.y=Math.max(BR,Math.min(H-BR,ball.y));}
    if(ball.x<BR||ball.x>W-BR){ball.vx*=-.8;ball.x=Math.max(BR,Math.min(W-BR,ball.x));}
    if(Math.hypot(ball.vx,ball.vy)<4.5) ball.hot=false;

    players.forEach(p => {
      if(!p.dying && Math.hypot(ball.x-p.x,ball.y-p.y)<PR+BR) {
        if(ball.hot && ball.lastTeam!==p.team && !p.inCemetery) {
          beginElimination(p); ball.hot=false; ball.vx*=-.3; ball.vy*=-.3;
          const thrower=players.find(x=>x.team===ball.lastTeam&&x.inCemetery);
          if(thrower) returnFromCemetery(thrower);
          checkVictory();
        } else if(!ball.hot) {
          ball.owner=p; ball.vx=0; ball.vy=0;
        }
      }
    });
  }
}

function updateBot(p) {
  if (!ball.owner && Math.hypot(ball.x-p.x,ball.y-p.y) < PR*2) tryDefend(p);
  if(ball.owner===p) {
    const enemies=players.filter(e=>e.team!==p.team&&!e.inCemetery);
    if(enemies.length) { const e=enemies[Math.floor(Math.random()*enemies.length)]; throwBall(p,e.x+(Math.random()*30-15),e.y+(Math.random()*30-15),10+Math.random()*3); }
  } else if(!ball.owner&&!ball.hot) {
    const a=Math.atan2(ball.y-p.y,ball.x-p.x); p.vx+=Math.cos(a)*.28; p.vy+=Math.sin(a)*.28;
  } else if(!p.inCemetery) {
    p.vx+=(Math.random()-.5)*.35; p.vy+=(Math.random()-.5)*.35;
  }
}

function checkVictory() {
  const activeRed=players.filter(p=>p.team==='red'&&!p.inCemetery);
  const activeBlue=players.filter(p=>p.team==='blue'&&!p.inCemetery);
  if(!activeBlue.length){score.red++;matchOver=true;resetAfterWin();}
  if(!activeRed.length){score.blue++;matchOver=true;resetAfterWin();}
}
function resetAfterWin(){ setTimeout(()=>{matchOver=false;players.forEach(p=>{p.inCemetery=false;p.dying=false;p.reintegrationAt=0;p.x=p.team==='red'?300:700;p.y=260;p.vx=p.vy=0;});ball.owner=players.find(p=>p.team==='blue')||null;},2200); }

function broadcast() {
  sendCounter++;
  if(sendCounter%2) return;
  const state={type:'state',players,ball,score,matchOver};
  connections.forEach(conn=>{ if(conn.open) conn.send(state); });
}

function draw() {
  ctx.fillStyle='#538a4b'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#45753e'; ctx.fillRect(0,0,CEM,H); ctx.fillRect(W-CEM,0,CEM,H);
  ctx.strokeStyle='rgba(255,255,255,.75)'; ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.moveTo(CEM,0);ctx.lineTo(CEM,H);ctx.moveTo(W-CEM,0);ctx.lineTo(W-CEM,H);ctx.stroke();
  ctx.beginPath();ctx.arc(W/2,H/2,60,0,Math.PI*2);ctx.stroke();

  const lp=localPlayer();
  if(mouse.down&&lp&&ball.owner===lp){ctx.strokeStyle='#ffdd59b0';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(lp.x,lp.y);ctx.lineTo(mouse.x,mouse.y);ctx.stroke();}

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
    const remaining=(p.defendCooldownUntil||0)-now;
    if(p.id===localId && remaining>0){ctx.beginPath();ctx.arc(p.x,p.y,PR+7,0,Math.PI*2);ctx.strokeStyle='#94a3b8';ctx.lineWidth=3;ctx.stroke();}
    ctx.fillStyle='#fff';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(p.name,p.x,p.y-PR-6);
  });
  ctx.beginPath();ctx.arc(ball.x,ball.y,BR,0,Math.PI*2);ctx.fillStyle=ball.hot?'#ffdd59':'#fff';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#111';ctx.stroke();

  ctx.fillStyle='#fff';ctx.font='700 24px system-ui';ctx.textAlign='center';ctx.fillText(score.blue+'  AZUL',W/2-90,34);ctx.fillText(score.red+'  VERMELHO',W/2+90,34);
  document.getElementById('score').textContent='AZUL '+score.blue+' — '+score.red+' VERMELHO';
  const abilityPlayer=localPlayer();
  const now=performance.now();
  const defendActive=now<(abilityPlayer?.defendingUntil||0);
  const defendRemaining=Math.max(0,((abilityPlayer?.defendCooldownUntil||0)-now)/1000);
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
  if(isHost){updateHost(dt);broadcast();}
  else if(hostConnection){
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
defendBtn.addEventListener('pointerdown',()=>{keys.e=true;});
defendBtn.addEventListener('pointerup',()=>{keys.e=false;});
defendBtn.addEventListener('pointercancel',()=>{keys.e=false;});

document.getElementById('createBtn').addEventListener('click',createRoom);
document.getElementById('joinBtn').addEventListener('click',joinRoom);
document.getElementById('copyBtn').addEventListener('click',async()=>{const url=new URL(location.href);url.searchParams.set('room',roomId);await navigator.clipboard?.writeText(url.href);const b=document.getElementById('copyBtn');b.textContent='Convite copiado!';setTimeout(()=>b.textContent='Copiar convite',1600);});

requestAnimationFrame(loop);
