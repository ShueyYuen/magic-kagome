import { DisposableStore } from "./magic/utils/disposable";

function loadScript(url: string, integrity: string, crossorigin: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.integrity = integrity;
    script.crossOrigin = crossorigin;
    script.onload = () => {
      script.remove();
      resolve();
    }
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.body.appendChild(script);
  });
}

let _onDeactivate: Array<() => Promise<void> | void> = [], _context: DisposableStore;
async function onDeactivate(cb?: () => Promise<void> | void) {
  if (typeof cb === 'function') {
    _onDeactivate.push(cb);
  } else {
    await Promise.all(_onDeactivate.map(fn => fn()));
    _context && _context.dispose();
    _onDeactivate = []; // 清空回调函数
  }
}
window.onDeactivate = onDeactivate;
window.onActivate = function onActivate(cb) {
  _context = new DisposableStore();
  cb(_context);
}

const magicSource = document.getElementById('magic-source') as HTMLScriptElement;
const magicData = JSON.parse(magicSource.text);

const magicKeys = Object.keys(magicData);
const shownMagic = JSON.parse(localStorage.getItem('shown-magic') || '{}');

let isBusy = false;
window.onMagic = async function onMagic(name?: string) {
  if (isBusy) return;
  isBusy = true;
  await onDeactivate();
  if (Object.keys(shownMagic).length >= magicKeys.length) {
    // 清空对象
    for (const key in shownMagic) {
      delete shownMagic[key];
    }
  }
  if (!name) {
    const notShownMagic = magicKeys.filter(key => !shownMagic[key]);
    name = notShownMagic[Math.floor(Math.random() * notShownMagic.length)];
  }
  const magicScript = magicData[name];
  loadScript(magicScript.url, magicScript.integrity, magicScript.crossorigin)
    .then(() => {
      console.log(`Loaded magic: ${name}`);
      // 在这里可以执行魔法脚本的相关操作
    })
    .catch(error => {
      console.error(`Error loading magic: ${error}`);
    }).finally(() => {
      isBusy = false;
    });
  shownMagic[name] = true; // 使用对象属性记录已显示的魔法
  localStorage.setItem('shown-magic', JSON.stringify(shownMagic));
}

const authorCard = document.getElementById('author-card');
if (authorCard) {
  authorCard.addEventListener('click', () => onMagic());
  authorCard.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      onMagic();
    }
  });
}

document.addEventListener('keyup', function (event) {
  if (event.key === 'Escape') {
    onDeactivate();
    authorCard && authorCard.blur();
  }
});