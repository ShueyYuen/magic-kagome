/** @see https://zhuanlan.zhihu.com/p/668295374 */
/** @see https://soundquest.jp/quest/rhythm/rhythm-mv2/envelope1/ */

import { ElementAnimator } from './utils/animation';
import { CanvasManager } from './utils/canvas';
import { DOMEmitter } from './utils/dom';
import { Disposable, IDisposable } from './utils/disposable';
import { BaseEvent, Emitter } from './utils/emitter';
import { renderTips } from './utils/tips-render';

// #region Global Variables
enum PianoKeyShape {
  WHITE,
  BLACK,
}

const WHITE_KET_COUNT = 52;
const KEY_PATTERN = [
  PianoKeyShape.WHITE, PianoKeyShape.BLACK, PianoKeyShape.WHITE, PianoKeyShape.BLACK,
  PianoKeyShape.WHITE, PianoKeyShape.WHITE, PianoKeyShape.BLACK, PianoKeyShape.WHITE,
  PianoKeyShape.BLACK, PianoKeyShape.WHITE, PianoKeyShape.BLACK, PianoKeyShape.WHITE
];
const KEYBOARD_PATTERN = [
  'KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD',
  'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH',
  'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL',
  'KeyP', 'Semicolon', 'Quote', 'BracketRight',
  'Enter', 'Backslash'
]
const NOTE_COLORS = [
  "#E33059", "#F75839", "#F7943D", "#F3B72F",
  "#EDD929", "#95C631", "#56A754", "#11826D",
  "#3160A3", "#5B37CC", "#A347BF", "#EA57B2"
]
const PATTERN_BIAS = 9;
const PIANO_KEY_COUNTS = 88;
const CENTER_C_POSITION = 39;

const RATIO = 0.08;
const DISPLAY_OPACITY = '0.6';
const MIN_KEY_SIZE = 8;
// #endregion

class SoundGenerator implements IDisposable {
  static TWELVE_TET = 12;

  static readonly INSTANCE = new SoundGenerator();

  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer | null = null;

  public isReady: Promise<void>;

  private constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.isReady = fetch('/magic/piano.mp3')
      .then((response) => response.arrayBuffer())
      .then((data) => this.audioContext.decodeAudioData(data))
      .then((buffer) => {
        this.audioBuffer = buffer;
      })
      .catch((error) => console.error('Error loading sounds:', error));
  }

  public getSound(frequency: number) {
    if (!this.audioBuffer) {
      throw new Error('Sounds not loaded yet');
    }
    const bufferSource = this.audioContext.createBufferSource();
    bufferSource.buffer = this.audioBuffer;
    bufferSource.playbackRate.value = frequency;

    bufferSource.connect(this.audioContext.destination);
    return bufferSource;
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null!;
    }
  }
}

class Piano extends Disposable {
  keys: PianoKey[] = [];

  private damperPedal: DamperPedal = null!;
  private keyReleaseMap: Map<string, PianoKey> = new Map();
  private keyControlIndex = CENTER_C_POSITION;
  private needsRedraw = true;

  constructor(
    keydownEmitter: DOMEmitter<'keydown'>,
    keyupEmitter: DOMEmitter<'keyup'>
  ) {
    super();
    this._register(keydownEmitter.event(this.handleKeyDown.bind(this)));
    this._register(keyupEmitter.event(this.handleKeyUp.bind(this)));
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.repeat) {
      return;
    }
    if (e.code === 'KeyZ') {
      this.keyControlIndex -= KEY_PATTERN.length;
      if (this.keyControlIndex + PATTERN_BIAS < 0) {
        this.keyControlIndex = -PATTERN_BIAS;
      }
      this.needsRedraw = true;
      return;
    }
    if (e.code === 'KeyX') {
      this.keyControlIndex += KEY_PATTERN.length;
      if (this.keyControlIndex - PATTERN_BIAS > PIANO_KEY_COUNTS) {
        this.keyControlIndex = PIANO_KEY_COUNTS - PATTERN_BIAS;
      }
      this.needsRedraw = true;
      return;
    }
    const key = KEYBOARD_PATTERN.indexOf(e.code);
    if (key === -1) {
      return;
    }
    const pianoKey = this.keys[key + this.keyControlIndex];
    if (pianoKey) {
      pianoKey.down();
      this.keyReleaseMap.set(e.code, pianoKey);
      this.needsRedraw = true;
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    const toRelease = this.keyReleaseMap.get(e.code);
    if (!toRelease) {
      return;
    }
    toRelease.up();
    this.keyReleaseMap.delete(e.code);
    this.needsRedraw = true;
  }

