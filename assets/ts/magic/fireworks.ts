/**
 * 烟花
 * 点击的地方会有一发升上去炸开。按住 Shift 再点，是一小束。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, isInteractiveTarget } from './utils/dom';
import { renderTips } from './utils/tips-render';

interface Point {
  x: number;
  y: number;
}

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  tx: number;
  ty: number;
  fuse: number;
  trail: Point[];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  life: number;
  decay: number;
  size: number;
  gravity: number;
  /** 大于 0 时，倒计时结束后再裂成小火星。-1 表示不再裂。 */
  crackle: number;
}

interface Flash {
  x: number;
  y: number;
  hue: number;
  life: number;
  r: number;
}

interface Aftershock {
  x: number;
  y: number;
  hue: number;
  delay: number;
  scale: number;
  kind: Burst;
}

type Burst = 'chrysanthemum' | 'peony' | 'willow' | 'ring';

const HUES = [28, 350, 190, 122, 265, 48];
const GRAVITY = 0.06;

class Fireworks extends Disposable {
  private stage: FullscreenStage;
  private rockets: Rocket[] = [];
  private sparks: Spark[] = [];
  private flashes: Flash[] = [];
  private aftershocks: Aftershock[] = [];
  private animationId: number | null = null;
  private introId: number | null = null;
  private lastTime = 0;

