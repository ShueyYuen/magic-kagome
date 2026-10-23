/**
 * 蒲公英
 * 鼠标划过会带起风，把种子吹走。点在花上，整朵散开，过一会儿再长回来。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, isInteractiveTarget } from './utils/dom';
import { perlin2, seed } from './utils/perlin';
import { renderTips } from './utils/tips-render';

interface Seed {
  /** 绕茎轴的方位。 */
  angle: number;
  /** 从花头上方量起的极角，用来铺成一个球。 */
  tilt: number;
  /** 0 到 1，瘦果偏金还是偏褐。 */
  tone: number;
  attached: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  life: number;
}

interface Head {
  x: number;
  y: number;
  phase: number;
  /** 花头偏离根的水平距离。根不动。 */
  lean: number;
  /** 花头回摆的速度。风停之后还会荡几下。 */
  leanV: number;
  /** 这朵花球的半径，每朵不一样。 */
  radius: number;
  /** 从屏幕底边到花心的茎长。 */
  stem: number;
  /** 静止时的倾角，弧度。风停后回到这个角度，不是竖直。 */
  slant: number;
  /** 0 偏绿，1 偏黄。越黄越容易被风吹散。 */
  gold: number;
  seeds: Seed[];
  grow: number;
  regrow: number;
}

const SEEDS_PER_HEAD = 64;

class Dandelions extends Disposable {
  private stage: FullscreenStage;
  private heads: Head[] = [];
  private mouseX = -9999;
  private mouseY = -9999;
  private windX = 0;
  private windY = 0;
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
    this.plant();
    this.stage.onResize = () => this.place();

    this._register(new DomListener(window, 'pointermove', (event: PointerEvent) => {
      if (this.mouseX < 0) {
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
        return;
      }
      this.windX = this.windX * 0.72 + (event.clientX - this.mouseX) * 0.55;
      this.windY = this.windY * 0.72 + (event.clientY - this.mouseY) * 0.55;
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }));
    this._register(new DomListener(window, 'pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return;
      }
      this.puff(event.clientX, event.clientY);
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

  private plant(): void {
    const { width } = this.stage;
    const count = Math.min(22, Math.max(16, Math.round(width / 55)));
    this.heads = [];
    for (let i = 0; i < count; i++) {
      const radius = 28 + Math.random() * 52;
      const sign = Math.random() < 0.5 ? -1 : 1;
      const head: Head = {
        x: 0,
        y: 0,
        phase: Math.random() * Math.PI * 2,
        lean: 0,
        leanV: 0,
        radius,
        stem: 100 + Math.random() * 210 + radius * 0.35,
        slant: sign * (0.05 + Math.random() * 0.16),
        gold: Math.random(),
        seeds: [],
        grow: 1,
        regrow: 0,
      };
      this.fill(head);
      head.grow = 1;
      this.heads.push(head);
    }
    this.place();
  }

  private place(): void {
    const { width, height } = this.stage;
    const count = this.heads.length;
    this.heads.forEach((head, index) => {
      const margin = Math.max(20, head.radius * 0.55);
      const span = Math.max(40, width - margin * 2);
      const slot = span / count;
      const jitter = Math.sin(head.phase * 3.1) * slot * 0.18;
      head.x = margin + slot * (index + 0.5) + jitter;
      head.x = Math.max(margin, Math.min(width - margin, head.x));
      head.y = Math.max(head.radius + 16, height - head.stem);
    });
    for (const head of this.heads) {
      if (head.lean === 0 && head.leanV === 0) {
        head.lean = this.restLean(head);
      }
    }
  }

  /** 这株静止时花头相对根的水平偏移。 */
  private restLean(head: Head): number {
    const rise = Math.max(48, this.stage.height - head.y);
    return Math.sin(head.slant) * rise;
  }

  private fill(head: Head): void {
    const flying = head.seeds.filter((seed) => !seed.attached);
    head.seeds = flying;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < SEEDS_PER_HEAD; i++) {
      const t = (i + 0.5) / SEEDS_PER_HEAD;
      head.seeds.push({
        angle: golden * i,
        tilt: Math.acos(1 - 2 * t),
        tone: Math.random(),
        attached: true,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rot: -Math.PI / 2 + (Math.random() - 0.5) * 0.4,
        spin: (Math.random() - 0.5) * 0.04,
        life: 1,
      });
    }
    head.grow = 0;
    head.regrow = 0;
  }

