/**
 * 黑洞
 * 每帧积分史瓦西零测地线：d²u/dφ² = 3Mu² − u，u = 1/r。
 * 吸积盘是不透明薄盘：最内稳定圆轨道 r = 6M 处力矩为零，
 * 面流量用该边界条件下的诺维科夫–索恩积分。
 * 平均流量仍是诺维科夫–索恩盘。其上叠了随开普勒角速度剪切的湍流，所以亮度和颜色会起伏。
 * 影子边界是光子球 r = 3M 的临界撞击参数 b = 3√3 M。
 */

import { ElementAnimator } from './utils/animation';
import { Disposable } from './utils/disposable';
import { DomListener, isTypingTarget, liftAuthorCard } from './utils/dom';
import { detectHtmlInCanvas } from './utils/html-in-canvas';
import { renderTips } from './utils/tips-render';

const FOV = 0.86;
const PAGE_Y = -4;
const BASE_CAM_R = 56;

interface PageShot {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  scrollX: number;
  scrollY: number;
  background: [number, number, number];
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
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform sampler2D uPage;
uniform vec2 uPageSize;
uniform vec2 uScroll;
uniform vec2 uView;
uniform vec2 uHalf;
uniform vec2 uResolution;
uniform float uM;
uniform float uCamR;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
uniform float uPageY;
uniform float uFront;
uniform float uBand;
uniform float uTime;
uniform vec3 uBg;

out vec4 fragColor;

float orbit(float u) {
  return 3.0 * uM * u * u - u;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 starfield(vec3 dir) {
  vec3 col = mix(uBg * 0.12, vec3(0.007, 0.009, 0.016), 0.9);
  vec3 p = normalize(dir) * 280.0;
  vec3 cell = floor(p);
  vec3 f = p - cell - 0.5;
  float n = hash13(cell);
  float d2 = dot(f, f);
  if (n > 0.992 && d2 < 0.012) {
    float tw = 0.6 + 0.4 * sin(uTime * 1.6 + n * 58.0);
    col += vec3(0.85, 0.9, 1.0) * (1.0 - d2 / 0.012) * tw;
  }
  return col;
}

vec2 planeOf(vec3 p) {
  return vec2(p.x, -p.z);
}

vec4 samplePage(vec2 plane) {
  float docX = uScroll.x + uView.x * 0.5 + plane.x / uHalf.x * (uView.x * 0.5);
  float docY = uScroll.y + uView.y * 0.5 - plane.y / uHalf.y * (uView.y * 0.5);
  vec2 uv = vec2(docX / uPageSize.x, docY / uPageSize.y);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec4(0.0);
  }
  return vec4(textureLod(uPage, vec2(uv.x, 1.0 - uv.y), 0.0).rgb, 1.0);
}

vec2 sucked(vec2 plane) {
  if (uFront < 0.8) {
    return plane;
  }
  float r0 = length(plane);
  float gap = r0 - uFront;
  if (r0 < 1e-3 || gap < 0.0) {
    return plane;
  }
  float influence = exp(-gap / max(uBand * 0.28, 0.6));
  float ang = influence * 1.15;
  float c = cos(ang);
  float s = sin(ang);
  vec2 q = vec2(c * plane.x - s * plane.y, s * plane.x + c * plane.y);
  float pull = influence * 0.7;
  float rq = max(length(q), 1e-3);
  return q * ((rq + pull * uBand * 0.35) / rq);
}

vec4 shadePage(vec2 plane, float bAbs, float bCrit) {
  float rho = length(plane);
  float edge = smoothstep(uFront - 0.15, uFront + 1.8, rho);
  if (edge <= 0.001) {
    return vec4(0.0);
  }
  vec4 tex = samplePage(sucked(plane));
  if (tex.a <= 0.0) {
    return vec4(0.0);
  }
  tex.rgb *= mix(0.58, 1.0, smoothstep(bCrit, bCrit * 3.4, bAbs));
  tex.a *= edge;
  return tex;
}

vec3 blackbody(float kelvin) {
  float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
  float red = t <= 66.0 ? 1.0 : clamp(1.292936186 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  float green = t <= 66.0
    ? clamp(0.3900815788 * log(t) - 0.6318414438, 0.0, 1.0)
    : clamp(1.129890861 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  float blue = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432067891 * log(t - 10.0) - 1.196254089, 0.0, 1.0));
  return vec3(red, green, blue);
}

float diskFlux(float radius) {
  float radial = sqrt(radius);
  float root3 = 1.73205080757;
  float axis = radial - (root3 * 0.5) * log(abs((radial - root3) / (radial + root3)));
  float integ = axis - 3.97607357595;
  if (integ <= 0.0) {
    return 0.0;
  }
  return integ / (pow(radius, 3.5) * (1.0 - 3.0 / radius));
}

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float gnoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 g00 = vec2(hash21(cell), hash21(cell + 13.1)) * 2.0 - 1.0;
  vec2 g10 = vec2(hash21(cell + vec2(1.0, 0.0)), hash21(cell + vec2(1.0, 0.0) + 13.1)) * 2.0 - 1.0;
  vec2 g01 = vec2(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(0.0, 1.0) + 13.1)) * 2.0 - 1.0;
  vec2 g11 = vec2(hash21(cell + vec2(1.0, 1.0)), hash21(cell + vec2(1.0, 1.0) + 13.1)) * 2.0 - 1.0;
  return mix(
    mix(dot(g00, f), dot(g10, f - vec2(1.0, 0.0)), u.x),
    mix(dot(g01, f - vec2(0.0, 1.0)), dot(g11, f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float diskTurbulence(vec2 p) {
  float sum = 0.0;
  float weight = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    sum += weight * gnoise(p);
    p = p * 2.13 + vec2(1.7, 4.2);
    weight *= 0.5;
  }
  return sum / 0.9375;
}

vec3 diskGlow(vec3 hit, float by) {
  float eaten = clamp(uFront / max(uHalf.y * 2.0, 8.0), 0.0, 1.0);
  if (eaten <= 0.001) {
    return vec3(0.0);
  }
  float radius = length(hit) / max(uM, 1e-4);
  // 内缘是最内稳定圆轨道。外缘不设亮边：流量在大半径按 r⁻³ 掉下去，
  // 截断放在已经暗到看不见的地方，避免 32M 处还剩一成亮度时被切掉。
  if (radius < 6.0 || radius > 160.0) {
    return vec3(0.0);
  }
  float flux = diskFlux(radius) / 1.136733e-4;
  if (flux <= 0.0) {
    return vec3(0.0);
  }
  float omega = pow(radius, -1.5);
  float azimuth = atan(hit.z, hit.x);
  float wound = azimuth - omega * uTime * 16.0;
  vec2 field = vec2(wound * 2.4, log(radius) * 7.0);
  float turb = diskTurbulence(field);
  flux *= clamp(1.0 + 0.9 * turb, 0.18, 2.6);
  float redshift = sqrt(max(0.0, 1.0 - 3.0 / radius)) / max(1.0 - by * omega / max(uM, 1e-4), 0.08);
  float temperature = redshift * 9000.0 * pow(flux, 0.25) * (1.0 + 0.32 * turb);
  float heat = clamp(temperature / 14000.0, 0.0, 1.0);
  float colorTemp = mix(1700.0, 9600.0, pow(heat, 2.8));
  float observed = pow(redshift, 4.0) * flux * smoothstep(0.0, 0.22, eaten);
  vec3 tint = blackbody(colorTemp);
  tint.b *= 0.48;
  vec3 light = tint * observed * 2.15;
  float luma = dot(light, vec3(0.2126, 0.7152, 0.0722));
  return light / (1.0 + luma);
}

vec3 trace(vec3 ro, vec3 rd) {
  float Rs = 2.0 * uM;
  float bCrit = 5.19615242 * uM;
  float r0 = max(length(ro), 0.001);
  vec3 n = ro / r0;
  float cosA = dot(rd, n);
  float sinA = length(cross(n, rd));
  float metric = sqrt(max(1e-3, 1.0 - Rs / r0));
  float bAbs = r0 * sinA / metric;
  float by = (cross(ro, rd) / metric).y;
  vec3 col = starfield(rd);
  bool gotDisk = false;

  if (sinA < 0.0025) {
    if (cosA < 0.0) {
      col = vec3(0.0);
    } else if (abs(rd.y) > 1e-4) {
      float t = (uPageY - ro.y) / rd.y;
      if (t > 0.0) {
        vec4 page = shadePage(planeOf(ro + rd * t), bAbs, bCrit);
        col = page.a > 0.0 ? mix(col, page.rgb, page.a) : col;
      }
    }
  } else {
    vec3 e1 = n;
    vec3 e2 = normalize(rd - n * cosA);
    float u = 1.0 / r0;
    float w = -cosA / (sinA * r0 * metric);
    float phi = 0.0;
    vec3 prev = ro;
    bool done = false;
    vec3 diskLight = vec3(0.0);

    for (int i = 0; i < 180; i++) {
      if (done) {
        break;
      }
      float r = 1.0 / max(u, 1e-4);
      float nearHole = smoothstep(12.0 * uM, 3.05 * uM, r);
      float dphi = mix(0.08, 0.016, nearHole);
      dphi = min(dphi, 0.16 / (1.0 + 2.4 * abs(w)));
      float u0 = u;

      float k1u = w;
      float k1w = orbit(u);
      float k2u = w + 0.5 * dphi * k1w;
      float k2w = orbit(u + 0.5 * dphi * k1u);
      float k3u = w + 0.5 * dphi * k2w;
      float k3w = orbit(u + 0.5 * dphi * k2u);
      float k4u = w + dphi * k3w;
      float k4w = orbit(u + dphi * k3u);
      u += dphi / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
      w += dphi / 6.0 * (k1w + 2.0 * k2w + 2.0 * k3w + k4w);
      phi += dphi;

      vec3 pos = (cos(phi) * e1 + sin(phi) * e2) / max(u, 1e-4);
      float y0 = prev.y;
      float y1 = pos.y;
      bool crosses = y0 * y1 <= 0.0 && abs(y0 - y1) > 1e-5;
      if (crosses && !gotDisk) {
        float t = clamp(y0 / (y0 - y1), 0.0, 1.0);
        float phiH = phi - dphi * (1.0 - t);
        vec3 hit = (cos(phiH) * e1 + sin(phiH) * e2) / max(mix(u0, u, t), 1e-4);
        vec3 emit = diskGlow(hit, by);
        if (dot(emit, emit) > 1e-5) {
          diskLight = emit;
          gotDisk = true;
          done = true;
        }
      }

      if (u > 1.0 / (Rs * 1.012)) {
        col = vec3(0.0);
        done = true;
        break;
      }

      if (!done && (y0 - uPageY) > 0.0 && (y1 - uPageY) <= 0.0) {
        float t = clamp((y0 - uPageY) / (y0 - y1), 0.0, 1.0);
        float phiH = phi - dphi * (1.0 - t);
        vec3 hit = (cos(phiH) * e1 + sin(phiH) * e2) / max(mix(u0, u, t), 1e-4);
        vec4 page = shadePage(planeOf(hit), bAbs, bCrit);
        if (page.a > 0.02) {
          col = bAbs < bCrit * 0.97 ? vec3(0.0) : mix(starfield(normalize(hit)), page.rgb, page.a);
          done = true;
        }
      }

      float rNow = 1.0 / max(u, 1e-4);
      if (!done && (u <= 1e-4 || (rNow > 480.0 && w < 0.0))) {
        col = starfield(normalize(pos));
        done = true;
      }
      if (!done && phi > 16.0) {
        done = true;
      }
      prev = pos;
    }

    if (gotDisk) {
      col = diskLight;
    } else if (bAbs < bCrit) {
      col = vec3(0.0);
    }
  }

  return min(max(col, vec3(0.0)), vec3(1.0));
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  float tilt = uPitch;
  float cp = cos(tilt);
  float sp = sin(tilt);
  float cy = cos(uYaw);
  float sy = sin(uYaw);
  vec3 ro = uCamR * vec3(sp * sy, cp, sp * cy);
  vec3 forward = normalize(-ro);
  vec3 worldUp = vec3(0.0, 0.0, -1.0);
  vec3 right = cross(forward, worldUp);
  if (dot(right, right) < 1e-6) {
    right = cross(forward, vec3(0.0, 1.0, 0.0));
  }
  right = normalize(right);
  vec3 up = normalize(cross(right, forward));
  float tanFov = tan(uFov * 0.5);
  float aspect = uResolution.x / uResolution.y;
  vec3 rd = normalize(forward + right * (ndc.x * tanFov * aspect) + up * (ndc.y * tanFov));
  fragColor = vec4(trace(ro, rd), 1.0);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function parseCssColor(color: string): [number, number, number] {
  const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!match) {
    return [1, 1, 1];
  }
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}

function pageBackground(): [number, number, number] {
  const body = getComputedStyle(document.body).backgroundColor;
  const root = getComputedStyle(document.documentElement).backgroundColor;
  const chosen = body && body !== 'rgba(0, 0, 0, 0)' && body !== 'transparent' ? body : root;
  return parseCssColor(chosen || 'rgb(255, 255, 255)');
}

function transparent(color: string): boolean {
  if (!color || color === 'transparent') {
    return true;
  }
  const match = color.match(/rgba\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+[,\s/]+([\d.]+)\s*\)/);
  return !!match && Number(match[1]) === 0;
}

function documentSize(): { width: number; height: number } {
  const root = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(root.scrollWidth, body.scrollWidth, window.innerWidth),
    height: Math.max(root.scrollHeight, body.scrollHeight, window.innerHeight),
  };
}

