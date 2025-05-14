import { DisposableStore } from './magic/utils/disposable';

// 全局声明应该使用 declare global
declare global {
  function onDeactivate(cb: () => Promise<any> | void): void;
  function onActivate(cb: (context: DisposableStore) => void): void;
  async function onMagic(name?: string): void;
}

// 如果需要导出 DisposableStore，应该单独创建一个模块导出文件
export { };