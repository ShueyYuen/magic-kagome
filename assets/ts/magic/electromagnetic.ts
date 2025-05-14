import { Disposable } from "./utils/disposable";
import { DomListener, requestPlainPage } from "./utils/dom";
import { renderTips } from "./utils/tips-render";

interface Ball {
  x: number;           // 当前X位置
  y: number;           // 当前Y位置
  originX: number;     // 原始X位置
  originY: number;     // 原始Y位置
  radius: number;      // 小球半径
  color: string;       // 小球颜色
  vx: number;          // X方向速度
  vy: number;          // Y方向速度
}

class ElectromagneticField extends Disposable {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private balls: Ball[] = [];
  private mouseX: number = 0;
  private mouseY: number = 0;
  private mouseRadius: number = 150;       // 鼠标影响半径
  private repulsionStrength: number = 10;  // 斥力强度
  private returnSpeed: number = 0.05;      // 回归速度
  private friction: number = 0.95;         // 摩擦系数
  private animationId: number | null = null;
  private columns: number = 20;            // 列数
  private rows: number = 15;               // 行数
  private isActive: boolean = false;

  constructor() {
    super();
    // 创建canvas元素
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;

    // 设置canvas样式
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.zIndex = '-1';
    this.canvas.style.pointerEvents = 'none';

    // 添加到DOM
    document.body.appendChild(this.canvas);

    // 初始化
    this.resize();
    this.initBalls();
    this.bindEvents();
    this.draw();
  }

  private resize(): void {
    // 设置canvas尺寸为窗口大小
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    // 如果小球已经初始化，重新计算位置
    if (this.balls.length > 0) {
      this.initBalls();
    }
    this.draw();
  }

  private initBalls(): void {
    this.balls = [];

    // 计算间距
    const spacingX = this.canvas.width / (this.columns + 1);
    const spacingY = this.canvas.height / (this.rows + 1);

    // 创建网格排列的小球
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.columns; col++) {
        const x = spacingX * (col + 1);
        const y = spacingY * (row + 1);
        const radius = 5;
        const color = `hsl(${Math.random() * 360}, 70%, 60%)`;

        this.balls.push({
          x,
          y,
          originX: x,
          originY: y,
          radius,
          color,
          vx: 0,
          vy: 0
        });
      }
    }
  }

  private bindEvents(): void {
    // 监听鼠标移动
    this._register(new DomListener(window, 'mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;

      // 如果动画未启动，则启动
      if (!this.isActive) {
        this.isActive = true;
        this.animate();
      }
    }));

    // 监听窗口大小变化
    this._register(new DomListener(window, 'resize', () => {
      this.resize();
    }));

    // 监听鼠标离开页面
    this._register(new DomListener(window, 'mouseleave', () => {
      this.mouseX = -1000;
      this.mouseY = -1000;
    }));
  }

  private update(): void {
    for (const ball of this.balls) {
      // 计算小球与鼠标的距离
      const dx = this.mouseX - ball.x;
      const dy = this.mouseY - ball.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // 如果在影响范围内，施加斥力
      if (distance < this.mouseRadius) {
        // 斥力与距离成反比
        const force = (this.mouseRadius - distance) / this.mouseRadius;
        const angle = Math.atan2(dy, dx);

        // 添加斥力产生的速度变化
        ball.vx -= Math.cos(angle) * force * this.repulsionStrength;
        ball.vy -= Math.sin(angle) * force * this.repulsionStrength;
      }

      // 添加回归力，拉回原始位置
      ball.vx += (ball.originX - ball.x) * this.returnSpeed;
      ball.vy += (ball.originY - ball.y) * this.returnSpeed;

      // 应用摩擦力
      ball.vx *= this.friction;
      ball.vy *= this.friction;

      // 更新位置
      ball.x += ball.vx;
      ball.y += ball.vy;
    }

    // 检查是否所有球都几乎回到了原位
    let allSettled = true;
    for (const ball of this.balls) {
      const dx = ball.x - ball.originX;
      const dy = ball.y - ball.originY;
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || speed > 0.1) {
        allSettled = false;
        break;
      }
    }

    // 如果所有球都回到了原位，停止动画
    if (allSettled) {
      this.isActive = false;
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }
  }

  private draw(): void {
    // 清除画布
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 绘制所有小球
    for (const ball of this.balls) {
      this.ctx.beginPath();
      this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = ball.color;
      this.ctx.fill();
      this.ctx.closePath();
    }
  }

  private animate(): void {
    this.update();
    this.draw();

    // 请求下一帧动画
    if (this.isActive) {
      this.animationId = requestAnimationFrame(() => this.animate());
    }
  }

  dispose(): void {
    super.dispose();
    this.canvas.remove();
    this.canvas = null!;
    this.balls.length = 0;
    this.isActive = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}

onActivate((context) => {
  context.add(requestPlainPage());
  context.add(new ElectromagneticField());

  renderTips({
    title: '电磁场',
    description: '鼠标悬停在小球上，电磁场会将小球吸引到鼠标位置，释放鼠标后小球会回到原位。',
  });
});