  setDamperPedal(damperPedal: DamperPedal) {
    if (this.damperPedal) {
      throw new Error("Damper pedal already set");
    }
    this.damperPedal = this._register(damperPedal);
  }

  addKey(key: PianoKey) {
    this._register(key);
    this.keys.push(key);
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
    if (!this.needsRedraw) {
      return;
    }
    ctx.clearRect(x, y, width, height);
    const nextDraw: Array<[PianoKey, any]> = [];
    const whiteWidth = width / WHITE_KET_COUNT;
    const blackKeyWidth = whiteWidth * 0.5;
    const blackKeyHeight = height * 0.7;
    let current = 0;
    this.keys.forEach((key) => {
      if (key.shape === PianoKeyShape.WHITE) {
        key.draw(ctx, current, whiteWidth, height);
        current += whiteWidth;
      } else {
        nextDraw.push([key, { x: current - blackKeyWidth / 2, width: blackKeyWidth, height: blackKeyHeight }]);
      }
    });
    nextDraw.forEach(([key, { x, width, height }]) => key.draw(ctx, x, width, height));

    this.applyGradientMask(ctx, width, height);

    this.needsRedraw = false;
  }

  private applyGradientMask(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    const gradient = ctx.createLinearGradient(0, 0, 0, height);

    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');  // 顶部完全透明
    gradient.addColorStop(1, 'rgba(255, 255, 255, 1)');  // 底部完全不透明

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  requestRedraw(): void {
    this.needsRedraw = true;
  }

  public dispose(): void {
    super.dispose();
    this.keyReleaseMap.clear();
  }
}

class DamperPedal extends Disposable {
  private _isPressed = false;
  public get isPressed() {
    return this._isPressed;
  }

  private pressEmitter: Emitter<void>;
  get onPress(): BaseEvent<void> {
    return this.pressEmitter.event;
  }

  private releaseEmitter: Emitter<void>;
  get onRelease(): BaseEvent<void> {
    return this.releaseEmitter.event;
  }

  constructor(
    keydownEmitter: DOMEmitter<'keydown'>,
    keyupEmitter: DOMEmitter<'keyup'>
  ) {
    super();
    this._register(keydownEmitter.event(this.handleKeyDown.bind(this)));
    this._register(keyupEmitter.event((this.handleKeyUp.bind(this))));
    this.pressEmitter = this._register(new Emitter<void>());
    this.releaseEmitter = this._register(new Emitter<void>());
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.repeat) {
      return;
    }
    if (e.code === 'ShiftLeft') {
      this._isPressed = true;
      this.pressEmitter.fire();
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'ShiftLeft') {
      this._isPressed = false;
      this.releaseEmitter.fire();
    }
  }
}

class PianoKey extends Disposable {
  public readonly frequency: number;

  private sound: AudioBufferSourceNode | null = null;

  private _isPressed = false;
  public get isPressed() {
    return this._isPressed;
  }

  private isAttachedToDamper = false;

  constructor(
    public shape: PianoKeyShape,
    public color: string,
    TET: number,
    private damperPedal: DamperPedal
  ) {
    super();
    this.frequency = Math.pow(2, TET / SoundGenerator.TWELVE_TET);

    this._register(this.damperPedal.onPress(this.handleDamperPress.bind(this)));
    this._register(this.damperPedal.onRelease(this.handleDamperRelease.bind(this)));
  }