  /**
   * 离鼠标越远、茎越矮，风推得越轻。
   * 花头当弹簧，风停了还会过冲再荡回来，不会一下子直立。
   */
  private bend(head: Head, time: number, dt: number): void {
    const dist = this.mouseX < 0
      ? 1e9
      : Math.hypot(head.x - this.mouseX, head.y - this.mouseY);
    const exposure = Math.max(0, 1 - dist / 460);
    const stature = 0.32 + Math.min(0.78, head.stem / 380);
    const influence = exposure * exposure * stature;
    const idle = Math.sin(time * 0.00115 + head.phase) * (2.2 + head.radius * 0.03) * stature;
    const target = this.restLean(head) + idle + this.windX * 1.65 * influence;
    const stiffness = 0.09 * (0.82 + (head.phase % 1) * 0.36);
    head.leanV += (target - head.lean) * stiffness * dt;
    head.leanV *= Math.pow(0.955, dt);
    head.lean += head.leanV * dt;
    const limit = 22 + head.radius * 0.42;
    head.lean = Math.max(-limit, Math.min(limit, head.lean));
  }

  private project(head: Head, seed: Seed): { x: number; y: number; z: number; ux: number; uy: number } {
    const radius = head.radius * Math.max(0.25, head.grow);
    const sway = head.lean - this.restLean(head);
    const lean = head.slant + sway * 0.003;
    const cx = Math.cos(seed.angle) * Math.sin(seed.tilt);
    const cy = -Math.cos(seed.tilt);
    const cz = Math.sin(seed.angle) * Math.sin(seed.tilt);
    const ux = cx * Math.cos(lean) + cz * Math.sin(lean);
    const uz = -cx * Math.sin(lean) + cz * Math.cos(lean);
    const ox = head.x + head.lean;
    const oy = head.y;
    return {
      x: ox + ux * radius,
      y: oy + cy * radius,
      z: uz,
      ux,
      uy: cy,
    };
  }

  private release(head: Head, seed: Seed, impulse: number): void {
    const pose = this.project(head, seed);
    seed.attached = false;
    seed.x = pose.x;
    seed.y = pose.y;
    seed.rot = Math.atan2(pose.uy, pose.ux);
    seed.vx = pose.ux * (0.45 + impulse) + this.windX * 0.22;
    seed.vy = pose.uy * 0.35 - 0.4 + this.windY * 0.16;
    seed.life = 1;
  }

  private puff(x: number, y: number): void {
    let closest: Head | null = null;
    let closestDist = Infinity;
    for (const head of this.heads) {
      const reach = head.radius + 16;
      const dist = (head.x - x) ** 2 + (head.y - y) ** 2;
      if (dist < reach * reach && dist < closestDist) {
        closestDist = dist;
        closest = head;
      }
    }
    if (closest) {
      for (const seed of closest.seeds) {
        if (seed.attached) {
          this.release(closest, seed, 2.4 + Math.random() * 1.6);
        }
      }
      return;
    }
    for (const head of this.heads) {
      const dx = head.x - x;
      const dy = head.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > 360) {
        continue;
      }
      const power = 1 - dist / 360;
      for (const seed of head.seeds) {
        if (!seed.attached || Math.random() > power * 0.8) {
          continue;
        }
        this.release(head, seed, power * 3);
        seed.vx += (dx / (dist || 1)) * power * 2.4;
        seed.vy += (dy / (dist || 1)) * power * 1.6;
      }
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
    this.windX *= Math.pow(0.9, dt);
    this.windY *= Math.pow(0.9, dt);
    const gust = Math.hypot(this.windX, this.windY);

    for (const head of this.heads) {
      this.bend(head, time, dt);
      const fragile = 0.5 + head.gold * 1.5;
      if (gust > 1.55 - head.gold * 0.7 && this.mouseX >= 0) {
        const dist = Math.hypot(head.x - this.mouseX, head.y - this.mouseY);
        const near = Math.max(0, 1 - dist / 280);
        const chance = Math.min(0.5, gust * 0.02 * near * fragile);
        if (chance > 0.01) {
          for (const seed of head.seeds) {
            if (seed.attached && Math.random() < chance) {
              this.release(head, seed, gust * (0.08 + head.gold * 0.14));
            }
          }
        }
      }

      let attached = 0;
      let write = 0;
      for (let i = 0; i < head.seeds.length; i++) {
        const seed = head.seeds[i];
        if (!seed.attached) {
          seed.vy += 0.012 * dt;
          seed.vx += perlin2(seed.x * 0.008, time * 0.00015 + seed.rot) * 0.06 * dt;
          seed.vx *= Math.pow(0.992, dt);
          seed.vy *= Math.pow(0.996, dt);
          seed.x += seed.vx * dt;
          seed.y += seed.vy * dt;
          seed.rot += seed.spin * dt;
          seed.life -= 0.0028 * dt;
          if (seed.y > height + 36 || seed.x < -50 || seed.x > width + 50 || seed.y < -70) {
            seed.life = 0;
          }
        } else {
          attached++;
        }
        if (seed.attached || seed.life > 0) {
          head.seeds[write++] = seed;
        }
      }
      head.seeds.length = write;

      if (attached === 0 && head.grow >= 1) {
        head.regrow += dt;
        if (head.regrow > 150) {
          this.fill(head);
        }
      } else if (head.grow < 1) {
        head.grow = Math.min(1, head.grow + 0.016 * dt);
      }
    }
  }

