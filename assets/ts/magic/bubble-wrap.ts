/**
 * 漂浮的泡泡
 * 随机大小，慢慢上浮。点破时有一声破裂声。
 *
 * 浏览器若实现了 html-in-canvas（https://github.com/WICG/html-in-canvas），
 * 就把页面放进 drawable 画布，用 WebGL2 的 texElementSubImage2D 取渲染图像，
 * 再在着色器里做肥皂泡薄膜。没有这个 API 时，退回画在页面上的薄膜。
 */

import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable, IDisposable } from './utils/disposable';
import { DomListener, isTypingTarget } from './utils/dom';
import { detectHtmlInCanvas, LensBubble, PageSurface } from './utils/html-in-canvas';
import { renderTips } from './utils/tips-render';

/** 薄膜只在边缘把采样往球心收一点。返回值是半径的倍数。 */
function filmSample(nx: number, ny: number): { x: number; y: number } | null {
  const r2 = nx * nx + ny * ny;
  if (r2 >= 1) {
    return null;
  }
  const r = Math.sqrt(r2);
  const limb = r <= 0.62 ? 0 : (r - 0.62) / 0.38;
  const pinch = limb * limb * 0.42;
  return { x: nx * (1 - pinch), y: ny * (1 - pinch) };
}

function filmCss(thickness: number, cosT: number, alpha: number): string {
  const opd = 2 * 1.33 * thickness * cosT;
  const band = (lambda: number) => 0.5 - 0.5 * Math.cos((Math.PI * 2 * opd) / lambda);
  const r = Math.round(255 * band(650));
  const g = Math.round(255 * band(530));
  const b = Math.round(255 * band(460));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

/** 戳点处的单位法线。popX/popY 已经是球面上的屏幕分量。 */
function pokeNormal(popX: number, popY: number): SpherePoint {
  return {
    x: popX,
    y: popY,
    z: Math.sqrt(Math.max(0, 1 - popX * popX - popY * popY)),
  };
}

/** 球面切平面上的一组正交基。 */
function pokeBasis(poke: SpherePoint): [SpherePoint, SpherePoint] {
  const ax = Math.abs(poke.x) < 0.8 ? 1 : 0;
  const ay = Math.abs(poke.x) < 0.8 ? 0 : 1;
  let e1x = ay * poke.z;
  let e1y = -ax * poke.z;
  let e1z = ax * poke.y - ay * poke.x;
  const len = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= len;
  e1y /= len;
  e1z /= len;
  return [
    { x: e1x, y: e1y, z: e1z },
    {
      x: poke.y * e1z - poke.z * e1y,
      y: poke.z * e1x - poke.x * e1z,
      z: poke.x * e1y - poke.y * e1x,
    },
  ];
}

/** 离戳点球面角为 theta、绕戳点转过 phi 的那一点。 */
function capPoint(poke: SpherePoint, e1: SpherePoint, e2: SpherePoint, theta: number, phi: number): SpherePoint {
  const along = Math.cos(theta);
  const aside = Math.sin(theta);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  return {
    x: poke.x * along + (e1.x * cp + e2.x * sp) * aside,
    y: poke.y * along + (e1.y * cp + e2.y * sp) * aside,
    z: poke.z * along + (e1.z * cp + e2.z * sp) * aside,
  };
}

function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  const value = angle % turn;
  return value < 0 ? value + turn : value;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  /** 0 在最远处，1 在最前面。大泡泡更近，绘制和点选都按这个顺序。 */
  depth: number;
  vx: number;
  vy: number;
  phase: number;
  life: number;
  born: number;
  popping: boolean;
  /** 戳点在单位球面上的位置，x/y 朝屏幕右方和下方。 */
  popX: number;
  popY: number;
  wobble: number;
}

class BubbleSynth implements IDisposable {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastAt = 0;
  private resuming = false;