  constructor() {
    super();
    this.stage = createFullscreenStage({
      pointerEvents: 'none',
      opacity: '0',
    });
    this._register(this.stage.canvas);

    this._register(new DomListener(window, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return;
      }
      if (event.shiftKey) {
        for (let i = -2; i <= 2; i++) {
          this.launch(event.clientX + i * 34, event.clientY - Math.abs(i) * 18);
        }
      } else {
        this.launch(event.clientX, event.clientY);
      }
    }));

    this.introId = window.setTimeout(() => {
      this.introId = null;
      const { width, height } = this.stage;
      this.launch(width * (0.32 + Math.random() * 0.16), height * (0.2 + Math.random() * 0.12));
      this.launch(width * (0.54 + Math.random() * 0.16), height * (0.26 + Math.random() * 0.14));
    }, 700);

    this.animationId = requestAnimationFrame(this.frame);
  }

  get element(): HTMLCanvasElement {
    return this.stage.canvas.element;
  }

  private launch(tx: number, ty: number): void {
    const { height } = this.stage;
    const hue = HUES[Math.floor(Math.random() * HUES.length)] + Math.random() * 12;
    if (this.rockets.length > 18 || height - ty < 72) {
      this.explode(tx, Math.min(ty, height - 24), hue, 0.8);
      return;
    }
    const x = tx + (Math.random() - 0.5) * 24;
    const y = height + 2;
    const dx = tx - x;
    const dy = ty - y;
    const dist = Math.hypot(dx, dy);
    const frames = Math.max(24, Math.min(64, dist / 13));
    this.rockets.push({
      x,
      y,
      vx: dx / frames,
      vy: (dy - GRAVITY * frames * (frames + 1) / 2) / frames,
      hue,
      tx,
      ty,
      fuse: frames,
      trail: [],
    });
  }

  private pickBurst(): Burst {
    const roll = Math.random();
    if (roll < 0.38) return 'chrysanthemum';
    if (roll < 0.66) return 'peony';
    if (roll < 0.84) return 'willow';
    return 'ring';
  }

  private explode(x: number, y: number, hue: number, scale: number, kind?: Burst): void {
    const burst = kind ?? this.pickBurst();
    this.flashes.push({ x, y, hue, life: 1, r: 8 });
    if (burst === 'chrysanthemum') {
      this.fillBurst(x, y, hue, Math.round(130 * scale), 2.4, 1.5, 0.0055, 0.032, 8);
      if (Math.random() < 0.55 && !kind) {
        this.aftershocks.push({
          x, y, hue: (hue + 38 + Math.random() * 20) % 360, delay: 12 + Math.random() * 8, scale: scale * 0.55, kind: 'peony',
        });
      }
    } else if (burst === 'peony') {
      this.fillBurst(x, y, hue, Math.round(100 * scale), 1.5, 1.3, 0.01, 0.02, 14);
      this.fillBurst(x, y, hue + 180, Math.round(28 * scale), 0.45, 0.55, 0.014, 0.012, 6);
    } else if (burst === 'willow') {
      const gold = 40 + Math.random() * 12;
      this.fillBurst(x, y, gold, Math.round(90 * scale), 1.15, 0.7, 0.0036, 0.072, 6);
    } else {
      const band = 2.5 * scale;
      this.fillBurst(x, y, hue, Math.round(78 * scale), band, 0.12, 0.007, 0.024, 10);
      this.fillBurst(x, y, (hue + 28) % 360, Math.round(56 * scale), band * 0.58, 0.08, 0.008, 0.02, 8);
    }
    if (this.sparks.length > 1600) {
      this.sparks.splice(0, this.sparks.length - 1600);
    }
    if (this.flashes.length > 28) {
      this.flashes.splice(0, this.flashes.length - 28);
    }
  }

  private fillBurst(
    x: number,
    y: number,
    hue: number,
    count: number,
    speed: number,
    spread: number,
    decay: number,
    gravity: number,
    hueJitter: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.18;
      const kick = speed + (Math.random() - 0.5) * spread;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * kick,
        vy: Math.sin(angle) * kick,
        hue: hue + (Math.random() - 0.5) * hueJitter,
        life: 1,
        decay: decay * (0.75 + Math.random() * 0.5),
        size: 1.15 + Math.random() * 0.9,
        gravity,
        crackle: Math.random() < 0.14 ? 16 + Math.random() * 22 : -1,
      });
    }
  }

  private crackle(x: number, y: number, hue: number): void {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1.3;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue: hue + (Math.random() - 0.5) * 18,
        life: 0.7,
        decay: 0.03,
        size: 0.8,
        gravity: 0.03,
        crackle: -1,
      });
    }
  }

  private frame = (time: number): void => {
    const dt = this.lastTime === 0 ? 1 : Math.min(2, (time - this.lastTime) / 16.67);
    this.lastTime = time;
    this.update(dt);
    this.draw();
    this.animationId = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const { height } = this.stage;
    let rocketWrite = 0;
    for (let i = 0; i < this.rockets.length; i++) {
      const rocket = this.rockets[i];
      rocket.trail.push({ x: rocket.x, y: rocket.y });
      if (rocket.trail.length > 22) {
        rocket.trail.shift();
      }
      this.sparks.push({
        x: rocket.x,
        y: rocket.y,
        vx: (Math.random() - 0.5) * 0.35,
        vy: 0.35 + Math.random() * 0.9,
        hue: 38 + Math.random() * 14,
        life: 0.55 + Math.random() * 0.3,
        decay: 0.04 + Math.random() * 0.02,
        size: 0.7,
        gravity: 0.045,
        crackle: -1,
      });
      rocket.vy += GRAVITY * dt;
      rocket.x += rocket.vx * dt;
      rocket.y += rocket.vy * dt;
      rocket.fuse -= dt;
      const arrived = Math.hypot(rocket.tx - rocket.x, rocket.ty - rocket.y) < 20;
      if (rocket.fuse <= 0 || arrived || rocket.y < 12) {
        this.explode(rocket.x, rocket.y, rocket.hue, 1);
      } else {
        this.rockets[rocketWrite++] = rocket;
      }
    }
    this.rockets.length = rocketWrite;

    let sparkWrite = 0;
    for (let i = 0; i < this.sparks.length; i++) {
      const spark = this.sparks[i];
      spark.vx *= Math.pow(0.986, dt);
      spark.vy *= Math.pow(0.986, dt);
      spark.vy += spark.gravity * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.life -= spark.decay * dt;
      if (spark.crackle > 0) {
        spark.crackle -= dt;
        if (spark.crackle <= 0) {
          spark.crackle = -1;
          this.crackle(spark.x, spark.y, spark.hue);
        }
      }
      if (spark.life > 0 && spark.y < height + 40) {
        this.sparks[sparkWrite++] = spark;
      }
    }
    this.sparks.length = sparkWrite;
    if (this.sparks.length > 1600) {
      this.sparks.splice(0, this.sparks.length - 1600);
    }

    let flashWrite = 0;
    for (let i = 0; i < this.flashes.length; i++) {
      const flash = this.flashes[i];
      flash.r += 3.4 * dt;
      flash.life -= 0.045 * dt;
      if (flash.life > 0) {
        this.flashes[flashWrite++] = flash;
      }
    }
    this.flashes.length = flashWrite;

    let shockWrite = 0;
    for (let i = 0; i < this.aftershocks.length; i++) {
      const shock = this.aftershocks[i];
      shock.delay -= dt;
      if (shock.delay <= 0) {
        this.explode(shock.x, shock.y, shock.hue, shock.scale, shock.kind);
      } else {
        this.aftershocks[shockWrite++] = shock;
      }
    }
    this.aftershocks.length = shockWrite;
  }

  private draw(): void {
    const { ctx, width, height } = this.stage;
    const dark = document.documentElement.classList.contains('theme-dark');
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    const light = dark ? 70 : 42;

    for (const flash of this.flashes) {
      const radius = flash.r * 5.5;
      const glow = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, radius);
      glow.addColorStop(0, `hsla(${flash.hue}, 90%, ${dark ? 92 : 70}%, ${flash.life * 0.9})`);
      glow.addColorStop(0.28, `hsla(${flash.hue}, 100%, ${light}%, ${flash.life * 0.38})`);
      glow.addColorStop(1, `hsla(${flash.hue}, 100%, ${light}%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const rocket of this.rockets) {
      const trail = rocket.trail;
      for (let i = 1; i < trail.length; i++) {
        const t = i / trail.length;
        ctx.strokeStyle = `hsla(40, 95%, ${light}%, ${t * t * 0.75})`;
        ctx.lineWidth = 0.6 + t * 2;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      if (trail.length > 0) {
        const last = trail[trail.length - 1];
        ctx.strokeStyle = `hsla(48, 100%, ${dark ? 78 : 50}%, 0.9)`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(rocket.x, rocket.y);
        ctx.stroke();
      }
      ctx.fillStyle = `hsla(50, 100%, ${dark ? 88 : 62}%, 0.95)`;
      ctx.beginPath();
      ctx.arc(rocket.x, rocket.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const spark of this.sparks) {
      const alpha = Math.max(0, spark.life);
      const twinkle = 0.72 + Math.sin(spark.life * 28 + spark.x) * 0.28;
      const speed = Math.hypot(spark.vx, spark.vy) || 1;
      const length = Math.min(26, speed * 4.4);
      ctx.strokeStyle = `hsla(${spark.hue}, 100%, ${light}%, ${alpha * 0.82 * twinkle})`;
      ctx.lineWidth = spark.size * (dark ? 1.15 : 1.35);
      ctx.beginPath();
      ctx.moveTo(spark.x, spark.y);
      ctx.lineTo(spark.x - (spark.vx / speed) * length, spark.y - (spark.vy / speed) * length);
      ctx.stroke();
      ctx.fillStyle = `hsla(${spark.hue}, 100%, ${light}%, ${alpha * (dark ? 0.22 : 0.14)})`;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${spark.hue}, 35%, ${dark ? 94 : 78}%, ${alpha * twinkle})`;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, Math.max(0.6, spark.size * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    if (this.introId !== null) {
      window.clearTimeout(this.introId);
      this.introId = null;
    }
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.rockets = [];
    this.sparks = [];
    this.flashes = [];
    this.aftershocks = [];
    super.dispose();
  }
}

onActivate((context) => {
  const show = context.add(new Fireworks());
  void ElementAnimator.show(show.element);

  renderTips({
    title: '烟花',
    description: '点一下，一发从底下升上去，炸成菊花、牡丹或会下垂的金柳。多点几下就是一场烟火。',
    operations: [
      { key: '点击', description: '向落点发射一发' },
      { key: 'Shift + 点击', description: '一次放一小束' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(show.element));
});
