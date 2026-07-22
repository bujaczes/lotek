// Tiny SVG element builder — the namespaced sibling of dom.js `el()`.
// document.createElement makes HTML elements; SVG needs createElementNS, and SVG
// `class` must go through setAttribute (SVGElement.className is read-only).
// Mirrors el()'s signature: s('circle', { cx: 10, r: 4, onClick }, [children]).

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) node.style.setProperty(prop, val);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
