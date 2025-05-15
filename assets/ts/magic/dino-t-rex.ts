/**
 * T-Rex Runner 小恐龙游戏
 * 基于Chrome浏览器断网时的游戏
 */

import { Alignment, DrawRect, SpiritAnimationFrameDrawer, SpiritManager, SpiritOptions } from "./utils/spirit-manager";
import { ElementAnimator } from "./utils/animation";
import { Disposable } from "./utils/disposable";
import { CanvasManager } from "./utils/canvas";
import { DomListener } from "./utils/dom";
import { renderTips } from "./utils/tips-render";

const SPIRIT = 'data:image/png;base64,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';

enum GameState {
  READY,
  RUNNING,
  GAME_OVER,
}

class DinoGame extends Disposable {
  private canvas: CanvasManager;
  private ctx: CanvasRenderingContext2D;
  private width: number = 600;
  private height: number = 170;

  private dino: Dino;
  private ground: Ground;
  private obstacles: Obstacle[] = [];
  private clouds: Cloud[] = [];

  private speed: number = 6;
  private score: number = 0;
  private animationId: number | null = null;
  private lastObstacleTime: number = 0;
  private lastCloudTime: number = 0;

  private preluder: number = 50;
  private state: GameState = GameState.READY;
  private get isGameOver() {
    return this.state === GameState.GAME_OVER;
  }
  private get isReady() {
    return this.state === GameState.READY;
  }

  private _highScore: number = -1;
  private get highScore() {
    if (this._highScore === -1) {
      this._highScore = parseInt(localStorage.getItem('dinoHighScore') || '0');
    }
    return this._highScore;
  }
  private set highScore(value: number) {
    this._highScore = value;
    localStorage.setItem('dinoHighScore', value.toString());
  }

  static {
    // 预加载精灵
    const spiritManager = SpiritManager.getInstance();
    spiritManager.registerSheet({
      id: 'dino-game',
      src: SPIRIT,
      spirits: [
        {
          id: 'game-over',
          x: 954,
          y: 28,
          width: 380,
          height: 22,
        },
        {
          id: 'replay',
          x: 2,
          y: 2,
          width: 72,
          height: 64,
        },
        {
          id: 'text',
          x: 954,
          y: 2,
          width: 20,
          height: 24,
          frameCount: 12,
        },
      ]
    });
  }

  constructor(private spiritManager: SpiritManager) {
    super();
    this.canvas = this._register(new CanvasManager({
      height: this.height,
      styles: {
        position: 'relative',
        mixBlendMode: 'multiply',
      }
    }));
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;

    this.dino = new Dino(this.spiritManager, this.ctx, this.height);
    this.ground = new Ground(this.spiritManager, this.ctx, this.height);

    this.setupEventListeners();
  }

  public mount(container: HTMLElement): void {
    this.canvas.mount(container);
    this.canvas.linkSize(container, (entry) => {
      const { width } = entry.contentRect;
      this.width = width;
      this.canvas.setSize(width, this.height, true);
      this.render();
    });
  }

  private start(): void {
    this.state = GameState.RUNNING;
    this.score = 0;
    this.speed = 6;
    this.obstacles = [];
    this.clouds = [];
    this.dino.reset();
    this.gameLoop();
  }

  private gameLoop(): void {
    this.update();
    this.render();

    if (!this.isGameOver) {
      this.animationId = requestAnimationFrame(() => this.gameLoop());
    }
  }

  private update(): void {
    this.preluder += this.speed;
    const now = Date.now();

    // 更新地面
    this.ground.update(this.speed);

    // 更新恐龙
    this.dino.update();

    // 生成障碍物
    if (now - this.lastObstacleTime > (Math.random() * 1000 + 800)) {
      this.obstacles.push(new Obstacle(this.spiritManager, this.ctx, this.width, this.height));
      this.lastObstacleTime = now;
    }

    // 更新障碍物
    const dinoHitbox = this.dino.getHitbox();
    this.obstacles.forEach((obstacle, index) => {
      obstacle.update(this.speed);

      const obstacleHitbox = obstacle.getHitbox();
      if (!obstacle.passed) {
        // 检测碰撞
        if (DrawRect.isOverlap(dinoHitbox, obstacleHitbox)) {
          this.endGame();
        }

        // 增加分数
        if (obstacle.x + obstacleHitbox.width < this.dino.x) {
          obstacle.passed = true;
          this.score++;

          // 每100分增加速度
          if (this.score % 20 === 0) {
            this.speed += 0.5;
          }
        }
      }

      // 移除超出画面的障碍物
      if (obstacle.x < -100) {
        this.obstacles.splice(index, 1);
      }
    });

    // 生成云
    if (now - this.lastCloudTime > (Math.random() * 3000 + 2000)) {
      this.clouds.push(new Cloud(this.spiritManager, this.ctx, this.width));
      this.lastCloudTime = now;
    }

    // 更新云
    this.clouds.forEach((cloud, index) => {
      cloud.update(this.speed * 0.5);

      // 移除超出画面的云
      if (cloud.x < -cloud.width) {
        this.clouds.splice(index, 1);
      }
    });
  }