  pop(): void {
    const ctx = this.ensure();
    if (!ctx || !this.noise) {
      return;
    }
    if (ctx.state === 'suspended') {
      this.resumeThen(() => this.pop());
      return;
    }
    const now = ctx.currentTime;
    if (now - this.lastAt < 0.032) {
      return;
    }
    this.lastAt = now;
    this.playPop(ctx, now);
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.noise = null;
    }
  }

  private resumeThen(action: () => void): void {
    if (!this.ctx || this.resuming) {
      return;
    }
    this.resuming = true;
    void this.ctx.resume().then(() => {
      this.resuming = false;
      action();
    }).catch(() => {
      this.resuming = false;
    });
  }

  private ensure(): AudioContext | null {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      const seconds = 0.09;
      const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const envelope = Math.pow(1 - i / length, 3);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
      this.noise = buffer;
    }
    return this.ctx;
  }

  private playPop(ctx: AudioContext, now: number): void {
    if (!this.noise) {
      return;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.playbackRate.value = 0.75 + Math.random() * 1.5;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 650 + Math.random() * 2400;
    filter.Q.value = 0.85;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.42, now + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.08);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const pitch = 210 + Math.random() * 460;
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, pitch * 0.45), now + 0.06);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.14, now);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(toneGain);
    toneGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }
}


class BubbleWrap extends Disposable {
  private stage: FullscreenStage | null = null;
  private surface: PageSurface | null = null;
  private synth = new BubbleSynth();
  private badge: HTMLDivElement;
  private bubbles: Bubble[] = [];
  private popped = 0;
  private lastX = 0;
  private lastY = 0;
  private pressing = false;
  private animationId: number | null = null;
  private lastTime = 0;
  private now = 0;
  private running = true;
  private presented = false;
  private popCanvas: HTMLCanvasElement;
  private popCtx: CanvasRenderingContext2D;

  constructor() {
    super();
    this._register(this.synth);
    this.badge = document.createElement('div');
    this.badge.hidden = true;
    this.badge.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:28px',
      'transform:translateX(-50%)',
      'z-index:30',
      'pointer-events:none',
      'padding:8px 14px',
      'border-radius:12px',
      'background:rgba(16,20,24,0.88)',
      'color:#f4fff6',
      'font:14px/1 "Open Sans",sans-serif',
    ].join(';');
    this._register({ dispose: () => this.badge.remove() });

    this.popCanvas = document.createElement('canvas');
    this.popCanvas.dataset.magicBubbles = 'pop';
    this.popCanvas.style.cssText = 'position:fixed;inset:0;z-index:22;pointer-events:none;';
    const popCtx = this.popCanvas.getContext('2d');
    if (!popCtx) {
      throw new Error('2d context unavailable');
    }
    this.popCtx = popCtx;
    this.syncPopCanvas();
    this._register({ dispose: () => this.popCanvas.remove() });
    this._register(new DomListener(window, 'resize', () => this.syncPopCanvas()));

    const mode = detectHtmlInCanvas();
    if (mode !== 'none') {
      try {
        const surface = new PageSurface(mode);
        this.surface = surface;
        this._register(surface);
        surface.onPaint = () => {
          if (this.running) {
            surface.render(this.lensBubbles());
          }
        };
      } catch (error) {
        console.warn('html-in-canvas 未能装入页面，改回半透明泡泡', error);
        this.surface = null;
      }
    }
    if (this.surface) {
      this._register(new DomListener(window, 'resize', () => {
        this.surface?.resize();
        this.containBubbles();
      }));
    } else {
      this.stage = createFullscreenStage({
        pointerEvents: 'none',
        opacity: '0',
      });
      this._register(this.stage.canvas);
      this.stage.onResize = () => this.containBubbles();
    }
    document.body.appendChild(this.popCanvas);
    document.body.appendChild(this.badge);