  get isCenterC() {
    return this.frequency === 1;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, width: number, height: number) {
    ctx.fillStyle = this._isPressed ? this.color : this.shape === PianoKeyShape.WHITE ? 'white' : 'black';
    ctx.fillRect(x, 0, width, height);
    ctx.strokeStyle = 'black';
    ctx.strokeRect(x, 0, width, height);
    if (this.isCenterC) {
      // Draw a small circle at the bottom of the key to mark Center C
      ctx.save();
      ctx.fillStyle = 'red';
      const circleRadius = Math.min(width, height) * 0.1;
      const circleX = x + width / 2;
      const circleY = height - circleRadius * 2;
      ctx.beginPath();
      ctx.arc(circleX, circleY, circleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  handleDamperPress() {
    this.isAttachedToDamper = true;
  }

  handleDamperRelease() {
    this.isAttachedToDamper = false;
    if (this._isPressed) {
      return;
    }
    this.mute();
  }

  down() {
    if (this._isPressed) {
      return;
    }
    this._isPressed = true;
    this.mute();
    this.sound = SoundGenerator.INSTANCE.getSound(this.frequency);
    this.sound.start(0);
  }

  up() {
    this._isPressed = false;
    if (this.isAttachedToDamper) {
      return;
    }
    this.mute();
  }

  mute() {
    this.sound && this.sound.disconnect();
    this.sound = null;
  }

  dispose(): void {
    super.dispose();
    this.mute();
  }
}

class Metronome extends Disposable {
  private bpm: number;
  private isRunning: boolean;
  private intervalId: number | null = null;
  private audioContext: AudioContext;

  constructor(
    keydownEmitter: DOMEmitter<'keydown'>,
    initialBpm: number = 120
  ) {
    super();
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this._register(keydownEmitter.event(this.handleKeyDown.bind(this)));
    this.bpm = initialBpm;
    this.isRunning = false;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.code === 'ArrowUp') {
      this.increaseBpm();
    } else if (e.code === 'ArrowDown') {
      this.decreaseBpm();
    }
    if (e.repeat) {
      return;
    }
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
      return this.isRunning ? this.stop() : this.start();
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleTick();
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  increaseBpm() {
    this.bpm = Math.min(this.bpm + 1, 300); // 限制最大BPM为300
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  decreaseBpm() {
    this.bpm = Math.max(this.bpm - 1, 30); // 限制最小BPM为30
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  private scheduleTick() {
    const interval = 60000 / this.bpm; // 计算每次tick的间隔时间
    this.intervalId = setInterval(() => {
      this.tick();
    }, interval);
  }

  private tick() {
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'sine'; // 使用正弦波
    oscillator.frequency.setValueAtTime(780, this.audioContext.currentTime); // 设置频率为880Hz

    gainNode.gain.setValueAtTime(1, this.audioContext.currentTime); // 初始音量
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.05); // 快速衰减音量

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.05);
  }

  public dispose(): void {
    super.dispose();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null!;
    }
    this.stop();
  }
}

// #region Activation
onActivate((context) => {
  context.add(SoundGenerator.INSTANCE);
  const keydownEmitter = context.add(new DOMEmitter(window, 'keydown'));
  const keyupEmitter = context.add(new DOMEmitter(window, 'keyup'));
  context.add(new Metronome(keydownEmitter));

  const piano = context.add(new Piano(keydownEmitter, keyupEmitter));
  const damperPedal = new DamperPedal(keydownEmitter, keyupEmitter);
  piano.setDamperPedal(damperPedal);

  for (let i = 0; i < PIANO_KEY_COUNTS; i++) {
    const patternIndex = (i + PATTERN_BIAS) % KEY_PATTERN.length;
    piano.addKey(new PianoKey(
      KEY_PATTERN[patternIndex],
      NOTE_COLORS[patternIndex],
      i - CENTER_C_POSITION,
      damperPedal
    ));
  }

  const canvasManager = context.add(new CanvasManager({
    autoResize: false,
    styles: {
      pointerEvents: 'none',
      position: 'fixed',
      opacity: DISPLAY_OPACITY,
      bottom: '0',
      left: '50%',
      transform: 'translateX(-50%)',
      boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.3)',
      zIndex: '9999',
    }
  }));
  canvasManager.mount(document.body);
  const canvas = canvasManager.element;
  const canvasContext = canvasManager.getContext('2d')!;
  canvasManager.linkSize(document.body, function (entry, canvas) {
    const { width } = entry.contentRect;
    const length = piano.keys.length;
    const minWidth = length * MIN_KEY_SIZE;
    canvas.width = Math.max(width, minWidth);
    canvas.height = canvas.width * RATIO;
    piano.requestRedraw();
    piano.draw(canvasContext, 0, 0, canvas.width, canvas.height);
  });
  canvasManager.startRenderLoop(() => piano.draw(canvasContext, 0, 0, canvas.width, canvas.height));

  // Replace CSS transitions with Element.animate for animations
  ElementAnimator.show(canvas, [
    { transform: 'translateX(-50%) translateY(100px)', opacity: '0' },
    { transform: 'translateX(-50%) translateY(0)', opacity: DISPLAY_OPACITY }
  ]);

  renderTips({
    title: '钢琴彩蛋',
    description: '按下键盘上的字母键来弹奏音符，使用 Shift 键来踩踏板，使用 Ctrl 键来控制节拍器的开关。',
    operations: [
      { key: 'Z', description: '向左移动' },
      { key: 'X', description: '向右移动' },
      { key: 'Shift', description: '踩踏板' },
      { key: 'Ctrl', description: '开启/关闭节拍器' }
    ]
  });

  // Modify onDeactivate to use disappearance animation
  onDeactivate(() => ElementAnimator.hide(canvas));
})
// #endregion