function halfExtents(aspect: number): [number, number] {
  const dist = BASE_CAM_R - PAGE_Y;
  const halfH = dist * Math.tan(FOV * 0.5);
  return [halfH * aspect, halfH];
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

function markDrawable(canvas: HTMLCanvasElement): void {
  const drawable = canvas as DrawableCanvas;
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  try {
    if ('content' in HTMLCanvasElement.prototype) {
      drawable.content = 'drawable';
    }
  } catch {
    // 旧版只有 layoutsubtree。
  }
  try {
    if ('layoutSubtree' in HTMLCanvasElement.prototype) {
      drawable.layoutSubtree = true;
    }
  } catch {
    // 新版只有 content。
  }
}

function shotVariance(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 2 || canvas.height < 2) {
    return 0;
  }
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const px = Math.min(canvas.width - 1, Math.floor((x + 0.5) * canvas.width / 6));
      const py = Math.min(canvas.height - 1, Math.floor((y + 0.5) * canvas.height / 6));
      const data = ctx.getImageData(px, py, 1, 1).data;
      const luma = data[0] + data[1] + data[2];
      sum += luma;
      sum2 += luma * luma;
      n++;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

function fitScale(cssWidth: number, cssHeight: number): number {
  const limit = Math.min(maxTextureSize(), 24576);
  let scale = Math.min(window.devicePixelRatio || 1, 1);
  if (cssWidth * scale > limit || cssHeight * scale > limit) {
    scale = Math.min(scale, limit / cssWidth, limit / cssHeight);
  }
  return Math.max(0.35, scale);
}

function maxTextureSize(): number {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  const max = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 4096;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return max > 0 ? max : 4096;
}

async function captureDrawable(cssWidth: number, cssHeight: number): Promise<HTMLCanvasElement | null> {
  const mode = detectHtmlInCanvas();
  if (mode === 'none') {
    return null;
  }
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const scale = fitScale(cssWidth, cssHeight);
  const width = Math.max(1, Math.floor(cssWidth * scale));
  const height = Math.max(1, Math.floor(cssHeight * scale));
  const layer = document.createElement('div');
  layer.dataset.magicBlackhole = 'capture';
  layer.style.cssText = 'position:fixed;inset:0;z-index:18;opacity:0;pointer-events:none;overflow:hidden;';
  const canvas = document.createElement('canvas') as DrawableCanvas;
  markDrawable(canvas);
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${cssWidth}px;height:${cssHeight}px;`;
  const host = document.createElement('div');
  host.setAttribute('drawable', '');
  host.style.cssText = `display:block;width:${cssWidth}px;min-height:${cssHeight}px;position:relative;background:${getComputedStyle(document.body).backgroundColor};`;
  canvas.appendChild(host);
  layer.appendChild(canvas);
  const curtain = document.createElement('div');
  curtain.dataset.magicBlackhole = 'curtain';
  const curtainColor = getComputedStyle(document.body).backgroundColor || '#111';
  curtain.style.cssText = `position:fixed;inset:0;z-index:30;background:${curtainColor};pointer-events:none;`;
  document.body.appendChild(curtain);
  document.body.appendChild(layer);
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

  const moved: PlacedNode[] = [];
  try {
    for (const node of Array.from(document.body.children)) {
      if (node === layer || node.dataset.magicBlackhole || !(node instanceof HTMLElement)) {
        continue;
      }
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT') {
        continue;
      }
      moved.push({ node, parent: node.parentNode!, next: node.nextSibling });
      host.appendChild(node);
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        canvas.removeEventListener('paint', finish);
        resolve();
      };
      canvas.addEventListener('paint', finish);
      canvas.onpaint = finish;
      if (typeof canvas.requestPaint === 'function') {
        canvas.requestPaint();
      }
      window.setTimeout(finish, 240);
    });

    if (mode === 'webgl') {
      return readElementTexture(canvas, host, width, height);
    }
    const source = canvas.getContext('2d') as CanvasRenderingContext2D & {
      drawElementImage?: (...args: unknown[]) => void;
    } | null;
    const draw = source?.drawElementImage;
    if (!source || !draw) {
      return null;
    }
    const attempts = [
      () => draw.call(source, host, 0, 0, cssWidth, cssHeight, 0, 0, cssWidth, cssHeight),
      () => draw.call(source, host, 0, 0),
    ];
    let drew = false;
    for (const attempt of attempts) {
      try {
        source.setTransform(scale, 0, 0, scale, 0, 0);
        attempt();
        drew = true;
        break;
      } catch {
        drew = false;
      }
    }
    if (!drew) {
      return null;
    }
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.drawImage(canvas, 0, 0);
    return shotVariance(out) > 8 ? out : null;
  } catch (error) {
    console.warn('html-in-canvas 没能拍下页面', error);
    return null;
  } finally {
    for (let i = moved.length - 1; i >= 0; i--) {
      const placed = moved[i];
      placed.parent.insertBefore(placed.node, placed.next);
    }
    layer.remove();
    curtain.remove();
    window.scrollTo(scrollX, scrollY);
  }
}

function readElementTexture(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    return null;
  }
  const anyGl = gl as WebGL2RenderingContext & {
    texElementSubImage2D?: (...args: unknown[]) => void;
    texElementImage2D?: (...args: unknown[]) => void;
  };
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  let uploaded = false;
  if (typeof anyGl.texElementSubImage2D === 'function') {
    try {
      anyGl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, host);
      uploaded = gl.getError() === gl.NO_ERROR;
    } catch {
      gl.getError();
    }
  }
  if (!uploaded && typeof anyGl.texElementImage2D === 'function') {
    try {
      anyGl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, host);
      uploaded = gl.getError() === gl.NO_ERROR;
    } catch {
      try {
        anyGl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, host);
        uploaded = gl.getError() === gl.NO_ERROR;
      } catch {
        gl.getError();
      }
    }
  }
  if (!uploaded || !texture) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
  const frame = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.deleteFramebuffer(frame);
  gl.deleteTexture(texture);
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  const flipped = new Uint8ClampedArray(pixels.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * row;
    flipped.set(pixels.subarray(src, src + row), y * row);
  }
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.putImageData(new ImageData(flipped, width, height), 0, 0);
  return shotVariance(out) > 8 ? out : null;
}

function imageIsClean(source: CanvasImageSource): boolean {
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext('2d');
  if (!ctx) {
    return false;
  }
  try {
    ctx.drawImage(source, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number[],
): void {
  const [tl, tr, br, bl] = radii.map((radius) => Math.max(0, Math.min(radius, w / 2, h / 2)));
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

function paintText(ctx: CanvasRenderingContext2D, node: Text, ox: number, oy: number): void {
  const raw = node.data.replace(/\s+/g, ' ');
  if (!raw.trim()) {
    return;
  }
  const el = node.parentElement;
  if (!el) {
    return;
  }
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
  if (!rects.length) {
    return;
  }
  ctx.save();
  ctx.font = style.font || `${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  const spacing = style.letterSpacing;
  if (spacing && spacing !== 'normal') {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
  }
  if (rects.length === 1) {
    const rect = rects[0];
    ctx.fillText(raw.trim(), rect.left + ox, rect.top + oy + rect.height / 2);
    ctx.restore();
    return;
  }
  const tokens = raw.split(/(\s+)/);
  let tokenIndex = 0;
  let tokenChar = 0;
  const takeLine = (rect: DOMRect): string => {
    const maxW = Math.max(4, rect.width + 2);
    let built = '';
    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex].slice(tokenChar);
      if (!token) {
        tokenIndex++;
        tokenChar = 0;
        continue;
      }
      const next = built + token;
      if (built && ctx.measureText(next).width > maxW) {
        break;
      }
      if (!built && ctx.measureText(token).width > maxW) {
        let cut = 1;
        while (cut < token.length && ctx.measureText(token.slice(0, cut + 1)).width <= maxW) {
          cut++;
        }
        built = token.slice(0, cut);
        tokenChar += cut;
        break;
      }
      built = next;
      tokenIndex++;
      tokenChar = 0;
    }
    return built.replace(/^\s+/, '');
  };
  for (const rect of rects) {
    const piece = takeLine(rect);
    if (piece.trim()) {
      ctx.fillText(piece, rect.left + ox, rect.top + oy + rect.height / 2);
    }
  }
  ctx.restore();
}

