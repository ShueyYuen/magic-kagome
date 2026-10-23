/**
 * 连星
 * 鼠标靠近时，近处的星会彼此牵上线。点一下钉住一颗，凑近的钉星连成自己的星座。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, isInteractiveTarget, isTypingTarget } from './utils/dom';
import { renderTips } from './utils/tips-render';

interface AmbientStar {
  nx: number;
  ny: number;
  r: number;
  phase: number;
  cross: boolean;
}

interface PinnedStar {
  nx: number;
  ny: number;
  phase: number;
}

class Constellation extends Disposable {
  private stage: FullscreenStage;
  private stars: AmbientStar[] = [];
  private pinned: PinnedStar[] = [];
  private mouseX = -9999;
  private mouseY = -9999;
  private lastPinX = 0;
  private lastPinY = 0;
  private lastPinAt = 0;
  private animationId: number | null = null;

  constructor() {
    super();
    this.stage = createFullscreenStage({
      pointerEvents: 'none',
      opacity: '0',
    });
    this._register(this.stage.canvas);
    this.seedStars();

    this._register(new DomListener(window, 'pointermove', (event: PointerEvent) => {
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }));
    this._register(new DomListener(window, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return;
      }
      this.pin(event.clientX, event.clientY);
    }));
    this._register(new DomListener(document, 'mouseleave', () => {
      this.mouseX = -9999;
      this.mouseY = -9999;
    }));
    this._register(new DomListener(window, 'keydown', this.onKeyDown));

    this.animationId = requestAnimationFrame(this.frame);
  }

  get element(): HTMLCanvasElement {
    return this.stage.canvas.element;
  }

  private seedStars(): void {
    const { width, height } = this.stage;
    const count = Math.round(Math.min(150, Math.max(48, (width * height) / 17000)));
    this.stars = [];
    for (let i = 0; i < count; i++) {
      this.stars.push({
        nx: Math.random(),
        ny: Math.random(),
        r: 0.7 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        cross: Math.random() < 0.16,
      });
    }
  }

  private pin(x: number, y: number): void {
    const { width, height } = this.stage;
    if (width < 1 || height < 1) {
      return;
    }
    const now = performance.now();
    if (now - this.lastPinAt < 280 && Math.hypot(x - this.lastPinX, y - this.lastPinY) < 14) {
      return;
    }
    this.lastPinAt = now;
    this.lastPinX = x;
    this.lastPinY = y;

    const hit = this.pinned.findIndex((star) => {
      const sx = star.nx * width;
      const sy = star.ny * height;
      return Math.hypot(sx - x, sy - y) < 16;
    });
    if (hit >= 0) {
      this.pinned.splice(hit, 1);
      return;
    }
    this.pinned.push({
      nx: x / width,
      ny: y / height,
      phase: Math.random() * Math.PI * 2,
    });
    if (this.pinned.length > 36) {
      this.pinned.shift();
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.code !== 'KeyC') {
      return;
    }
    if (document.getSelection()?.toString()) {
      return;
    }
    this.pinned = [];
  };

  private frame = (time: number): void => {
    this.draw(time);
    this.animationId = requestAnimationFrame(this.frame);
  };

  private draw(time: number): void {
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);
    const dark = document.documentElement.classList.contains('theme-dark');
    const sky = dark ? '198, 220, 255' : '62, 62, 95';
    const gold = dark ? '255, 214, 130' : '184, 98, 28';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;

    if (this.mouseX >= 0) {
      const near: Array<{ x: number; y: number }> = [];
      for (const star of this.stars) {
        const x = star.nx * width;
        const y = star.ny * height;
        if ((x - this.mouseX) ** 2 + (y - this.mouseY) ** 2 < 168 * 168) {
          near.push({ x, y });
        }
      }
      ctx.strokeStyle = `rgba(${sky}, 0.38)`;
      ctx.beginPath();
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const dx = near[i].x - near[j].x;
          const dy = near[i].y - near[j].y;
          if (dx * dx + dy * dy < 128 * 128) {
            ctx.moveTo(near[i].x, near[i].y);
            ctx.lineTo(near[j].x, near[j].y);
          }
        }
      }
      ctx.stroke();

      ctx.strokeStyle = `rgba(${sky}, 0.2)`;
      ctx.beginPath();
      for (const point of near) {
        ctx.moveTo(this.mouseX, this.mouseY);
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }

    if (this.pinned.length > 0) {
      const placed = this.pinned.map((star) => ({
        x: star.nx * width,
        y: star.ny * height,
      }));
      ctx.strokeStyle = `rgba(${gold}, 0.8)`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const seen = new Set<string>();
      for (let i = 0; i < placed.length; i++) {
        const nearest: Array<{ j: number; d2: number }> = [];
        for (let j = 0; j < placed.length; j++) {
          if (i === j) {
            continue;
          }
          const dx = placed[i].x - placed[j].x;
          const dy = placed[i].y - placed[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 320 * 320) {
            nearest.push({ j, d2 });
          }
        }
        nearest.sort((a, b) => a.d2 - b.d2);
        for (const link of nearest.slice(0, 2)) {
          const a = Math.min(i, link.j);
          const b = Math.max(i, link.j);
          const key = `${a}:${b}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          ctx.moveTo(placed[a].x, placed[a].y);
          ctx.lineTo(placed[b].x, placed[b].y);
        }
      }
      ctx.stroke();

      if (this.mouseX >= 0) {
        ctx.strokeStyle = `rgba(${gold}, 0.4)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const point of placed) {
          if ((point.x - this.mouseX) ** 2 + (point.y - this.mouseY) ** 2 < 240 * 240) {
            ctx.moveTo(this.mouseX, this.mouseY);
            ctx.lineTo(point.x, point.y);
          }
        }
        ctx.stroke();
      }
    }

    const ink = dark ? '#f5f7ff' : '#3e3e5f';
    for (const star of this.stars) {
      const x = star.nx * width;
      const y = star.ny * height;
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 0.003 + star.phase));
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(x, y, star.r, 0, Math.PI * 2);
      ctx.fill();
      if (star.cross) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - star.r * 2.4, y);
        ctx.lineTo(x + star.r * 2.4, y);
        ctx.moveTo(x, y - star.r * 2.4);
        ctx.lineTo(x, y + star.r * 2.4);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    for (const star of this.pinned) {
      const x = star.nx * width;
      const y = star.ny * height;
      const pulse = 0.85 + 0.15 * Math.sin(time * 0.004 + star.phase);
      ctx.fillStyle = `rgba(${gold}, 0.2)`;
      ctx.beginPath();
      ctx.arc(x, y, 9 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${gold}, 0.95)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x, y + 7);
      ctx.stroke();
      ctx.fillStyle = `rgba(${gold}, 1)`;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.stars = [];
    this.pinned = [];
    super.dispose();
  }
}

onActivate((context) => {
  const sky = context.add(new Constellation());
  void ElementAnimator.show(sky.element);

  renderTips({
    title: '连星',
    description: '星星本来就在。鼠标靠近时，近处的会彼此牵上线。点一下钉住一颗，挨得近的钉星会连成你的星座。',
    operations: [
      { key: '移动', description: '点亮身边的星线' },
      { key: '点击', description: '钉住或收回一颗星' },
      { key: 'C', description: '收起钉住的星' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(sky.element));
});
