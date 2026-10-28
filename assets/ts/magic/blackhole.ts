/**
 * 黑洞
 * 光线仍沿史瓦西零测地线积分：d²u/dφ² = 3Mu² − u，u = 1/r。
 * 吸积盘是不透明薄盘，面流量用最内稳定圆轨道上的诺维科夫–索恩积分。
 * 文字和图片贴在同一个平面上绕着黑洞转。
 * 屏幕上看到的是测地线打到这一层的像，靠近光子球会被拉成弧。
 * 吸积盘仍是诺维科夫–索恩盘，花纹来自湍流，不画规则旋臂。
 */

import { ElementAnimator } from './utils/animation';
import { Disposable } from './utils/disposable';
import { DomListener, isTypingTarget, liftAuthorCard } from './utils/dom';
import { renderTips } from './utils/tips-render';

const FOV = 0.86;
const PAGE_Y = -4;
const BASE_CAM_R = 56;
const HOLD = 2.4;
const ATLAS_LIMIT = 4096;
const DEPTH_FAR = 320;
const GRAVITY = 28;
const GRAVITY_FALLOFF = 0.78;
const GRAVITY_NEAR = 60;
const GRAVITY_SOFT = 2;
const ORBIT = 1.9;
const DEBRIS_SIZE = 2048;
const DEBRIS_SPAN = 72;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uM;
uniform float uCamR;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
uniform float uEaten;
uniform float uTime;
uniform float uSpan;
uniform vec3 uBg;
uniform sampler2D uDebris;

out vec4 fragColor;

vec3 gRo;
vec3 gForward;
float gDepth;

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

void markShadow(vec3 rd) {
  float radius = max(5.19615242 * uM, 0.35);
  float b = dot(gRo, rd);
  float c = dot(gRo, gRo) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) {
    return;
  }
  float t = -b - sqrt(disc);
  if (t > 0.0) {
    gDepth = clamp(dot(rd, gForward) * t / ${DEPTH_FAR}.0, 0.0, 1.0);
  }
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
  float eaten = clamp(uEaten, 0.0, 1.0);
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
  float bAbs = 0.0;
  float by = 0.0;
  vec3 col = starfield(rd);
  bool gotDisk = false;
  bool gotPage = false;
  vec3 pageLight = vec3(0.0);
  float pageAlpha = 0.0;

  if (sinA < 0.0025) {
    if (cosA < 0.0) {
      col = vec3(0.0);
      markShadow(rd);
    }
  } else {
    bAbs = r0 * sinA / metric;
    by = (cross(ro, rd) / metric).y;
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
      float pageY = ${PAGE_Y.toFixed(1)};
      float tDisk = -1.0;
      float tPage = -1.0;
      if (y0 * y1 <= 0.0 && abs(y0 - y1) > 1e-5) {
        tDisk = clamp(y0 / (y0 - y1), 0.0, 1.0);
      }
      if ((y0 - pageY) * (y1 - pageY) <= 0.0 && abs(y0 - y1) > 1e-5) {
        tPage = clamp((y0 - pageY) / (y0 - y1), 0.0, 1.0);
      }
      for (int pass = 0; pass < 2; pass++) {
        if (done) {
          break;
        }
        float tHit = -1.0;
        bool isDisk = false;
        if (tDisk >= 0.0 && (tPage < 0.0 || tDisk <= tPage)) {
          tHit = tDisk;
          isDisk = true;
          tDisk = -1.0;
        } else if (tPage >= 0.0) {
          tHit = tPage;
          tPage = -1.0;
        }
        if (tHit < 0.0) {
          break;
        }
        float phiH = phi - dphi * (1.0 - tHit);
        vec3 hit = (cos(phiH) * e1 + sin(phiH) * e2) / max(mix(u0, u, tHit), 1e-4);
        if (isDisk && !gotDisk) {
          vec3 emit = diskGlow(hit, by);
          float luma = dot(emit, vec3(0.2126, 0.7152, 0.0722));
          if (luma > 0.05) {
            diskLight = emit;
            gotDisk = true;
            gDepth = clamp(dot(hit - gRo, gForward) / ${DEPTH_FAR}.0, 0.0, 1.0);
            done = true;
          }
        } else if (!isDisk && !gotPage) {
          vec2 uv = vec2(hit.x, -hit.z) / max(uSpan, 1.0) * 0.5 + 0.5;
          if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
            vec4 ink = texture(uDebris, uv);
            if (ink.a > 0.12) {
              float radM = length(hit.xz) / max(uM, 1e-4);
              float grav = smoothstep(24.0, 6.2, radM);
              pageLight = mix(ink.rgb, ink.rgb * vec3(1.25, 0.55, 0.2), grav);
              pageAlpha = ink.a;
              gotPage = true;
              gDepth = clamp(dot(hit - gRo, gForward) / ${DEPTH_FAR}.0, 0.0, 1.0);
              done = true;
            }
          }
        }
      }

      if (u > 1.0 / (Rs * 1.012)) {
        col = vec3(0.0);
        markShadow(rd);
        done = true;
        break;
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
    } else if (gotPage) {
      col = mix(col, pageLight, pageAlpha);
    } else if (bAbs < bCrit) {
      col = vec3(0.0);
      markShadow(rd);
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
  gRo = ro;
  gForward = forward;
  gDepth = 1.0;
  fragColor = vec4(trace(ro, rd), 1.0);
  gl_FragDepth = gDepth;
}
`;

const QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aCenter;
layout(location = 2) in vec4 aGeo;
layout(location = 3) in vec4 aUv;
layout(location = 4) in vec4 aExtra;

uniform vec2 uResolution;
uniform float uCamR;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;
uniform float uM;
uniform float uOrtho;
uniform float uSpan;

out vec2 vUv;
out float vAlpha;
out float vHeat;

void main() {
  float scale = max(aExtra.y, 0.0);
  vec2 local = (aCorner * 2.0 - 1.0) * vec2(aGeo.x, aGeo.y) * scale;
  float s = sin(aCenter.w);
  float c = cos(aCenter.w);
  vec2 spun = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec3 center = aCenter.xyz;
  vec2 rel = vec2(spun.x, -spun.y);
  float rC = length(center.xz);
  float units = rC / max(uM, 0.2);
  float pull = smoothstep(58.0, 11.0, units);
  pull = pull * pull * clamp(aExtra.z, 0.0, 1.0);
  vec3 world = vec3(center.x + rel.x, center.y, center.z + rel.y);
  if (pull > 0.04 && rC > length(rel) * 2.2) {
    vec2 dir = center.xz / rC;
    float radial = dot(rel, dir);
    float tangential = rel.x * (-dir.y) + rel.y * dir.x;
    float stretch = mix(1.0, 7.5, pull);
    float squash = mix(1.0, 0.34, pull);
    float smear = mix(0.0, 7.0, pull);
    float rP = max(0.2, rC + radial * stretch);
    float ang = atan(center.z, center.x) + (tangential * squash + radial * smear) / rC;
    world = vec3(cos(ang) * rP, center.y, sin(ang) * rP);
  }

  vUv = vec2(mix(aUv.x, aUv.z, aCorner.x), mix(aUv.y, aUv.w, aCorner.y));
  vAlpha = aGeo.z;
  vHeat = aGeo.w;
  if (vAlpha < 0.004 || scale < 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (uOrtho > 0.5) {
    gl_Position = vec4(world.x / max(uSpan, 1.0), -world.z / max(uSpan, 1.0), 0.0, 1.0);
    return;
  }

  float cp = cos(uPitch);
  float sp = sin(uPitch);
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
  vec3 relv = world - ro;
  float w = dot(relv, forward);
  if (w < 0.15) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float tanFov = tan(uFov * 0.5);
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float ndcX = dot(relv, right) / (w * tanFov * aspect);
  float ndcY = dot(relv, up) / (w * tanFov);
  float z = clamp(w / ${DEPTH_FAR}.0, 0.0, 1.0);
  gl_Position = vec4(ndcX * w, ndcY * w, z * w, w);
}
`;

