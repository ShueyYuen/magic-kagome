/**
 * 万花筒涂鸦
 * 一笔会按旋转对称复制，奇数瓣再镜像一次。C 清屏，方括号改瓣数。
 */

import { ElementAnimator } from './utils/animation';
import { createFullscreenStage, FullscreenStage } from './utils/canvas';
import { Disposable } from './utils/disposable';
import { DomListener, isTypingTarget, liftWidgetInfo } from './utils/dom';
import { renderTips } from './utils/tips-render';

interface Stroke {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width: number;
}

const MIN_FOLDS = 3;
const MAX_FOLDS = 12;
const MAX_STROKES = 5000;

class Kaleidoscope extends Disposable {
  private stage: FullscreenStage;
  private strokes: Stroke[] = [];
  private folds = 6;
  private hue = Math.random() * 360;
  private drawing = false;
  private lastX = 0;
  private lastY = 0;
  private textColor = '#3e3e5f';
  private pillColor = 'rgba(255, 255, 255, 0.82)';

  constructor() {
    super();
    this.stage = createFullscreenStage({
      pointerEvents: 'auto',
      cursor: 'crosshair',
      touchAction: 'none',
      userSelect: 'none',
      opacity: '0',
    });
    this._register(this.stage.canvas);
    const style = getComputedStyle(document.documentElement);
    this.textColor = style.getPropertyValue('--theme-text-primary').trim() || this.textColor;
    const background = style.getPropertyValue('--theme-bg-high').trim();
    if (background) {
      this.pillColor = background;
    }
    this.stage.onResize = () => this.redraw();

    const canvas = this.stage.canvas.element;
    this._register(new DomListener(canvas, 'pointerdown', this.onPointerDown));
    this._register(new DomListener(canvas, 'pointermove', this.onPointerMove));
    this._register(new DomListener(canvas, 'pointerup', this.onPointerUp));
    this._register(new DomListener(canvas, 'pointercancel', this.onPointerUp));
    this._register(new DomListener(window, 'keydown', this.onKeyDown));
    this.drawBadge();
  }

  get element(): HTMLCanvasElement {
    return this.stage.canvas.element;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.drawing = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.stage.canvas.element.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drawing) {
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    if (dx * dx + dy * dy < 1) {
      return;
    }
    this.hue = (this.hue + 1.4) % 360;
    const stroke: Stroke = {
      x0: this.lastX,
      y0: this.lastY,
      x1: x,
      y1: y,
      color: `hsla(${this.hue}, 78%, 58%, 0.9)`,
      width: 2.4,
    };
    this.strokes.push(stroke);
    if (this.strokes.length > MAX_STROKES) {
      this.strokes.splice(0, this.strokes.length - MAX_STROKES);
      this.redraw();
    } else {
      this.paint(stroke);
      this.drawBadge();
    }
    this.lastX = x;
    this.lastY = y;
  };

  private onPointerUp = (): void => {
    this.drawing = false;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) {
      return;
    }
    if (event.code === 'KeyC' && !event.repeat) {
      this.strokes = [];
      this.redraw();
      return;
    }
    if (event.code === 'BracketLeft' || event.code === 'Minus') {
      this.setFolds(this.folds - 1);
    } else if (event.code === 'BracketRight' || event.code === 'Equal') {
      this.setFolds(this.folds + 1);
    }
  };

  private setFolds(next: number): void {
    const folds = Math.max(MIN_FOLDS, Math.min(MAX_FOLDS, next));
    if (folds === this.folds) {
      return;
    }
    this.folds = folds;
    this.redraw();
  }

  private redraw(): void {
    const { ctx, width, height } = this.stage;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of this.strokes) {
      this.paint(stroke);
    }
    this.drawBadge();
  }

  private paint(stroke: Stroke): void {
    const { ctx, width, height } = this.stage;
    const cx = width / 2;
    const cy = height / 2;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    for (let i = 0; i < this.folds; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((Math.PI * 2 * i) / this.folds);
      this.strokeLocal(stroke, cx, cy);
      ctx.scale(-1, 1);
      this.strokeLocal(stroke, cx, cy);
      ctx.restore();
    }
  }

  private strokeLocal(stroke: Stroke, cx: number, cy: number): void {
    const { ctx } = this.stage;
    ctx.beginPath();
    ctx.moveTo(stroke.x0 - cx, stroke.y0 - cy);
    ctx.lineTo(stroke.x1 - cx, stroke.y1 - cy);
    ctx.stroke();
  }

  private drawBadge(): void {
    const { ctx, width } = this.stage;
    const label = `${this.folds} 瓣`;
    ctx.save();
    ctx.font = '14px "Open Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(label).width;
    const x = width / 2;
    const y = 36;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = this.pillColor;
    this.roundRect(ctx, x - textWidth / 2 - 14, y - 16, textWidth + 28, 32, 12);
    ctx.fill();
    ctx.fillStyle = this.textColor;
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
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
}

onActivate((context) => {
  context.add(liftWidgetInfo());
  const toy = context.add(new Kaleidoscope());
  void ElementAnimator.show(toy.element);

  renderTips({
    title: '万花筒',
    description: '按住鼠标涂鸦，每一笔都会绕着屏幕中心复制成对称的花瓣。',
    operations: [
      { key: '按住拖动', description: '画一笔' },
      { key: '[ ]', description: '减少或增加瓣数' },
      { key: 'C', description: '清屏' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(toy.element));
});
