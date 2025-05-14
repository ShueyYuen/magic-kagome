import { IDisposable } from "./disposable";

export interface CanvasManagerOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  alpha?: boolean;
  antialias?: boolean;
  styles?: Partial<CSSStyleDeclaration>;
  autoResize?: boolean;
}

export type CanvasContextType = '2d' | 'webgl' | 'webgl2' | 'bitmaprenderer';

export class CanvasManager implements IDisposable {
  private canvas: HTMLCanvasElement;
  private resizeObserver: ResizeObserver | null = null;
  private contexts: Map<string, RenderingContext> = new Map();
  private parentElement: HTMLElement | null = null;
  private pixelRatio: number;
  private animationFrameId: number | null = null;
  private eventHandlers: Map<string, EventListener[]> = new Map();

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  get displayWidth(): number {
    return Math.floor(this.canvas.clientWidth);
  }

  get displayHeight(): number {
    return Math.floor(this.canvas.clientHeight);
  }

  constructor(private options: CanvasManagerOptions = {}) {
    this.canvas = document.createElement('canvas');

    this.pixelRatio = options.pixelRatio || window.devicePixelRatio || 1;

    // 设置初始尺寸
    const width = options.width!;
    const height = options.height!;
    Number.isInteger(width) && Number.isInteger(height) && this.setSize(width, height);

    // 应用样式
    if (options.styles) {
      this.setStyle(options.styles);
    } else {
      // 默认样式，使canvas填满父容器
      this.setStyle({
        display: 'block',
        width: '100%',
        height: '100%'
      });
    }

    // 自动调整大小
    if (options.autoResize !== false) {
      this.enableAutoResize();
    }
  }

  mount(parent: HTMLElement): void {
    this.parentElement = parent;
    parent.appendChild(this.canvas);
    if (this.options.autoResize) {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      this.setSize(width, height);
      this.enableAutoResize();
    }
  }

  /**
   * 获取渲染上下文
   */
  getContext(contextId: "2d", options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
  getContext(contextId: "bitmaprenderer", options?: ImageBitmapRenderingContextSettings): ImageBitmapRenderingContext | null;
  getContext(contextId: "webgl", options?: WebGLContextAttributes): WebGLRenderingContext | null;
  getContext(contextId: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
  getContext<T extends RenderingContext>(contextId: CanvasContextType, options?: any): T | null {
    if (this.contexts.has(contextId)) {
      return this.contexts.get(contextId) as T;
    }

    const ctx = this.canvas.getContext(contextId, {
      alpha: true,
      antialias: true,
      ...options
    });

    if (ctx) {
      this.contexts.set(contextId, ctx as RenderingContext);
      return ctx as T;
    }

    return null;
  }

  /**
   * 设置画布尺寸，考虑设备像素比
   */
  setSize(width: number, height: number, updateStyle: boolean = false): void {
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);

    if (updateStyle) {
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }

    // 如果是2d上下文，调整比例
    const ctx2d = this.contexts.get('2d') as CanvasRenderingContext2D | undefined;
    if (ctx2d) {
      ctx2d.scale(this.pixelRatio, this.pixelRatio);
    }
  }

  /**
   * 设置设备像素比
   */
  setPixelRatio(ratio: number): void {
    if (this.pixelRatio !== ratio) {
      this.pixelRatio = ratio;
      this.setSize(this.displayWidth, this.displayHeight);
    }
  }

  /**
   * 启用自动调整大小
   */
  enableAutoResize(): void {
    if (!this.parentElement) return;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      this.setSize(width, height);
    });

    this.resizeObserver.observe(this.parentElement);
  }

  /**
   * 自定义调整大小处理
   */
  linkSize(element: Element, onResize: (this: CanvasManager, entry: ResizeObserverEntry, canvas: HTMLCanvasElement) => void): void {
    this.clearResize();
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      onResize.call(this, entry, this.canvas);
    });

    this.resizeObserver.observe(element);
  }

  private _linkSizeToWindow = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.setSize(width, height);
  };
  /**
   * 保持画布大小与窗口一致
   */
  linkSizeToWindow(): void {
    this.clearResize();
    window.addEventListener('resize', this._linkSizeToWindow);
    this._linkSizeToWindow(); // 立即调用一次以设置初始大小
  }

  private clearResize() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this._linkSizeToWindow);
  }

  /**
   * 设置样式
   */
  setStyle(styles: Partial<CSSStyleDeclaration>): void {
    Object.entries(styles).forEach(([key, value]) => {
      if (value !== undefined) {
        (this.canvas.style as any)[key] = value;
      }
    });
  }

  /**
   * 清除画布
   */
  clear(color?: string): void {
    const ctx2d = this.getContext('2d');
    if (ctx2d) {
      if (color) {
        ctx2d.fillStyle = color;
        ctx2d.fillRect(0, 0, this.displayWidth, this.displayHeight);
      } else {
        ctx2d.clearRect(0, 0, this.displayWidth, this.displayHeight);
      }
    }

    // WebGL清除
    const ctxWebGL = this.contexts.get('webgl') as WebGLRenderingContext | undefined;
    if (ctxWebGL) {
      ctxWebGL.clear(ctxWebGL.COLOR_BUFFER_BIT | ctxWebGL.DEPTH_BUFFER_BIT);
    }
  }

  /**
   * 启动渲染循环
   */
  startRenderLoop(callback: (time: number) => void): void {
    if (this.animationFrameId !== null) {
      this.stopRenderLoop();
    }
    const animate = (time: number) => {
      callback(time);
      this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * 停止渲染循环
   */
  stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * 添加事件监听器
   */
  addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (ev: HTMLElementEventMap[K]) => any
  ): void {
    if (!this.eventHandlers.has(type as string)) {
      this.eventHandlers.set(type as string, []);
    }

    const handlers = this.eventHandlers.get(type as string)!;
    handlers.push(listener as EventListener);
    this.canvas.addEventListener(type, listener as EventListener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (ev: HTMLElementEventMap[K]) => any
  ): void {
    const handlers = this.eventHandlers.get(type as string);
    if (handlers) {
      const index = handlers.indexOf(listener as EventListener);
      if (index !== -1) {
        handlers.splice(index, 1);
        this.canvas.removeEventListener(type, listener as EventListener);
      }
    }
  }

  /**
   * 将画布内容导出为数据URL
   */
  toDataURL(type?: string, quality?: any): string {
    return this.canvas.toDataURL(type, quality);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    // 停止渲染循环
    this.stopRenderLoop();

    // 移除所有事件监听器
    this.eventHandlers.forEach((handlers, type) => {
      handlers.forEach(handler => {
        this.canvas.removeEventListener(type, handler);
      });
    });
    this.eventHandlers.clear();

    // 断开ResizeObserver
    this.clearResize();

    // 清除上下文引用
    this.contexts.clear();

    // 移除画布
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.remove();
    }

    // 清除引用
    this.parentElement = null;
  }
}