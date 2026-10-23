/**
 * 落雪
 * 雪花落下，会在页面底部叠一层薄雪。鼠标是风，点一下把近处的雪掀起来。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, isInteractiveTarget } from './utils/dom';
import { renderTips } from './utils/tips-render';

interface Flake {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  base: number;
  phase: number;
  rot: number;
  spin: number;
  extra: boolean;
}

const BIN = 4;
const MAX_PILE = 42;
const FLAKE_CAP = 360;

class Snowfall extends Disposable {
  private stage: FullscreenStage;
  private flakes: Flake[] = [];
  private bins = new Float32Array(0);
  private binsScratch = new Float32Array(0);
  private mouseX = -9999;
  private mouseY = -9999;
  private windX = 0;
  private windY = 0;
  private animationId: number | null = null;
  private lastTime = 0;

  constructor() {
    super();
    this.stage = createFullscreenStage({
      pointerEvents: 'none',
      opacity: '0',
    });
    this._register(this.stage.canvas);
    this.layout(true);
    this.stage.onResize = () => this.layout(false);

    this._register(new DomListener(window, 'pointermove', (event: PointerEvent) => {
      if (this.mouseX < 0) {
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
        return;
      }
      this.windX = this.windX * 0.7 + (event.clientX - this.mouseX) * 0.6;
      this.windY = this.windY * 0.7 + (event.clientY - this.mouseY) * 0.6;
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }));
    this._register(new DomListener(window, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return;
      }
      this.kick(event.clientX, event.clientY);
    }));
    this._register(new DomListener(document, 'mouseleave', () => {
      this.mouseX = -9999;
      this.mouseY = -9999;
    }));

    this.animationId = requestAnimationFrame(this.frame);
  }

  get element(): HTMLCanvasElement {
    return this.stage.canvas.element;
  }

  private layout(refill: boolean): void {
    const { width } = this.stage;
    const nextCount = Math.max(1, Math.ceil(width / BIN));
    const next = new Float32Array(nextCount);
    if (this.bins.length > 0) {
      for (let i = 0; i < nextCount; i++) {
        const src = Math.min(this.bins.length - 1, Math.floor((i * this.bins.length) / nextCount));
        next[i] = this.bins[src];
      }
    }
    this.bins = next;
    this.binsScratch = new Float32Array(nextCount);
    if (refill || this.flakes.length === 0) {
      this.fillFlakes();
    }
  }

  private fillFlakes(): void {
    const { width, height } = this.stage;
    const count = Math.round(Math.min(170, Math.max(64, width / 11)));
    this.flakes = [];
    for (let i = 0; i < count; i++) {
      this.flakes.push(this.makeFlake(Math.random() * width, Math.random() * height, false));
    }
  }

  private makeFlake(x: number, y: number, extra: boolean): Flake {
    const r = extra ? 1.3 + Math.random() * 1.5 : 1.05 + Math.random() * 2.3;
    const base = 0.85 + r * 0.5;
    return {
      x,
      y,
      r,
      vx: (Math.random() - 0.5) * 0.3,
      vy: base,
      base,
      phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.02,
      extra,
    };
  }

  private recycle(flake: Flake): void {
    const { width } = this.stage;
    flake.x = Math.random() * width;
    flake.y = -8 - Math.random() * 40;
    flake.vx = 0;
    flake.vy = flake.base;
    flake.extra = false;
  }

  private deposit(index: number, amount: number): void {
    const bins = this.bins;
    const paint = (i: number, value: number) => {
      if (i < 0 || i >= bins.length) {
        return;
      }
      bins[i] = Math.min(MAX_PILE, bins[i] + value);
    };
    paint(index, amount);
    paint(index - 1, amount * 0.45);
    paint(index + 1, amount * 0.45);
  }

  private kick(x: number, y: number): void {
    const { height } = this.stage;
    const reach = 160;
    for (const flake of this.flakes) {
      const dx = flake.x - x;
      const dy = flake.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < reach && dist > 0.001) {
        const power = (1 - dist / reach) * 7;
        flake.vx += (dx / dist) * power;
        flake.vy += (dy / dist) * power - 1.4;
      }
    }
    for (let i = 0; i < this.bins.length; i++) {
      const bx = i * BIN + BIN / 2;
      const dx = bx - x;
      if (Math.abs(dx) > reach || this.bins[i] < 0.8 || this.flakes.length >= FLAKE_CAP) {
        if (Math.abs(dx) <= reach && this.bins[i] >= 0.8) {
          const falloff = 1 - Math.abs(dx) / reach;
          this.bins[i] *= 1 - falloff * 0.55;
        }
        continue;
      }
      const falloff = 1 - Math.abs(dx) / reach;
      const depth = this.bins[i];
      const taken = depth * falloff * 0.65;
      this.bins[i] = depth - taken;
      const bits = Math.min(2, Math.max(1, Math.round(taken / 4)));
      for (let n = 0; n < bits && this.flakes.length < FLAKE_CAP; n++) {
        const flake = this.makeFlake(bx + (Math.random() - 0.5) * 8, height - depth, true);
        flake.vx = Math.sign(dx || 1) * (1 + Math.random() * 2);
        flake.vy = -2.2 - Math.random() * 2.6;
        this.flakes.push(flake);
      }
    }
  }

  private frame = (time: number): void => {
    const dt = this.lastTime === 0 ? 1 : Math.min(2, (time - this.lastTime) / 16.67);
    this.lastTime = time;
    this.update(time, dt);
    this.draw();
    this.animationId = requestAnimationFrame(this.frame);
  };

  private update(time: number, dt: number): void {
    const { width, height } = this.stage;
    this.windX *= Math.pow(0.9, dt);
    this.windY *= Math.pow(0.9, dt);
    const gust = Math.hypot(this.windX, this.windY);

    let write = 0;
    for (let i = 0; i < this.flakes.length; i++) {
      const flake = this.flakes[i];
      if (this.mouseX >= 0 && gust > 0.7) {
        const dx = flake.x - this.mouseX;
        const dy = flake.y - this.mouseY;
        const dist = Math.hypot(dx, dy);
        if (dist < 220 && dist > 0.001) {
          const power = (1 - dist / 220) * Math.min(gust, 16) * 0.05 * dt;
          flake.vx += (dx / dist) * power + this.windX * 0.012 * dt;
          flake.vy += (dy / dist) * power * 0.35;
        }
      }
      flake.vx *= Math.pow(0.94, dt);
      flake.vy += (flake.base - flake.vy) * Math.min(1, 0.03 * dt);
      flake.x += (flake.vx + Math.sin(time * 0.0012 + flake.phase) * 0.28) * dt;
      flake.y += flake.vy * dt;
      flake.rot += flake.spin * dt;

      if (flake.x < -20) flake.x = width + 20;
      if (flake.x > width + 20) flake.x = -20;

      const index = Math.max(0, Math.min(this.bins.length - 1, Math.floor(flake.x / BIN)));
      const ground = height - this.bins[index];
      if (flake.y >= ground - flake.r && flake.vy > 0) {
        this.deposit(index, flake.r * 2.1);
        if (flake.extra) {
          continue;
        }
        this.recycle(flake);
      } else if (flake.y > height + 30) {
        if (flake.extra) {
          continue;
        }
        this.recycle(flake);
      }
      this.flakes[write++] = flake;
    }
    this.flakes.length = write;

    this.driftPile(dt);
    this.settle(dt);
  }

  private driftPile(dt: number): void {
    if (this.mouseX < 0 || Math.abs(this.windX) < 1.3 || this.bins.length < 3) {
      return;
    }
    const { height } = this.stage;
    const bins = this.bins;
    const dir = this.windX > 0 ? 1 : -1;
    const fromBottom = height - this.mouseY;
    const vertical = Math.max(0.18, 1 - fromBottom / (height * 0.9));
    const amount = Math.min(0.5, Math.abs(this.windX) * 0.018) * vertical * dt;
    const start = dir > 0 ? bins.length - 2 : 1;
    for (let i = start; dir > 0 ? i >= 1 : i <= bins.length - 2; i -= dir) {
      const influence = Math.max(0, 1 - Math.abs(i * BIN - this.mouseX) / 260);
      if (influence <= 0 || bins[i] <= 0) {
        continue;
      }
      const move = Math.min(bins[i], bins[i] * amount * influence);
      bins[i] -= move;
      const next = i + dir;
      bins[next] = Math.min(MAX_PILE, bins[next] + move);
    }
  }

  private settle(dt: number): void {
    const source = this.bins;
    const target = this.binsScratch;
    if (target.length !== source.length) {
      return;
    }
    const melt = Math.pow(0.9985, dt);
    const last = source.length - 1;
    target[0] = source[0] * melt;
    target[last] = source[last] * melt;
    for (let i = 1; i < last; i++) {
      const smoothed = source[i] * 0.74 + source[i - 1] * 0.13 + source[i + 1] * 0.13;
      target[i] = smoothed < 0.25 ? 0 : smoothed * melt;
    }
    this.bins = target;
    this.binsScratch = source;
  }

  private draw(): void {
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);
    const dark = document.documentElement.classList.contains('theme-dark');
    const flakeColor = dark ? 'rgba(244, 248, 252, 0.92)' : 'rgba(255, 255, 255, 0.96)';
    const flakeInk = dark ? 'rgba(210, 224, 236, 0.45)' : 'rgba(148, 168, 186, 0.85)';
    const pileFill = dark ? 'rgba(232, 240, 246, 0.78)' : 'rgba(255, 255, 255, 0.94)';
    const pileLine = dark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(176, 194, 210, 0.95)';

    let peak = 0;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < this.bins.length; i++) {
      if (this.bins[i] > peak) {
        peak = this.bins[i];
      }
      ctx.lineTo(i * BIN, height - this.bins[i]);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    if (peak > 0.4) {
      ctx.fillStyle = pileFill;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, height - this.bins[0]);
      for (let i = 1; i < this.bins.length; i++) {
        ctx.lineTo(i * BIN, height - this.bins[i]);
      }
      ctx.strokeStyle = pileLine;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    ctx.lineCap = 'round';
    for (const flake of this.flakes) {
      ctx.save();
      ctx.translate(flake.x, flake.y);
      ctx.rotate(flake.rot);
      ctx.fillStyle = flakeColor;
      ctx.strokeStyle = flakeInk;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.8, flake.r * 0.42), 0, Math.PI * 2);
      ctx.fill();
      if (flake.r > 1.8) {
        ctx.beginPath();
        for (let arm = 0; arm < 6; arm++) {
          const angle = (Math.PI * arm) / 3;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(angle) * flake.r * 2, Math.sin(angle) * flake.r * 2);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.flakes = [];
    this.bins = new Float32Array(0);
    this.binsScratch = new Float32Array(0);
    super.dispose();
  }
}

onActivate((context) => {
  const snow = context.add(new Snowfall());
  void ElementAnimator.show(snow.element);

  renderTips({
    title: '落雪',
    description: '雪花会落在页面底部，慢慢积成薄薄一层，又会自己化掉。鼠标划得越快风越大，点一下把身边的雪掀起来。',
    operations: [
      { key: '移动', description: '吹开身边的雪' },
      { key: '点击', description: '把近处的积雪掀起来' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(snow.element));
});
