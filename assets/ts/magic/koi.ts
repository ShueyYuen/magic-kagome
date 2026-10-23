/**
 * 锦鲤
 * 从上往下看一池鱼。鱼自己在水里游，偶尔才钻到身边的荷叶下面绕一会儿。
 * 鼠标划过水面会起涟漪，点一下投下饵料。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, isInteractiveTarget } from './utils/dom';
import { perlin2, seed } from './utils/perlin';
import { renderTips } from './utils/tips-render';

interface Spot {
  x: number;
  y: number;
  r: number;
}

interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  phase: number;
  length: number;
  /** 俯视时的半身宽。 */
  breadth: number;
  body: string;
  belly: string;
  spot: string;
  spots: Spot[];
  gulp: number;
  wake: number;
  /** 1 或 -1，在叶子下面绕圈的方向。 */
  spin: number;
  /** 正在玩的那片叶子。游走时为空。 */
  home: Leaf | null;
  /** 还要在叶子下绕多久。 */
  play: number;
  /** 大于 0 时只在水里逛，不找叶子。 */
  roam: number;
}

interface Leaf {
  nx: number;
  ny: number;
  x: number;
  y: number;
  radius: number;
  /** 0 到 1，出水。 */
  grow: number;
  delay: number;
  rot: number;
  vein: number;
  bob: number;
  ripple: number;
}

interface Crumb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  r: number;
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  life: number;
}

const KOI_COLORS = [
  { body: '#ef7a3a', belly: '#ffe6c4', spot: '#fffaf3' },
  { body: '#f4f0e6', belly: '#ffffff', spot: '#e25a3c' },
  { body: '#2c3138', belly: '#f3efe6', spot: '#f0b429' },
  { body: '#f2c14b', belly: '#fff6d8', spot: '#fffaf3' },
  { body: '#d94b4b', belly: '#f8d2c4', spot: '#2c3138' },
];

const MAX_SPEED = 2.7;
const FEED_SPEED = 4.4;

class KoiPond extends Disposable {
  private stage: FullscreenStage;
  private fishes: Fish[] = [];
  private leaves: Leaf[] = [];
  private crumbs: Crumb[] = [];
  private ripples: Ripple[] = [];
  private mouseX = -9999;
  private mouseY = -9999;
  private mouseTrail = 0;
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
    this.plantLeaves();
    this.stage.onResize = () => {
      if (this.fishes.length === 0) {
        this.spawn();
      }
      this.placeLeaves();
    };
    this._register(new DomListener(window, 'scroll', () => this.placeLeaves(), true));

