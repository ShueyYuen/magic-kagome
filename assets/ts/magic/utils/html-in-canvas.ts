/**
 * 把当前页面放进 html-in-canvas，并用 WebGL2 画肥皂泡薄膜。
 *
 * Chrome 155 之前认 `layoutsubtree`，155 之后认 `content="drawable"`。
 * 两边都写上，避免只命中其中一个版本时子节点仍被当成 canvas 后备内容。
 * WebGL 上传按 Chrome 博客的三代签名尝试：texElementSubImage2D，然后 texElementImage2D。
 *
 * @see https://github.com/WICG/html-in-canvas
 * @see https://developer.chrome.com/blog/html-in-canvas-ot-changes
 */

import type { IDisposable } from './disposable';

export type HtmlInCanvasMode = 'none' | 'webgl' | '2d';

export interface LensBubble {
  x: number;
  y: number;
  radius: number;
  phase: number;
  alpha: number;
  /** 戳点在单位球面上的坐标。膜还完整时 cosOpen 大于 1。 */
  pokeX: number;
  pokeY: number;
  pokeZ: number;
  /** 球冠张角的余弦。大于 1 表示还没裂。 */
  cosOpen: number;
}

interface PlacedNode {
  node: HTMLElement;
  parent: Node;
  next: Node | null;
}

interface DrawableCanvas extends HTMLCanvasElement {
  content?: string;
  layoutSubtree?: boolean;
  requestPaint?: () => void;
  onpaint: ((this: HTMLCanvasElement, ev: Event) => void) | null;
  updateElementGeometry?: (element: Element, options?: {
    preserveHitTestOrder?: boolean;
    canvasTransform?: DOMMatrix;
  }) => void;
  getElementImageDefaultSize?: (element: Element) => { width: number; height: number };
  captureElementImage?: (element: Element) => { width?: number; height?: number; close?: () => void };
}

const PAGE_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const PAGE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPage;
uniform float uFull;
uniform vec2 uScroll;
uniform vec2 uPageSize;
uniform vec2 uView;
out vec4 frag;
void main() {
  vec2 uv = vUv;
  if (uFull > 0.5) {
    vec2 css = vec2(vUv.x * uView.x, (1.0 - vUv.y) * uView.y);
    vec2 pageCss = css + uScroll;
    uv = vec2(pageCss.x / uPageSize.x, 1.0 - pageCss.y / uPageSize.y);
  }
  frag = vec4(texture(uPage, uv).rgb, 1.0);
}`;

const LENS_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec2 uView;
out vec2 vN;
void main() {
  vN = aCorner;
  vec2 css = uCenter + aCorner * uRadius;
  vec2 clip = vec2(css.x / uView.x * 2.0 - 1.0, 1.0 - css.y / uView.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const LENS_FS = `#version 300 es
precision highp float;
in vec2 vN;
uniform sampler2D uPage;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec2 uView;
uniform vec2 uScroll;
uniform vec2 uPageSize;
uniform float uFull;
uniform float uPhase;
uniform vec2 uPoke;
uniform float uPokeZ;
uniform float uCosOpen;
out vec4 frag;

vec2 toUv(vec2 css) {
  vec2 pageCss = uFull > 0.5 ? css + uScroll : css;
  vec2 size = uFull > 0.5 ? uPageSize : uView;
  return vec2(pageCss.x / size.x, 1.0 - pageCss.y / size.y);
}

// 薄膜前后表面的反射干涉。光程差 opd = 2 n t cosθ，单位纳米。
vec3 filmReflect(float opd) {
  vec3 lambda = vec3(650.0, 530.0, 460.0);
  vec3 phi = 6.2831853 * opd / lambda;
  return 0.5 - 0.5 * cos(phi);
}

