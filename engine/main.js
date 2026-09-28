// Fixed 30 Hz simulation; rendering resolution is independent of game coordinates.
import { Assets } from './assets.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { Debug } from './debug.js';
import { Frame } from './psx.js';
import { context } from './audio.js';

const $ = id => document.getElementById(id);
const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha: false });
let settings = { quality: 2, brightness: 1.12, hints: true, scanlines: false, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
try { Object.assign(settings, JSON.parse(localStorage.getItem('night_zero_settings') || '{}')); } catch {}
settings.quality = settings.quality === 1 ? 1 : 2;
settings.brightness = Math.max(.8, Math.min(1.6, Number(settings.brightness) || 1.12));
let game, input, img, acc = 0, last = performance.now();
const dialog = $('settings');
function applySettings() {
  if (game && game.fb.scale !== settings.quality) game.fb = new Frame(320,240,settings.quality);
  if (game) {
    game.hints = !!settings.hints; game.reducedMotion = !!settings.reducedMotion;
    canvas.width = game.fb.w; canvas.height = game.fb.h;
    img = ctx.createImageData(game.fb.w,game.fb.h);
  }
  canvas.classList.toggle('enhanced',settings.quality === 2);
  canvas.style.filter = `brightness(${settings.brightness})`;
  $('scan').hidden = !settings.scanlines;
  $('quality').value = String(settings.quality); $('brightness').value = settings.brightness;
  $('hints').checked = settings.hints; $('scanlines').checked = settings.scanlines; $('reduce-motion').checked = settings.reducedMotion;
  try { localStorage.setItem('night_zero_settings',JSON.stringify(settings)); } catch {}
  if (game) { game.draw(); blit(); }
}
function pause() {
  if (!dialog.open) dialog.showModal();
  input?.reset(); acc=0;
  context()?.suspend().catch(()=>{});
}
function resume() {
  dialog.close(); input?.reset(); last=performance.now(); acc=0;
  context()?.resume().catch(()=>{}); canvas.focus();
}
$('settings-button').onclick = pause; $('resume').onclick = resume;
dialog.addEventListener('cancel', e => { e.preventDefault(); resume(); });
$('fullscreen').onclick = async () => {
  try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {}
};
for (const [id,key] of [['quality','quality'],['brightness','brightness'],['hints','hints'],['scanlines','scanlines'],['reduce-motion','reducedMotion']]) {
  $(id).addEventListener('input',()=>{ settings[key]=$(id).type==='checkbox'?$(id).checked:Number($(id).value); applySettings(); });
}
addEventListener('keydown',e=>{
  if(e.code==='KeyP' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); dialog.open?resume():pause(); }
  if(e.altKey && e.code==='KeyS') { e.preventDefault(); settings.scanlines=!settings.scanlines; applySettings(); }
},true);
addEventListener('blur',()=>{ if(game?.mode==='play') pause(); });
document.addEventListener('visibilitychange',()=>{ if(document.hidden) pause(); });
function failure(error) {
  console.error(error); $('status').hidden=false; $('status').replaceChildren();
  const p=document.createElement('p');p.textContent='The game could not load. Check your connection and reload to retry. '+(error.message || error);
  const b=document.createElement('button');b.textContent='Reload';b.onclick=()=>location.reload();
  p.append(document.createElement('br'),b);$('status').append(p);
}
function blit() {
  img.data.set(game.fb.px); ctx.putImageData(img,0,0);
  // Shake scenery and actors together, keeping their depth masks aligned.
  const k = game.reducedMotion ? 0 : Math.min(2,game.fx.shake*2);
  canvas.style.transform=k?`translate(${(Math.random()-.5)*k}px,${(Math.random()-.5)*k}px)`:'';
}
try {
  const A = await new Assets().boot();
  game = await new Game(A,{scale:settings.quality}).init();
  game.onError=failure;
  input = new Input(); input.attachMouse(canvas);
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug') ? new Debug(game) : null;
  window.game=game;
  window.step=(inp={},n=1)=>{for(let i=0;i<n;i++)game.update({...inp});game.draw();blit();};
  applySettings(); $('status').hidden=true; canvas.focus(); last=performance.now();
  function frame(now) {
    const paused=window.paused || dialog.open || document.hidden;
    acc=paused?0:acc+Math.min(.1,(now-last)/1000);last=now;
    try {
      let stepped=false;
      while(acc>=1/30) {
        const I=input.read();if(debug && I.debug.length)debug.keys(I.debug);
        game.update(I);acc-=1/30;stepped=true;
      }
      if(stepped){game.draw();blit();}
    } catch(error) { game.fail(error); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch(error) { failure(error); }