  private render(): void {
    // 清空画布
    this.ctx.clearRect(0, 0, this.width, this.height);

    // 绘制云
    this.clouds.forEach(cloud => cloud.draw());

    // 绘制地面
    this.ground.draw();

    // 绘制障碍物
    this.obstacles.forEach(obstacle => obstacle.draw());

    // 绘制恐龙
    this.dino.draw();

    if (this.preluder < this.width) {
      this.ctx.clearRect(this.preluder, 0, this.width, this.height)
    }

    // 绘制分数
    this.drawScore();

    // 游戏结束显示
    if (this.isGameOver) {
      this.drawGameOver();
    }
  }

  private endGame(): void {
    this.state = GameState.GAME_OVER;
    this.dino.die();
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('dinoHighScore', this.highScore.toString());
    }
  }

  private drawScore(): void {
    const options = { scale: 0.5 };
    this.score.toString().padStart(5, '0').split('').forEach((char, index) =>
      this.spiritManager.drawSpiritFrame(this.ctx, 'text', this.width - 50 + index * 10, 5, parseInt(char), options));

    this.spiritManager.drawSpiritFrame(this.ctx, 'text', this.width - 150, 5, 10, options);
    this.spiritManager.drawSpiritFrame(this.ctx, 'text', this.width - 140, 5, 11, options);
    this.highScore.toString().padStart(5, '0').split('').forEach((char, index) =>
      this.spiritManager.drawSpiritFrame(this.ctx, 'text', this.width - 120 + index * 10, 5, parseInt(char), options));
  }

  private drawGameOver(): void {
    const center = this.width / 2;
    const hit = this.spiritManager.drawSpirit(this.ctx, 'replay', center, this.height / 2 + 5, { scale: 0.5, alignment: Alignment.CENTER })!;
    this.spiritManager.drawSpirit(this.ctx, 'game-over', center, hit.y - 10, { scale: 0.5, alignment: Alignment.BOTTOM_CENTER });
  }

  private setupEventListeners(): void {
    let jumping = false;
    this._register(new DomListener(document, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (this.isReady) {
          this.start();
        }
        this.dino.jump();
        jumping = !this.isGameOver;
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.dino.duck(true);
      }
    }));

    this._register(new DomListener(document, 'keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (this.isGameOver && !jumping) {
          this.start();
        }
        jumping = false;
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.dino.duck(false);
      }
    }));

    this._register(
      new DomListener(
        this.canvas.element,
        'click',
        (e: MouseEvent) => this.isGameOver && this.start()
      )
    );
  }
}

const EDGE_SIZE = 4;
class Dino {
  public x: number = 24;
  public y: number = 0;
  private running = false;
  private dead = false;
  private groundY: number = 0;
  private jumping: boolean = false;
  private ducking: boolean = false;
  private jumpVelocity: number = 0;
  private gravity: number = 0.6;
  private frame: number = 0;
  private frameCount: number = 0;

  static {
    // 预加载精灵
    const spiritManager = SpiritManager.getInstance();
    spiritManager.registerSheet({
      id: 'dino-t-rex',
      src: SPIRIT,
      spirits: [
        {
          id: 'dino-run',
          x: 1514,
          y: 2,
          width: 88,
          height: 94,
          frameCount: 2,
        },
        {
          id: 'dino-jump',
          x: 1336,
          y: 2,
          width: 90,
          height: 94,
        },
        {
          id: 'dino-duck',
          x: 1862,
          y: 38,
          width: 118,
          height: 58,
          frameCount: 2,
        },
        {
          id: 'dino-ready',
          x: 74,
          y: 2,
          width: 92,
          height: 96,
        },
        {
          id: 'dino-dead',
          x: 1690,
          y: 2,
          width: 88,
          height: 94,
        }
      ]
    });
  }

