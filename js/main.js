import { loadAll } from './world.js';
import { Game } from './game.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

function loading(p) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 320, 240);
  ctx.fillStyle = '#555'; ctx.fillRect(80, 118, 160, 4);
  ctx.fillStyle = '#b01010'; ctx.fillRect(80, 118, 160 * p, 4);
  ctx.fillStyle = '#888'; ctx.font = '10px serif'; ctx.fillText('NOW LOADING', 128, 110);
}

// ---------------------------------------------------------------- input
const held = new Set();
const edge = new Set();
const KEYS = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  run: ['ShiftLeft', 'ShiftRight'], aim: ['KeyZ', 'KeyQ'], fire: ['KeyX', 'Space'],
  confirm: ['Enter', 'KeyE', 'Space'], cancel: ['Escape', 'Backspace', 'KeyC'], menu: ['Tab', 'KeyI'],
};
addEventListener('keydown', (e) => {
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
  if (!held.has(e.code)) edge.add(e.code);
  held.add(e.code);
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());
let mouseAim = false, mouseFire = false;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => { if (e.button === 2) mouseAim = true; if (e.button === 0) mouseFire = true; });
addEventListener('mouseup', (e) => { if (e.button === 2) mouseAim = false; });

let padPrev = [];
function readInput() {
  const any = (names, set) => KEYS[names].some(k => set.has(k));
  const I = {
    up: any('up', held), back: any('down', held), left: any('left', held), right: any('right', held),
    run: any('run', held), aim: any('aim', held) || mouseAim,
    upPressed: any('up', edge), downPressed: any('down', edge), leftPressed: any('left', edge), rightPressed: any('right', edge),
    runPressed: any('run', edge), cancelPressed: any('cancel', edge), menuPressed: any('menu', edge),
  };
  I.firePressed = any('fire', edge) || mouseFire;
  I.confirmPressed = any('confirm', edge);
  I.actionPressed = I.confirmPressed && !I.aim;
  const pad = navigator.getGamepads && [...navigator.getGamepads()].find(p => p);
  if (pad) {
    const b = pad.buttons.map(x => x.pressed), pr = (i) => b[i] && !padPrev[i];
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    I.up ||= ay < -0.5 || b[12]; I.back ||= ay > 0.5 || b[13]; I.left ||= ax < -0.5 || b[14]; I.right ||= ax > 0.5 || b[15];
    I.run ||= b[1]; I.aim ||= b[5] || b[7] || b[6];
    I.upPressed ||= pr(12); I.downPressed ||= pr(13); I.leftPressed ||= pr(14); I.rightPressed ||= pr(15);
    I.runPressed ||= pr(1);
    if (I.aim) I.firePressed ||= pr(0) || pr(2); else { I.confirmPressed ||= pr(0); I.actionPressed ||= pr(0); }
    I.cancelPressed ||= pr(1); I.menuPressed ||= pr(9) || pr(3);
    padPrev = b;
  }
  edge.clear(); mouseFire = false;
  return I;
}

// ---------------------------------------------------------------- boot + loop (30 Hz, like the originals)
loading(0);
const assets = await loadAll(loading);
const game = new Game(assets, canvas);
window.game = game;                  // debugging hook
// deterministic test driver: window.step({up:true,...}, frames)
window.step = (inp = {}, n = 1) => { for (let i = 0; i < n; i++) game.update(Object.assign({}, inp)); game.draw(); };
let acc = 0, last = performance.now();
function frame(now) {
  acc += Math.min(0.5, (now - last) / 1000);
  last = now;
  let stepped = false;
  if (window.paused) acc = 0;           // test hook: freeze the live loop
  while (acc >= 1 / 30) { game.update(readInput()); acc -= 1 / 30; stepped = true; }
  if (stepped) game.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
