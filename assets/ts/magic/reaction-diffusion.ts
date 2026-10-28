/**
 * 反应扩散
 * Gray–Scott：∂u/∂t = Du∇²u − uv² + F(1−u)，∂v/∂t = Dv∇²v + uv² − (F+k)v。
 * Du = 1，Dv = 0.5，拉普拉斯用九点核。点一下播种，方括号换一组 F / k。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, isInteractiveTarget, isTypingTarget, liftAuthorCard } from './utils/dom';
import { renderTips } from './utils/tips-render';

interface Preset {
  name: string;
  f: number;
  k: number;
}

const PRESETS: Preset[] = [
  { name: '斑点', f: 0.03, k: 0.062 },
  { name: '珊瑚', f: 0.0545, k: 0.062 },
  { name: '迷宫', f: 0.029, k: 0.057 },
  { name: '蠕虫', f: 0.078, k: 0.061 },
  { name: '分裂', f: 0.0367, k: 0.0649 },
  { name: '螺旋', f: 0.018, k: 0.051 },
];

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

class ReactionDiffusion extends Disposable {
  private stage: FullscreenStage;
  private cols = 0;
  private rows = 0;
  private u = new Float32Array(0);
  private v = new Float32Array(0);
  private nu = new Float32Array(0);
  private nv = new Float32Array(0);
  private plate: HTMLCanvasElement | null = null;
  private plateCtx: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private lut = new Uint8ClampedArray(256 * 4);
  private lutDark: boolean | null = null;
  private preset = 1;
  private painting = false;
  private hasBrush = false;
  private brushX = 0;
  private brushY = 0;
  private textColor = '#3e3e5f';
  private pillColor = 'rgba(255, 255, 255, 0.82)';
  private fontFamily = 'sans-serif';
  private animationId: number | null = null;

  constructor() {
    super();
    this.stage = createFullscreenStage({
      pointerEvents: 'none',
      opacity: '0',
    });
    this._register(this.stage.canvas);
    this.fontFamily = getComputedStyle(document.body).fontFamily || this.fontFamily;
    this.readTheme();
    this.allocate();
    this.stage.onResize = () => this.allocate();

    this._register(new DomListener(window, 'pointerdown', this.onPointerDown));
    this._register(new DomListener(window, 'pointermove', this.onPointerMove));
    this._register(new DomListener(window, 'pointerup', this.onPointerUp));
    this._register(new DomListener(window, 'pointercancel', this.onPointerUp));
    this._register(new DomListener(window, 'keydown', this.onKeyDown));
    this.animationId = requestAnimationFrame(this.frame);
  }

  get element(): HTMLCanvasElement {
    return this.stage.canvas.element;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }
    this.painting = true;
    this.hasBrush = false;
    this.sowEvent(event, 7.5);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.painting || (event.buttons & 1) === 0) {
      return;
    }
    this.sowEvent(event, 6.2);
  };

  private onPointerUp = (): void => {
    this.painting = false;
    this.hasBrush = false;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
      return;
    }
    if (event.code === 'BracketLeft' || event.code === 'Minus') {
      this.cycle(-1);
    } else if (event.code === 'BracketRight' || event.code === 'Equal') {
      this.cycle(1);
    }
  };

  private cycle(delta: number): void {
    this.preset = (this.preset + delta + PRESETS.length) % PRESETS.length;
    this.sow(this.cols * 0.5, this.rows * 0.46, 8);
    this.sow(this.cols * 0.32, this.rows * 0.58, 6);
    this.sow(this.cols * 0.68, this.rows * 0.6, 6);
  }

  private readTheme(): void {
    const style = getComputedStyle(document.documentElement);
    this.textColor = style.getPropertyValue('--theme-text-primary').trim() || this.textColor;
    const background = style.getPropertyValue('--theme-bg-high').trim();
    if (background) {
      this.pillColor = background;
    }
  }

  private allocate(): void {
    const { width, height } = this.stage;
    if (width < 2 || height < 2) {
      return;
    }
    const cell = Math.max(4, Math.sqrt((width * height) / 26000));
    const cols = Math.max(48, Math.round(width / cell));
    const rows = Math.max(48, Math.round(height / cell));
    if (cols === this.cols && rows === this.rows) {
      return;
    }
    const count = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.u = new Float32Array(count);
    this.nu = new Float32Array(count);
    this.v = new Float32Array(count);
    this.nv = new Float32Array(count);
    this.u.fill(1);
    this.nu.fill(1);
    const plate = document.createElement('canvas');
    plate.width = cols;
    plate.height = rows;
    const plateCtx = plate.getContext('2d');
    if (!plateCtx) {
      return;
    }
    this.plate = plate;
    this.plateCtx = plateCtx;
    this.image = plateCtx.createImageData(cols, rows);
    this.germinate();
  }

  private germinate(): void {
    this.sow(this.cols * 0.42, this.rows * 0.4, 7);
    this.sow(this.cols * 0.58, this.rows * 0.5, 6);
    this.sow(this.cols * 0.48, this.rows * 0.64, 5);
  }

  private sowEvent(event: PointerEvent, radius: number): void {
    const x = event.clientX / this.stage.width * this.cols;
    const y = event.clientY / this.stage.height * this.rows;
    if (this.hasBrush) {
      const dx = x - this.brushX;
      const dy = y - this.brushY;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(dist / 2.4));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.sow(this.brushX + dx * t, this.brushY + dy * t, radius);
      }
    } else {
      this.sow(x, y, radius);
    }
    this.brushX = x;
    this.brushY = y;
    this.hasBrush = true;
  }

  private sow(gx: number, gy: number, radius: number): void {
    const cols = this.cols;
    const rows = this.rows;
    const r2 = radius * radius;
    const x0 = Math.floor(gx - radius);
    const x1 = Math.ceil(gx + radius);
    const y0 = Math.floor(gy - radius);
    const y1 = Math.ceil(gy + radius);
    for (let y = y0; y <= y1; y++) {
      if (y < 1 || y >= rows - 1) {
        continue;
      }
      for (let x = x0; x <= x1; x++) {
        if (x < 1 || x >= cols - 1) {
          continue;
        }
        const dx = x + 0.5 - gx;
        const dy = y + 0.5 - gy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) {
          continue;
        }
        const fall = 1 - d2 / r2;
        const notch = 0.65 + 0.35 * Math.sin(Math.atan2(dy, dx) * 3);
        const i = y * cols + x;
        const nextV = Math.max(this.v[i], fall * notch);
        this.v[i] = nextV > 1 ? 1 : nextV;
        const nextU = Math.min(this.u[i], 1 - 0.55 * fall);
        this.u[i] = nextU < 0 ? 0 : nextU;
      }
    }
  }

  private step(f: number, k: number): void {
    const cols = this.cols;
    const rows = this.rows;
    const u = this.u;
    const v = this.v;
    const nu = this.nu;
    const nv = this.nv;
    const kill = f + k;
    for (let y = 1; y < rows - 1; y++) {
      const row = y * cols;
      const up = row - cols;
      const down = row + cols;
      for (let x = 1; x < cols - 1; x++) {
        const i = row + x;
        const uc = u[i];
        const vc = v[i];
        const lapU =
          u[up - 1 + x] * 0.05 + u[up + x] * 0.2 + u[up + 1 + x] * 0.05 +
          u[i - 1] * 0.2 + uc * -1 + u[i + 1] * 0.2 +
          u[down - 1 + x] * 0.05 + u[down + x] * 0.2 + u[down + 1 + x] * 0.05;
        const lapV =
          v[up - 1 + x] * 0.05 + v[up + x] * 0.2 + v[up + 1 + x] * 0.05 +
          v[i - 1] * 0.2 + vc * -1 + v[i + 1] * 0.2 +
          v[down - 1 + x] * 0.05 + v[down + x] * 0.2 + v[down + 1 + x] * 0.05;
        const uvv = uc * vc * vc;
        let nextU = uc + (lapU - uvv + f * (1 - uc));
        let nextV = vc + (0.5 * lapV + uvv - kill * vc);
        if (nextU < 0) nextU = 0;
        else if (nextU > 1) nextU = 1;
        if (nextV < 0) nextV = 0;
        else if (nextV > 1) nextV = 1;
        nu[i] = nextU;
        nv[i] = nextV;
      }
    }
    this.u = nu;
    this.v = nv;
    this.nu = u;
    this.nv = v;
  }

  private ensureLut(dark: boolean): void {
    if (this.lutDark === dark) {
      return;
    }
    this.lutDark = dark;
    const deep = dark ? [18, 52, 62] : [10, 58, 52];
    const mid = dark ? [84, 206, 154] : [16, 150, 88];
    const hot = dark ? [255, 228, 186] : [255, 236, 196];
    const lut = this.lut;
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const offset = i * 4;
      if (t < 0.045) {
        lut[offset + 3] = 0;
        continue;
      }
      const u = (t - 0.045) / 0.955;
      let red: number;
      let green: number;
      let blue: number;
      if (u < 0.5) {
        const s = u / 0.5;
        red = deep[0] + (mid[0] - deep[0]) * s;
        green = deep[1] + (mid[1] - deep[1]) * s;
        blue = deep[2] + (mid[2] - deep[2]) * s;
      } else {
        const s = (u - 0.5) / 0.5;
        red = mid[0] + (hot[0] - mid[0]) * s;
        green = mid[1] + (hot[1] - mid[1]) * s;
        blue = mid[2] + (hot[2] - mid[2]) * s;
      }
      lut[offset] = red;
      lut[offset + 1] = green;
      lut[offset + 2] = blue;
      lut[offset + 3] = Math.min(255, (36 + u * 219) | 0);
    }
  }

  private draw(): void {
    const image = this.image;
    const plate = this.plate;
    const plateCtx = this.plateCtx;
    if (!image || !plate || !plateCtx) {
      return;
    }
    const dark = document.documentElement.classList.contains('theme-dark');
    this.ensureLut(dark);
    const data = image.data;
    const values = this.v;
    const lut = this.lut;
    for (let i = 0; i < values.length; i++) {
      const index = Math.min(255, (values[i] * 280) | 0) * 4;
      const offset = i * 4;
      data[offset] = lut[index];
      data[offset + 1] = lut[index + 1];
      data[offset + 2] = lut[index + 2];
      data[offset + 3] = lut[index + 3];
    }
    plateCtx.putImageData(image, 0, 0);
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(plate, 0, 0, width, height);
    this.drawBadge(ctx, width);
  }

  private drawBadge(ctx: CanvasRenderingContext2D, width: number): void {
    const preset = PRESETS[this.preset];
    const label = preset.name;
    ctx.save();
    ctx.font = `14px ${this.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(label).width;
    const x = width / 2;
    const y = 36;
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = this.pillColor;
    roundRect(ctx, x - textWidth / 2 - 14, y - 16, textWidth + 28, 32, 12);
    ctx.fill();
    ctx.fillStyle = this.textColor;
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  private frame = (): void => {
    const preset = PRESETS[this.preset];
    const cells = this.cols * this.rows;
    const steps = cells > 0 ? Math.max(6, Math.min(10, (280000 / cells) | 0)) : 0;
    for (let i = 0; i < steps; i++) {
      this.step(preset.f, preset.k);
    }
    this.draw();
    this.animationId = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.u = new Float32Array(0);
    this.v = new Float32Array(0);
    super.dispose();
  }
}

onActivate((context) => {
  context.add(liftAuthorCard());
  const field = context.add(new ReactionDiffusion());
  void ElementAnimator.show(field.element);

  renderTips({
    title: '反应扩散',
    description: '两种试剂碰到一起，会自己长成斑点、珊瑚或迷宫。上方的名字是现在这一组。',
    operations: [
      { key: '点击', description: '播种' },
      { key: '按住拖动', description: '涂一条菌种' },
      { key: '[ ]', description: '换一种形态' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(field.element));
});
