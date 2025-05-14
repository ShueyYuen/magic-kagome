/**
 * Spirit图像资源管理器
 * 用于管理、加载和渲染游戏或网站中的精灵图(sprite)资源
 */

// Spirit接口定义精灵图的基本属性
export interface Spirit {
  id: string;         // 精灵唯一标识符
  src: string;        // 图像资源的路径
  x: number;          // 在精灵图中的X坐标
  y: number;          // 在精灵图中的Y坐标
  width: number;      // 精灵宽度
  height: number;     // 精灵高度
  frameCount?: number; // 动画帧数(可选)
  frameDelay?: number; // 帧间延迟(可选，单位ms)
}

// 精灵图集接口，用于加载整张精灵图
export interface SpiritSheet {
  id: string;         // 图集唯一标识符
  src: string;        // 图集资源的路径
  spirits: Omit<Spirit, 'src'>[];  // 图集中包含的所有精灵
}

// 对齐方式枚举
export enum Alignment {
  TOP_LEFT = 'topLeft',         // 左上角对齐（默认）
  TOP_CENTER = 'topCenter',     // 上边中心对齐
  TOP_RIGHT = 'topRight',       // 右上角对齐
  MIDDLE_LEFT = 'middleLeft',   // 左边中心对齐
  CENTER = 'center',            // 居中对齐
  MIDDLE_RIGHT = 'middleRight', // 右边中心对齐
  BOTTOM_LEFT = 'bottomLeft',   // 左下角对齐
  BOTTOM_CENTER = 'bottomCenter', // 下边中心对齐
  BOTTOM_RIGHT = 'bottomRight'  // 右下角对齐
}

// 精灵配置选项
export interface SpiritOptions {
  alignment?: Alignment;  // 对齐方式，默认为 Alignment.TOP_LEFT
  scale?: number;         // 缩放比例
  rotation?: number;      // 旋转角度(弧度)
  alpha?: number;         // 透明度(0-1)
  flip?: {                // 翻转选项
    horizontal?: boolean; // 水平翻转
    vertical?: boolean;   // 垂直翻转
  };
}

// 绘制区域接口，表示精灵在画布上的实际绘制区域
export interface DrawRect {
  x: number;          // 左上角X坐标
  y: number;          // 左上角Y坐标
  width: number;      // 宽度
  height: number;     // 高度
  rotation?: number;  // 旋转角度(如果有)
}

export namespace DrawRect {
  export const EMPTY: DrawRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
  }

  export function isOverlap(a: DrawRect, b: DrawRect): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }
}

// 加载状态枚举
export enum LoadState {
  IDLE = 'idle',
  LOADING = 'loading',
  LOADED = 'loaded',
  ERROR = 'error'
}

/**
 * Spirit图像资源管理类
 */
export class SpiritManager {
  private spirits: Map<string, Spirit>;                         // 精灵资源映射
  private sheets: Map<string, SpiritSheet>;                     // 精灵图集映射
  private images: Map<string, HTMLImageElement>;                // 已加载的图像资源
  private loadState: Map<string, LoadState>;                    // 资源加载状态
  private loadPromises: Map<string, Promise<HTMLImageElement>>; // 加载Promise对象

  // 单例模式
  private static instance: SpiritManager;

  private constructor() {
    this.spirits = new Map();
    this.sheets = new Map();
    this.images = new Map();
    this.loadState = new Map();
    this.loadPromises = new Map();
  }

  // 获取单例实例
  public static getInstance(): SpiritManager {
    if (!SpiritManager.instance) {
      SpiritManager.instance = new SpiritManager();
    }
    return SpiritManager.instance;
  }

  /**
   * 注册一个精灵资源
   * @param spirit 精灵对象
   */
  public registerSpirit(spirit: Spirit): void {
    this.spirits.set(spirit.id, spirit);
    this.loadState.set(spirit.id, LoadState.IDLE);
  }

  /**
   * 注册一个精灵图集
   * @param sheet 精灵图集对象
   */
  public registerSheet(sheet: SpiritSheet): void {
    this.sheets.set(sheet.id, sheet);
    this.loadState.set(sheet.id, LoadState.IDLE);

    // 注册图集中的所有精灵
    sheet.spirits.forEach(spirit => {
      this.spirits.set(spirit.id, { ...spirit, src: sheet.src });
      this.loadState.set(spirit.id, LoadState.IDLE);
    });
  }