    this.spawnAll();
    this._register(new DomListener(document, 'pointerdown', this.onPointerDown, true));
    this._register(new DomListener(document, 'pointermove', this.onPointerMove, true));
    this._register(new DomListener(document, 'pointerup', this.onPointerUp, true));
    this._register(new DomListener(document, 'pointercancel', this.onPointerUp, true));
    this._register(new DomListener(window, 'keydown', this.onKeyDown));
    this.surface?.connect();
    this.animationId = requestAnimationFrame(this.frame);
  }

  get element(): HTMLElement {
    return this.surface?.layer ?? this.stage!.canvas.element;
  }

  get refracts(): boolean {
    return !!this.surface && !this.surface.bubbleLayer;
  }

  private view(): { width: number; height: number } {
    if (this.stage) {
      return { width: this.stage.width, height: this.stage.height };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }

  private targetCount(): number {
    const { width, height } = this.view();
    return Math.round(Math.min(5, Math.max(3, (width * height) / 180000)));
  }

  private makeBubble(x?: number, y?: number): Bubble {
    const { width, height } = this.view();
    const depth = Math.random();
    const minR = 22;
    const maxR = Math.min(110, Math.max(64, Math.min(width, height) * 0.16));
    const r = minR + (maxR - minR) * (0.22 + 0.78 * depth);
    const spanX = Math.max(r * 2, width);
    const spanY = Math.max(r * 2, height);
    return {
      x: x ?? (width <= r * 2 ? width / 2 : r + Math.random() * (spanX - r * 2)),
      y: y ?? (height <= r * 2 ? height / 2 : r + Math.random() * (spanY - r * 2)),
      r,
      depth,
      vx: (Math.random() - 0.5) * (0.25 + depth * 0.55),
      vy: -(0.18 + depth * 0.42) - Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
      life: 1,
      born: Math.random() * 0.7,
      wobble: 0.6 + Math.random() * 0.8,
      popping: false,
      popX: 0,
      popY: 0,
    };
  }

  /** 从远到近，近处的盖住远处的。 */
  private backToFront(): Bubble[] {
    return this.bubbles.slice().sort((a, b) => a.depth - b.depth);
  }

  private spawnAll(): void {
    const count = this.targetCount();
    this.bubbles = [];
    for (let i = 0; i < count; i++) {
      this.bubbles.push(this.makeBubble());
    }
  }

  private containBubbles(): void {
    const { width, height } = this.view();
    for (const bubble of this.bubbles) {
      if (bubble.x < -bubble.r) bubble.x = width + bubble.r;
      if (bubble.x > width + bubble.r) bubble.x = -bubble.r;
      if (bubble.y < -bubble.r) bubble.y = height + bubble.r;
      if (bubble.y > height + bubble.r) bubble.y = -bubble.r;
    }
  }

  private radiusOf(bubble: Bubble): number {
    const scale = this.easeOut(Math.min(1, bubble.born));
    const wobble = 1 + Math.sin(this.now * 0.002 * bubble.wobble + bubble.phase) * 0.035;
    return Math.max(0, bubble.r * scale * wobble);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.overSidebar(event.clientX, event.clientY)) {
      return;
    }
    this.pressing = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (this.popAlong(event.clientX, event.clientY, event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pressing) {
      return;
    }
    const popped = this.overSidebar(event.clientX, event.clientY)
      ? false
      : this.popAlong(this.lastX, this.lastY, event.clientX, event.clientY);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (popped) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private onPointerUp = (): void => {
    this.pressing = false;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || isTypingTarget(event.target)) {
      return;
    }
    if (event.code === 'KeyR') {
      this.popped = 0;
      this.spawnAll();
      this.syncBadge();
    }
  };

  private overSidebar(x: number, y: number): boolean {
    const hit = document.elementFromPoint(x, y);
    return !!hit && !!hit.closest('.widget-info');
  }

  private popAlong(x0: number, y0: number, x1: number, y1: number): boolean {
    let front: Bubble | null = null;
    for (const bubble of this.bubbles) {
      if (bubble.popping || bubble.born < 0.85) {
        continue;
      }
      if (!this.hits(bubble, x0, y0, x1, y1)) {
        continue;
      }
      if (!front || bubble.depth > front.depth) {
        front = bubble;
      }
    }
    if (!front) {
      return false;
    }
    this.openHole(front, x0, y0, x1, y1);
    this.popped += 1;
    this.synth.pop();
    this.syncBadge();
    return true;
  }

  private hits(bubble: Bubble, x0: number, y0: number, x1: number, y1: number): boolean {
    const radius = this.radiusOf(bubble);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    let t = 0;
    if (lengthSquared > 0) {
      t = ((bubble.x - x0) * dx + (bubble.y - y0) * dy) / lengthSquared;
      t = Math.max(0, Math.min(1, t));
    }
    const px = x0 + dx * t - bubble.x;
    const py = y0 + dy * t - bubble.y;
    return px * px + py * py <= radius * radius;
  }

  private frame = (time: number): void => {
    if (!this.running) {
      return;
    }
    const dt = this.lastTime === 0 ? 1 : Math.min(2, (time - this.lastTime) / 16.67);
    this.lastTime = time;
    this.now = time;
    this.step(dt);
    if (this.surface) {
      const layer = this.surface.bubbleLayer;
      if (layer) {
        this.drawGlassy(layer.ctx, layer.width, layer.height);
      }
      this.surface.requestPaint();
    } else if (this.stage) {
      this.drawGlassy(this.stage.ctx, this.stage.width, this.stage.height);
    }
    this.drawRuptures();
    this.animationId = requestAnimationFrame(this.frame);
  };

  private lensBubbles(): LensBubble[] {
    const lenses: LensBubble[] = [];
    for (const bubble of this.backToFront()) {
      const radius = this.radiusOf(bubble);
      if (radius < 1) {
        continue;
      }
      const pose = bubble.popping ? this.popPose(bubble) : null;
      if (pose?.gone) {
        continue;
      }
      const poke = pokeNormal(bubble.popX, bubble.popY);
      lenses.push({
        x: bubble.x,
        y: bubble.y,
        radius,
        phase: bubble.phase + this.now * 0.0004,
        alpha: 1,
        pokeX: poke.x,
        pokeY: poke.y,
        pokeZ: poke.z,
        cosOpen: pose ? Math.cos(pose.theta) : 2,
      });
    }
    return lenses;
  }

  private step(dt: number): void {
    const { width, height } = this.view();
    for (const bubble of this.bubbles) {
      if (bubble.born < 1) {
        bubble.born = Math.min(1, bubble.born + dt * 0.045);
      }
      if (bubble.popping) {
        bubble.life = Math.max(0, bubble.life - dt * 0.08);
        if (bubble.life === 0) {
          const next = this.makeBubble();
          next.born = 0;
          next.y = height + next.r;
          Object.assign(bubble, next);
        }
        continue;
      }

      bubble.vx += Math.sin(this.now * 0.001 + bubble.phase) * 0.02 * dt;
      bubble.vy += Math.cos(this.now * 0.0008 + bubble.phase) * 0.012 * dt;
      bubble.vy -= 0.01 * dt;
      const speed = Math.hypot(bubble.vx, bubble.vy);
      const maxSpeed = 1.35;
      if (speed > maxSpeed) {
        bubble.vx = (bubble.vx / speed) * maxSpeed;
        bubble.vy = (bubble.vy / speed) * maxSpeed;
      }
      bubble.x += bubble.vx * dt;
      bubble.y += bubble.vy * dt;

      if (bubble.y < -bubble.r) {
        bubble.y = height + bubble.r;
        bubble.x = bubble.r + Math.random() * Math.max(1, width - bubble.r * 2);
      } else if (bubble.y > height + bubble.r) {
        bubble.y = -bubble.r;
      }
      if (bubble.x < -bubble.r) bubble.x = width + bubble.r;
      if (bubble.x > width + bubble.r) bubble.x = -bubble.r;
    }
  }

  private drawGlassy(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const bubble of this.backToFront()) {
      if (bubble.popping && this.popPose(bubble).gone) {
        continue;
      }
      const radius = this.radiusOf(bubble);
      if (radius < 1) {
        continue;
      }
      const theta = bubble.popping ? this.popPose(bubble).theta : 0;
      this.refractDrawn(ctx, bubble, radius, theta);
      ctx.save();
      this.clipRemaining(ctx, bubble, radius, theta);
      this.drawFilm(ctx, bubble, radius);
      this.drawHighlight(ctx, bubble, 1);
      ctx.restore();
    }
    if (!this.presented && this.stage) {
      this.presented = true;
      this.stage.canvas.element.style.opacity = '1';
    }
  }

  /**
   * 采样画布上已经画好的下层泡泡，只在边缘按薄膜弯一下再写回。
   * 近处的泡泡因此折的是远处泡泡已经画过的那一层。
   */
  private refractDrawn(
    ctx: CanvasRenderingContext2D,
    bubble: Bubble,
    radius: number,
    theta: number,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const left = Math.floor((bubble.x - radius) * dpr) - 2;
    const top = Math.floor((bubble.y - radius) * dpr) - 2;
    const size = Math.ceil(radius * 2 * dpr) + 4;
    if (size < 2) {
      return;
    }
    let image: ImageData;
    try {
      image = ctx.getImageData(left, top, size, size);
    } catch {
      return;
    }
    const src = new Uint8ClampedArray(image.data);
    const out = image.data;
    const sample = (bx: number, by: number): [number, number, number, number] => {
      const x = bx - left;
      const y = by - top;
      const x0 = Math.max(0, Math.min(size - 1, Math.floor(x)));
      const y0 = Math.max(0, Math.min(size - 1, Math.floor(y)));
      const x1 = Math.min(size - 1, x0 + 1);
      const y1 = Math.min(size - 1, y0 + 1);
      const tx = x < 0 || x >= size - 1 ? 0 : x - Math.floor(x);
      const ty = y < 0 || y >= size - 1 ? 0 : y - Math.floor(y);
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const i00 = (y0 * size + x0) * 4;
      const i10 = (y0 * size + x1) * 4;
      const i01 = (y1 * size + x0) * 4;
      const i11 = (y1 * size + x1) * 4;
      return [
        src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11,
        src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11,
        src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11,
        src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11,
      ];
    };
    for (let py = 0; py < size; py++) {
      const cssY = (top + py + 0.5) / dpr;
      const ny = (cssY - bubble.y) / radius;
      for (let px = 0; px < size; px++) {
        const cssX = (left + px + 0.5) / dpr;
        const nx = (cssX - bubble.x) / radius;
        if (nx * nx + ny * ny >= 1) {
          continue;
        }
        if (theta > 0 && this.onOpenedCap(nx, ny, bubble, theta)) {
          continue;
        }
        const hit = filmSample(nx, ny);
        if (!hit) {
          continue;
        }
        const bent = sample((bubble.x + hit.x * radius) * dpr, (bubble.y + hit.y * radius) * dpr);
        if (bent[3] < 8) {
          continue;
        }
        const index = (py * size + px) * 4;
        out[index] = bent[0];
        out[index + 1] = bent[1];
        out[index + 2] = bent[2];
        out[index + 3] = bent[3];
      }
    }
    ctx.putImageData(image, left, top);
  }

  /** 画在页面上的那层膜：中间几乎透明，彩虹和白边留在轮廓。 */
  private drawFilm(ctx: CanvasRenderingContext2D, bubble: Bubble, radius: number): void {
    const phase = bubble.phase + this.now * 0.0004;
    const sway = 90 * Math.sin(phase);
    ctx.save();
    ctx.beginPath();
    ctx.arc(bubble.x, bubble.y, radius, 0, Math.PI * 2);
    ctx.clip();

    const body = ctx.createLinearGradient(bubble.x, bubble.y - radius, bubble.x, bubble.y + radius);
    body.addColorStop(0, filmCss(160 + sway, 0.96, 0.16));
    body.addColorStop(0.42, 'rgba(255, 255, 255, 0.03)');
    body.addColorStop(0.7, filmCss(520 + sway, 0.7, 0.12));
    body.addColorStop(1, filmCss(860 + sway, 0.42, 0.2));
    ctx.fillStyle = body;
    ctx.fillRect(bubble.x - radius, bubble.y - radius, radius * 2, radius * 2);

    const rim = ctx.createRadialGradient(bubble.x, bubble.y, radius * 0.58, bubble.x, bubble.y, radius);
    rim.addColorStop(0, 'rgba(255, 255, 255, 0)');
    rim.addColorStop(0.55, filmCss(340 + sway, 0.62, 0.08));
    rim.addColorStop(0.78, filmCss(460 + sway, 0.4, 0.34));
    rim.addColorStop(0.9, filmCss(640 + sway, 0.24, 0.5));
    rim.addColorStop(0.955, 'rgba(18, 22, 28, 0.28)');
    rim.addColorStop(0.985, 'rgba(255, 255, 255, 0.92)');
    rim.addColorStop(1, 'rgba(255, 255, 255, 0.2)');
    ctx.fillStyle = rim;
    ctx.fillRect(bubble.x - radius, bubble.y - radius, radius * 2, radius * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(bubble.x, bubble.y, radius - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  private drawHighlight(ctx: CanvasRenderingContext2D, bubble: Bubble, alpha: number): void {
    const radius = this.radiusOf(bubble);
    if (radius < 2) {
      return;
    }
    const hx = bubble.x - radius * 0.32;
    const hy = bubble.y - radius * 0.36;
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, radius * 0.16);
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.95 * alpha})`);
    glow.addColorStop(0.28, `rgba(255, 255, 255, ${0.45 * alpha})`);
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.save();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(hx, hy, radius * 0.16, radius * 0.09, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 记下戳中的球面位置。破口从这一点沿球面扩开。 */
  private openHole(bubble: Bubble, x0: number, y0: number, x1: number, y1: number): void {
    const radius = this.radiusOf(bubble);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    let t = 0;
    if (lengthSquared > 0) {
      t = ((bubble.x - x0) * dx + (bubble.y - y0) * dy) / lengthSquared;
      t = Math.max(0, Math.min(1, t));
    }
    let nx = (x0 + dx * t - bubble.x) / radius;
    let ny = (y0 + dy * t - bubble.y) / radius;
    const dist = Math.hypot(nx, ny);
    if (dist < 0.08) {
      nx = 0.22;
      ny = -0.12;
    } else if (dist > 0.96) {
      nx *= 0.96 / dist;
      ny *= 0.96 / dist;
    }
    bubble.popX = nx;
    bubble.popY = ny;
    bubble.life = 1;
    bubble.popping = true;
  }

  /**
   * theta 是球冠张角。张角按时间的平方长大，所以越裂越快。
   * 正面的膜被盖住的那一帧就结束，不再停在最后的位置上淡出。
   */
  private popPose(bubble: Bubble): { theta: number; alpha: number; gone: boolean } {
    const t = 1 - bubble.life;
    const poke = pokeNormal(bubble.popX, bubble.popY);
    const thetaEnd = Math.acos(Math.max(-1, -Math.sqrt(Math.max(0, 1 - poke.z * poke.z))));
    return {
      theta: thetaEnd * t * t,
      alpha: 1,
      gone: t >= 1,
    };
  }

  /** 屏幕上的这一点落在已经裂开的球冠里。 */
  private onOpenedCap(nx: number, ny: number, bubble: Bubble, theta: number): boolean {
    const r2 = nx * nx + ny * ny;
    if (r2 >= 1 || theta <= 0) {
      return false;
    }
    const poke = pokeNormal(bubble.popX, bubble.popY);
    const dot = nx * poke.x + ny * poke.y + Math.sqrt(1 - r2) * poke.z;
    return dot > Math.cos(theta);
  }

  private unit(n: number): number {
    const x = Math.sin(n) * 43758.5453;
    return x - Math.floor(x);
  }

  private clipRemaining(
    ctx: CanvasRenderingContext2D,
    bubble: Bubble,
    radius: number,
    theta: number,
  ): void {
    if (theta <= 0.02) {
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, radius, 0, Math.PI * 2);
      ctx.clip();
      return;
    }
    const poke = pokeNormal(bubble.popX, bubble.popY);
    const [e1, e2] = pokeBasis(poke);
    const steps = 72;
    const rim: SpherePoint[] = [];
    for (let i = 0; i < steps; i++) {
      rim.push(capPoint(poke, e1, e2, theta, (i / steps) * Math.PI * 2));
    }
    const hidden = (point: SpherePoint) => point.z < -0.015;
    const allVisible = rim.every(point => !hidden(point));
    if (allVisible) {
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, radius, 0, Math.PI * 2);
      ctx.moveTo(bubble.x + rim[0].x * radius, bubble.y + rim[0].y * radius);
      for (let i = 1; i < rim.length; i++) {
        ctx.lineTo(bubble.x + rim[i].x * radius, bubble.y + rim[i].y * radius);
      }
      ctx.closePath();
      ctx.clip('evenodd');
      return;
    }
    if (rim.every(hidden)) {
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y, radius, 0, Math.PI * 2);
      ctx.clip();
      return;
    }
    let start = 0;
    for (let i = 0; i < steps; i++) {
      const prev = rim[(i - 1 + steps) % steps];
      if (hidden(prev) && !hidden(rim[i])) {
        start = i;
        break;
      }
    }
    const chain: SpherePoint[] = [];
    for (let k = 0; k < steps; k++) {
      const point = rim[(start + k) % steps];
      if (hidden(point)) {
        break;
      }
      chain.push(point);
    }
    const first = chain[0];
    const last = chain[chain.length - 1];
    const from = wrapAngle(Math.atan2(last.y, last.x));
    const to = wrapAngle(Math.atan2(first.y, first.x));
    const cosT = Math.cos(theta);
    const remains = (angle: number) => Math.cos(angle) * poke.x + Math.sin(angle) * poke.y <= cosT;
    const dir = remains(from + 0.12) ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(bubble.x + first.x * radius, bubble.y + first.y * radius);
    for (const point of chain) {
      ctx.lineTo(bubble.x + point.x * radius, bubble.y + point.y * radius);
    }
    let angle = from;
    for (let n = 0; n < steps + 2; n++) {
      angle = wrapAngle(angle + dir * (Math.PI * 2 / steps));
      ctx.lineTo(bubble.x + Math.cos(angle) * radius, bubble.y + Math.sin(angle) * radius);
      const left = dir > 0 ? wrapAngle(to - angle) : wrapAngle(angle - to);
      if (left < Math.PI * 2 / steps) {
        break;
      }
    }
    ctx.closePath();
    ctx.clip();
  }

  private syncPopCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);
    if (this.popCanvas.width !== width || this.popCanvas.height !== height) {
      this.popCanvas.width = width;
      this.popCanvas.height = height;
      this.popCanvas.style.width = `${window.innerWidth}px`;
      this.popCanvas.style.height = `${window.innerHeight}px`;
    }
  }

  /**
   * 液滴长在球冠上。最密的一排贴着球冠边缘，方向是球面张角变大的方向。
   */
  private drawRuptures(): void {
    this.syncPopCanvas();
    const ctx = this.popCtx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.lineCap = 'round';
    for (const bubble of this.bubbles) {
      if (!bubble.popping) {
        continue;
      }
      const pose = this.popPose(bubble);
      if (pose.theta < 0.04 || pose.alpha <= 0) {
        continue;
      }
      const radius = this.radiusOf(bubble);
      const poke = pokeNormal(bubble.popX, bubble.popY);
      const [e1, e2] = pokeBasis(poke);
      const count = Math.round(Math.min(1400, 420 + bubble.r * 9));
      for (let i = 0; i < count; i++) {
        const phi = this.unit(i * 2.17 + bubble.phase) * Math.PI * 2;
        const along = Math.pow(this.unit(i * 5.91 + bubble.phase * 3), 0.32);
        const vary = this.unit(i * 8.13 + 2.2);
        const ang = Math.max(0.03, along) * pose.theta;
        const here = capPoint(poke, e1, e2, ang, phi);
        if (here.z < 0) {
          continue;
        }
        const before = capPoint(poke, e1, e2, Math.max(0, ang - 0.08), phi);
        let dx = here.x - before.x;
        let dy = here.y - before.y;
        const span = Math.hypot(dx, dy) || 1;
        dx /= span;
        dy /= span;
        let x = bubble.x + here.x * radius;
        let y = bubble.y + here.y * radius;
        if (along > 0.9) {
          const extra = ((along - 0.9) / 0.1) * radius * 0.16 * vary;
          x += dx * extra;
          y += dy * extra;
        }
        const atFront = along > 0.62;
        const len = atFront ? 2 + vary * 7 : 1.5 + vary * 3;
        const alpha = pose.alpha * (atFront ? 0.72 + vary * 0.28 : 0.34 + along * 0.3);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * len, y + dy * len);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = atFront ? 0.7 + vary * 0.55 : 0.45;
        ctx.stroke();
      }
    }
  }

  private syncBadge(): void {
    if (this.popped <= 0) {
      this.badge.hidden = true;
      return;
    }
    this.badge.hidden = false;
    this.badge.textContent = `捏破 ${this.popped}`;
  }

  private easeOut(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  dispose(): void {
    this.running = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.bubbles = [];
    super.dispose();
  }
}

onActivate((context) => {
  const wrap = context.add(new BubbleWrap());

  renderTips({
    title: '泡泡',
    description: wrap.refracts
      ? '大小不一的肥皂泡慢慢上浮。薄膜中间几乎看穿，彩虹和弯折都在边缘。上面的泡会把下面再折一点。按住划过会捏破。'
      : '大小不一的肥皂泡慢慢上浮。叠在一起时，上面的会把下面的膜再折一点。按住划过会捏破，并响一声。',
    operations: [
      { key: '按住拖动', description: '捏破碰到的泡泡' },
      { key: 'R', description: '换一批泡泡' },
    ],
  });

});