void main() {
  float r2 = dot(vN, vN);
  if (r2 >= 1.0) discard;
  float r = sqrt(r2);
  float nz = sqrt(max(0.0, 1.0 - r2));
  vec3 N = vec3(vN, nz);
  // 裂口是球面上的球冠，不是屏幕上的圆。戳点一侧、张角以内的膜已经不在了。
  if (uCosOpen < 1.5 && dot(N, vec3(uPoke, uPokeZ)) > uCosOpen) discard;

  // 肥皂膜只有几百纳米，正中几乎不偏折。弯折只出现在边缘，膜面转开、变成薄棱镜的地方。
  float limb = smoothstep(0.62, 1.0, r);
  float pinch = limb * limb * 0.42;
  vec2 hit = vN * (1.0 - pinch);
  vec2 dir = r > 0.0001 ? vN / r : vec2(1.0, 0.0);
  float shift = limb * uRadius * 0.015;
  vec2 sampleCss = uCenter + hit * uRadius;
  vec3 red = texture(uPage, toUv(sampleCss - dir * shift)).rgb;
  vec3 green = texture(uPage, toUv(sampleCss)).rgb;
  vec3 blue = texture(uPage, toUv(sampleCss + dir * shift)).rgb;
  vec3 scene = vec3(red.r, green.g, blue.b);

  // 膜厚从上往下增加（液体往下沉），再加一圈慢慢转的起伏。
  float n = 1.33;
  float cosT = sqrt(max(0.0, 1.0 - r2 / (n * n)));
  float thickness = 150.0 + 780.0 * (vN.y * 0.5 + 0.5) + 110.0 * sin(atan(vN.y, vN.x) * 2.0 + uPhase);
  vec3 bands = filmReflect(2.0 * n * thickness * cosT);

  // 正入射水大约只反射 2%。掠射时反射升上去，边缘就不再透出后面的画面。
  // 指数比物理的 5 次方低一些，亮页面上彩虹才看得清。
  float fresnel = 0.04 + 0.96 * pow(1.0 - nz, 2.4);
  vec3 room = mix(vec3(0.66, 0.74, 0.84), vec3(1.0, 0.99, 0.97), smoothstep(0.35, -0.75, vN.y));
  vec3 reflected = room * mix(bands, vec3(1.0), smoothstep(0.55, 0.92, fresnel));
  vec3 transmitted = scene * mix(vec3(1.0), vec3(1.0) - bands, 0.5 * smoothstep(0.2, 0.92, r));
  vec3 rgb = transmitted * (1.0 - fresnel) + reflected * fresnel;

  float spec = pow(max(0.0, dot(normalize(vec3(-0.32, -0.48, 1.0)), N)), 90.0);
  rgb += spec * 0.95;
  float spec2 = pow(max(0.0, dot(normalize(vec3(-0.08, -0.62, 1.0)), N)), 140.0);
  rgb += spec2 * 0.4;
  frag = vec4(min(rgb, vec3(1.0)), 1.0);
}`;

function has(proto: object, name: string): boolean {
  return name in proto;
}

export function detectHtmlInCanvas(): HtmlInCanvasMode {
  const glProbe = document.createElement('canvas');
  markDrawableCanvas(glProbe);
  try {
    const gl = glProbe.getContext('webgl2');
    if (gl && (
      typeof (gl as WebGL2RenderingContext & { texElementSubImage2D?: unknown }).texElementSubImage2D === 'function'
      || typeof (gl as WebGL2RenderingContext & { texElementImage2D?: unknown }).texElementImage2D === 'function'
    )) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return 'webgl';
    }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // 探针画布失败就继续看 2D。
  }

  const ctxProbe = document.createElement('canvas');
  markDrawableCanvas(ctxProbe);
  try {
    const ctx = ctxProbe.getContext('2d');
    if (ctx && typeof (ctx as CanvasRenderingContext2D & { drawElementImage?: unknown }).drawElementImage === 'function') {
      return '2d';
    }
  } catch {
    return 'none';
  }
  return 'none';
}

function markDrawableCanvas(canvas: HTMLCanvasElement): void {
  const drawable = canvas as DrawableCanvas;
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  try {
    if (has(HTMLCanvasElement.prototype, 'content')) {
      drawable.content = 'drawable';
    }
  } catch {
    // 只认 layoutsubtree 的版本没有 content setter。
  }
  try {
    if (has(HTMLCanvasElement.prototype, 'layoutSubtree')) {
      drawable.layoutSubtree = true;
    }
  } catch {
    // 只认 content 的版本没有 layoutSubtree setter。
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('无法创建着色器');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'shader compile failed';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) {
    throw new Error('无法创建程序');
  }
  const vert = compile(gl, gl.VERTEX_SHADER, vs);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'program link failed';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

export class PageSurface implements IDisposable {
  readonly layer: HTMLDivElement;
  readonly mode: 'webgl' | '2d';
  onPaint: (() => void) | null = null;

  private domCanvas: DrawableCanvas;
  private glCanvas: HTMLCanvasElement | null = null;
  private host: HTMLDivElement;
  private spacer: HTMLDivElement;
  private moved: PlacedNode[] = [];
  private observer: ResizeObserver | null = null;
  private paintListener = () => {
    this.sawPaint = true;
    this.onPaint?.();
  };
  private sawPaint = false;
  private warned = false;
  private drawOverload: 0 | 1 | 2 | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private pageProgram: WebGLProgram | null = null;
  private lensProgram: WebGLProgram | null = null;
  private pageBuffer: WebGLBuffer | null = null;
  private lensBuffer: WebGLBuffer | null = null;
  private pageVao: WebGLVertexArrayObject | null = null;
  private lensVao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private texW = 0;
  private texH = 0;
  private sceneFbo: WebGLFramebuffer | null = null;
  private sceneTex: [WebGLTexture | null, WebGLTexture | null] = [null, null];
  private sceneW = 0;
  private sceneH = 0;
  private pageCss = { width: 1, height: 1 };
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private ghost: HTMLElement | null = null;
  private revealed = false;
  private disposed = false;

  /** WebGL 折射不可用时，调用方在这张透明画布上画半透明泡泡。 */
  get bubbleLayer(): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
    if (!this.overlayCtx) {
      return null;
    }
    return { ctx: this.overlayCtx, width: window.innerWidth, height: window.innerHeight };
  }

  constructor(mode: 'webgl' | '2d') {
    this.mode = mode;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    this.layer = document.createElement('div');
    this.layer.dataset.magicBubbles = 'page';
    const background = getComputedStyle(document.body).backgroundColor;
    this.layer.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:20',
      'pointer-events:none',
      'opacity:0',
      'overflow:hidden',
      `background:${background}`,
    ].join(';');

    this.domCanvas = document.createElement('canvas') as DrawableCanvas;
    markDrawableCanvas(this.domCanvas);
    this.domCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;overflow:hidden;pointer-events:none;';
    this.layer.appendChild(this.domCanvas);

    this.host = document.createElement('div');
    this.host.setAttribute('drawable', '');
    this.host.style.cssText = [
      'display:block',
      'width:100%',
      'position:relative',
      'pointer-events:auto',
      `background:${background}`,
      `min-height:${window.innerHeight}px`,
    ].join(';');
    this.domCanvas.appendChild(this.host);
    document.body.appendChild(this.layer);
    this.holdGhost();

    for (const node of Array.from(document.body.childNodes)) {
      if (node === this.layer || node === this.ghost || !(node instanceof HTMLElement)) {
        continue;
      }
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT') {
        continue;
      }
      this.moved.push({ node, parent: node.parentNode!, next: node.nextSibling });
      this.host.appendChild(node);
    }

    this.spacer = document.createElement('div');
    this.spacer.setAttribute('aria-hidden', 'true');
    this.spacer.style.pointerEvents = 'none';
    document.body.appendChild(this.spacer);
    this.syncSpacer();
    window.scrollTo(scrollX, scrollY);
    this.observer = new ResizeObserver(() => this.syncSpacer());
    this.observer.observe(this.host);

    try {
      this.resize();
      if (mode === 'webgl') {
        this.gl = this.domCanvas.getContext('webgl2', {
          alpha: false,
          antialias: true,
          premultipliedAlpha: false,
        });
        if (!this.gl) {
          throw new Error('webgl2 上下文不可用');
        }
        this.initGl(this.gl);
      } else {
        this.ctx2d = this.domCanvas.getContext('2d');
        if (!this.ctx2d) {
          throw new Error('2d 上下文不可用');
        }
        this.attachLensLayer();
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /**
   * 节点搬进画布后，真正的画面要等下一帧 paint 才出现。
   * 这之前留一份静止的页面，避免空出一帧。
   */
  private holdGhost(): void {
    const ghost = document.createElement('div');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.dataset.magicBubbles = 'ghost';
    ghost.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:100%',
      'z-index:19',
      'pointer-events:none',
      `background:${getComputedStyle(document.body).backgroundColor}`,
    ].join(';');
    for (const node of Array.from(document.body.children)) {
      if (node === this.layer) {
        continue;
      }
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT') {
        continue;
      }
      ghost.appendChild(node.cloneNode(true));
    }
    document.body.appendChild(ghost);
    this.ghost = ghost;
  }

  private reveal(): void {
    if (this.revealed || this.disposed) {
      return;
    }
    this.revealed = true;
    this.layer.style.opacity = '1';
    this.ghost?.remove();
    this.ghost = null;
  }

  private attachLensLayer(): void {
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    this.layer.appendChild(this.glCanvas);
    this.resize();
    this.gl = this.glCanvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (this.gl) {
      try {
        this.initGl(this.gl);
        return;
      } catch (error) {
        console.warn('webgl2 折射着色器失败，泡泡改回半透明', error);
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
        this.gl = null;
      }
    }
    this.overlayCtx = this.glCanvas.getContext('2d');
  }

  connect(): void {
    this.domCanvas.addEventListener('paint', this.paintListener);
    this.domCanvas.onpaint = this.paintListener;
    this.requestPaint();
  }

  requestPaint(): void {
    if (this.disposed) {
      return;
    }
    if (typeof this.domCanvas.requestPaint === 'function') {
      this.domCanvas.requestPaint();
    }
    if (!this.sawPaint) {
      this.onPaint?.();
    }
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    this.sizeCanvas(this.domCanvas, width, height);
    if (this.glCanvas) {
      this.sizeCanvas(this.glCanvas, width, height);
    }
    this.texW = 0;
    this.texH = 0;
  }

  render(bubbles: LensBubble[]): void {
    if (this.disposed) {
      return;
    }
    try {
      if (this.mode === 'webgl' && this.gl && this.lensProgram) {
        this.renderWebGlPage(bubbles);
      } else if (this.ctx2d) {
        this.render2dPage();
        if (this.gl && this.glCanvas && this.lensProgram) {
          this.uploadCanvas(this.domCanvas);
          this.presentLenses(bubbles, false);
        }
      }
      this.syncGeometry();
      if (this.sawPaint || typeof this.domCanvas.requestPaint !== 'function') {
        this.reveal();
      }
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.warn('html-in-canvas 绘制失败，页面节点仍留在画布内', error);
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    this.domCanvas.onpaint = null;
    this.domCanvas.removeEventListener('paint', this.paintListener);
    this.observer?.disconnect();
    this.observer = null;
    for (let i = this.moved.length - 1; i >= 0; i--) {
      const placed = this.moved[i];
      placed.parent.insertBefore(placed.node, placed.next);
    }
    this.moved = [];
    this.ghost?.remove();
    this.ghost = null;
    this.spacer.remove();
    this.layer.remove();
    if (this.gl) {
      if (this.pageProgram) this.gl.deleteProgram(this.pageProgram);
      if (this.lensProgram) this.gl.deleteProgram(this.lensProgram);
      if (this.pageBuffer) this.gl.deleteBuffer(this.pageBuffer);
      if (this.lensBuffer) this.gl.deleteBuffer(this.lensBuffer);
      if (this.pageVao) this.gl.deleteVertexArray(this.pageVao);
      if (this.lensVao) this.gl.deleteVertexArray(this.lensVao);
      if (this.texture) this.gl.deleteTexture(this.texture);
      if (this.sceneFbo) this.gl.deleteFramebuffer(this.sceneFbo);
      if (this.sceneTex[0]) this.gl.deleteTexture(this.sceneTex[0]);
      if (this.sceneTex[1]) this.gl.deleteTexture(this.sceneTex[1]);
    }
    window.scrollTo(scrollX, scrollY);
  }

  private sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }

  private syncSpacer(): void {
    this.spacer.style.height = `${this.host.offsetHeight}px`;
  }

  private syncGeometry(): void {
    if (typeof this.domCanvas.updateElementGeometry !== 'function') {
      return;
    }
    this.domCanvas.updateElementGeometry(this.host, {
      preserveHitTestOrder: true,
      canvasTransform: new DOMMatrix([1, 0, 0, 1, -window.scrollX, -window.scrollY]),
    });
  }

  private gridSize(): { width: number; height: number } {
    const cssWidth = Math.max(1, this.host.offsetWidth);
    const cssHeight = Math.max(1, this.host.offsetHeight);
    try {
      if (typeof this.domCanvas.getElementImageDefaultSize === 'function') {
        const size = this.domCanvas.getElementImageDefaultSize(this.host);
        if (size?.width > 0 && size.height > 0) {
          return { width: Math.ceil(size.width), height: Math.ceil(size.height) };
        }
      }
      if (typeof this.domCanvas.captureElementImage === 'function') {
        const image = this.domCanvas.captureElementImage(this.host);
        const width = image?.width || 0;
        const height = image?.height || 0;
        image?.close?.();
        if (width > 0 && height > 0) {
          return { width: Math.ceil(width), height: Math.ceil(height) };
        }
      }
    } catch {
      // 第一帧还没有快照。
    }
    const dpr = window.devicePixelRatio || 1;
    return {
      width: Math.max(1, Math.ceil(cssWidth * dpr)),
      height: Math.max(1, Math.ceil(cssHeight * dpr)),
    };
  }

  private render2dPage(): void {
    const ctx = this.ctx2d;
    if (!ctx) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    if (typeof ctx.reset === 'function') {
      ctx.reset();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const grid = this.gridSize();
    const scaleX = grid.width / Math.max(1, this.host.offsetWidth);
    const scaleY = grid.height / Math.max(1, this.host.offsetHeight);
    const draw = (ctx as CanvasRenderingContext2D & {
      drawElementImage: (...args: unknown[]) => void;
    }).drawElementImage.bind(ctx);
    const sx = window.scrollX * scaleX;
    const sy = window.scrollY * scaleY;
    const attempts = [
      () => draw(this.host, sx, sy, cssWidth * scaleX, cssHeight * scaleY, 0, 0, cssWidth, cssHeight, {
        preserveElementGeometry: true,
      }),
      () => draw(this.host, -window.scrollX, -window.scrollY),
      () => draw(this.host, 0, 0),
    ];
    if (this.drawOverload !== null) {
      attempts[this.drawOverload]();
      return;
    }
    let lastError: unknown;
    for (let i = 0; i < attempts.length; i++) {
      try {
        attempts[i]();
        this.drawOverload = i as 0 | 1 | 2;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private renderWebGlPage(bubbles: LensBubble[]): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    const uploaded = this.uploadElement(gl);
    this.presentLenses(bubbles, uploaded === 'full');
  }

  /**
   * 远的泡泡先折页面。每画完一个，就把结果拷进另一张纹理，
   * 近的泡泡采样这张图，于是会把下层已经折过的画面再折一次。
   */
  private presentLenses(bubbles: LensBubble[], full: boolean): void {
    const gl = this.gl;
    if (!gl || !this.texture) {
      return;
    }
    this.ensureScene(gl);
    const width = this.sceneW;
    const height = this.sceneH;
    const target = (index: 0 | 1) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.sceneTex[index],
        0,
      );
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
    };

    target(0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    this.drawPage(full);

    let src: 0 | 1 = 0;
    for (const bubble of bubbles) {
      if (bubble.radius < 1 || bubble.alpha <= 0) {
        continue;
      }
      const dst: 0 | 1 = src === 0 ? 1 : 0;
      target(dst);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex[src]);
      this.drawPage(false);
      this.drawBubbles([bubble], false);
      src = dst;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex[src]);
    this.drawPage(false);
  }

  private ensureScene(gl: WebGL2RenderingContext): void {
    const width = Math.max(1, gl.drawingBufferWidth);
    const height = Math.max(1, gl.drawingBufferHeight);
    if (this.sceneFbo && this.sceneW === width && this.sceneH === height && this.sceneTex[0] && this.sceneTex[1]) {
      return;
    }
    if (!this.sceneFbo) {
      this.sceneFbo = gl.createFramebuffer();
    }
    for (let i = 0; i < 2; i++) {
      if (this.sceneTex[i]) {
        gl.deleteTexture(this.sceneTex[i]);
      }
      const tex = gl.createTexture();
      this.sceneTex[i] = tex;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex[0], 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`折射缓冲不完整: ${status}`);
    }
    this.sceneW = width;
    this.sceneH = height;
  }

  private uploadElement(gl: WebGL2RenderingContext): 'slice' | 'full' {
    const anyGl = gl as WebGL2RenderingContext & {
      texElementSubImage2D?: (...args: unknown[]) => void;
      texElementImage2D?: (...args: unknown[]) => void;
    };
    const viewW = Math.max(1, gl.drawingBufferWidth);
    const viewH = Math.max(1, gl.drawingBufferHeight);
    const grid = this.gridSize();
    this.pageCss = {
      width: Math.max(1, this.host.offsetWidth),
      height: Math.max(1, this.host.offsetHeight),
    };
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (typeof anyGl.texElementSubImage2D === 'function') {
      this.alloc(gl, viewW, viewH);
      gl.getError();
      try {
        anyGl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.host, {
          sx: window.scrollX * (grid.width / this.pageCss.width),
          sy: window.scrollY * (grid.height / this.pageCss.height),
          swidth: window.innerWidth * (grid.width / this.pageCss.width),
          sheight: window.innerHeight * (grid.height / this.pageCss.height),
          width: viewW,
          height: viewH,
        });
        if (gl.getError() === gl.NO_ERROR) {
          return 'slice';
        }
      } catch {
        gl.getError();
      }
    }

    const fullW = Math.min(8192, Math.max(viewW, grid.width));
    const fullH = Math.min(16384, Math.max(viewH, grid.height));
    this.alloc(gl, fullW, fullH);
    gl.getError();
    let uploaded = false;
    if (typeof anyGl.texElementSubImage2D === 'function') {
      try {
        anyGl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.host);
        uploaded = gl.getError() === gl.NO_ERROR;
      } catch {
        gl.getError();
      }
    }
    if (!uploaded && typeof anyGl.texElementImage2D === 'function') {
      try {
        anyGl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, this.host);
      } catch {
        anyGl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.host);
      }
    }
    return 'full';
  }

  private uploadCanvas(source: HTMLCanvasElement): void {
    const gl = this.gl;
    if (!gl || !this.texture) {
      return;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.alloc(gl, source.width, source.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private alloc(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (this.texW === width && this.texH === height) {
      return;
    }
    this.texW = width;
    this.texH = height;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  private drawPage(full: boolean): void {
    const gl = this.gl;
    const program = this.pageProgram;
    if (!gl || !program || !this.pageVao) {
      return;
    }
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.bindVertexArray(this.pageVao);
    gl.uniform1i(gl.getUniformLocation(program, 'uPage'), 0);
    gl.uniform1f(gl.getUniformLocation(program, 'uFull'), full ? 1 : 0);
    gl.uniform2f(gl.getUniformLocation(program, 'uScroll'), window.scrollX, window.scrollY);
    gl.uniform2f(gl.getUniformLocation(program, 'uPageSize'), this.pageCss.width, this.pageCss.height);
    gl.uniform2f(gl.getUniformLocation(program, 'uView'), window.innerWidth, window.innerHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private drawBubbles(bubbles: LensBubble[], full: boolean): void {
    const gl = this.gl;
    const program = this.lensProgram;
    if (!gl || !program || !this.lensVao) {
      return;
    }
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.bindVertexArray(this.lensVao);
    gl.uniform1i(gl.getUniformLocation(program, 'uPage'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'uView'), window.innerWidth, window.innerHeight);
    gl.uniform2f(gl.getUniformLocation(program, 'uScroll'), window.scrollX, window.scrollY);
    gl.uniform2f(gl.getUniformLocation(program, 'uPageSize'), this.pageCss.width, this.pageCss.height);
    gl.uniform1f(gl.getUniformLocation(program, 'uFull'), full ? 1 : 0);
    const center = gl.getUniformLocation(program, 'uCenter');
    const radius = gl.getUniformLocation(program, 'uRadius');
    const alpha = gl.getUniformLocation(program, 'uAlpha');
    const phase = gl.getUniformLocation(program, 'uPhase');
    const poke = gl.getUniformLocation(program, 'uPoke');
    const pokeZ = gl.getUniformLocation(program, 'uPokeZ');
    const cosOpen = gl.getUniformLocation(program, 'uCosOpen');
    for (const bubble of bubbles) {
      if (bubble.radius < 1 || bubble.alpha <= 0) {
        continue;
      }
      gl.uniform2f(center, bubble.x, bubble.y);
      gl.uniform1f(radius, bubble.radius);
      gl.uniform1f(alpha, bubble.alpha);
      gl.uniform1f(phase, bubble.phase);
      gl.uniform2f(poke, bubble.pokeX, bubble.pokeY);
      gl.uniform1f(pokeZ, bubble.pokeZ);
      gl.uniform1f(cosOpen, bubble.cosOpen);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  private initGl(gl: WebGL2RenderingContext): void {
    this.pageProgram = link(gl, PAGE_VS, PAGE_FS);
    this.lensProgram = link(gl, LENS_VS, LENS_FS);
    this.texture = gl.createTexture();
    this.pageBuffer = gl.createBuffer();
    this.lensBuffer = gl.createBuffer();
    this.pageVao = gl.createVertexArray();
    this.lensVao = gl.createVertexArray();

    const pageVerts = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      -1, 1, 0, 1,
      1, -1, 1, 0,
      1, 1, 1, 1,
    ]);
    gl.bindVertexArray(this.pageVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pageBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, pageVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    const corners = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]);
    gl.bindVertexArray(this.lensVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lensBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
}

function parseColor(color: string): [number, number, number] {
  const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!match) {
    return [0.08, 0.09, 0.1];
  }
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}
