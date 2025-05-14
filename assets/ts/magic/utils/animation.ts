/**
 * 元素动画类型
 */
export enum AnimationType {
  FADE = 'fade',
  SLIDE_UP = 'slide-up',
  SLIDE_DOWN = 'slide-down',
  SLIDE_LEFT = 'slide-left',
  SLIDE_RIGHT = 'slide-right',
  SCALE = 'scale',
}

/**
 * 自定义关键帧接口
 */
export type CustomKeyframes = Keyframe[] | PropertyIndexedKeyframes;

type SavedAnimationConfig = {
  frames: CustomKeyframes,
  options: KeyframeAnimationOptions
}

function reserveAnimationDirection(direction?: PlaybackDirection): PlaybackDirection {
  switch (direction) {
    case 'normal':
      return 'reverse';
    case 'reverse':
      return 'normal';
    case 'alternate':
      return 'alternate-reverse';
    case 'alternate-reverse':
      return 'alternate';
    default:
      return 'reverse';
  }
}

/**
 * 元素动画控制器
 * 提供通用的元素显示/隐藏动画能力
 */
export class ElementAnimator {
  // 默认动画配置
  private static readonly DEFAULT_CONFIG: KeyframeAnimationOptions = {
    duration: 500,
    easing: 'ease',
    delay: 0,
    fill: 'forwards',
    iterations: 1
  };
  private static readonly enterAnimationMap = new WeakMap<HTMLElement, SavedAnimationConfig>();

  /**
   * 显示元素动画
   * @param element 要显示的元素
   * @param type 动画类型
   * @param config 动画配置
   * @param customKeyframes 自定义关键帧(当type为CUSTOM时使用)
   * @returns 动画完成Promise
   */
  public static show(
    element: HTMLElement,
    framesOrType: AnimationType | CustomKeyframes = AnimationType.FADE,
    config: KeyframeAnimationOptions = {},
  ): Promise<void> {
    // 合并配置
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };

    // 根据动画类型获取关键帧
    const keyframes = typeof framesOrType === 'string' ? this.getShowKeyframes(framesOrType) : framesOrType;

    this.enterAnimationMap.set(element, {
      frames: keyframes,
      options: finalConfig
    });

    // 执行动画
    const animation = element.animate(keyframes, finalConfig);
    return new Promise<void>(resolve => {
      animation.onfinish = () => resolve();
    });
  }

  /**
   * 隐藏元素动画
   * @param element 要隐藏的元素
   * @param type 动画类型
   * @param config 动画配置
   * @param customKeyframes 自定义关键帧(当type为CUSTOM时使用)
   * @returns 动画完成Promise
   */
  public static hide(element: HTMLElement): Promise<void>;
  public static hide(
    element: HTMLElement,
    framesOrType?: AnimationType | CustomKeyframes,
    config?: KeyframeAnimationOptions,
  ): Promise<void>
  public static hide(
    element: HTMLElement,
    framesOrType?: AnimationType | CustomKeyframes,
    config: KeyframeAnimationOptions = {},
  ) {
    if (!framesOrType) {
      const savedAnimation = this.enterAnimationMap.get(element);
      if (savedAnimation) {
        const { frames, options } = savedAnimation;
        return this.hide(element, frames, {
          ...options,
          direction: reserveAnimationDirection(options.direction)
        });
      } else {
        framesOrType = AnimationType.FADE;
      }
    }
    // 合并配置
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };

    // 根据动画类型获取关键帧
    const keyframes = typeof framesOrType === 'string' ? this.getHideKeyframes(framesOrType) : framesOrType;

    // 执行动画
    const animation = element.animate(keyframes, finalConfig);

    return new Promise<void>(resolve => {
      animation.onfinish = () => {
        // 动画完成后隐藏元素
        resolve();
      };
    });
  }

  /**
   * 获取显示动画关键帧
   */
  private static getShowKeyframes(
    type: AnimationType,
  ): CustomKeyframes {
    switch (type) {
      case AnimationType.SLIDE_UP:
        return [
          { transform: 'translateY(30px)', opacity: '0' },
          { transform: 'translateY(0)', opacity: '1' }
        ];
      case AnimationType.SLIDE_DOWN:
        return [
          { transform: 'translateY(-30px)', opacity: '0' },
          { transform: 'translateY(0)', opacity: '1' }
        ];
      case AnimationType.SLIDE_LEFT:
        return [
          { transform: 'translateX(30px)', opacity: '0' },
          { transform: 'translateX(0)', opacity: '1' }
        ];
      case AnimationType.SLIDE_RIGHT:
        return [
          { transform: 'translateX(-30px)', opacity: '0' },
          { transform: 'translateX(0)', opacity: '1' }
        ];
      case AnimationType.SCALE:
        return [
          { transform: 'scale(0.8)', opacity: '0' },
          { transform: 'scale(1)', opacity: '1' }
        ];
      case AnimationType.FADE:
      default:
        return [
          { opacity: '0' },
          { opacity: '1' }
        ];
    }
  }

  /**
   * 获取隐藏动画关键帧
   */
  private static getHideKeyframes(
    type: AnimationType,
  ): CustomKeyframes {
    switch (type) {
      case AnimationType.SLIDE_UP:
        return [
          { transform: 'translateY(0)', opacity: '1' },
          { transform: 'translateY(-30px)', opacity: '0' }
        ];
      case AnimationType.SLIDE_DOWN:
        return [
          { transform: 'translateY(0)', opacity: '1' },
          { transform: 'translateY(30px)', opacity: '0' }
        ];
      case AnimationType.SLIDE_LEFT:
        return [
          { transform: 'translateX(0)', opacity: '1' },
          { transform: 'translateX(-30px)', opacity: '0' }
        ];
      case AnimationType.SLIDE_RIGHT:
        return [
          { transform: 'translateX(0)', opacity: '1' },
          { transform: 'translateX(30px)', opacity: '0' }
        ];
      case AnimationType.SCALE:
        return [
          { transform: 'scale(1)', opacity: '1' },
          { transform: 'scale(0.8)', opacity: '0' }
        ];
      case AnimationType.FADE:
      default:
        return [
          { opacity: '1' },
          { opacity: '0' }
        ];
    }
  }

  /**
   * 立即停止元素上的所有动画
   */
  public static stopAnimations(element: HTMLElement): void {
    element.getAnimations().forEach(animation => animation.cancel());
  }
}