  constructor(private spiritManager: SpiritManager, private ctx: CanvasRenderingContext2D, height: number) {
    this.groundY = height - 20; // 恐龙在地面上的Y坐标
    this.y = this.groundY;
  }

  public update(): void {
    if (this.x < 60) {
      this.x += 0.5;
    }
    if (this.jumping) {
      this.y += this.jumpVelocity;
      this.jumpVelocity += this.gravity;

      if (this.y >= this.groundY) {
        this.y = this.groundY;
        this.jumping = false;
        this.jumpVelocity = 0;
      }
    }
    // 动画帧
    if (++this.frameCount > 5) {
      this.frameCount = 0;
      this.frame = (this.frame + 1) % 2; // 两帧交替
    }
  }

  private _hitbox: DrawRect | null = null;
  public draw(): void {
    const options: SpiritOptions = {
      scale: 0.5,
      alignment: Alignment.BOTTOM_CENTER
    }
    if (this.dead) {
      this.spiritManager.drawSpirit(this.ctx, 'dino-dead', this.x, this.y, options);
      return;
    }
    if (!this.running) {
      this.spiritManager.drawSpirit(this.ctx, 'dino-ready', this.x, this.y, options);
      return;
    }
    // 在这里我们用文本代替图像
    if (this.ducking) {
      // 蹲下的恐龙
      this._hitbox = this.spiritManager.drawSpiritFrame(this.ctx, 'dino-duck', this.x, this.y, this.frame, options);
    } else if (!this.jumping) {
      this._hitbox = this.spiritManager.drawSpiritFrame(this.ctx, 'dino-run', this.x, this.y, this.frame, options);
    } else {
      // 跳跃的恐龙
      this._hitbox = this.spiritManager.drawSpirit(this.ctx, 'dino-jump', this.x, this.y, options);
    }
  }

  public jump(): void {
    if (!this.jumping && !this.ducking) {
      this.jumping = true;
      this.jumpVelocity = -10;
    }
  }

  public duck(isDucking: boolean): void {
    if (!this.jumping) {
      this.ducking = isDucking;
    }
  }

  public die(): void {
    this.dead = true;
  }

  public getHitbox(): { x: number; y: number; width: number; height: number } {
    if (!this._hitbox) {
      return DrawRect.EMPTY;
    }
    return {
      x: this._hitbox.x + EDGE_SIZE,
      y: this._hitbox.y + EDGE_SIZE,
      width: this._hitbox.width - (EDGE_SIZE << 1),
      height: this._hitbox.height - (EDGE_SIZE << 1),
    }
  }

  public reset(): void {
    this.y = this.groundY;
    this.running = true;
    this.dead = false;
    this.jumping = false;
    this.ducking = false;
    this.jumpVelocity = 0;
  }
}

class Obstacle {
  public x: number;
  public y: number;
  public passed: boolean = false;
  private type: string;
  private size: number = 0;

  static {
    const spiritManager = SpiritManager.getInstance();
    spiritManager.registerSheet({
      id: 'dino-obstacle',
      src: SPIRIT,
      spirits: [
        {
          id: 'pterodactyl',
          x: 258,
          y: 2,
          width: 94,
          height: 80,
          frameCount: 2,
        },
        {
          id: 'small-cactus-1',
          x: 446,
          y: 2,
          width: 34,
          height: 70,
        },
        {
          id: 'small-cactus-2',
          x: 480,
          y: 2,
          width: 68,
          height: 70,
        },
        {
          id: 'small-cactus-3',
          x: 548,
          y: 2,
          width: 102,
          height: 70,
        },
        {
          id: 'large-cactus-1',
          x: 650,
          y: 2,
          width: 52,
          height: 100,
        },
        {
          id: 'large-cactus-2',
          x: 702,
          y: 2,
          width: 100,
          height: 100,
        },
        {
          id: 'large-cactus-3',
          x: 802,
          y: 2,
          width: 152,
          height: 100,
        },
      ]
    });
  }

  static readonly TYPES = [
    'small-cactus',
    'large-cactus',
    'pterodactyl'
  ];

  private drawer: SpiritAnimationFrameDrawer;

