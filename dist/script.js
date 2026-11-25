'use strict';
// Engine: no DOM dependencies. Cell IDs 1..7 map to I,O,T,S,Z,J,L.
const SHAPES = [null, [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], [[2,2],[2,2]], [[0,3,0],[3,3,3],[0,0,0]], [[0,4,4],[4,4,0],[0,0,0]], [[5,5,0],[0,5,5],[0,0,0]], [[6,0,0],[6,6,6],[0,0,0]], [[0,0,7],[7,7,7],[0,0,0]]];
const COLORS = ['#101a14','#58d9df','#efd15c','#b38de3','#95d86c','#e67b76','#6b9fe9','#efa460'];
// Clockwise SRS kicks. Coordinates here use screen Y (positive downward).
const KICKS = [ [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]], [[0,0],[1,0],[1,1],[0,-2],[1,-2]], [[0,0],[1,0],[1,-1],[0,2],[1,2]], [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]] ];
const I_KICKS = [ [[0,0],[-2,0],[1,0],[-2,1],[1,-2]], [[0,0],[-1,0],[2,0],[-1,-2],[2,1]], [[0,0],[2,0],[-1,0],[2,-1],[-1,2]], [[0,0],[1,0],[-2,0],[1,2],[-2,-1]] ];
class TetrisEngine {
  constructor(sound = () => {}) { this.sound=sound; this.status='menu'; this.board=this.empty(); this.score=0;this.lines=0;this.level=1;this.active=null;this.next=0; }
  empty(){return Array.from({length:20},()=>Array(10).fill(0));}
  take(){if(!this.bag.length){this.bag=[1,2,3,4,5,6,7];for(let i=6;i>0;i--){const j=Math.floor(Math.random()*(i+1));[this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];}}return this.bag.pop();}
  start(){this.board=this.empty();this.score=0;this.lines=0;this.level=1;this.bag=[];this.next=this.take();this.status='playing';this.fall=0;this.lock=0;this.resets=0;this.spawn();this.sound('start');}
  spawn(){const id=this.next;this.next=this.take();this.active={id,m:SHAPES[id].map(r=>r.slice()),x:id===2?4:3,y:-1,r:0};this.lock=0;this.resets=0;this.fall=0;if(this.collides(this.active.m,this.active.x,this.active.y))this.end();}
  collides(m,x,y){return m.some((row,dy)=>row.some((v,dx)=>v&&(x+dx<0||x+dx>=10||y+dy>=20||(y+dy>=0&&this.board[y+dy][x+dx]))));}
  get grounded(){const a=this.active;return a&&this.collides(a.m,a.x,a.y+1);}
  resetLock(wasGrounded){if(wasGrounded&&this.resets<15){this.lock=0;this.resets++;}}
  move(dx){if(this.status!=='playing')return;const a=this.active,g=this.grounded;if(!this.collides(a.m,a.x+dx,a.y)){a.x+=dx;this.resetLock(g);this.sound('move');}}
  rotate(){if(this.status!=='playing'||this.active.id===2)return;const a=this.active,g=this.grounded,m=a.m[0].map((_,x)=>a.m.map(row=>row[x]).reverse());for(const [dx,dy] of (a.id===1?I_KICKS:KICKS)[a.r]){if(!this.collides(m,a.x+dx,a.y+dy)){a.m=m;a.x+=dx;a.y+=dy;a.r=(a.r+1)%4;this.resetLock(g);this.sound('rotate');return;}}}
  down(manual=false){if(this.status!=='playing')return false;const a=this.active;if(!this.collides(a.m,a.x,a.y+1)){a.y++;if(manual)this.score++;return true;}return false;}
  hardDrop(){if(this.status!=='playing')return;while(this.down())this.score+=2;this.fix();}
  fix(){const a=this.active;let above=false;a.m.forEach((row,dy)=>row.forEach((v,dx)=>{if(v){if(a.y+dy<0)above=true;else this.board[a.y+dy][a.x+dx]=v;}}));if(above){this.end();return;}const remaining=this.board.filter(row=>row.some(v=>!v)),count=20-remaining.length;this.board=[...Array.from({length:count},()=>Array(10).fill(0)),...remaining];this.score+=([0,100,300,500,800][count]||0)*this.level;this.lines+=count;this.level=1+Math.floor(this.lines/10);this.sound(count?'clear':'lock');this.spawn();}
  end(){this.status='over';this.sound('over');}
  pause(){if(this.status==='playing')this.status='paused';else if(this.status==='paused')this.status='playing';}
  tick(dt){if(this.status!=='playing')return;this.fall+=dt;const interval=Math.max(65,800*Math.pow(.8,this.level-1));while(this.fall>=interval){this.fall-=interval;if(!this.down()){this.fall=0;break;}}if(this.grounded){this.lock+=dt;if(this.lock>=500)this.fix();}else this.lock=0;}
}

