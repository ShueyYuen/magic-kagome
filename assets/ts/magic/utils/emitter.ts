/* eslint-disable @typescript-eslint/ban-types */
import { LinkedList } from './linkedList';
import { SafeDisposable, Disposable, DisposableStore, type IDisposable } from './disposable';

class Listener<T> {
  readonly subscription = new SafeDisposable();

  constructor(
    readonly callback: (e: T) => void,
    readonly callbackThis: unknown | undefined
  ) { }

  invoke(e: T) {
    this.callback.call(this.callbackThis, e);
  }
}

export interface BaseEvent<T> {
  (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: IDisposable[] | DisposableStore): IDisposable;
}

export interface EmitterOptions {
  /**
   * Optional function that's called *before* the very first listener is added
   */
  onWillAddFirstListener?: Function;
  /**
   * Optional function that's called after a listener is added
   */
  onDidAddListener?: Function;
  /**
   * Optional function that's called *before* a listener is removed
   */
  onWillRemoveListener?: Function;
  /**
   * Optional function that's called *after* remove the very last listener
   */
  onDidRemoveLastListener?: Function;
}

export class Emitter<T> implements IDisposable {
  protected _listeners?: LinkedList<Listener<T>>;
  private _disposed = false;
  private _event?: BaseEvent<T>;
  private readonly _options?: EmitterOptions;

  constructor(options?: EmitterOptions) {
    this._options = options;
  }

  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;

      if (this._listeners) {
        for (const listener of this._listeners) {
          if (listener.subscription.isset()) {
            listener.subscription.unset();
          }
        }
        this._listeners.clear();
        this._listeners = undefined;
      }

      this._options?.onDidRemoveLastListener?.(this);
    }
  }

  get event(): BaseEvent<T> {
    this._event ??= (
      callback: (e: T) => unknown,
      thisArgs?: unknown,
      disposables?: IDisposable[] | DisposableStore
    ) => {
      if (this._disposed) {
        return Disposable.None;
      }
      if (!this._listeners) {
        this._listeners = new LinkedList();
      }
      if (this._listeners.isEmpty() && this._options?.onWillAddFirstListener) {
        this._options.onWillAddFirstListener(this);
      }
      const listener = new Listener(callback, thisArgs);
      const removeListener = this._listeners.push(listener);

      const result = listener.subscription.set(() => {
        if (!this._disposed) {
          removeListener();
          if (this._options && this._options.onDidRemoveLastListener) {
            const hasListeners = this._listeners && !this._listeners.isEmpty();
            if (!hasListeners) {
              this._options.onDidRemoveLastListener(this);
            }
          }
        }
      });
      if (disposables instanceof DisposableStore) {
        disposables.add(result);
      } else if (Array.isArray(disposables)) {
        disposables.push(result);
      }
      return result;
    };
    return this._event;
  }

  fire(event: T): void {
    if (this._listeners) {
      for (const listener of this._listeners) {
        listener.invoke(event);
      }
    }
  }
}