  /**
   * 预加载指定的精灵资源
   * @param spiritId 精灵ID
   * @returns 加载完成的Promise
   */
  public preloadSpirit(spiritId: string): Promise<HTMLImageElement> {
    const spirit = this.spirits.get(spiritId);
    if (!spirit) {
      return Promise.reject(new Error(`Spirit with id ${spiritId} not found`));
    }

    return this.loadImage(spirit.src);
  }

  /**
   * 预加载指定的精灵图集
   * @param sheetId 图集ID
   * @returns 加载完成的Promise
   */
  public preloadSheet(sheetId: string): Promise<HTMLImageElement> {
    const sheet = this.sheets.get(sheetId);
    if (!sheet) {
      return Promise.reject(new Error(`Sheet with id ${sheetId} not found`));
    }

    return this.loadImage(sheet.src);
  }

  /**
   * 预加载所有已注册的资源
   * @returns 所有资源加载完成的Promise
   */
  public preloadAll(): Promise<void> {
    const sources = new Set<string>();

    // 收集所有唯一的图像源
    this.spirits.forEach(spirit => {
      sources.add(spirit.src);
    });

    this.sheets.forEach(sheet => {
      sources.add(sheet.src);
    });

    // 创建加载所有图像的Promise数组
    const promises = Array.from(sources).map(src => this.loadImage(src));

    // 等待所有图像加载完成
    return Promise.all(promises).then(() => {
      console.log('All spirits and sheets preloaded');
    });
  }

  /**
   * 加载图像资源
   * @param src 图像路径
   * @returns 加载完成的Promise
   */
  private loadImage(src: string): Promise<HTMLImageElement> {
    // 如果已经有加载Promise，直接返回
    if (this.loadPromises.has(src)) {
      return this.loadPromises.get(src)!;
    }

    // 如果图像已加载，直接返回已解决的Promise
    if (this.images.has(src) && this.loadState.get(src) === LoadState.LOADED) {
      return Promise.resolve(this.images.get(src)!);
    }

    // 创建新的加载Promise
    const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        this.images.set(src, img);
        this.loadState.set(src, LoadState.LOADED);
        resolve(img);
      };

      img.onerror = () => {
        this.loadState.set(src, LoadState.ERROR);
        reject(new Error(`Failed to load image: ${src}`));
      };