class RetroAudio {
  constructor(){this.enabled=true;this.context=null;}
  unlock(){try{this.context ||= new (window.AudioContext||window.webkitAudioContext)();this.context.resume().catch(()=>{});}catch{}}
  play(event){if(!this.enabled||!this.context)return;const notes={move:[180],rotate:[300,450],lock:[110,80],clear:[440,554,659,880],over:[330,261,196,130],start:[330,440,659]}[event]||[];const ctx=this.context;notes.forEach((hz,i)=>{const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime+i*.065;o.type='square';o.frequency.value=hz;g.gain.setValueAtTime(.035,t);g.gain.exponentialRampToValueAtTime(.001,t+.065);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+.07);});}
}

class TFTRenderer {
  constructor(canvas){this.ctx=canvas.getContext('2d');this.ctx.imageSmoothingEnabled=false;}
  text(str,x,y,size=8,color='#a8b79b'){const c=this.ctx;c.fillStyle=color;c.font=`${size}px monospace`;c.textAlign='left';c.fillText(str,x,y);}
  block(x,y,id,s=12,ghost=false){const c=this.ctx;c.fillStyle=COLORS[id];if(ghost){c.strokeStyle=COLORS[id];c.globalAlpha=.3;c.strokeRect(x+1.5,y+1.5,s-3,s-3);c.globalAlpha=1;return;}c.fillRect(x+1,y+1,s-2,s-2);c.fillStyle='#ffffff40';c.fillRect(x+2,y+2,s-4,2);c.fillStyle='#0003';c.fillRect(x+2,y+s-4,s-4,2);}
  draw(g, remote=false) {
    const c = this.ctx, left = 8, top = 10, cell = 15, hud = 169;
    c.fillStyle = '#100b22';
    c.fillRect(0, 0, 240, 320);
    c.strokeStyle = '#6454ac';
    c.strokeRect(left - .5, top - .5, 151, 301);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) {
      const px = left + x * cell, py = top + y * cell;
      c.fillStyle = '#201737';
      c.fillRect(px, py, cell - 1, cell - 1);
      if (g.board[y][x]) this.block(px, py, g.board[y][x], cell);
    }

    const piece = g.active;
    if (piece) {
      let ghostY = piece.y;
      if (!remote) while (!g.collides(piece.m, piece.x, ghostY + 1)) ghostY++;
      piece.m.forEach((row, dy) => row.forEach((id, dx) => {
        if (!id) return;
        const x = left + (piece.x + dx) * cell;
        if (!remote && ghostY + dy >= 0) this.block(x, top + (ghostY + dy) * cell, id, cell, true);
        if (piece.y + dy >= 0) this.block(x, top + (piece.y + dy) * cell, id, cell);
      }));
    }

