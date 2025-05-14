declare var APlayer: any;
declare var DPlayer: any;

declare var reloadPlantUML: (isDark: boolean) => void

(function () {
  const themeMedia: MediaQueryList = window.matchMedia("(prefers-color-scheme: light)");

  function querySelectorArrs(selector: string): Array<Element> {
    return Array.from(document.querySelectorAll(selector))
  }

  function switchTheme(theme: string) {
    const rootDom: Element = document.documentElement
    theme = theme || "auto"
    switch (theme) {
      case "auto":
        autoSwitchTheme({
          matches: themeMedia.matches, media: ""
        } as MediaQueryListEvent);
        themeMedia.addEventListener("change", autoSwitchTheme);
        break;
      default:
        themeMedia.removeEventListener("change", autoSwitchTheme);
        rootDom.classList.remove(`theme-${theme == "light" ? "dark" : "light"}`);
        rootDom.classList.add(`theme-${theme == "light" ? "light" : "dark"}`);
        rootDom.setAttribute(`data-theme`, theme == "light" ? "light" : "dark");
        window.reloadPlantUML && window.reloadPlantUML(theme == "light");
    }
    window.localStorage.setItem('theme', theme)
  }

  function autoSwitchTheme(e: MediaQueryListEvent) {
    const rootDom: Element = document.documentElement
    rootDom.classList.remove(`theme-${e.matches ? "dark" : "light"}`);
    rootDom.classList.add(`theme-${e.matches ? "light" : "dark"}`);
    rootDom.setAttribute(`data-theme`, e.matches ? "light" : "dark");
    window.reloadPlantUML && window.reloadPlantUML(e.matches)
  }

  const currentTheme: string = window.localStorage.getItem('theme') || ''
  switchTheme(currentTheme);

  window.addEventListener('DOMContentLoaded', () => {
    /** moble click toggle menu */
    const mobileMenuBtn: Element = document.querySelector('.header-nav--btn')!;
    mobileMenuBtn.addEventListener('click', function () {
      mobileMenuBtn.classList.toggle('open')
    })

    /** theme change click */
    const themeLightBtn = document.querySelector('#theme-light')!;
    const themeDarkBtn = document.querySelector('#theme-dark')!;
    const themeAuto = document.querySelector('#theme-auto')!;
    themeLightBtn.addEventListener('click', () => switchTheme('light'))
    themeDarkBtn.addEventListener('click', () => switchTheme('dark'))
    themeAuto.addEventListener('click', () => switchTheme('auto'))

    /** background image lazy */
    const lazyBackgrounds = querySelectorArrs('[background-image-lazy]')
    let lazyBackgroundsCount = lazyBackgrounds.length
    if (lazyBackgroundsCount > 0) {
      let lazyBackgroundObserver = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function ({ isIntersecting, target }) {
          if (isIntersecting) {
            let img = target.dataset.img
            if (img) {
              target.style.backgroundImage = `url(${img})`
            }
            lazyBackgroundObserver.unobserve(target)
            lazyBackgroundsCount--
          }
          if (lazyBackgroundsCount <= 0) {
            lazyBackgroundObserver.disconnect()
          }
        })
      })

      lazyBackgrounds.forEach(function (lazyBackground) {
        lazyBackgroundObserver.observe(lazyBackground)
      })
    }
  });
})();

(function () {
  'use strict';

  if (!document.queryCommandSupported('copy')) {
    return;
  }

  function flashCopyMessage(el, msg) {
    el.textContent = msg;
    setTimeout(function () {
      el.textContent = "Copy";
    }, 1000);
  }

  function selectText(node) {
    var selection = window.getSelection()!;
    var range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  }

  function addCopyButton(containerEl) {
    var copyBtn = document.createElement("button");
    copyBtn.className = "highlight-copy-btn";
    copyBtn.textContent = "Copy";

    var codeEl = containerEl.querySelector('[data-lang]') || containerEl.querySelector('code');
    copyBtn.addEventListener('click', function () {
      try {
        var selection = selectText(codeEl);
        document.execCommand('copy');
        selection.removeAllRanges();

        flashCopyMessage(copyBtn, 'Copied!')
      } catch (e) {
        console && console.log(e);
        flashCopyMessage(copyBtn, 'Failed :\'(')
      }
    });

    containerEl.appendChild(copyBtn);
  }

  // Add copy button to code blocks
  window.addEventListener('DOMContentLoaded', () => {
    const highlightBlocks = document.getElementsByClassName('highlight');
    Array.prototype.forEach.call(highlightBlocks, addCopyButton);
  });
})();