  /** 绿色圆托，跟着花头走。 */
  private drawReceptacle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    grow: number,
    dark: boolean,
  ): void {
    const radius = 16 * grow;
    ctx.save();
    ctx.fillStyle = dark ? 'rgba(92, 122, 64, 0.35)' : 'rgba(60, 90, 40, 0.18)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + radius * 0.35, radius * 0.9, radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = dark ? '#6f8c48' : '#5c7a38';
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const angle = Math.PI * 0.15 + (Math.PI * 0.7 * i) / 6;
      const bx = x + Math.cos(angle) * radius * 0.15;
      const by = y + radius * 0.15;
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(
        x + Math.cos(angle) * radius * 1.15,
        y + Math.sin(angle) * radius * 0.85,
        x + Math.cos(angle) * radius * 1.45,
        y + radius * 0.95,
      );
      ctx.quadraticCurveTo(
        x + Math.cos(angle) * radius * 0.7,
        y + radius * 0.7,
        bx,
        by,
      );
    }
    ctx.fill();

    const shade = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.1, x, y, radius);
    shade.addColorStop(0, dark ? '#d5e4a6' : '#e4f0bf');
    shade.addColorStop(0.55, dark ? '#8eae5c' : '#7ea24a');
    shade.addColorStop(1, dark ? '#4f6b34' : '#4d7330');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = dark ? 'rgba(232, 236, 196, 0.45)' : 'rgba(255, 252, 230, 0.55)';
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.4;
      const dist = radius * (0.25 + (i % 4) * 0.16);
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist * 0.92, 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 瘦果靠近中心，外面是一伞绒毛。tip 是这根种子在球面上的外端。 */
  private drawFloret(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    tipX: number,
    tipY: number,
    tone: number,
    alpha: number,
    dark: boolean,
  ): void {
    const dx = tipX - ox;
    const dy = tipY - oy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const achene = dark
      ? ['#d7b56a', '#c49245', '#a56e30', '#7a4e22']
      : ['#b8893a', '#946828', '#6e4a1c', '#5c3c16'];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';

    const beakX = ox + dx * 0.58;
    const beakY = oy + dy * 0.58;
    ctx.strokeStyle = dark ? 'rgba(236, 230, 214, 0.45)' : 'rgba(92, 80, 62, 0.32)';
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(ox + dx * 0.26, oy + dy * 0.26);
    ctx.lineTo(beakX, beakY);
    ctx.stroke();

    ctx.strokeStyle = achene[Math.min(3, Math.floor(tone * 4))];
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(ox + dx * 0.1, oy + dy * 0.1);
    ctx.lineTo(ox + dx * 0.24, oy + dy * 0.24);
    ctx.stroke();

    ctx.strokeStyle = dark ? 'rgba(255, 250, 242, 0.72)' : 'rgba(108, 102, 94, 0.55)';
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    const hairs = 11;
    const outer = len * 1.04;
    const bx = dx * 0.58;
    const by = dy * 0.58;
    for (let i = 0; i < hairs; i++) {
      const spread = (i / (hairs - 1) - 0.5) * 1.15;
      const hx = ux * Math.cos(spread) + px * Math.sin(spread);
      const hy = uy * Math.cos(spread) + py * Math.sin(spread);
      const bdot = bx * hx + by * hy;
      const disc = bdot * bdot - (bx * bx + by * by) + outer * outer;
      const reach = Math.max(4, -bdot + Math.sqrt(Math.max(0, disc)));
      ctx.moveTo(beakX, beakY);
      ctx.lineTo(beakX + hx * reach, beakY + hy * reach);
    }
    ctx.stroke();
    ctx.restore();
  }

  private draw(time: number): void {
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);
    const dark = document.documentElement.classList.contains('theme-dark');

    ctx.lineCap = 'round';
    for (const head of this.heads) {
      const ox = head.x + head.lean;
      const oy = head.y;
      const grow = Math.max(0.25, head.grow);
      const hue = 116 - head.gold * 48;

      ctx.strokeStyle = dark
        ? `hsla(${hue}, 40%, 64%, 0.86)`
        : `hsla(${hue}, 42%, 32%, 0.86)`;
      ctx.lineWidth = 1.3 + head.radius * 0.022;
      ctx.beginPath();
      ctx.moveTo(head.x, height + 4);
      ctx.quadraticCurveTo(
        head.x + head.lean * 0.42,
        (height + oy) * 0.55,
        ox,
        oy + head.radius * 0.2 * grow,
      );
      ctx.stroke();

      const attached = head.seeds.filter((seed) => seed.attached);
      attached.sort((a, b) => this.project(head, a).z - this.project(head, b).z);
      const split = attached.findIndex((seed) => this.project(head, seed).z > 0.05);
      const frontAt = split < 0 ? attached.length : split;
      for (let i = 0; i < frontAt; i++) {
        const pose = this.project(head, attached[i]);
        this.drawFloret(ctx, ox, oy, pose.x, pose.y, attached[i].tone, 1, dark);
      }
      this.drawReceptacle(ctx, ox, oy, grow * (head.radius / 70), dark);
      for (let i = frontAt; i < attached.length; i++) {
        const pose = this.project(head, attached[i]);
        this.drawFloret(ctx, ox, oy, pose.x, pose.y, attached[i].tone, 1, dark);
      }

      for (const seed of head.seeds) {
        if (seed.attached) {
          continue;
        }
        const ux = Math.cos(seed.rot);
        const uy = Math.sin(seed.rot);
        this.drawFloret(
          ctx,
          seed.x - ux * 22,
          seed.y - uy * 22,
          seed.x + ux * 16,
          seed.y + uy * 16,
          seed.tone,
          Math.max(0, seed.life),
          dark,
        );
      }
    }

    const gust = Math.hypot(this.windX, this.windY);
    if (gust > 2.4 && this.mouseX >= 0 && this.mouseY >= 0 && this.mouseY <= height) {
      const angle = Math.atan2(this.windY, this.windX);
      ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(62, 62, 95, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const along = 18 + i * 16;
        const side = Math.sin(time * 0.01 + i * 1.7) * 10;
        const px = Math.cos(angle);
        const py = Math.sin(angle);
        const x = this.mouseX - px * along - py * side;
        const y = this.mouseY - py * along + px * side;
        const len = 12 + i * 6;
        ctx.moveTo(x, y);
        ctx.lineTo(x + px * len, y + py * len);
      }
      ctx.stroke();
    }
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.heads = [];
    super.dispose();
  }
}

onActivate((context) => {
  const field = context.add(new Dandelions());
  void ElementAnimator.show(field.element);

  renderTips({
    title: '蒲公英',
    description: '花球上沾满种子。鼠标快速划过会带起风，点在花上会把整朵吹散，过一会儿又长回来。',
    operations: [
      { key: '移动', description: '吹散身边的种子' },
      { key: '点击', description: '把最近的一朵吹散' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(field.element));
});
