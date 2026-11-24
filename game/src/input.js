// Keyboard + mouse, in one place. The game reads `keys` as a plain
// object of booleans and `pressed` as edge-triggered one-frame actions,
// so the loop never touches DOM events directly.
export class Input {
  constructor(canvas) {
    this.keys = {};
    this.pressed = {};
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.mouseDown = false;
    this.dragging = false;
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.pressed[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });

    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true; this.dragging = true;
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.mouseDX += e.clientX - (this.lastX ?? e.clientX);
      this.mouseDY += e.clientY - (this.lastY ?? e.clientY);
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Consume one-frame presses after the loop reads them. */
  endFrame() {
    this.pressed = {};
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  get forward() { return !!(this.keys.KeyW || this.keys.ArrowUp); }
  get back() { return !!(this.keys.KeyS || this.keys.ArrowDown); }
  get left() { return !!(this.keys.KeyA || this.keys.ArrowLeft); }
  get right() { return !!(this.keys.KeyD || this.keys.ArrowRight); }
  get sprint() { return !!this.keys.ShiftLeft || !!this.keys.ShiftRight; }
  get handbrake() { return !!this.keys.Space; }

  /** Driving input from the same keys: throttle -1..1, steer -1..1. */
  drive() {
    return {
      throttle: this.forward ? 1 : 0,
      brake: this.back ? 1 : 0,
      steer: (this.left ? -1 : 0) + (this.right ? 1 : 0),
      boost: this.sprint,
      handbrake: this.handbrake,
    };
  }

  walk() {
    return {
      forward: this.forward, back: this.back,
      left: this.left, right: this.right, sprint: this.sprint,
    };
  }

  wasPressed(code) { return !!this.pressed[code]; }
}