function paintElement(ctx: CanvasRenderingContext2D, el: Element, ox: number, oy: number): void {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) {
    return;
  }
  const tag = el.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') {
    return;
  }
  if (el.closest('[data-magic-blackhole]')) {
    return;
  }
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return;
  }
  const own = Number.parseFloat(style.opacity);
  if (own === 0) {
    return;
  }

  const rect = el.getBoundingClientRect();
  ctx.save();
  if (Number.isFinite(own) && own < 1) {
    ctx.globalAlpha *= own;
  }
  const radii = [
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    Number.parseFloat(style.borderTopRightRadius) || 0,
    Number.parseFloat(style.borderBottomRightRadius) || 0,
    Number.parseFloat(style.borderBottomLeftRadius) || 0,
  ];
  const clips = style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden' || radii.some((radius) => radius > 0);
  if (clips && rect.width > 0 && rect.height > 0) {
    roundedPath(ctx, rect.left + ox, rect.top + oy, rect.width, rect.height, radii);
    ctx.clip();
  }
  if (rect.width > 0 && rect.height > 0 && !transparent(style.backgroundColor)) {
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(rect.left + ox, rect.top + oy, rect.width, rect.height);
  }
  if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0 && imageIsClean(el)) {
    drawFitted(ctx, el, rect, style.objectFit, ox, oy);
  } else if (el instanceof HTMLCanvasElement && el.width > 0 && imageIsClean(el)) {
    ctx.drawImage(el, rect.left + ox, rect.top + oy, rect.width, rect.height);
  } else if (el instanceof HTMLVideoElement && el.readyState >= 2 && imageIsClean(el)) {
    ctx.drawImage(el, rect.left + ox, rect.top + oy, rect.width, rect.height);
  }
  const border = Number.parseFloat(style.borderTopWidth) || 0;
  if (border > 0 && !transparent(style.borderTopColor) && rect.width > 0) {
    ctx.strokeStyle = style.borderTopColor;
    ctx.lineWidth = border;
    roundedPath(ctx, rect.left + ox, rect.top + oy, rect.width, rect.height, radii);
    ctx.stroke();
  }
  for (const child of el.childNodes) {
    if (child instanceof Text) {
      paintText(ctx, child, ox, oy);
    } else if (child instanceof Element) {
      paintElement(ctx, child, ox, oy);
    }
  }
  ctx.restore();
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number },
  rect: DOMRect,
  fit: string,
  ox: number,
  oy: number,
): void {
  const sourceW = img.naturalWidth || img.width || rect.width;
  const sourceH = img.naturalHeight || img.height || rect.height;
  if (!sourceW || !sourceH) {
    ctx.drawImage(img, rect.left + ox, rect.top + oy, rect.width, rect.height);
    return;
  }
  if (fit !== 'cover' && fit !== 'contain') {
    ctx.drawImage(img, rect.left + ox, rect.top + oy, rect.width, rect.height);
    return;
  }
  const sourceRatio = sourceW / sourceH;
  const rectRatio = rect.width / Math.max(rect.height, 1);
  let dw = rect.width;
  let dh = rect.height;
  let dx = rect.left + ox;
  let dy = rect.top + oy;
  const cover = fit === 'cover';
  if ((cover && sourceRatio > rectRatio) || (!cover && sourceRatio < rectRatio)) {
    dh = rect.height;
    dw = dh * sourceRatio;
    dx = rect.left + ox + (rect.width - dw) / 2;
  } else {
    dw = rect.width;
    dh = dw / sourceRatio;
    dy = rect.top + oy + (rect.height - dh) / 2;
  }
  if (cover) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left + ox, rect.top + oy, rect.width, rect.height);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function rasterizePage(cssWidth: number, cssHeight: number): HTMLCanvasElement {
  const scale = fitScale(cssWidth, cssHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(cssWidth * scale));
  canvas.height = Math.max(1, Math.floor(cssHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }
  const [r, g, b] = pageBackground();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  paintElement(ctx, document.body, window.scrollX, window.scrollY);
  return canvas;
}

async function capturePage(): Promise<PageShot> {
  const size = documentSize();
  const background = pageBackground();
  const drawable = await captureDrawable(size.width, size.height);
  const canvas = drawable ?? rasterizePage(size.width, size.height);
  return {
    canvas,
    cssWidth: size.width,
    cssHeight: size.height,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    background,
  };
}

class BlackHole extends Disposable {
  readonly element: HTMLCanvasElement;
  readonly ready: Promise<void>;
  disposed = false;

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private shot: PageShot | null = null;
  private animationId: number | null = null;
  private running = false;
  private lastTime = 0;
  private elapsed = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private zoom = 0;
  private eatMax = 1;
  private viewRadius = 1;
  private band = 12;
  private half: [number, number] = [1, 1];
  private prevOverflow = '';
  private locations = new Map<string, WebGLUniformLocation | null>();

  constructor() {
    super();
    this.element = document.createElement('canvas');
    this.element.dataset.magicBlackhole = 'stage';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:100%',
      'height:100%',
      'display:block',
      'z-index:20',
      'pointer-events:auto',
      'touch-action:none',
      'user-select:none',
      'opacity:0',
      'background:#000',
    ].join(';');
    this.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    this.ready = this.boot();
  }

  restart(): void {
    this.elapsed = 0;
    this.zoom = 0;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.running = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    document.documentElement.style.overflow = this.prevOverflow;
    const gl = this.gl;
    if (gl) {
      if (this.program) {
        gl.deleteProgram(this.program);
      }
      if (this.texture) {
        gl.deleteTexture(this.texture);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.element.remove();
    super.dispose();
  }

  private async boot(): Promise<void> {
    try {
      this.shot = await capturePage();
      if (this.disposed) {
        return;
      }
      const parent = document.querySelector('.single-container') ?? document.body;
      parent.appendChild(this.element);
      this.gl = this.element.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      });
      if (!this.gl) {
        throw new Error('WebGL2 不可用');
      }
      this.program = link(this.gl, VERT, FRAG);
      for (const name of [
        'uPage', 'uPageSize', 'uScroll', 'uView', 'uHalf', 'uResolution',
        'uM', 'uCamR', 'uYaw', 'uPitch', 'uFov', 'uPageY', 'uFront', 'uBand',
        'uTime', 'uBg',
      ]) {
        this.locations.set(name, this.gl.getUniformLocation(this.program, name));
      }
      this.upload(this.shot);
      this.resize();
      this._register(new DomListener(window, 'resize', () => this.resize()));
      this._register(new DomListener(window, 'pointermove', this.onPointer));
      this._register(new DomListener(window, 'wheel', this.onWheel, { passive: true }));
      this._register(new DomListener(window, 'keydown', this.onKey));
      this.running = true;
      this.lastTime = performance.now();
      const card = document.getElementById('author-card');
      if (card) {
        card.style.zIndex = '40';
      }
      this.animationId = requestAnimationFrame(this.frame);
    } catch (error) {
      console.error('黑洞没能启动', error);
      this.dispose();
    }
  }

  private upload(shot: PageShot): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, shot.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const huge = shot.canvas.width > 4096 || shot.canvas.height > 4096;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, huge ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (!huge) {
      gl.generateMipmap(gl.TEXTURE_2D);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) {
        const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
        gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
      }
    }
  }

  private resize = (): void => {
    const gl = this.gl;
    const shot = this.shot;
    if (!gl || !shot) {
      return;
    }
    const cssW = window.innerWidth;
    const cssH = Math.max(1, window.innerHeight);
    const budget = 1100000;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.35);
    const scale = Math.min(dpr, Math.sqrt(budget / (cssW * cssH)));
    const width = Math.max(1, Math.floor(cssW * scale));
    const height = Math.max(1, Math.floor(cssH * scale));
    if (this.element.width !== width) {
      this.element.width = width;
    }
    if (this.element.height !== height) {
      this.element.height = height;
    }
    gl.viewport(0, 0, width, height);
    this.half = halfExtents(width / height);
    this.viewRadius = Math.hypot(this.half[0], this.half[1]);
    this.eatMax = Math.max(this.viewRadius + 1, this.measureEat(shot, cssW, cssH));
    this.band = clamp(Math.min(this.half[1] * 0.62, this.eatMax * 0.2), 6, 22);
  };

  private measureEat(shot: PageShot, viewW: number, viewH: number): number {
    const [halfW, halfH] = this.half;
    const corners: Array<[number, number]> = [
      [0, 0],
      [shot.cssWidth, 0],
      [0, shot.cssHeight],
      [shot.cssWidth, shot.cssHeight],
    ];
    let max = 1;
    for (const [px, py] of corners) {
      const right = (px - (shot.scrollX + viewW / 2)) / (viewW / 2) * halfW;
      const up = -((py - (shot.scrollY + viewH / 2)) / (viewH / 2)) * halfH;
      max = Math.max(max, Math.hypot(right, up));
    }
    return max;
  }

  private frame = (now: number): void => {
    if (!this.running) {
      return;
    }
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;
    const follow = 1 - Math.exp(-dt * 5);
    this.lookYaw += (this.targetYaw - this.lookYaw) * follow;
    this.lookPitch += (this.targetPitch - this.lookPitch) * follow;
    this.draw();
    this.animationId = requestAnimationFrame(this.frame);
  };

  private draw(): void {
    const gl = this.gl;
    const program = this.program;
    const shot = this.shot;
    if (!gl || !program || !shot) {
      return;
    }
    const hold = 3;
    const visibleSpan = 10;
    const restSpan = 6;
    const grow = smoothstep(hold - 0.2, hold + 4.5, this.elapsed);
    const cine = smoothstep(hold + 1.2, hold + visibleSpan, this.elapsed);
    const fallen = this.elapsed - hold;
    let front = 0;
    if (fallen > 0 && fallen < visibleSpan) {
      const p = fallen / visibleSpan;
      const eased = p * p * (3 - 2 * p);
      front = eased * this.viewRadius;
    } else if (fallen >= visibleSpan) {
      const p = clamp((fallen - visibleSpan) / restSpan, 0, 1);
      front = this.viewRadius + p * (this.eatMax - this.viewRadius);
    }
    const mass = mix(0.18, 1, grow);
    const tilt = clamp(mix(0, 1.32, cine) + this.lookPitch, 0, 1.48);
    const yaw = this.lookYaw;
    const camR = clamp(mix(BASE_CAM_R, 118, cine) + this.zoom, 28, 180);

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const set1f = (name: string, value: number) => {
      gl.uniform1f(this.locations.get(name) ?? null, value);
    };
    const set2f = (name: string, x: number, y: number) => {
      gl.uniform2f(this.locations.get(name) ?? null, x, y);
    };
    gl.uniform1i(this.locations.get('uPage') ?? null, 0);
    set2f('uPageSize', shot.cssWidth, shot.cssHeight);
    set2f('uScroll', shot.scrollX, shot.scrollY);
    set2f('uView', window.innerWidth, window.innerHeight);
    set2f('uHalf', this.half[0], this.half[1]);
    set2f('uResolution', gl.drawingBufferWidth, gl.drawingBufferHeight);
    set1f('uM', mass);
    set1f('uCamR', camR);
    set1f('uYaw', yaw);
    set1f('uPitch', tilt);
    set1f('uFov', FOV);
    set1f('uPageY', PAGE_Y);
    set1f('uFront', front);
    set1f('uBand', this.band);
    set1f('uTime', this.elapsed);
    gl.uniform3f(this.locations.get('uBg') ?? null, shot.background[0], shot.background[1], shot.background[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private onPointer = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest('.widget-info')) {
      return;
    }
    const x = event.clientX / Math.max(1, window.innerWidth) - 0.5;
    const y = event.clientY / Math.max(1, window.innerHeight) - 0.5;
    this.targetYaw = x * 1.15;
    this.targetPitch = y * 0.55;
  };

  private onWheel = (event: WheelEvent): void => {
    this.zoom = clamp(this.zoom + event.deltaY * 0.02, -18, 28);
  };

  private onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'r' && event.key !== 'R') {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    this.restart();
  };
}

onActivate((context) => {
  context.add(liftAuthorCard());
  const hole = context.add(new BlackHole());
  void hole.ready.then(() => {
    if (!hole.disposed) {
      void ElementAnimator.show(hole.element);
    }
  });

  renderTips({
    title: '黑洞',
    description: '整页落到史瓦西吸积盘上。视角抬离盘面。内缘发白，外侧顺着流量变暗，朝向你转的一侧更亮。',
    operations: [
      { key: '移动', description: '绕到侧面看吸积盘' },
      { key: '滚轮', description: '靠近或退远' },
      { key: 'R', description: '再吸一次' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(hole.element));
});
