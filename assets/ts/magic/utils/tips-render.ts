import { ElementAnimator } from "./animation";

interface MagicTip {
  title: string;
  description: string;
  operations?: { key: string; description: string }[];
}

function createStyleSheet() {
  const stylesheet = new CSSStyleSheet();
  stylesheet.insertRule(`
.magic-tip {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--theme-text-primary);
}`);
  stylesheet.insertRule(`
.magic-tip .magic-tip-description {
  padding: 8px 0;
  font-size: 12px;
}`);
  stylesheet.insertRule(`
.magic-tip-operations {
  display: table;
  font-size: 12px;
  list-style-type: circle;
  list-style-position: inside;
  border-left: 2px dashed var(--theme-text-primary);
}`);
  stylesheet.insertRule(`
.magic-tip-operations strong {
  padding: 0 4px;
}`);
  document.adoptedStyleSheets.push(stylesheet);
  return stylesheet;
}

export function renderTips(tip: MagicTip, target = "author-card") {
  const targetElement = document.getElementById(target);
  if (!targetElement) {
    throw new Error(`Element with ID "${target}" not found.`);
  }

  const stylesheet = createStyleSheet();

  const tipElement = document.createElement("div");
  tipElement.className = "magic-tip";
  tipElement.innerHTML = `
    <h3 class="magic-tip-title">${tip.title}</h3>
    <p class="magic-tip-description">${tip.description}</p>`;

  const escKeyboard = {
    key: "Esc",
    description: "退出彩蛋～"
  }
  if (!tip.operations) {
    tip.operations = [escKeyboard]
  } else {
    tip.operations.unshift(escKeyboard);
  }
  const operationsElement = document.createElement("table");
  operationsElement.className = "magic-tip-operations";
  operationsElement.innerHTML = tip.operations.map(item => `<tr>
  <td style="padding: 0 8px;"><strong>${item.key}</strong>:</td>
  <td>${item.description}</td>
</tr>`).join("");;
  tipElement.appendChild(operationsElement);

  targetElement.appendChild(tipElement);

  ElementAnimator.show(tipElement, [
    { height: '0', opacity: 0 },
    { height: 'auto', opacity: 1 }
  ]);

  return onDeactivate(() =>
    ElementAnimator
      .hide(tipElement)
      .then(() => tipElement.remove())
      .then(() => {
        const index = document.adoptedStyleSheets.indexOf(stylesheet);
        if (index !== -1) {
          document.adoptedStyleSheets.splice(index, 1);
        }
      })
  );
}
