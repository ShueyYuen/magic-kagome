import { Emitter, type BaseEvent } from "./emitter";
import type { IDisposable } from './disposable';

export interface DOMEventMap extends HTMLElementEventMap, DocumentEventMap, WindowEventMap { }

export class DOMEmitter<T extends keyof DOMEventMap> implements IDisposable {
  private emitter: Emitter<DOMEventMap[T]>;

  get event(): BaseEvent<DOMEventMap[T]> {
    return this.emitter.event;
  }

  constructor(element: Window | HTMLElement, type: T, useCapture?: boolean) {
    const fn = (e: Event) => this.emitter.fire(e as DOMEventMap[T]);
    this.emitter = new Emitter({
      onWillAddFirstListener: () => element.addEventListener(type, fn, useCapture),
      onDidRemoveLastListener: () => element.removeEventListener(type, fn, useCapture),
    });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/**
 * 事件监听器，不具有DOMEmitter的懒加载特性
 */
export class DomListener implements IDisposable {
  constructor(
    private node: EventTarget,
    private readonly type: string,
    private handler: (e: any) => void,
    private readonly options: boolean | AddEventListenerOptions = false
  ) {
    this.node.addEventListener(this.type, this.handler, this.options);
  }

  dispose(): void {
    if (!this.handler) {
      // Already disposed
      return;
    }
    this.node.removeEventListener(this.type, this.handler, this.options);
    // Prevent leakers from holding on to the dom or handler func
    this.node = null!;
    this.handler = null!;
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * 点在链接、按钮或侧边栏上时，把这次点击留给页面本身。
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return !!element?.closest('a, button, input, textarea, select, summary, #author-card, .widget-info');
}

/**
 * 只把作者卡片抬到特效画布上面。侧栏是 sticky，子元素的 z-index 出不去，
 * 所以把卡片暂时挂到 body 上，按原位固定。其他卡片留在画布下面。
 */
export function liftAuthorCard(): IDisposable {
  const card = document.getElementById('author-card');
  const parent = card?.parentElement;
  if (!card || !parent) {
    return { dispose() { /* 列表页没有作者卡片 */ } };
  }
  const next = card.nextSibling;
  const placeholder = document.createElement('div');
  placeholder.dataset.magicAuthorPlaceholder = '';
  placeholder.style.height = `${card.offsetHeight}px`;
  placeholder.style.margin = getComputedStyle(card).margin;
  placeholder.style.visibility = 'hidden';
  placeholder.style.pointerEvents = 'none';
  parent.insertBefore(placeholder, card);

  const previous = {
    position: card.style.position,
    zIndex: card.style.zIndex,
    top: card.style.top,
    left: card.style.left,
    width: card.style.width,
    margin: card.style.margin,
    right: card.style.right,
    bottom: card.style.bottom,
    boxSizing: card.style.boxSizing,
  };
  card.style.position = 'fixed';
  card.style.zIndex = '40';
  card.style.margin = '0';
  card.style.right = 'auto';
  card.style.bottom = 'auto';
  card.style.boxSizing = 'border-box';
  document.body.appendChild(card);

  const place = () => {
    const rect = placeholder.getBoundingClientRect();
    card.style.top = `${rect.top}px`;
    card.style.left = `${rect.left}px`;
    card.style.width = `${rect.width}px`;
  };
  const fit = () => {
    const height = `${card.offsetHeight}px`;
    if (placeholder.style.height !== height) {
      placeholder.style.height = height;
    }
    place();
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(card);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', fit);

  return {
    dispose() {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', fit);
      card.style.position = previous.position;
      card.style.zIndex = previous.zIndex;
      card.style.top = previous.top;
      card.style.left = previous.left;
      card.style.width = previous.width;
      card.style.margin = previous.margin;
      card.style.right = previous.right;
      card.style.bottom = previous.bottom;
      card.style.boxSizing = previous.boxSizing;
      if (placeholder.isConnected) {
        parent.insertBefore(card, placeholder);
      } else if (parent.isConnected) {
        parent.insertBefore(card, next);
      }
      placeholder.remove();
    },
  };
}

export function requestPlainPage(): IDisposable {
  const stylesheet = new CSSStyleSheet();
  stylesheet.insertRule(`[data-plain="true"] [class*=soft-style] {
  background-color: transparent;
  box-shadow: none;
}`);
  stylesheet.insertRule(`
[data-plain="true"] [class*=soft-style--] {
  background-color: transparent;
  box-shadow: none;
}`);
  stylesheet.insertRule(`
[data-plain="true"] .card-cover {
  opacity: 0.6;
}`);

  stylesheet.insertRule(`
[data-plain="true"] .highlight {
  opacity: 0.9;
}`);

  stylesheet.insertRule(`
[data-plain="true"] .article-content img {
  opacity: 0.9;
}`);

  stylesheet.insertRule(`
[data-plain="true"] #waline .wl-comment {
  background: none;
  box-shadow: none;
}`);

  stylesheet.insertRule(`
[data-plain="true"] #waline .wl-comment .wl-panel {
  background: none;
}`);
  document.adoptedStyleSheets.push(stylesheet);
  document.documentElement.dataset.plain = 'true';
  return {
    dispose: () => {
      document.documentElement.dataset.plain = 'false';
      const index = document.adoptedStyleSheets.indexOf(stylesheet);
      if (index !== -1) {
        document.adoptedStyleSheets.splice(index, 1);
      }
    }
  }
}