    for (const [label, value, y] of [
      ['PONTOS', g.score, 33], ['NÍVEL', g.level, 91], ['LINHAS', g.lines, 149]
    ]) {
      this.text(label, hud, y, 8, '#bcace4');
      const digits = String(value);
      this.text(digits, hud, y + 21, digits.length > 7 ? 12 : 15, '#fff2ff');
    }
    this.text('PRÓXIMA', hud, 207, 8, '#bcace4');
    SHAPES[g.next]?.forEach((row, y) => row.forEach((id, x) => {
      if (id) this.block(hud + x * 14, 219 + y * 14, id, 14);
    }));
    this.text(remote ? 'ESP32' : 'OFFLINE', hud, 302, 8, '#8cf8f2');
    if (g.status === 'paused') {
      c.fillStyle = '#100b22ee';
      c.fillRect(left, 128, 150, 65);
      this.text('PAUSADO', 29, 153, 18, '#8cf8f2');
      this.text(remote && g.controls === 2 ? 'GIRAR / CONTINUAR' : 'P / CONTINUAR', 16, 170, 8, '#fff2ff');
      if (!remote || g.controls === 2) this.text('ESQUERDA / MENU', 16, 184, 8, '#fff2ff');
    }
  }
}

// Proposed protocol, NOT UUIDs from an existing firmware. See README.
const BLE_CONFIG=Object.freeze({service:'702a0001-3a5a-4b2e-9f4c-18c8e6503200',state:'702a0002-3a5a-4b2e-9f4c-18c8e6503200',command:'702a0003-3a5a-4b2e-9f4c-18c8e6503200'});
class ESP32BLE {
  constructor(onState,onStatus){this.onState=onState;this.onStatus=onStatus;this.connected=false;this.buffer='';this.decoder=new TextDecoder();this.queue=Promise.resolve();}
  async connect(){if(!navigator.bluetooth)throw Error('Web Bluetooth indisponível. Use Chrome Android/desktop compatível e HTTPS ou localhost.');if(!window.isSecureContext)throw Error('Bluetooth exige HTTPS ou localhost. O modo offline continua disponível.');this.onStatus('Procurando ESP32…');try{this.device=await navigator.bluetooth.requestDevice({filters:[{services:[BLE_CONFIG.service]}]});this.device.addEventListener('gattserverdisconnected',()=>this.disconnected());const server=await this.device.gatt.connect(),service=await server.getPrimaryService(BLE_CONFIG.service);this.state=await service.getCharacteristic(BLE_CONFIG.state);this.command=await service.getCharacteristic(BLE_CONFIG.command);this.buffer='';this.decoder=new TextDecoder();this.state.addEventListener('characteristicvaluechanged',e=>this.receive(e.target.value));await this.state.startNotifications();this.connected=true;this.onStatus('Conectado · aguardando estado do ESP32');await this.send('sync');}catch(e){this.disconnect();throw e;}}
  receive(value){this.buffer+=this.decoder.decode(value,{stream:true});if(this.buffer.length>16384){this.buffer='';this.onStatus('Pacote BLE excede o limite.');return;}let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);try{const s=JSON.parse(line);if(!ESP32BLE.valid(s))throw Error();this.onState(s);}catch{this.onStatus('Estado BLE inválido; aguardando novo pacote.');}}}
  static valid(s){const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;if (s?.v === 1 && ['menu','help'].includes(s.status)) return integer(s.menuSelection,0,1);return s&&s.v===1&&Array.isArray(s.board)&&s.board.length===20&&s.board.every(r=>Array.isArray(r)&&r.length===10&&r.every(v=>integer(v,0,7)))&&integer(s.score,0,999999999)&&integer(s.lines,0,9999999)&&integer(s.level,1,999999)&&integer(s.next,1,7)&&['playing','paused','over'].includes(s.status)&&(s.menuSelection===undefined||integer(s.menuSelection,0,1))&&(s.active===null||(s.active&&integer(s.active.id,1,7)&&integer(s.active.x,-4,9)&&integer(s.active.y,-4,19)&&Array.isArray(s.active.m)&&s.active.m.length>=2&&s.active.m.length<=4&&s.active.m.every(r=>Array.isArray(r)&&r.length===s.active.m.length&&r.every(v=>v===0||v===s.active.id))&&s.active.m.flat().filter(Boolean).length===4&&s.active.m.every((r,dy)=>r.every((v,dx)=>!v||(s.active.x+dx>=0&&s.active.x+dx<10&&s.active.y+dy<20)))));}
  send(action){if(!this.connected)return Promise.resolve();this.queue=this.queue.catch(()=>{}).then(async()=>{if(this.connected)await this.command.writeValueWithResponse(new TextEncoder().encode(JSON.stringify({v:1,action})+'\n'));}).catch(()=>{this.onStatus('Falha ao enviar comando ao ESP32.');});return this.queue;}
  disconnected(){this.connected=false;this.onStatus('Desconectado · modo offline disponível');}
  disconnect(){if(this.device?.gatt.connected)this.device.gatt.disconnect();this.disconnected();}
}

