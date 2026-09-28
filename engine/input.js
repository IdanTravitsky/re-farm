// Keyboard + mouse + gamepad -> one input snapshot per 30 Hz tick.
const KEYS = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  run: ['ShiftLeft', 'ShiftRight'], aim: ['KeyZ', 'KeyQ'], fire: ['KeyX', 'Space'],
  confirm: ['Enter', 'KeyE', 'Space'], cancel: ['Escape', 'Backspace', 'KeyC'], menu: ['Tab', 'KeyI'], map: ['KeyM'],
  prevTab: ['BracketLeft', 'PageUp'], nextTab: ['BracketRight', 'PageDown'],
  reload: ['KeyR'], cycle: ['KeyV'],
};

export class Input {
  constructor(target = globalThis) {
    this.held = new Set(); this.edge = new Set(); this.mouseAim = false; this.mouseFire = false; this.padPrev = [];
    if (!target.addEventListener) return;
    target.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target?.tagName)) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
      if (!this.held.has(e.code)) this.edge.add(e.code);
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.reset());
  }
  reset() { this.held.clear(); this.edge.clear(); this.mouseAim = false; this.mouseFire = false; this.padPrev = []; this.axisPrev = []; }
  attachMouse(el) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => { el.focus(); if (e.button === 2) this.mouseAim = true; if (e.button === 0) this.mouseFire = true; });
    globalThis.addEventListener('mouseup', (e) => { if (e.button === 2) this.mouseAim = false; });
  }
  read() {
    const any = (n, set) => KEYS[n].some(k => set.has(k));
    const H = this.held, E = this.edge;
    const I = {
      up: any('up', H), back: any('down', H), left: any('left', H), right: any('right', H),
      run: any('run', H), aim: any('aim', H) || this.mouseAim,
      upPressed: any('up', E), downPressed: any('down', E), leftPressed: any('left', E), rightPressed: any('right', E),
      runPressed: any('run', E), cancelPressed: any('cancel', E), menuPressed: any('menu', E), mapPressed: any('map', E),
      prevTabPressed: any('prevTab', E), nextTabPressed: any('nextTab', E),
      reloadPressed: any('reload', E), cyclePressed: any('cycle', E),
      firePressed: any('fire', E) || this.mouseFire, confirmPressed: any('confirm', E),
      debug: [...E].filter(k => /^F\d$/.test(k)),
    };
    const pad = globalThis.navigator?.getGamepads && [...navigator.getGamepads()].find(p => p);
    if (pad) {
      const b = pad.buttons.map(x => x.pressed), pr = (i) => b[i] && !this.padPrev[i];
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      I.up ||= ay < -0.5 || b[12]; I.back ||= ay > 0.5 || b[13]; I.left ||= ax < -0.5 || b[14]; I.right ||= ax > 0.5 || b[15];
      I.run ||= b[1]; I.aim ||= b[7] || b[6];
      const axes = [ay < -.5, ay > .5, ax < -.5, ax > .5], prev = this.axisPrev || [];
      I.upPressed ||= pr(12) || axes[0] && !prev[0]; I.downPressed ||= pr(13) || axes[1] && !prev[1];
      I.leftPressed ||= pr(14) || axes[2] && !prev[2]; I.rightPressed ||= pr(15) || axes[3] && !prev[3];
      this.axisPrev = axes; I.reloadPressed ||= I.aim && pr(3); I.cyclePressed ||= !I.aim && pr(2);
      I.runPressed ||= pr(1); I.prevTabPressed ||= pr(4); I.nextTabPressed ||= pr(5);
      if (I.aim) I.firePressed ||= pr(0) || pr(2); else { I.confirmPressed ||= pr(0); I.actionPressed ||= pr(0); }
      I.cancelPressed ||= pr(1); I.menuPressed ||= pr(9) || (!I.aim && pr(3)); I.mapPressed ||= pr(8);
      this.padPrev = b;
    }
    if (!pad) { this.padPrev = []; this.axisPrev = []; }
    I.actionPressed = I.confirmPressed && !I.aim;
    this.edge.clear(); this.mouseFire = false;
    return I;
  }
}