    this._register(new DomListener(window, 'pointermove', (event: PointerEvent) => {
      if (this.mouseX >= 0) {
        this.mouseTrail += Math.hypot(event.clientX - this.mouseX, event.clientY - this.mouseY);
        if (this.mouseTrail > 26) {
          this.mouseTrail = 0;
          this.addRipple(event.clientX, event.clientY, 5);
        }
      }
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }));
    this._register(new DomListener(window, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return;
      }
      this.feed(event.clientX, event.clientY);
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
    const count = Math.round(Math.min(22, Math.max(10, (width * height) / 62000)));
    this.fishes = [];
    for (let i = 0; i < count; i++) {
      const palette = KOI_COLORS[i % KOI_COLORS.length];
      const length = 48 + Math.random() * 20;
      const breadth = length * (0.145 + Math.random() * 0.03);
      const spots: Spot[] = [];
      const spotCount = 3 + Math.floor(Math.random() * 2);
      for (let s = 0; s < spotCount; s++) {
        spots.push({
          x: -length * 0.08 + Math.random() * length * 0.38,
          y: (Math.random() - 0.5) * breadth * 0.85,
          r: breadth * (0.28 + Math.random() * 0.38),
        });
      }
      this.fishes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        angle: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        length,
        breadth,
        body: palette.body,
        belly: palette.belly,
        spot: palette.spot,
        spots,
        gulp: 0,
        wake: Math.random() * 40,
        spin: Math.random() > 0.5 ? 1 : -1,
        home: null,
        play: 0,
        roam: 90 + Math.random() * 320,
      });
    }
  }

  private plantLeaves(): void {
    const { width, height } = this.stage;
    const onCover = this.coverRect() !== null;
    const count = onCover
      ? (width < 720 ? 3 : width < 1100 ? 4 : 5)
      : Math.min(16, Math.max(9, Math.round((width * height) / 72000)));
    const spots: { nx: number; ny: number; radius: number }[] = [];
    this.leaves = [];
    for (let i = 0; i < count; i++) {
      const radius = 46 + Math.random() * 40;
      let nx = 0.2 + Math.random() * 0.6;
      let ny = 0.22 + Math.random() * 0.52;
      for (let attempt = 0; attempt < 12; attempt++) {
        const tx = 0.08 + Math.random() * 0.84;
        const ty = 0.14 + Math.random() * 0.68;
        const crowded = spots.some((spot) => {
          const dx = (tx - spot.nx) * (onCover ? 420 : width);
          const dy = (ty - spot.ny) * (onCover ? 280 : height);
          return Math.hypot(dx, dy) < (radius + spot.radius) * 0.62;
        });
        nx = tx;
        ny = ty;
        if (!crowded) {
          break;
        }
      }
      spots.push({ nx, ny, radius });
      const roll = Math.random();
      const grow = roll < 0.5
        ? 0.78 + Math.random() * 0.22
        : roll < 0.78
          ? 0.2 + Math.random() * 0.45
          : 0;
      this.leaves.push({
        nx,
        ny,
        x: 0,
        y: 0,
        radius,
        grow,
        delay: grow === 0 ? Math.random() * 36 : 0,
        rot: (Math.random() - 0.5) * 1.4,
        vein: Math.random() * Math.PI * 2,
        bob: Math.random() * Math.PI * 2,
        ripple: Math.random() * 8,
      });
    }
    this.placeLeaves();
  }

  /** 封面在视口里的位置。滚走之后矩形会跟着变。 */
  private coverRect(): DOMRect | null {
    const cover = document.querySelector('.article-cover');
    if (!cover) {
      return null;
    }
    const rect = cover.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 120) {
      return null;
    }
    return rect;
  }

  /** 有封面时叶子钉在封面上，并随它滚动。没有封面就散在整页。 */
  private placeLeaves(): void {
    const { width, height } = this.stage;
    const cover = this.coverRect();
    const left = cover ? cover.left : 24;
    const top = cover ? cover.top : 24;
    const pondWidth = cover ? cover.width : width - 48;
    const pondHeight = cover ? cover.height : height - 48;
    const margin = cover ? 28 : 16;
    const spanX = Math.max(40, pondWidth - margin * 2);
    const spanY = Math.max(40, pondHeight - margin * 2);
    for (const leaf of this.leaves) {
      leaf.x = left + margin + spanX * leaf.nx;
      leaf.y = top + margin + spanY * leaf.ny;
    }
  }

  private addRipple(x: number, y: number, r = 6): void {
    this.ripples.push({ x, y, r, life: 1 });
    if (this.ripples.length > 56) {
      this.ripples.splice(0, this.ripples.length - 56);
    }
  }

  private feed(x: number, y: number): void {
    this.addRipple(x, y, 7);
    this.addRipple(x, y, 16);
    this.addRipple(x, y, 26);
    for (let i = 0; i < 7; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 16;
      this.crumbs.push({
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        vx: Math.cos(angle) * 0.35,
        vy: 0.25 + Math.random() * 0.45,
        life: 1,
        r: 2 + Math.random() * 1.5,
      });
    }
    if (this.crumbs.length > 42) {
      this.crumbs.splice(0, this.crumbs.length - 42);
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
    this.placeLeaves();
    const t = time * 0.00012;
    this.school(dt);
    for (const fish of this.fishes) {
      if (fish.roam > 0) {
        fish.roam -= dt;
      }
      if (fish.roam > 0 || !fish.home) {
        const angle = perlin2(fish.x * 0.004 + fish.phase, fish.y * 0.004 + t) * Math.PI * 2;
        const drift = fish.roam > 0 ? 0.09 : 0.045;
        fish.vx += Math.cos(angle) * drift * dt;
        fish.vy += Math.sin(angle) * drift * dt;
      }
      this.avoidEdges(fish, dt);
      this.react(fish, dt);
      this.coast(fish, dt);
      this.wake(fish, dt);
    }
    this.updateLeaves(dt);
    this.updateCrumbs(dt);
    this.updateRipples(dt);
  }

  private updateLeaves(dt: number): void {
    for (const leaf of this.leaves) {
      if (leaf.delay > 0) {
        leaf.delay -= dt;
        continue;
      }
      if (leaf.grow >= 1) {
        continue;
      }
      const before = leaf.grow;
      leaf.grow = Math.min(1, leaf.grow + 0.011 * dt);
      leaf.ripple += dt;
      if (leaf.ripple > 8) {
        leaf.ripple = 0;
        this.addRipple(leaf.x, leaf.y, Math.max(8, leaf.radius * leaf.grow * 0.45));
      }
      if (before < 1 && leaf.grow >= 1) {
        this.addRipple(leaf.x, leaf.y, leaf.radius * 0.4);
        this.addRipple(leaf.x, leaf.y, leaf.radius * 0.85);
      }
    }
  }

  private wake(fish: Fish, dt: number): void {
    const speed = Math.hypot(fish.vx, fish.vy);
    if (speed < 0.8) {
      return;
    }
    fish.wake += speed * dt;
    if (fish.wake < 52) {
      return;
    }
    fish.wake = 0;
    const leaf = this.leafUnder(fish.x, fish.y);
    if (leaf) {
      const angle = Math.atan2(fish.y - leaf.y, fish.x - leaf.x);
      this.addRipple(
        leaf.x + Math.cos(angle) * leaf.radius * 0.92,
        leaf.y + Math.sin(angle) * leaf.radius * 0.92,
        6,
      );
      return;
    }
    this.addRipple(fish.x, fish.y, 5);
  }

  private leafUnder(x: number, y: number): Leaf | null {
    let nearest: Leaf | null = null;
    let best = Infinity;
    for (const leaf of this.leaves) {
      if (leaf.grow < 0.72) {
        continue;
      }
      const dist = Math.hypot(leaf.x - x, leaf.y - y);
      if (dist < leaf.radius * 0.96 && dist < best) {
        best = dist;
        nearest = leaf;
      }
    }
    return nearest;
  }

  private school(dt: number): void {
    const fishes = this.fishes;
    for (let i = 0; i < fishes.length; i++) {
      const fish = fishes[i];
      let cx = 0;
      let cy = 0;
      let avx = 0;
      let avy = 0;
      let neighbors = 0;
      for (let j = 0; j < fishes.length; j++) {
        if (i === j) {
          continue;
        }
        const other = fishes[j];
        const dx = fish.x - other.x;
        const dy = fish.y - other.y;
        const dist = Math.hypot(dx, dy);
        const gap = (fish.length + other.length) * 0.55;
        if (dist < gap && dist > 0.001) {
          const push = (1 - dist / gap) * 0.16 * dt;
          fish.vx += (dx / dist) * push;
          fish.vy += (dy / dist) * push;
        }
        if (dist < 140) {
          cx += other.x;
          cy += other.y;
          avx += other.vx;
          avy += other.vy;
          neighbors++;
        }
      }
      if (neighbors === 0) {
        continue;
      }
      const tx = cx / neighbors - fish.x;
      const ty = cy / neighbors - fish.y;
      const td = Math.hypot(tx, ty) || 1;
      fish.vx += (tx / td) * 0.028 * dt;
      fish.vy += (ty / td) * 0.028 * dt;
      fish.vx += (avx / neighbors - fish.vx) * 0.05 * dt;
      fish.vy += (avy / neighbors - fish.vy) * 0.05 * dt;
    }
  }

  private avoidEdges(fish: Fish, dt: number): void {
    const { width, height } = this.stage;
    const pad = 56;
    if (fish.x < pad) fish.vx += (pad - fish.x) * 0.004 * dt;
    if (fish.x > width - pad) fish.vx -= (fish.x - (width - pad)) * 0.004 * dt;
    if (fish.y < pad) fish.vy += (pad - fish.y) * 0.004 * dt;
    if (fish.y > height - pad) fish.vy -= (fish.y - (height - pad)) * 0.004 * dt;
  }

  private react(fish: Fish, dt: number): void {
    let nearest: Crumb | null = null;
    let best = 240 * 240;
    for (const crumb of this.crumbs) {
      const dx = crumb.x - fish.x;
      const dy = crumb.y - fish.y;
      const dist = dx * dx + dy * dy;
      if (dist < best) {
        best = dist;
        nearest = crumb;
      }
    }

    let feeding = false;
    if (nearest && best < 220 * 220) {
      feeding = true;
      const dx = nearest.x - fish.x;
      const dy = nearest.y - fish.y;
      const dist = Math.sqrt(best) || 1;
      fish.vx += (dx / dist) * 0.42 * dt;
      fish.vy += (dy / dist) * 0.42 * dt;
      if (dist < fish.length * 0.45 + nearest.r) {
        nearest.life -= 0.22 * dt;
        fish.gulp = 1;
      }
    }

    if (feeding) {
      return;
    }

    let fleeing = false;
    if (this.mouseX >= 0) {
      const dx = fish.x - this.mouseX;
      const dy = fish.y - this.mouseY;
      const dist = Math.hypot(dx, dy);
      const radius = 150;
      if (dist < radius && dist > 0.001) {
        fleeing = true;
        const push = (1 - dist / radius) * 1.15 * dt;
        fish.vx += (dx / dist) * push;
        fish.vy += (dy / dist) * push;
      }
    }
    if (!fleeing) {
      this.playUnderLeaf(fish, dt);
    }
  }

  /** 只有已经游到叶子边上，才会钻下去绕一会儿，然后离开。 */
  private playUnderLeaf(fish: Fish, dt: number): void {
    if (fish.roam > 0) {
      return;
    }
    if (!fish.home || fish.home.grow < 0.55) {
      fish.home = null;
      const playing = this.fishes.reduce((count, other) => count + (other.home ? 1 : 0), 0);
      if (playing >= 3) {
        fish.roam = 80 + Math.random() * 140;
        return;
      }
      let nearest: Leaf | null = null;
      let best = Infinity;
      for (const leaf of this.leaves) {
        if (leaf.grow < 0.55) {
          continue;
        }
        const dist = Math.hypot(leaf.x - fish.x, leaf.y - fish.y);
        if (dist < leaf.radius * 1.05 && dist < best) {
          best = dist;
          nearest = leaf;
        }
      }
      if (!nearest) {
        fish.roam = 70 + Math.random() * 120;
        return;
      }
      fish.home = nearest;
      fish.play = 0;
    }
    const leaf = fish.home;
    if (!leaf) {
      return;
    }
    const dx = leaf.x - fish.x;
    const dy = leaf.y - fish.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < leaf.radius * 1.15) {
      if (fish.play <= 0) {
        fish.play = 130 + Math.random() * 220;
      }
      fish.play -= dt;
      if (fish.play <= 0) {
        const angle = Math.atan2(fish.y - leaf.y, fish.x - leaf.x) + (Math.random() - 0.5) * 1.2;
        fish.vx = Math.cos(angle) * 2.3;
        fish.vy = Math.sin(angle) * 2.3;
        fish.home = null;
        fish.roam = 220 + Math.random() * 380;
        return;
      }
      const tx = (-dy / dist) * fish.spin;
      const ty = (dx / dist) * fish.spin;
      const target = leaf.radius * (0.42 + (fish.phase % 1) * 0.28);
      const radial = (dist - target) / leaf.radius;
      const wantX = tx * 1.35 + (dx / dist) * radial * 1.6;
      const wantY = ty * 1.35 + (dy / dist) * radial * 1.6;
      fish.vx += (wantX - fish.vx) * 0.22 * dt;
      fish.vy += (wantY - fish.vy) * 0.22 * dt;
      return;
    }
    fish.home = null;
    fish.play = 0;
    fish.roam = 40 + Math.random() * 70;
  }

  private coast(fish: Fish, dt: number): void {
    const drag = Math.pow(0.965, dt);
    fish.vx *= drag;
    fish.vy *= drag;
    const speed = Math.hypot(fish.vx, fish.vy);
    const max = fish.gulp > 0.25 ? FEED_SPEED : MAX_SPEED;
    if (speed > max) {
      fish.vx = (fish.vx / speed) * max;
      fish.vy = (fish.vy / speed) * max;
    }
    if (speed > 0.12) {
      const target = Math.atan2(fish.vy, fish.vx);
      let delta = target - fish.angle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      fish.angle += delta * Math.min(1, 0.18 * dt);
    }
    fish.x += fish.vx * dt;
    fish.y += fish.vy * dt;
    fish.gulp *= Math.pow(0.9, dt);

    const { width, height } = this.stage;
    fish.x = Math.max(-30, Math.min(width + 30, fish.x));
    fish.y = Math.max(-30, Math.min(height + 30, fish.y));
  }

  private updateCrumbs(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.crumbs.length; i++) {
      const crumb = this.crumbs[i];
      crumb.x += crumb.vx * dt;
      crumb.y += crumb.vy * dt;
      crumb.vx *= Math.pow(0.98, dt);
      crumb.life -= 0.0045 * dt;
      if (crumb.life > 0) {
        this.crumbs[write++] = crumb;
      }
    }
    this.crumbs.length = write;
  }

  private updateRipples(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.ripples.length; i++) {
      const ripple = this.ripples[i];
      ripple.r += 1.7 * dt;
      ripple.life -= 0.018 * dt;
      if (ripple.life > 0) {
        this.ripples[write++] = ripple;
      }
    }
    this.ripples.length = write;
  }

  private draw(time: number): void {
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';

    for (const ripple of this.ripples) {
      ctx.strokeStyle = `rgba(96, 168, 204, ${ripple.life * 0.42})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(214, 236, 244, ${ripple.life * 0.22})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, Math.max(1, ripple.r - 3.5), 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const crumb of this.crumbs) {
      ctx.globalAlpha = Math.max(0, crumb.life);
      ctx.fillStyle = '#e0a15a';
      ctx.beginPath();
      ctx.arc(crumb.x, crumb.y, crumb.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const fish of this.fishes) {
      this.drawFish(fish, time);
    }
    for (const leaf of this.leaves) {
      this.drawLeaf(leaf, time);
    }
  }

  private drawLeaf(leaf: Leaf, time: number): void {
    const shown = leaf.grow <= 0 ? 0 : 1 - (1 - leaf.grow) * (1 - leaf.grow);
    if (shown < 0.02) {
      return;
    }
    const { ctx } = this.stage;
    const radius = leaf.radius * (0.28 + 0.72 * shown);
    const bob = leaf.grow >= 1 ? Math.sin(time * 0.0014 + leaf.bob) * 0.02 : 0;
    const open = 0.18 + 0.82 * shown;

    ctx.save();
    ctx.translate(leaf.x, leaf.y + (1 - shown) * 26);
    ctx.rotate(leaf.rot);

    ctx.strokeStyle = `rgba(36, 92, 48, ${0.25 + shown * 0.35})`;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const stem = leaf.vein + Math.PI;
    ctx.moveTo(Math.cos(leaf.vein) * radius * 0.16, Math.sin(leaf.vein) * radius * 0.16);
    ctx.quadraticCurveTo(
      Math.cos(stem) * radius * 0.35,
      Math.sin(stem) * radius * 0.2,
      Math.cos(stem) * 6,
      Math.sin(stem) * (radius * 0.72 + (1 - shown) * 18),
    );
    ctx.stroke();

    ctx.rotate(bob);
    ctx.scale(open, 0.42 + 0.58 * shown);

    ctx.fillStyle = 'rgba(12, 32, 18, 0.18)';
    ctx.beginPath();
    ctx.ellipse(3, 4, radius, radius * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();

    this.tracePad(ctx, radius, leaf.vein);
    const shade = ctx.createRadialGradient(-radius * 0.18, -radius * 0.22, radius * 0.05, 0, 0, radius);
    shade.addColorStop(0, '#b6e09a');
    shade.addColorStop(0.45, '#4f9a52');
    shade.addColorStop(1, '#1c5a34');
    ctx.globalAlpha = 0.74;
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.strokeStyle = 'rgba(12, 48, 24, 0.45)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.save();
    this.tracePad(ctx, radius, leaf.vein);
    ctx.clip();
    const notch = 0.13;
    const span = Math.PI * 2 - notch * 2;
    const px = Math.cos(leaf.vein) * radius * 0.22;
    const py = Math.sin(leaf.vein) * radius * 0.22;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = 'rgba(232, 242, 196, 0.8)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    const veins = 18;
    for (let i = 0; i < veins; i++) {
      const angle = leaf.vein + notch + 0.08 + (span - 0.16) * (i / (veins - 1));
      const tip = radius * (0.82 + (i % 3) * 0.04);
      const bend = ((i % 2) * 2 - 1) * radius * 0.05;
      const mx = px * 0.25 + Math.cos(angle) * tip * 0.5 + Math.cos(angle + Math.PI / 2) * bend;
      const my = py * 0.25 + Math.sin(angle) * tip * 0.5 + Math.sin(angle + Math.PI / 2) * bend;
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(mx, my, Math.cos(angle) * tip, Math.sin(angle) * tip);
    }
    ctx.stroke();
    ctx.restore();

    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#e7f6c8';
    ctx.beginPath();
    ctx.ellipse(-radius * 0.22, -radius * 0.28, radius * 0.28, radius * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 圆盘叶，叶柄处只留一条窄缝。 */
  private tracePad(ctx: CanvasRenderingContext2D, radius: number, vein: number): void {
    const notch = 0.13;
    const start = vein + notch;
    const end = vein + Math.PI * 2 - notch;
    const px = Math.cos(vein) * radius * 0.22;
    const py = Math.sin(vein) * radius * 0.22;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const steps = 56;
    for (let i = 0; i <= steps; i++) {
      const angle = start + (end - start) * (i / steps);
      const wave = 1
        + Math.sin(angle * 8 + vein * 2) * 0.028
        + Math.sin(angle * 15 + 1.3) * 0.014;
      ctx.lineTo(Math.cos(angle) * radius * wave, Math.sin(angle) * radius * wave);
    }
    ctx.closePath();
  }

  private drawFish(fish: Fish, time: number): void {
    const { ctx } = this.stage;
    const speed = Math.hypot(fish.vx, fish.vy);
    const wag = Math.sin(time * (0.005 + speed * 0.0012) + fish.phase) * (0.16 + Math.min(0.1, speed * 0.02));
    const length = fish.length;
    const breadth = fish.breadth;
    const dark = document.documentElement.classList.contains('theme-dark');
    const ink = dark ? 'rgba(232, 236, 240, 0.42)' : 'rgba(62, 54, 48, 0.38)';

    ctx.save();
    ctx.translate(fish.x + 2, fish.y + 3);
    ctx.rotate(fish.angle);
    ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(18, 26, 36, 0.14)';
    this.traceBody(ctx, length, breadth);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(fish.x, fish.y);
    ctx.rotate(fish.angle);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const side of [1, -1] as const) {
      ctx.save();
      ctx.translate(length * 0.14, side * breadth * 0.82);
      this.drawPectoral(ctx, length, breadth, 0, side, fish.belly, ink);
      ctx.restore();
      ctx.save();
      ctx.translate(-length * 0.02, side * breadth * 0.42);
      this.drawPelvic(ctx, length, breadth, side, fish.belly, ink);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(-length * 0.3, 0);
    ctx.rotate(wag);
    this.drawCaudal(ctx, length, breadth, fish.belly, ink);
    ctx.restore();

    ctx.fillStyle = fish.body;
    ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(48, 40, 36, 0.28)';
    ctx.lineWidth = 1;
    this.traceBody(ctx, length, breadth);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    this.traceBody(ctx, length, breadth);
    ctx.clip();
    ctx.fillStyle = fish.spot;
    for (const spot of fish.spots) {
      ctx.beginPath();
      ctx.ellipse(spot.x, spot.y, spot.r * 1.35, spot.r * 0.82, fish.phase, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(length * 0.22, 0);
    ctx.lineTo(-length * 0.18, 0);
    ctx.stroke();

    const eyeX = length * 0.27;
    const eyeY = breadth * 0.55;
    const eyeR = Math.max(1.05, breadth * 0.12);
    ctx.fillStyle = '#1b1b24';
    ctx.beginPath();
    ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 俯视的瘦长身体，轮廓固定：圆头，肩部略宽，收到细细的尾柄。 */
  private traceBody(ctx: CanvasRenderingContext2D, length: number, breadth: number): void {
    ctx.beginPath();
    ctx.moveTo(length * 0.42, 0);
    ctx.bezierCurveTo(length * 0.4, -breadth * 0.62, length * 0.24, -breadth * 0.98, length * 0.06, -breadth);
    ctx.bezierCurveTo(-length * 0.08, -breadth * 0.9, -length * 0.2, -breadth * 0.5, -length * 0.3, -breadth * 0.2);
    ctx.quadraticCurveTo(-length * 0.33, 0, -length * 0.3, breadth * 0.2);
    ctx.bezierCurveTo(-length * 0.2, breadth * 0.5, -length * 0.08, breadth * 0.9, length * 0.06, breadth);
    ctx.bezierCurveTo(length * 0.24, breadth * 0.98, length * 0.4, breadth * 0.62, length * 0.42, 0);
    ctx.closePath();
  }

  /** 原点在胸鳍根部，鱼头朝 +x。 */
  private drawPectoral(
    ctx: CanvasRenderingContext2D,
    length: number,
    breadth: number,
    flap: number,
    side: 1 | -1,
    fill: string,
    ink: string,
  ): void {
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.moveTo(length * 0.02, 0);
    ctx.quadraticCurveTo(
      -length * 0.02,
      side * breadth * (1.45 + flap),
      -length * 0.12,
      side * breadth * (1.05 + flap * 0.25),
    );
    ctx.quadraticCurveTo(-length * 0.03, side * breadth * 0.28, length * 0.02, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      ctx.moveTo(0, side * breadth * 0.04);
      ctx.quadraticCurveTo(
        -length * 0.03,
        side * breadth * (0.45 + t * 0.4),
        -length * 0.02 - t * length * 0.08,
        side * breadth * (0.55 + t * 0.45 + flap * 0.15),
      );
    }
    ctx.stroke();
  }

  /** 原点在腹鳍根部，鱼头朝 +x。 */
  private drawPelvic(
    ctx: CanvasRenderingContext2D,
    length: number,
    breadth: number,
    side: 1 | -1,
    fill: string,
    ink: string,
  ): void {
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-length * 0.04, side * breadth * 0.72, -length * 0.09, side * breadth * 0.48);
    ctx.quadraticCurveTo(-length * 0.03, side * breadth * 0.12, length * 0.01, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  /** 小一点的分叉尾。原点在尾柄末端，鱼头朝 +x。 */
  private drawCaudal(
    ctx: CanvasRenderingContext2D,
    length: number,
    breadth: number,
    fill: string,
    ink: string,
  ): void {
    const reach = length * 0.16;
    const spread = breadth * 1.05;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-reach * 0.25, -spread * 0.22, -reach * 0.7, -spread * 0.9, -reach * 0.95, -spread * 0.7);
    ctx.quadraticCurveTo(-reach * 1.05, -spread * 0.22, -reach * 0.7, -spread * 0.04);
    ctx.quadraticCurveTo(-reach * 0.58, 0, -reach * 0.7, spread * 0.04);
    ctx.quadraticCurveTo(-reach * 1.05, spread * 0.22, -reach * 0.95, spread * 0.7);
    ctx.bezierCurveTo(-reach * 0.7, spread * 0.9, -reach * 0.25, spread * 0.22, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const t = i / 4 * 2 - 1;
      const tipY = t * spread * 0.62;
      const tipX = -reach * (0.9 - Math.abs(t) * 0.1);
      ctx.moveTo(0, t * breadth * 0.08);
      ctx.quadraticCurveTo(tipX * 0.45, tipY * 0.5, tipX, tipY);
    }
    ctx.stroke();
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.fishes = [];
    this.leaves = [];
    this.crumbs = [];
    this.ripples = [];
    super.dispose();
  }
}

onActivate((context) => {
  const pond = context.add(new KoiPond());
  void ElementAnimator.show(pond.element);

  renderTips({
    title: '锦鲤',
    description: '荷叶散落在水面上。锦鲤自己游，路过叶子时才会钻下去绕一会儿。鼠标划过水面会起涟漪，点一下投下饵料。',
    operations: [
      { key: '移动', description: '荡开涟漪，鱼先躲开' },
      { key: '点击', description: '投下一点饵料' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(pond.element));
});