if(typeof document!=='undefined'){
const $=id=>document.getElementById(id),audio=new RetroAudio(),game=new TetrisEngine(e=>audio.play(e)),renderer=new TFTRenderer($('display'));
let remote = null, connecting = false, last = 0;
let screen = 'menu', menuSelection = 0, legacyStarted = false;
const overlay = $('overlay'), helpDialog = $('help-dialog');
const menuButtons = [$('start'), $('help')];
const connectHint = 'Conecte o ESP32 para usar os botões físicos.';
const legacyHint = 'Este firmware só envia a partida. Grave o firmware atualizado para usar Girar no menu.';

function selectMenu(index) {
  menuSelection = index;
  menuButtons.forEach((button, i) => button.classList.toggle('selected', i === index));
}

function showScreen(next) {
  if (screen !== next) clearInputs();
  screen = next;
  overlay.classList.toggle('hidden', !['menu', 'help'].includes(next));
  $('round-end').classList.toggle('hidden', next !== 'over');
  $('pause').disabled = next !== 'playing' && next !== 'paused';
  $('pause').textContent = next === 'paused' ? 'CONTINUAR' : 'PAUSAR';
  if (next === 'help' && !helpDialog.open) helpDialog.showModal();
  if (next !== 'help' && helpDialog.open) helpDialog.close();
}

const ble = new ESP32BLE(state => {
  remote = state;
  const legacy = state.menuSelection === undefined;
  if (!legacy) selectMenu(state.menuSelection);
  $('round-end').querySelector('p').hidden = state.controls !== 2;
  $('menu-hint').textContent = legacy ? legacyHint : 'Esquerda ↓ · Descer ↑ · Girar confirma';
  const status = state.controls === 2 ? 'Controle físico conectado' : 'Atualize o firmware para controlar todas as telas da partida.';
  $('connection-status').textContent = legacy ? legacyHint : status;
  showScreen(legacy && !legacyStarted ? (helpDialog.open ? 'help' : 'menu') : state.status);
}, message => {
  const active = ble.connected;
  $('connection-status').textContent = message;
  $('connection-title').textContent = active ? 'ESP32 conectado' : 'Modo independente';
  $('connect').querySelector('span').textContent = active ? 'DESCONECTAR' : 'CONECTAR ESP32';
  $('connect-menu').hidden = active;
  document.querySelector('.local').innerHTML = active ? '<i></i> MODO ESP32' : '<i></i> MODO OFFLINE';
  if (!active && (remote || game.status === 'menu' || !connecting)) {
    remote = null;
    legacyStarted = false;
    $('round-end').querySelector('p').hidden = false;
    game.status = 'menu';
    selectMenu(0);
    showScreen('menu');
  }
  if (active && !remote) {
    game.status = 'menu';
    showScreen('menu');
  }
  $('menu-hint').textContent = active || connecting ? message : connectHint;
});

function start() {
  audio.unlock();
  clearInputs();
  if (ble.connected) {
    if (!remote) return;
    if (remote.menuSelection === undefined) legacyStarted = true;
    ble.send('restart');
    return;
  }
  game.start();
  showScreen('playing');
}

function showHelp() {
  clearInputs();
  if (ble.connected && remote?.menuSelection !== undefined) {
    ble.send('help');
    return;
  }
  showScreen('help');
}

function closeHelp() {
  if (ble.connected && remote?.status === 'help') ble.send('rotate');
  else showScreen('menu');
}

function action(name) {
  audio.unlock();
  if (helpDialog.open) {
    if (name === 'rotate') closeHelp();
    return;
  }
  if (!overlay.classList.contains('hidden')) {
    if (!['left', 'down', 'rotate'].includes(name)) return;
    if (ble.connected && !remote) return;
    if (ble.connected && remote.menuSelection !== undefined) ble.send(name);
    else if (name === 'rotate') menuButtons[menuSelection].click();
    else selectMenu(name === 'left' ? 1 : 0);
    return;
  }
  if (screen === 'paused' || screen === 'over') {
    if (name === 'rotate' && screen === 'over') { start(); return; }
    if (name === 'rotate') name = 'pause';
    if (name === 'left' && !ble.connected) {
      game.status = 'menu';
      selectMenu(0);
      showScreen('menu');
      return;
    }
  }
  if(ble.connected){ble.send(name);return;}
  if(name==='pause'){game.pause();showScreen(game.status);clearInputs();}else if(name==='left')game.move(-1);else if(name==='right')game.move(1);else if(name==='rotate')game.rotate();else if(name==='down')game.down(true);else if(name==='drop')game.hardDrop();
}
const held = new Map();
function clearInputs() { held.clear(); }
function press(key, name) {
  action(name);
  if (screen === 'playing' && name === 'down') held.set(key, { name, wait: 45 });
}
function release(key) { held.delete(key); }
const keys={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'rotate',ArrowDown:'down',Space:'drop',KeyP:'pause'};
window.addEventListener('keydown',e=>{if(helpDialog.open&&e.code!=='ArrowUp'||['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)&&e.code==='Space')return;const name=keys[e.code];if(!name)return;e.preventDefault();if(!e.repeat)press(e.code,name);});window.addEventListener('keyup',e=>release(e.code));
$('start').onclick = start;
$('restart').onclick = start;
$('pause').onclick = () => action('pause');
$('help').onclick=showHelp;
$('close-help').onclick=closeHelp;
helpDialog.addEventListener('cancel', event => { event.preventDefault(); closeHelp(); });
selectMenu(0);
async function connect(){if(connecting)return;if(ble.connected){ble.disconnect();return;}connecting=true;try{await ble.connect();}catch(e){$('connection-status').textContent=e.name==='NotFoundError'?'Seleção cancelada · modo offline disponível':e.message;$('menu-hint').textContent=$('connection-status').textContent;}finally{connecting=false;}}
$('connect').onclick=connect;$('connect-menu').onclick=connect;
function inactive(){clearInputs();if(game.status==='playing')game.pause();}window.addEventListener('blur',inactive);document.addEventListener('visibilitychange',()=>{if(document.hidden)inactive();last=0;});
function frame(t){const dt=last?Math.min(t-last,100):0;last=t;if(!document.hidden){for(const h of held.values()){h.wait-=dt;if(h.wait<=0){action(h.name);h.wait+=40;}}if (!ble.connected) {
  game.tick(dt);
  if (screen !== 'help' && game.status !== screen) showScreen(game.status);
}
if (screen === 'playing' || screen === 'paused') renderer.draw(remote || game, Boolean(remote));}requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
if(typeof module!=='undefined')module.exports={TetrisEngine,ESP32BLE,SHAPES};