      img.src = src;
      this.loadState.set(src, LoadState.LOADING);
    });

    this.loadPromises.set(src, loadPromise);
    return loadPromise;
  }

  /**
   * 获取精灵的加载状态
   * @param spiritId 精灵ID
   * @returns 加载状态
   */
  public getSpiritLoadState(spiritId: string): LoadState {
    const state = this.loadState.get(spiritId);
    return state || LoadState.IDLE;
  }

  /**
   * 在Canvas上绘制精灵图像
   * @param ctx Canvas渲染上下文
   * @param spiritId 精灵ID
   * @param x 绘制位置X坐标
   * @param y 绘制位置Y坐标
   * @param options 绘制选项
   * @returns 绘制区域信息，若绘制失败则返回null
   */
  public drawSpirit(
    ctx: CanvasRenderingContext2D,
    spiritId: string,
    x: number,
    y: number,
    options: SpiritOptions = {}
  ): DrawRect | null {
    const spirit = this.spirits.get(spiritId);
    if (!spirit) {
      console.error(`Spirit with id ${spiritId} not found`);
      return null;
    }

    const image = this.images.get(spirit.src);
    if (!image || this.loadState.get(spirit.src) !== LoadState.LOADED) {
      // 图像尚未加载完成
      this.preloadSpirit(spiritId).catch(err => console.error(err));
      return null;
    }

    // 保存当前上下文状态
    ctx.save();
    
    // 应用缩放
    const scale = options.scale !== undefined ? options.scale : 1;
    
    // 计算实际尺寸
    const actualWidth = spirit.width * scale;
    const actualHeight = spirit.height * scale;
    
    // 根据对齐方式计算偏移
    const alignment = options.alignment || Alignment.TOP_LEFT;
    const offset = this.calculateAlignmentOffset(actualWidth, actualHeight, alignment);
    
    // 应用变换，考虑对齐偏移
    ctx.translate(x, y);

    // 应用缩放
    ctx.scale(
      scale * (options.flip?.horizontal ? -1 : 1),
      scale * (options.flip?.vertical ? -1 : 1)
    );

    // 应用旋转
    if (options.rotation) {
      ctx.rotate(options.rotation);
    }

    // 应用透明度
    if (options.alpha !== undefined) {
      ctx.globalAlpha = options.alpha;
    }

    // 确定绘制位置和尺寸，考虑对齐偏移
    const dx = (options.flip?.horizontal ? -spirit.width : 0) + (offset.x / scale);
    const dy = (options.flip?.vertical ? -spirit.height : 0) + (offset.y / scale);

    // 绘制精灵图
    ctx.drawImage(
      image,
      spirit.x,
      spirit.y,
      spirit.width,
      spirit.height,
      dx,
      dy,
      spirit.width,
      spirit.height
    );

    // 恢复上下文状态
    ctx.restore();
    
    // 创建绘制区域对象，考虑了对齐偏移
    const drawRect: DrawRect = {
      x: x + offset.x - (options.flip?.horizontal ? actualWidth : 0),
      y: y + offset.y - (options.flip?.vertical ? actualHeight : 0),
      width: actualWidth,
      height: actualHeight
    };
    
    // 如果有旋转，记录旋转角度
    if (options.rotation) {
      drawRect.rotation = options.rotation;
    }
    
    return drawRect;
  }

  /**
   * 在Canvas上绘制精灵动画的当前帧
   * @param ctx Canvas渲染上下文
   * @param spiritId 精灵ID
   * @param x 绘制位置X坐标
   * @param y 绘制位置Y坐标
   * @param frameIndex 要绘制的帧索引
   * @param options 绘制选项
   * @returns 绘制区域信息，若绘制失败则返回null
   */
  public drawSpiritFrame(
    ctx: CanvasRenderingContext2D,
    spiritId: string,
    x: number,
    y: number,
    frameIndex: number,
    options: SpiritOptions = {}
  ): DrawRect | null {
    const spirit = this.spirits.get(spiritId);
    if (!spirit || !spirit.frameCount) {
      // 如果不是动画精灵，则调用普通绘制方法
      return this.drawSpirit(ctx, spiritId, x, y, options);
    }

    const image = this.images.get(spirit.src);
    if (!image || this.loadState.get(spirit.src) !== LoadState.LOADED) {
      // 图像尚未加载完成
      this.preloadSpirit(spiritId).catch(err => console.error(err));
      return null;
    }

    // 确保帧索引在有效范围内
    const validFrameIndex = Math.abs(frameIndex) % spirit.frameCount;

    // 保存当前上下文状态
    ctx.save();
    
    // 应用缩放
    const scale = options.scale !== undefined ? options.scale : 1;
    
    // 计算实际尺寸
    const actualWidth = spirit.width * scale;
    const actualHeight = spirit.height * scale;
    
    // 根据对齐方式计算偏移
    const alignment = options.alignment || Alignment.TOP_LEFT;
    const offset = this.calculateAlignmentOffset(actualWidth, actualHeight, alignment);
    
    // 应用变换，考虑对齐偏移
    ctx.translate(x, y);

    // 应用缩放
    ctx.scale(
      scale * (options.flip?.horizontal ? -1 : 1),
      scale * (options.flip?.vertical ? -1 : 1)
    );

    // 应用旋转
    if (options.rotation) {
      ctx.rotate(options.rotation);
    }

    // 应用透明度
    if (options.alpha !== undefined) {
      ctx.globalAlpha = options.alpha;
    }

    // 确定绘制位置和尺寸，考虑对齐偏移
    const dx = (options.flip?.horizontal ? -spirit.width : 0) + (offset.x / scale);
    const dy = (options.flip?.vertical ? -spirit.height : 0) + (offset.y / scale);

    // 计算当前帧在精灵图上的位置
    const frameX = spirit.x + validFrameIndex * spirit.width;

    // 绘制精灵图的特定帧
    ctx.drawImage(
      image,
      frameX,
      spirit.y,
      spirit.width,
      spirit.height,
      dx,
      dy,
      spirit.width,
      spirit.height
    );

    // 恢复上下文状态
    ctx.restore();

    // 创建绘制区域对象，考虑了对齐偏移
    const drawRect: DrawRect = {
      x: x + offset.x - (options.flip?.horizontal ? actualWidth : 0),
      y: y + offset.y - (options.flip?.vertical ? actualHeight : 0),
      width: actualWidth,
      height: actualHeight
    };
    
    // 如果有旋转，记录旋转角度
    if (options.rotation) {
      drawRect.rotation = options.rotation;
    }
    
    return drawRect;
  }

  public createAnimationFrames(
    spiritId: string,
    options: SpiritOptions & { startFrame?: number, fps?: number } = {}
  ): SpiritAnimationFrameDrawer | null {
    const spirit = this.spirits.get(spiritId);
    if (!spirit) {
      console.error(`Spirit with id ${spiritId} is not an animation`);
      return null;
    }

    return new SpiritAnimationFrameDrawer(this, spiritId, options);
  }

  /**
   * 清除所有资源
   */
  public clearAll(): void {
    this.spirits.clear();
    this.sheets.clear();
    this.images.clear();
    this.loadState.clear();
    this.loadPromises.clear();
  }
  
  /**
   * 计算基于对齐方式的偏移量
   * @param width 精灵宽度
   * @param height 精灵高度
   * @param alignment 对齐方式
   * @returns 偏移量对象 {x, y}
   */
  private calculateAlignmentOffset(
    width: number,
    height: number,
    alignment: Alignment = Alignment.TOP_LEFT
  ): { x: number; y: number } {
    let offsetX = 0;
    let offsetY = 0;

    // 计算X轴偏移
    switch (alignment) {
      case Alignment.TOP_CENTER:
      case Alignment.CENTER:
      case Alignment.BOTTOM_CENTER:
        offsetX = -width / 2; // 水平居中
        break;
      case Alignment.TOP_RIGHT:
      case Alignment.MIDDLE_RIGHT:
      case Alignment.BOTTOM_RIGHT:
        offsetX = -width; // 右对齐
        break;
    }

    // 计算Y轴偏移
    switch (alignment) {
      case Alignment.MIDDLE_LEFT:
      case Alignment.CENTER:
      case Alignment.MIDDLE_RIGHT:
        offsetY = -height / 2; // 垂直居中
        break;
      case Alignment.BOTTOM_LEFT:
      case Alignment.BOTTOM_CENTER:
      case Alignment.BOTTOM_RIGHT:
        offsetY = -height; // 底部对齐
        break;
    }

    return { x: offsetX, y: offsetY };
  }
}

