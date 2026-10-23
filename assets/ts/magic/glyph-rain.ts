/**
 * 文章字符雨
 * 从当前文章里抽出字形，做成自上而下的雨。鼠标可以拨开一道缝。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, liftWidgetInfo } from './utils/dom';
import { renderTips } from './utils/tips-render';

interface Drop {
  x: number;
  y: number;
  speed: number;
  charIndex: number;
  offset: number;
}

const FONT_SIZE = 18;
const TRAIL = 16;
const FALLBACK = '萤火虫在字里行间停了一下泡泡纸被捏响万花筒转了起来星河滚烫你是人间理想';

function collectGlyphs(): string {
  const chunks: string[] = [];
  const selectors = ['.article-content', '.article-header', 'h1', 'title'];
  document.querySelectorAll(selectors.join(',')).forEach((element) => {
    if (element.closest('.widget-info')) {
      return;
    }
    const text = element.textContent || '';
    if (text.trim()) {
      chunks.push(text);
    }
  });
  const glyphs = chunks.join('').replace(/\s+/g, '').slice(0, 4000);
  return glyphs.length >= 4 ? glyphs : FALLBACK;
}

class GlyphRain extends Disposable {
  private stage: FullscreenStage;
  private glyphs = collectGlyphs();
  private drops: Drop[] = [];
  private mouseX = -9999;
  private mouseY = -9999;
  private color = '#10bb57';
  private fontFamily = 'sans-serif';
  private animationId: number | null = null;
  private lastTime = 0;

  constructor() {
    super();
    this.stage = createFullscreenStage({
      pointerEvents: 'none',
      opacity: '0',
    });
    this._register(this.stage.canvas);
    const style = getComputedStyle(document.documentElement);
    this.color = style.getPropertyValue('--theme-text-focus').trim() || this.color;
    this.fontFamily = getComputedStyle(document.body).fontFamily || this.fontFamily;
    this.layout();
    this.stage.onResize = () => this.layout();

    this._register(new DomListener(window, 'pointermove', (event: PointerEvent) => {
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
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

  private layout(): void {
    const { width, height } = this.stage;
    const gap = FONT_SIZE + 2;
    const columns = Math.max(1, Math.floor(width / gap));
    this.drops = [];
    for (let i = 0; i < columns; i++) {
      this.drops.push({
        x: gap * i + gap / 2,
        y: Math.random() * height,
        speed: 1.3 + Math.random() * 2.4,
        charIndex: Math.floor(Math.random() * this.glyphs.length),
        offset: 0,
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
    const reach = 130;
    for (const drop of this.drops) {
      const previousStep = Math.floor(drop.y / FONT_SIZE);
      drop.y += drop.speed * dt;
      const nextStep = Math.floor(drop.y / FONT_SIZE);
      if (nextStep > previousStep) {
        drop.charIndex = (drop.charIndex + (nextStep - previousStep)) % this.glyphs.length;
      }
      if (drop.y - TRAIL * FONT_SIZE > height) {
        drop.y = -Math.random() * height * 0.35;
        drop.speed = 1.3 + Math.random() * 2.4;
      }

      let target = 0;
      if (this.mouseX >= 0) {
        const dx = drop.x - this.mouseX;
        const distance = Math.abs(dx);
        const headDistance = Math.abs(drop.y - this.mouseY);
        if (distance < reach && headDistance < reach * 2.2) {
          const horizontal = 1 - distance / reach;
          const vertical = 1 - headDistance / (reach * 2.2);
          target = Math.sign(dx || 1) * horizontal * vertical * 72;
        }
      }
      drop.offset += (target - drop.offset) * Math.min(1, 0.14 * dt);
    }
  }

  private draw(): void {
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);
    ctx.font = `600 ${FONT_SIZE}px ${this.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.color;

    const length = this.glyphs.length;
    for (const drop of this.drops) {
      for (let i = 0; i < TRAIL; i++) {
        const y = drop.y - i * FONT_SIZE;
        if (y < -FONT_SIZE || y > height + FONT_SIZE) {
          continue;
        }
        const index = (drop.charIndex - i + length * 8) % length;
        ctx.globalAlpha = (1 - i / TRAIL) * (i === 0 ? 1 : 0.82);
        ctx.fillText(this.glyphs.charAt(index), drop.x + drop.offset, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.drops = [];
    super.dispose();
  }
}

onActivate((context) => {
  context.add(liftWidgetInfo());
  const rain = context.add(new GlyphRain());
  void ElementAnimator.show(rain.element);

  renderTips({
    title: '字符雨',
    description: '雨点是这篇文章里的字。鼠标移过去，会在雨里拨开一道缝。',
    operations: [
      { key: '移动', description: '拨开身边的字符' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(rain.element));
});