const QUAD_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vUv;
in float vAlpha;
in float vHeat;
out vec4 fragColor;
void main() {
  vec4 tex = texture(uAtlas, vUv);
  float alpha = tex.a * vAlpha;
  if (alpha < 0.02) {
    discard;
  }
  vec3 tint = mix(vec3(1.0), vec3(1.2, 0.56, 0.22), clamp(vHeat, 0.0, 1.0));
  fragColor = vec4(tex.rgb * tint, alpha);
}
`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Clip {
  x: number;
  y: number;
  r: number;
  b: number;
}

interface Stamp {
  kind: 'glyph' | 'image' | 'plate';
  box: Box;
  opacity: number;
  dist: number;
  rank: number;
  pinned?: boolean;
  text?: string;
  font?: string;
  color?: string;
  decoration?: string;
  decoColor?: string;
  textX?: number;
  textY?: number;
  textH?: number;
  source?: CanvasImageSource | null;
  src?: string;
  svg?: SVGSVGElement;
  fit?: string;
  background?: string;
  gradient?: string;
  radii?: number[];
  borderWidth?: number;
  borderColor?: string;
}

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
}

interface Piece {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  homeX: number;
  homeY: number;
  homeZ: number;
  halfW: number;
  halfH: number;
  rot: number;
  spin: number;
  alpha: number;
  heat: number;
  scale: number;
  inertia: number;
  swing: number;
  infall: number;
  delay: number;
  rank: number;
  kicked: boolean;
  alive: boolean;
  pinned: boolean;
  flat: boolean;
  key: number;
  u0: number;
  vBottom: number;
  u1: number;
  vTop: number;
}

interface Scene {
  pieces: Piece[];
  atlas: HTMLCanvasElement;
  background: [number, number, number];
}

interface Grapheme {
  segment: string;
  index: number;
}

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'META', 'HEAD',
  'BR', 'WBR', 'AUDIO', 'SOURCE', 'TRACK', 'PARAM', 'OBJECT', 'EMBED',
]);

let graphemeSegmenter: { segment(input: string): Iterable<Grapheme> } | null | undefined;
const fontMetricCache = new Map<string, { ascent: number; descent: number }>();

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

function hash01(n: number): number {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967295;
}

function parseCssColor(color: string): [number, number, number] {
  const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!match) {
    return [1, 1, 1];
  }
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}

function inkOnSpace(color: string): string {
  const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
  if (!match) {
    return color;
  }
  const r = Number(match[1]) / 255;
  const g = Number(match[2]) / 255;
  const b = Number(match[3]) / 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luma >= 0.62) {
    return color;
  }
  const mix = (1 - luma / 0.62) * 0.88;
  const nr = Math.round((r + (0.96 - r) * mix) * 255);
  const ng = Math.round((g + (0.97 - g) * mix) * 255);
  const nb = Math.round((b + (1 - b) * mix) * 255);
  return `rgb(${nr}, ${ng}, ${nb})`;
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
  const match = color.match(/rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+(?:[,\s/]+([\d.]+%?))?\s*\)/);
  if (!match || match[1] === undefined) {
    return false;
  }
  const alpha = match[1].endsWith('%') ? parseFloat(match[1]) / 100 : parseFloat(match[1]);
  return !(alpha > 0.02);
}

function halfExtents(aspect: number): [number, number] {
  const dist = BASE_CAM_R - PAGE_Y;
  const halfH = dist * Math.tan(FOV * 0.5);
  return [halfH * aspect, halfH];
}

function toWorld(clientX: number, clientY: number, viewW: number, viewH: number, half: [number, number]): [number, number] {
  const x = ((clientX - viewW / 2) / (viewW / 2)) * half[0];
  const z = ((clientY - viewH / 2) / (viewH / 2)) * half[1];
  return [x, z];
}

function worldSpan(css: number, view: number, half: number): number {
  return (css / Math.max(view, 1)) * half * 2;
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

function maxTextureSize(): number {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  const max = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : ATLAS_LIMIT;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return Math.max(1024, Math.min(max > 0 ? max : ATLAS_LIMIT, ATLAS_LIMIT));
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

function isBlank(text: string): boolean {
  return !text.trim() || /^[\s\u00a0\u200b\ufeff]+$/u.test(text);
}

function graphemes(text: string): Grapheme[] {
  if (graphemeSegmenter === undefined) {
    const Ctor = (Intl as unknown as {
      Segmenter?: new (locales?: string, options?: { granularity: string }) => { segment(input: string): Iterable<Grapheme> };
    }).Segmenter;
    graphemeSegmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  }
  if (!graphemeSegmenter) {
    const out: Grapheme[] = [];
    for (let i = 0; i < text.length;) {
      const segment = String.fromCodePoint(text.codePointAt(i) ?? 0);
      out.push({ segment, index: i });
      i += segment.length;
    }
    return out;
  }
  return Array.from(graphemeSegmenter.segment(text));
}

function fontOf(style: CSSStyleDeclaration): string {
  if (style.font) {
    return style.font;
  }
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

function fontMetrics(ctx: CanvasRenderingContext2D, font: string): { ascent: number; descent: number } {
  const cached = fontMetricCache.get(font);
  if (cached) {
    return cached;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = font;
  const measured = ctx.measureText('国Hg');
  const size = Number((/([\d.]+)px/.exec(font) || [])[1]) || 16;
  const ascent = measured.fontBoundingBoxAscent || measured.actualBoundingBoxAscent || size * 0.8;
  const descent = measured.fontBoundingBoxDescent || measured.actualBoundingBoxDescent || size * 0.2;
  ctx.restore();
  const metrics = {
    ascent: ascent > 0 ? ascent : size * 0.8,
    descent: descent > 0 ? descent : size * 0.2,
  };
  fontMetricCache.set(font, metrics);
  return metrics;
}

function radiiOf(style: CSSStyleDeclaration): number[] {
  return [
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    Number.parseFloat(style.borderTopRightRadius) || 0,
    Number.parseFloat(style.borderBottomRightRadius) || 0,
    Number.parseFloat(style.borderBottomLeftRadius) || 0,
  ];
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

function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number },
  w: number,
  h: number,
  fit: string,
): void {
  const sourceW = img.naturalWidth || img.width || w;
  const sourceH = img.naturalHeight || img.height || h;
  if (!sourceW || !sourceH || (fit !== 'cover' && fit !== 'contain')) {
    ctx.drawImage(img, 0, 0, w, h);
    return;
  }
  const sourceRatio = sourceW / sourceH;
  const rectRatio = w / Math.max(h, 1);
  let dw = w;
  let dh = h;
  let dx = 0;
  let dy = 0;
  const cover = fit === 'cover';
  if ((cover && sourceRatio > rectRatio) || (!cover && sourceRatio < rectRatio)) {
    dh = h;
    dw = dh * sourceRatio;
    dx = (w - dw) / 2;
  } else {
    dw = w;
    dh = dw / sourceRatio;
    dy = (h - dh) / 2;
  }
  if (cover) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function splitTop(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === ',' && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function extractCall(input: string, name: string): string | null {
  const start = input.indexOf(`${name}(`);
  if (start < 0) {
    return null;
  }
  let depth = 1;
  const begin = start + name.length + 1;
  for (let i = begin; i < input.length; i++) {
    if (input[i] === '(') {
      depth++;
    } else if (input[i] === ')') {
      depth--;
      if (depth === 0) {
        return input.slice(begin, i);
      }
    }
  }
  return null;
}

function directionAngle(token: string): number | null {
  const value = token.trim().toLowerCase();
  if (value.endsWith('deg') || value.endsWith('turn')) {
    const amount = parseFloat(value);
    if (!Number.isFinite(amount)) {
      return null;
    }
    return value.endsWith('turn') ? amount * 360 : amount;
  }
  if (!value.startsWith('to ')) {
    return null;
  }
  let x = 0;
  let y = 0;
  for (const part of value.slice(3).split(/\s+/)) {
    if (part === 'top') y -= 1;
    else if (part === 'bottom') y += 1;
    else if (part === 'left') x -= 1;
    else if (part === 'right') x += 1;
    else return null;
  }
  if (!x && !y) {
    return null;
  }
  return Math.atan2(x, -y) * 180 / Math.PI;
}

function takeColor(token: string): { color: string; rest: string } | null {
  const trimmed = token.trim();
  if (/^(rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(/i.test(trimmed)) {
    const open = trimmed.indexOf('(');
    let depth = 0;
    for (let i = open; i < trimmed.length; i++) {
      if (trimmed[i] === '(') depth++;
      else if (trimmed[i] === ')') {
        depth--;
        if (depth === 0) {
          return { color: trimmed.slice(0, i + 1), rest: trimmed.slice(i + 1).trim() };
        }
      }
    }
    return null;
  }
  const named = /^([#a-zA-Z][\w#.%+-]*)\s*(.*)$/.exec(trimmed);
  if (!named) {
    return null;
  }
  return { color: named[1], rest: named[2].trim() };
}

function parseLinearGradient(input: string): { angle: number; stops: Array<{ color: string; at: number }> } | null {
  const body = extractCall(input, 'linear-gradient');
  if (!body) {
    return null;
  }
  const parts = splitTop(body);
  if (!parts.length) {
    return null;
  }
  let angle = 180;
  let index = 0;
  const direction = directionAngle(parts[0]);
  if (direction !== null) {
    angle = direction;
    index = 1;
  }
  const stops: Array<{ color: string; at: number }> = [];
  for (; index < parts.length; index++) {
    const taken = takeColor(parts[index]);
    if (!taken) {
      continue;
    }
    let at = -1;
    if (taken.rest.endsWith('%')) {
      at = parseFloat(taken.rest) / 100;
    }
    stops.push({ color: taken.color, at });
  }
  if (stops.length < 2) {
    return null;
  }
  const missing = stops.filter((stop) => !(stop.at >= 0));
  if (missing.length === stops.length) {
    stops.forEach((stop, stopIndex) => {
      stop.at = stops.length === 1 ? 0 : stopIndex / (stops.length - 1);
    });
  } else {
    stops.forEach((stop, stopIndex) => {
      if (stop.at < 0) {
        stop.at = stopIndex / (stops.length - 1);
      }
    });
  }
  return { angle, stops };
}

function paintGradient(ctx: CanvasRenderingContext2D, w: number, h: number, gradient: string): boolean {
  const parsed = parseLinearGradient(gradient);
  if (!parsed) {
    return false;
  }
  const rad = parsed.angle * Math.PI / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
  const gradientFill = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  try {
    for (const stop of parsed.stops) {
      gradientFill.addColorStop(clamp(stop.at, 0, 1), stop.color);
    }
  } catch {
    return false;
  }
  ctx.fillStyle = gradientFill;
  ctx.fillRect(0, 0, w, h);
  return true;
}

function clipsOverflow(style: CSSStyleDeclaration): boolean {
  const clips = (value: string) => value === 'hidden' || value === 'clip' || value === 'scroll' || value === 'auto';
  return clips(style.overflowX) || clips(style.overflowY);
}

function intersectClip(outer: Clip | null, inner: Clip | null): Clip | null {
  if (!outer) {
    return inner;
  }
  if (!inner) {
    return outer;
  }
  const x = Math.max(outer.x, inner.x);
  const y = Math.max(outer.y, inner.y);
  const r = Math.min(outer.r, inner.r);
  const b = Math.min(outer.b, inner.b);
  if (r - x < 1 || b - y < 1) {
    return { x, y, r: x, b: y };
  }
  return { x, y, r, b };
}

function cropBox(box: Box, clip: Clip | null): Box | null {
  if (!clip) {
    return box;
  }
  const x = Math.max(box.x, clip.x);
  const y = Math.max(box.y, clip.y);
  const r = Math.min(box.x + box.w, clip.r);
  const b = Math.min(box.y + box.h, clip.b);
  if (r - x < 0.8 || b - y < 0.8) {
    return null;
  }
  return { x, y, w: r - x, h: b - y };
}

function boxOf(rect: DOMRect): Box | null {
  if (rect.width < 0.8 || rect.height < 0.8) {
    return null;
  }
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

function skippedElement(el: Element): boolean {
  if (!(el instanceof HTMLElement)) {
    return el.tagName === 'SVG' ? false : SKIP_TAGS.has(el.tagName);
  }
  if (el.id === 'author-card' || el.dataset.magicBlackhole !== undefined || el.dataset.magicAuthorPlaceholder !== undefined) {
    return true;
  }
  return SKIP_TAGS.has(el.tagName);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 900);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(imageIsClean(image) ? image : null);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = src;
  });
}

async function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
  const rect = svg.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return null;
  }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(rect.width));
  clone.setAttribute('height', String(rect.height));
  const color = getComputedStyle(svg).color;
  let xml = new XMLSerializer().serializeToString(clone);
  if (color) {
    xml = xml.replace(/currentColor/g, color);
  }
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
}

async function ensureImage(image: HTMLImageElement): Promise<HTMLImageElement | null> {
  if (!(image.complete && image.naturalWidth > 0)) {
    try {
      await Promise.race([
        image.decode(),
        new Promise((resolve) => window.setTimeout(resolve, 700)),
      ]);
    } catch {
      // 解码失败就当这张图不存在。
    }
  }
  return image.complete && image.naturalWidth > 0 && imageIsClean(image) ? image : null;
}

function collectStamps(viewW: number, viewH: number): Stamp[] {
  const stamps: Stamp[] = [];
  const range = document.createRange();
  let rank = 0;
  let stopped = false;

  const distance = (box: Box) => {
    const dx = box.x + box.w / 2 - viewW / 2;
    const dy = box.y + box.h / 2 - viewH / 2;
    return dx * dx + dy * dy;
  };

  const push = (stamp: Stamp) => {
    if (stopped) {
      return;
    }
    stamp.rank = rank++;
    stamp.dist = distance(stamp.box);
    stamps.push(stamp);
    if (stamps.length >= 18000) {
      stopped = true;
    }
  };

  const visit = (el: Element, opacity: number, clip: Clip | null) => {
    if (stopped || skippedElement(el)) {
      return;
    }
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden') {
      return;
    }
    const own = Number.parseFloat(style.opacity);
    const nextOpacity = opacity * (Number.isFinite(own) ? own : 1);
    if (nextOpacity < 0.02) {
      return;
    }
    if (style.display === 'contents') {
      for (const child of el.childNodes) {
        if (child instanceof Element) {
          visit(child, nextOpacity, clip);
        }
      }
      return;
    }

    let nextClip = clip;
    if (el !== document.body && el !== document.documentElement && clipsOverflow(style)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        nextClip = intersectClip(clip, { x: rect.left, y: rect.top, r: rect.right, b: rect.bottom });
      }
    }

    const tag = el.tagName;
    const rect = el.getBoundingClientRect();
    const full = boxOf(rect);
    const visible = full ? cropBox(full, nextClip) : null;
    const radii = radiiOf(style);

    if (tag === 'IMG' && el instanceof HTMLImageElement && visible) {
      push({
        kind: 'image',
        box: visible,
        opacity: nextOpacity,
        dist: 0,
        rank: 0,
        source: el,
        fit: style.objectFit || 'fill',
        radii,
      });
      return;
    }
    if (tag === 'CANVAS' && el instanceof HTMLCanvasElement && visible && el.width > 0 && imageIsClean(el)) {
      push({
        kind: 'image',
        box: visible,
        opacity: nextOpacity,
        dist: 0,
        rank: 0,
        source: el,
        fit: 'fill',
        radii,
      });
      return;
    }
    if (tag === 'VIDEO' && el instanceof HTMLVideoElement && visible && el.readyState >= 2 && imageIsClean(el)) {
      push({
        kind: 'image',
        box: visible,
        opacity: nextOpacity,
        dist: 0,
        rank: 0,
        source: el,
        fit: style.objectFit || 'fill',
        radii,
      });
      return;
    }
    if (tag === 'SVG' && el instanceof SVGSVGElement && visible) {
      push({
        kind: 'image',
        box: visible,
        opacity: nextOpacity,
        dist: 0,
        rank: 0,
        svg: el,
        fit: 'fill',
        radii,
      });
      return;
    }
    if (tag === 'SELECT' || tag === 'IFRAME') {
      return;
    }
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && visible && el.value) {
      push({
        kind: 'glyph',
        box: visible,
        opacity: nextOpacity,
        dist: 0,
        rank: 0,
        text: el.value,
        font: fontOf(style),
        color: inkOnSpace(style.color),
        textX: 0,
        textY: 0,
        textH: visible.h,
        decoration: 'none',
      });
      return;
    }

    for (const child of el.childNodes) {
      if (stopped) {
        return;
      }
      if (child instanceof Element) {
        visit(child, nextOpacity, nextClip);
      } else if (child instanceof Text) {
        paintTextNode(child, style, nextOpacity, nextClip);
      }
    }
  };

  const paintTextNode = (node: Text, style: CSSStyleDeclaration, opacity: number, clip: Clip | null) => {
    const raw = node.data;
    if (!raw || isBlank(raw)) {
      return;
    }
    const font = fontOf(style);
    const decoration = style.textDecorationLine || '';
    for (const part of graphemes(raw)) {
      if (stopped || isBlank(part.segment)) {
        continue;
      }
      try {
        range.setStart(node, part.index);
        range.setEnd(node, part.index + part.segment.length);
      } catch {
        continue;
      }
      const full = boxOf(range.getBoundingClientRect());
      if (!full) {
        continue;
      }
      const visible = cropBox(full, clip);
      if (!visible) {
        continue;
      }
      push({
        kind: 'glyph',
        box: visible,
        opacity,
        dist: 0,
        rank: 0,
        text: part.segment,
        font,
        color: inkOnSpace(style.color),
        decoration,
        decoColor: inkOnSpace(style.textDecorationColor || style.color),
        textX: full.x - visible.x,
        textY: full.y - visible.y,
        textH: full.h,
      });
    }
  };

  visit(document.body, 1, null);
  return stamps;
}

class Shelf {
  private x = 1;
  private y = 1;
  private rowH = 0;

  constructor(private size: number) {}

  alloc(w: number, h: number): { x: number; y: number } | null {
    const gw = w + 2;
    const gh = h + 2;
    if (gw > this.size - 2 || gh > this.size - 2) {
      return null;
    }
    if (this.x + gw > this.size - 1) {
      this.x = 1;
      this.y += this.rowH;
      this.rowH = 0;
    }
    if (this.y + gh > this.size - 1) {
      return null;
    }
    const pos = { x: this.x, y: this.y };
    this.x += gw;
    this.rowH = Math.max(this.rowH, gh);
    return pos;
  }
}

function rasterSize(cssW: number, cssH: number, scale: number, cap: number): { w: number; h: number; s: number } | null {
  if (cssW < 0.5 || cssH < 0.5) {
    return null;
  }
  let s = scale;
  let w = Math.ceil(cssW * s);
  let h = Math.ceil(cssH * s);
  const edge = Math.max(w, h);
  if (edge > cap) {
    s *= cap / edge;
    w = Math.max(1, Math.ceil(cssW * s));
    h = Math.max(1, Math.ceil(cssH * s));
  }
  return { w, h, s };
}

function slotSize(stamp: Stamp, scale: number): { w: number; h: number; s: number } | null {
  if (stamp.pinned) {
    return { w: 8, h: 8, s: 1 };
  }
  const cap = stamp.kind === 'glyph' ? 200 : stamp.kind === 'image' ? 720 : 480;
  return rasterSize(stamp.box.w, stamp.box.h, scale, cap);
}

function layoutStamps(stamps: Stamp[], scale: number, atlas: number): Array<Slot | null> | null {
  const shelf = new Shelf(atlas);
  const slots: Array<Slot | null> = [];
  for (const stamp of stamps) {
    const size = slotSize(stamp, scale);
    if (!size) {
      slots.push(null);
      continue;
    }
    const pos = shelf.alloc(size.w, size.h);
    if (!pos) {
      return null;
    }
    slots.push({ ...pos, ...size });
  }
  return slots;
}

function bleed(ctx: CanvasRenderingContext2D, slots: Slot[], atlas: number): void {
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, atlas, atlas);
  } catch {
    return;
  }
  const data = image.data;
  for (const slot of slots) {
    const x0 = Math.max(1, slot.x - 1);
    const y0 = Math.max(1, slot.y - 1);
    const x1 = Math.min(atlas - 2, slot.x + slot.w);
    const y1 = Math.min(atlas - 2, slot.y + slot.h);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const index = (y * atlas + x) * 4;
        if (data[index + 3] > 16) {
          continue;
        }
        let found = false;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sample = ((y + dy) * atlas + (x + dx)) * 4;
            if (data[sample + 3] > 28) {
              data[index] = data[sample];
              data[index + 1] = data[sample + 1];
              data[index + 2] = data[sample + 2];
              found = true;
              break;
            }
          }
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

function paintStamp(ctx: CanvasRenderingContext2D, stamp: Stamp, slot: Slot): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(slot.x - 1, slot.y - 1, slot.w + 2, slot.h + 2);
  ctx.clip();
  ctx.globalAlpha = clamp(stamp.opacity, 0, 1);
  if (stamp.pinned) {
    ctx.fillStyle = stamp.background || '#fff';
    ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
    ctx.restore();
    return;
  }
  ctx.setTransform(slot.s, 0, 0, slot.s, slot.x, slot.y);
  const w = stamp.box.w;
  const h = stamp.box.h;
  const radii = stamp.radii || [0, 0, 0, 0];
  const rounded = radii.some((radius) => radius > 0.5);
  if (rounded) {
    roundedPath(ctx, 0, 0, w, h, radii);
    ctx.clip();
  }
  if (stamp.kind === 'glyph' && stamp.text && stamp.font && stamp.color) {
    const metrics = fontMetrics(ctx, stamp.font);
    const textH = stamp.textH || h;
    const baseline = clamp((textH - metrics.ascent - metrics.descent) / 2 + metrics.ascent, 1, Math.max(1, textH - 1));
    ctx.font = stamp.font;
    ctx.fillStyle = stamp.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const x = stamp.textX || 0;
    const y = (stamp.textY || 0) + baseline;
    ctx.fillText(stamp.text, x, y);
    const decoration = stamp.decoration || '';
    if (decoration.includes('underline') || decoration.includes('line-through')) {
      const size = Number((/([\d.]+)px/.exec(stamp.font) || [])[1]) || h;
      const thickness = Math.max(1, size / 14);
      ctx.fillStyle = stamp.decoColor || stamp.color;
      if (decoration.includes('underline')) {
        ctx.fillRect(x, y + thickness, w, thickness);
      }
      if (decoration.includes('line-through')) {
        ctx.fillRect(x, y - metrics.ascent * 0.35, w, thickness);
      }
    }
  } else {
    if (stamp.background && !transparent(stamp.background)) {
      ctx.fillStyle = stamp.background;
      ctx.fillRect(0, 0, w, h);
    }
    if (stamp.gradient) {
      paintGradient(ctx, w, h, stamp.gradient);
    }
    if (stamp.source && imageIsClean(stamp.source)) {
      try {
        drawFitted(ctx, stamp.source, w, h, stamp.fit || 'fill');
      } catch {
        // 这张图画不出来就留白色或透明。
      }
    }
    if ((stamp.borderWidth || 0) > 0 && stamp.borderColor && !transparent(stamp.borderColor)) {
      ctx.strokeStyle = stamp.borderColor;
      ctx.lineWidth = stamp.borderWidth || 1;
      roundedPath(ctx, 0, 0, w, h, radii);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function pieceFrom(stamp: Stamp, slot: Slot, atlas: number, viewW: number, viewH: number, half: [number, number], index: number): Piece {
  const [x, z] = toWorld(stamp.box.x + stamp.box.w / 2, stamp.box.y + stamp.box.h / 2, viewW, viewH, half);
  const fullW = worldSpan(stamp.box.w, viewW, half[0]);
  const fullH = worldSpan(stamp.box.h, viewH, half[1]);
  const area = Math.max(fullW * fullH, 1e-4);
  const bulk = Math.sqrt(area);
  const roll = hash01(index * 3 + 1);
  const swingRoll = hash01(index * 3 + 2);
  const infallRoll = hash01(index * 3 + 5);
  const y = PAGE_Y;
  let inertia = 1;
  let swing = 0.9;
  let infall = 0.28;
  if (stamp.kind === 'glyph') {
    inertia = 0.92 + infallRoll * 0.16;
    swing = 0.86 + swingRoll * 0.28;
    infall = 0.22 + roll * 0.12;
  } else if (stamp.kind === 'image') {
    inertia = clamp(bulk / 0.8, 1.15, 1.8);
    swing = 0.9 + swingRoll * 0.16;
    infall = 0.2 + roll * 0.08;
  }
  const u0 = slot.x / atlas;
  const u1 = (slot.x + slot.w) / atlas;
  const vTop = 1 - slot.y / atlas;
  const vBottom = 1 - (slot.y + slot.h) / atlas;
  return {
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    homeX: x, homeY: y, homeZ: z,
    halfW: fullW / 2,
    halfH: fullH / 2,
    rot: 0,
    spin: 0,
    alpha: 1,
    heat: 0,
    scale: 1,
    inertia,
    swing,
    infall,
    delay: 0,
    rank: stamp.rank,
    kicked: false,
    alive: true,
    pinned: false,
    flat: true,
    key: 0,
    u0, vBottom, u1, vTop,
  };
}

function pull(r: number, strength: number): number {
  const far = GRAVITY / Math.pow(Math.max(r, 0.6), GRAVITY_FALLOFF);
  const near = GRAVITY_NEAR / (r * r + GRAVITY_SOFT * GRAVITY_SOFT);
  return strength * (far + near);
}

function resetPiece(piece: Piece): void {
  piece.x = piece.homeX;
  piece.y = piece.homeY;
  piece.z = piece.homeZ;
  piece.vx = 0;
  piece.vy = 0;
  piece.vz = 0;
  piece.rot = 0;
  piece.kicked = false;
  piece.alive = true;
  piece.alpha = 1;
  piece.heat = 0;
  piece.scale = 1;
}

function integrate(piece: Piece, dt: number, elapsed: number, strength: number, mass: number): void {
  piece.y = PAGE_Y;
  piece.vy = 0;
  if (!piece.alive) {
    piece.alpha = 0;
    piece.scale = 0;
    return;
  }
  if (elapsed < HOLD + piece.delay || strength <= 0) {
    piece.alpha = 1;
    piece.scale = 1;
    piece.heat = 0;
    piece.vx = 0;
    piece.vz = 0;
    return;
  }

  const planar = Math.hypot(piece.x, piece.z);
  const inner = Math.max(1.15, mass * 3.2);
  if (planar < inner) {
    piece.alive = false;
    piece.alpha = 0;
    piece.scale = 0;
    piece.vx = 0;
    piece.vz = 0;
    return;
  }

  const mag = pull(planar, strength) / piece.inertia;
  const vCirc = Math.sqrt(Math.max(mag, 0) * planar);
  const rx = piece.x / planar;
  const rz = piece.z / planar;
  const tx = -rz;
  const tz = rx;
  const vTang = vCirc * ORBIT * piece.swing;
  const vRad = -vCirc * piece.infall;
  const wantX = vRad * rx + vTang * tx;
  const wantZ = vRad * rz + vTang * tz;
  piece.vx = wantX;
  piece.vz = wantZ;
  piece.x += piece.vx * dt;
  piece.z += piece.vz * dt;
  piece.rot += (vTang / planar) * dt;
  piece.kicked = true;

  if (!Number.isFinite(piece.x) || !Number.isFinite(piece.z)) {
    piece.alive = false;
    piece.alpha = 0;
    piece.scale = 0;
    return;
  }
  const radius = Math.hypot(piece.x, piece.z);
  const outer = Math.max(3.2, mass * 6.4);
  const swallowed = smoothstep(outer, inner, radius);
  piece.alpha = 1 - swallowed;
  piece.scale = mix(1, 0.35, smoothstep(7, inner, radius));
  piece.heat = smoothstep(10, inner, radius);
  if (swallowed > 0.985) {
    piece.alive = false;
    piece.alpha = 0;
    piece.scale = 0;
  }
}

async function buildScene(): Promise<Scene> {
  const viewW = window.innerWidth;
  const viewH = Math.max(1, window.innerHeight);
  const half = halfExtents(viewW / viewH);
  const background = pageBackground();
  const collected = collectStamps(viewW, viewH);
  await Promise.all(collected.map(async (stamp) => {
    if (stamp.kind === 'image' && stamp.source instanceof HTMLImageElement) {
      stamp.source = await ensureImage(stamp.source);
    } else if (stamp.svg) {
      stamp.source = await svgImage(stamp.svg);
      stamp.svg = undefined;
    }
    if (stamp.src) {
      const image = await loadImage(stamp.src);
      if (image) {
        stamp.source = image;
      }
      stamp.src = undefined;
    }
  }));
  const stamps = collected.filter((stamp) => stamp.kind === 'glyph' || (stamp.kind === 'image' && !!stamp.source));

  let content = stamps.sort((a, b) => a.dist - b.dist);
  if (content.length > 14000) {
    content = content.slice(0, 14000);
  }
  const atlasSize = maxTextureSize();
  let scale = Math.min(window.devicePixelRatio || 1, 1.75);
  let slots: Array<Slot | null> | null = null;
  let packed: Stamp[] = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    packed = content;
    slots = layoutStamps(packed, scale, atlasSize);
    if (slots) {
      break;
    }
    if (content.length > 48) {
      content = content.slice(0, Math.floor(content.length * 0.8));
    } else {
      scale *= 0.68;
    }
  }
  if (!slots) {
    throw new Error('页面碎片装不进贴图');
  }

  const atlas = document.createElement('canvas');
  atlas.width = atlasSize;
  atlas.height = atlasSize;
  const ctx = atlas.getContext('2d', { willReadFrequently: true, alpha: true });
  if (!ctx) {
    throw new Error('无法绘制页面碎片');
  }
  ctx.clearRect(0, 0, atlasSize, atlasSize);
  const bleedSlots: Slot[] = [];
  slots.forEach((slot, index) => {
    if (!slot) {
      return;
    }
    const stamp = packed[index];
    try {
      paintStamp(ctx, stamp, slot);
    } catch (error) {
      console.warn('有一块页面碎片没画上', error);
    }
    if (!stamp.pinned) {
      bleedSlots.push(slot);
    }
  });
  bleed(ctx, bleedSlots, atlasSize);

  const pieces: Piece[] = [];
  slots.forEach((slot, index) => {
    if (!slot) {
      return;
    }
    pieces.push(pieceFrom(packed[index], slot, atlasSize, viewW, viewH, half, index));
  });
  return { pieces, atlas, background };
}

class BlackHole extends Disposable {
  readonly element: HTMLCanvasElement;
  readonly ready: Promise<void>;
  disposed = false;

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private quadProgram: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private debrisTex: WebGLTexture | null = null;
  private debrisFbo: WebGLFramebuffer | null = null;
  private holeVao: WebGLVertexArrayObject | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private pieces: Piece[] = [];
  private order: number[] = [];
  private instanceData = new Float32Array(0);
  private background: [number, number, number] = [1, 1, 1];
  private animationId: number | null = null;
  private running = false;
  private lastTime = 0;
  private elapsed = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private zoom = 0;
  private holeLocations = new Map<string, WebGLUniformLocation | null>();
  private quadLocations = new Map<string, WebGLUniformLocation | null>();
  private prevOverflow = '';

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
    this.ready = this.boot();
  }

  restart(): void {
    this.elapsed = 0;
    this.zoom = 0;
    for (const piece of this.pieces) {
      resetPiece(piece);
    }
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
      if (this.program) gl.deleteProgram(this.program);
      if (this.quadProgram) gl.deleteProgram(this.quadProgram);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.debrisTex) gl.deleteTexture(this.debrisTex);
      if (this.debrisFbo) gl.deleteFramebuffer(this.debrisFbo);
      if (this.holeVao) gl.deleteVertexArray(this.holeVao);
      if (this.quadVao) gl.deleteVertexArray(this.quadVao);
      if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.element.remove();
    super.dispose();
  }

  private async boot(): Promise<void> {
    try {
      document.documentElement.style.overflow = 'hidden';
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      if (this.disposed) {
        return;
      }
      const scene = await buildScene();
      if (this.disposed) {
        return;
      }
      this.pieces = scene.pieces;
      this.order = this.pieces.map((_, index) => index);
      this.instanceData = new Float32Array(Math.max(1, this.pieces.length) * 16);
      this.background = scene.background;
      const parent = document.querySelector('.single-container') ?? document.body;
      parent.appendChild(this.element);
      this.gl = this.element.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      });
      if (!this.gl) {
        throw new Error('WebGL2 不可用');
      }
      const gl = this.gl;
      this.program = link(gl, VERT, FRAG);
      this.quadProgram = link(gl, QUAD_VERT, QUAD_FRAG);
      for (const name of ['uResolution', 'uM', 'uCamR', 'uYaw', 'uPitch', 'uFov', 'uEaten', 'uTime', 'uSpan', 'uBg', 'uDebris']) {
        this.holeLocations.set(name, gl.getUniformLocation(this.program, name));
      }
      for (const name of ['uAtlas', 'uResolution', 'uCamR', 'uYaw', 'uPitch', 'uFov', 'uM', 'uOrtho', 'uSpan']) {
        this.quadLocations.set(name, gl.getUniformLocation(this.quadProgram, name));
      }
      this.debrisTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.debrisTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DEBRIS_SIZE, DEBRIS_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.debrisFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.debrisFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.debrisTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.holeVao = gl.createVertexArray();
      this.quadVao = gl.createVertexArray();
      this.instanceBuffer = gl.createBuffer();
      const corners = gl.createBuffer();
      gl.bindVertexArray(this.quadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 1, 1,
        0, 0, 1, 1, 0, 1,
      ]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
      const stride = 16 * 4;
      for (let location = 1; location <= 4; location++) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, (location - 1) * 16);
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindVertexArray(null);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene.atlas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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
      this.draw(0);
      this.animationId = requestAnimationFrame(this.frame);
    } catch (error) {
      console.error('黑洞没能启动', error);
      this.dispose();
    }
  }

  private resize = (): void => {
    const gl = this.gl;
    if (!gl) {
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
  };

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
    this.draw(dt);
    this.animationId = requestAnimationFrame(this.frame);
  };

  private draw(dt: number): void {
    const gl = this.gl;
    const program = this.program;
    const quadProgram = this.quadProgram;
    if (!gl || !program || !quadProgram) {
      return;
    }
    const grow = smoothstep(HOLD - 0.2, HOLD + 4.2, this.elapsed);
    const eaten = smoothstep(HOLD + 0.35, HOLD + 6.2, this.elapsed);
    const cine = smoothstep(HOLD + 0.45, HOLD + 8.2, this.elapsed);
    const gain = smoothstep(HOLD, HOLD + 0.9, this.elapsed);
    const mass = mix(0.2, 1, grow);
    const strength = gain * mix(0.8, 1, mass);
    const tilt = clamp(mix(0, 1.32, cine) + this.lookPitch, 0, 1.48);
    const yaw = this.lookYaw;
    const camR = clamp(mix(BASE_CAM_R, 118, cine) + this.zoom, 28, 180);
    for (const piece of this.pieces) {
      integrate(piece, dt, this.elapsed, strength, mass);
    }
    const count = this.writeInstances(yaw, tilt, camR);
    this.renderDebris(count, mass);

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(this.holeVao);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    const set1f = (name: string, value: number) => gl.uniform1f(this.holeLocations.get(name) ?? null, value);
    set1f('uM', mass);
    set1f('uCamR', camR);
    set1f('uYaw', yaw);
    set1f('uPitch', tilt);
    set1f('uFov', FOV);
    set1f('uEaten', eaten);
    set1f('uTime', this.elapsed);
    set1f('uSpan', DEBRIS_SPAN);
    gl.uniform2f(this.holeLocations.get('uResolution') ?? null, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform3f(this.holeLocations.get('uBg') ?? null, this.background[0], this.background[1], this.background[2]);
    gl.uniform1i(this.holeLocations.get('uDebris') ?? null, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.debrisTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private renderDebris(count: number, mass: number): void {
    const gl = this.gl;
    const quadProgram = this.quadProgram;
    if (!gl || !quadProgram || !this.debrisFbo) {
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.debrisFbo);
    gl.viewport(0, 0, DEBRIS_SIZE, DEBRIS_SIZE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    if (count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(quadProgram);
      gl.bindVertexArray(this.quadVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(this.quadLocations.get('uAtlas') ?? null, 0);
      gl.uniform1f(this.quadLocations.get('uM') ?? null, mass);
      gl.uniform1f(this.quadLocations.get('uOrtho') ?? null, 1);
      gl.uniform1f(this.quadLocations.get('uSpan') ?? null, DEBRIS_SPAN);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
  }

  private writeInstances(yaw: number, pitch: number, camR: number): number {
    const gl = this.gl;
    if (!gl || !this.instanceBuffer) {
      return 0;
    }
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    const fx = -sp * sy;
    const fy = -cp;
    const fz = -sp * cy;
    const rox = -fx * camR;
    const roy = -fy * camR;
    const roz = -fz * camR;
    const pieces = this.pieces;
    let alive = 0;
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece.alpha <= 0.004 || piece.scale <= 0.001) {
        continue;
      }
      const w = (piece.x - rox) * fx + (piece.y - roy) * fy + (piece.z - roz) * fz;
      piece.key = w - piece.rank * 1e-3;
      this.order[alive++] = i;
    }
    const order = this.order;
    order.length = alive;
    order.sort((a, b) => pieces[b].key - pieces[a].key);
    const data = this.instanceData;
    for (let i = 0; i < alive; i++) {
      const piece = pieces[order[i]];
      const offset = i * 16;
      data[offset] = piece.x;
      data[offset + 1] = piece.y;
      data[offset + 2] = piece.z;
      data[offset + 3] = piece.rot;
      data[offset + 4] = piece.halfW;
      data[offset + 5] = piece.halfH;
      data[offset + 6] = piece.alpha;
      data[offset + 7] = piece.heat;
      data[offset + 8] = piece.u0;
      data[offset + 9] = piece.vBottom;
      data[offset + 10] = piece.u1;
      data[offset + 11] = piece.vTop;
      data[offset + 12] = piece.flat ? 1 : 0;
      data[offset + 13] = piece.scale;
      data[offset + 14] = piece.halfW * piece.halfH > 4 ? 0.22 : 1;
      data[offset + 15] = 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, alive * 16));
    return alive;
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
    description: '文字贴在同一个平面上绕进去，靠近光子球会被光线拉成弧。吸积盘内缘发白，外侧顺着流量变暗，朝向你转的一侧更亮。',
    operations: [
      { key: '移动', description: '绕到侧面看吸积盘' },
      { key: '滚轮', description: '靠近或退远' },
      { key: 'R', description: '再吸一次' },
    ],
  });

  onDeactivate(() => ElementAnimator.hide(hole.element));
});
