let cachedTop:    number | null = null;
let cachedBottom: number | null = null;

function read(side: 'top' | 'bottom'): number {
  const el = document.createElement('div');
  el.style.cssText =
    `position:fixed;visibility:hidden;pointer-events:none;` +
    `padding-${side}:env(safe-area-inset-${side},0px)`;
  document.body.appendChild(el);
  const cs  = getComputedStyle(el);
  const val = parseInt(side === 'top' ? cs.paddingTop : cs.paddingBottom, 10) || 0;
  document.body.removeChild(el);
  return val;
}

export function safeAreaTop(): number {
  if (cachedTop === null) cachedTop = read('top');
  return cachedTop;
}

export function safeAreaBottom(): number {
  if (cachedBottom === null) cachedBottom = read('bottom');
  return cachedBottom;
}