export class SpiritAnimationFrameDrawer {
  private frame: number = 0;
  private readonly frameGap: number = 0;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;

  static FRAMES_PER_SECOND = 60;

  constructor(
    private spiritManager: SpiritManager,
    private spiritId: string,
    private options: SpiritOptions & { startFrame?: number, fps?: number }
  ) {
    this.frame = this.options.startFrame ?? 0;
    this.frameGap = 1000 / (this.options.fps ?? SpiritAnimationFrameDrawer.FRAMES_PER_SECOND);
    this.frameCount = this.spiritManager['spirits'].get(this.spiritId)!.frameCount ?? 1;
  }

  public draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    options: SpiritOptions & { frame?: number } = {}
  ): DrawRect | null {
    const tempOptions = { ...this.options, ...options };
    const currentTime = performance.now();
    if (tempOptions.frame !== undefined) {
      this.frame = tempOptions.frame % this.frameCount;
      this.lastFrameTime = currentTime;
    } else {
      const deltaTime = currentTime - this.lastFrameTime;
      if (deltaTime > this.frameGap) {
        this.frame = (this.frame + 1) % this.frameCount;
        this.lastFrameTime = currentTime - (deltaTime % this.frameGap);
      }
    }
    return this.spiritManager.drawSpiritFrame(ctx, this.spiritId, x, y, this.frame, tempOptions);
  }
}