  constructor(spiritManager: SpiritManager, private ctx: CanvasRenderingContext2D, width: number, height: number) {
    this.x = width;

    // 随机选择障碍物类型：仙人掌(小、大)或翼龙
    this.type = Obstacle.TYPES[Math.floor(Math.random() * Obstacle.TYPES.length)];
    this.size = Math.floor(Math.random() * 3) + 1;

    if (this.type === 'pterodactyl') {
      // 翼龙的高度在三个不同的位置之一
      const heights = [height - 80, height - 50, height - 20];
      this.y = heights[Math.floor(Math.random() * heights.length)];
      this.drawer = spiritManager.createAnimationFrames('pterodactyl', {
        scale: 0.5,
        alignment: Alignment.BOTTOM_CENTER,
        fps: 6,
      })!;
    } else {
      // 仙人掌总是在地面上
      this.y = height - 22;
      this.drawer = spiritManager.createAnimationFrames(`${this.type}-${this.size}`, {
        scale: 0.5,
        alignment: Alignment.BOTTOM_CENTER,
      })!;
    }
  }

  public update(speed: number): void {
    this.x -= speed;
  }

  private _hitbox: DrawRect | null = null;
  public draw(): void {
    this._hitbox = this.drawer.draw(this.ctx, this.x, this.y);
  }

  public getHitbox(): { x: number; y: number; width: number; height: number } {
    if (!this._hitbox) {
      return DrawRect.EMPTY;
    }
    return {
      x: this._hitbox.x + EDGE_SIZE,
      y: this._hitbox.y + EDGE_SIZE,
      width: this._hitbox.width - (EDGE_SIZE << 1),
      height: this._hitbox.height - (EDGE_SIZE << 1),
    }
  }
}

class Ground {
  private x: number = 0;
  private groundY: number;

  static {
    // 预加载精灵
    const spiritManager = SpiritManager.getInstance();
    spiritManager.registerSpirit({
      id: 'ground',
      src: SPIRIT,
      x: 2,
      y: 102,
      width: 2400,
      height: 40,
    });
  }

  constructor(private spiritManager: SpiritManager, private ctx: CanvasRenderingContext2D, height: number) {
    this.groundY = height - 14;
  }

  public update(speed: number): void {
    // 地面滚动
    this.x = (this.x - speed) % 1200;
  }

  public draw(): void {
    const options: SpiritOptions = {
      scale: 0.5,
      alignment: Alignment.BOTTOM_LEFT,
    }
    // 绘制地面
    this.spiritManager.drawSpirit(this.ctx, 'ground', this.x, this.groundY, options);
    this.spiritManager.drawSpirit(this.ctx, 'ground', this.x + 1200, this.groundY, options);
  }
}

class Cloud {
  public x: number;
  public y: number;
  public width: number = 70;
  public height: number = 30;

  static {
    // 预加载精灵
    const spiritManager = SpiritManager.getInstance();
    spiritManager.registerSpirit({
      id: 'cloud',
      src: SPIRIT,
      x: 166,
      y: 2,
      width: 92,
      height: 28,
    });
  }

  constructor(private spiritManager: SpiritManager, private ctx: CanvasRenderingContext2D, canvasWidth: number) {
    this.x = canvasWidth;
    this.y = Math.random() * 60 + 10; // 云的高度在10-70之间随机
  }

  public update(speed: number): void {
    this.x -= speed;
  }

  public draw(): void {
    // 在这里用文字代替图像
    this.spiritManager.drawSpirit(this.ctx, 'cloud', this.x, this.y, {
      scale: 0.5,
      alpha: 0.8
    });
  }
}

onActivate((context) => {
  const container = document.querySelector<HTMLDivElement>('#top .header-inner')!;
  const wrapper = document.createElement('div');
  wrapper.style.width = '100%';
  wrapper.style.marginBottom = '-16px';
  wrapper.style.textAlign = 'center';
  container.append(wrapper);
  ElementAnimator.show(wrapper, [
    { height: '0', opacity: '0', overflow: 'hidden' },
    { height: '170px', opacity: '1' },
  ]);

  const spiritManager = SpiritManager.getInstance();
  const game = context.add(new DinoGame(spiritManager));
  spiritManager.preloadAll().then(() => game.mount(wrapper));

  renderTips({
    title: '小恐龙游戏',
    description: '按空格键或向上箭头开始游戏，向下箭头蹲下，点击屏幕重新开始',
    operations: [
      { key: '空格键', description: '开始游戏/跳跃' },
      { key: '上箭头', description: '跳跃' },
      { key: '下箭头', description: '蹲下' },
      { key: '点击', description: '重新开始' },
    ]
  });

  onDeactivate(() =>
    ElementAnimator
      .hide(wrapper)
      .then(() => wrapper.remove())
  );
});
