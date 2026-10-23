/**
 * 萤火虫
 * 用 Perlin 噪声慢慢飘，鼠标是一盏灯，点击会把它们炸开。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, liftWidgetInfo } from './utils/dom';
import { perlin2, seed } from './utils/perlin';
import { renderTips } from './utils/tips-render';

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  phase: number;
  size: number;
}

const HUES = [42, 78, 152, 168, 198, 330];
const MAX_SPEED = 14;

class Fireflies extends Disposable {
  private stage: FullscreenStage;
  private flies: Firefly[] = [];
  private mouseX = -9999;
  private mouseY = -9999;
  private animationId: number | null = null;
  private lastTime = 0;

  constructor() {
    super();
    seed(Math.floor(Math.random() * 65535));
    this.stage = createFullscreenStage({
      pointerEvents: 'none',
      opacity: '0',
    });
    this._register(this.stage.canvas);
    this.spawn();
    this.stage.onResize = () => {
      if (this.flies.length === 0) {
        this.spawn();
      }
    };

    this._register(new DomListener(window, 'pointermove', (event: PointerEvent) => {
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }));
    this._register(new DomListener(window, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      this.burst(event.clientX, event.clientY);
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

  private spawn(): void {
    const { width, height } = this.stage;
    const count = Math.round(Math.min(180, Math.max(48, (width * height) / 15000)));
    this.flies = [];
    for (let i = 0; i < count; i++) {
      this.flies.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0,
        vy: 0,
        hue: HUES[i % HUES.length] + Math.random() * 12,
        phase: Math.random() * Math.PI * 2,
        size: 1.4 + Math.random() * 2.2,
      });
    }
  }

  private burst(x: number, y: number): void {
    for (const fly of this.flies) {
      const dx = fly.x - x;
      const dy = fly.y - y;
      const distance = Math.hypot(dx, dy) || 1;
      const reach = 340;
      if (distance > reach) {
        continue;
      }
      const power = (1 - distance / reach) * 16;
      fly.vx += (dx / distance) * power;
      fly.vy += (dy / distance) * power;
    }
  }

  private frame = (time: number): void => {
    const dt = this.lastTime === 0 ? 1 : Math.min(2, (time - this.lastTime) / 16.67);
    this.lastTime = time;
    this.update(time, dt);
    this.draw(time);
    this.animationId = requestAnimationFrame(this.frame);
  };

  private update(time: number, dt: number): void {
    const { width, height } = this.stage;
    const t = time * 0.00015;
    for (const fly of this.flies) {
      const angle = perlin2(fly.x * 0.0025, fly.y * 0.0025 + t) * Math.PI * 2;
      fly.vx += Math.cos(angle) * 0.16 * dt;
      fly.vy += Math.sin(angle) * 0.16 * dt;

      if (this.mouseX >= 0) {
        const dx = this.mouseX - fly.x;
        const dy = this.mouseY - fly.y;
        const distance = Math.hypot(dx, dy);
        const radius = 280;
        if (distance < radius && distance > 6) {
          const pull = (1 - distance / radius) * 0.62 * dt;
          fly.vx += (dx / distance) * pull;
          fly.vy += (dy / distance) * pull;
        }
      }

      fly.vx *= Math.pow(0.96, dt);
      fly.vy *= Math.pow(0.96, dt);
      const speed = Math.hypot(fly.vx, fly.vy);
      if (speed > MAX_SPEED) {
        fly.vx = (fly.vx / speed) * MAX_SPEED;
        fly.vy = (fly.vy / speed) * MAX_SPEED;
      }

      fly.x += fly.vx * dt;
      fly.y += fly.vy * dt;

      if (fly.x < -30) fly.x = width + 30;
      if (fly.x > width + 30) fly.x = -30;
      if (fly.y < -30) fly.y = height + 30;
      if (fly.y > height + 30) fly.y = -30;
    }
  }

  private draw(time: number): void {
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);

    if (this.mouseX >= 0 && this.mouseY >= 0 && this.mouseY <= height) {
      const lantern = ctx.createRadialGradient(this.mouseX, this.mouseY, 0, this.mouseX, this.mouseY, 170);
      lantern.addColorStop(0, 'rgba(255, 226, 150, 0.22)');
      lantern.addColorStop(1, 'rgba(255, 226, 150, 0)');
      ctx.fillStyle = lantern;
      ctx.beginPath();
      ctx.arc(this.mouseX, this.mouseY, 170, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const fly of this.flies) {
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 0.004 + fly.phase));
      const radius = fly.size * (2.4 + twinkle * 4);
      const glow = ctx.createRadialGradient(fly.x, fly.y, 0, fly.x, fly.y, radius);
      glow.addColorStop(0, `hsla(${fly.hue}, 95%, 70%, ${twinkle})`);
      glow.addColorStop(0.4, `hsla(${fly.hue}, 90%, 58%, ${twinkle * 0.45})`);
      glow.addColorStop(1, `hsla(${fly.hue}, 80%, 50%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(fly.x, fly.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.flies = [];
    super.dispose();
  }
}

onActivate((context) => {
  context.add(liftWidgetInfo());
  const fireflies = context.add(new Fireflies());
  void ElementAnimator.show(fireflies.element);

  renderTips({
    title: '萤火虫',
    description: '它们顺着噪声慢慢飘。把鼠标当成灯，靠近会聚过来；点一下，会炸开再慢慢聚回来。',
    operations: [
      { key: '移动', description: '萤火虫聚向鼠标' },
      { key: '点击', description: '把周围的萤火虫炸开' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(fireflies.element));
});
