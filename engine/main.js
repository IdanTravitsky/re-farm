// Browser bootstrap: load, then run the game at a fixed 30 Hz like the originals.
import { Assets } from './assets.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { Debug } from './debug.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(320, 240);

ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 320, 240);
ctx.fillStyle = '#888'; ctx.font = '10px serif'; ctx.fillText('NOW LOADING', 128, 116);

const A = await new Assets().boot();
const game = await new Game(A).init();
const input = new Input();
input.attachMouse(canvas);
const params = new URLSearchParams(location.search);
const debug = params.has('debug') ? new Debug(game) : null;

// test / authoring hooks
window.game = game;
window.step = (inp = {}, n = 1) => { for (let i = 0; i < n; i++) game.update({ ...inp }); game.draw(); blit(); };

function blit() { img.data.set(game.fb.px); ctx.putImageData(img, 0, 0); }

let acc = 0, last = performance.now();
function frame(now) {
  acc += Math.min(0.5, (now - last) / 1000);
  last = now;
  if (window.paused) acc = 0;
  let stepped = false;
  while (acc >= 1 / 30) {
    const I = input.read();
    if (debug && I.debug.length) debug.keys(I.debug);
    game.update(I);
    acc -= 1 / 30; stepped = true;
  }
  if (stepped) { game.draw(); blit(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
