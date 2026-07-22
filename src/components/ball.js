import { el } from '../dom.js';

// A single luminous Lotto ball: a specular-highlight sphere (CSS radial gradient
// in the stylesheet) carrying a JetBrains Mono numeral. `index` drives the
// staggered roll-in via the --roll-delay custom property; prefers-reduced-motion
// is handled entirely in CSS.
export function createBall(number, index = 0) {
  return el(
    'div',
    {
      class: 'ball',
      style: { '--roll-delay': `${index * 100}ms` },
      role: 'img',
      'aria-label': `Wylosowana liczba ${number}`,
    },
    [el('span', { class: 'ball__num', 'aria-hidden': 'true', text: String(number) })]
  );
}
