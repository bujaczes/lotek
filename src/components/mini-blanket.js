import { el } from '../dom.js';
import { numberToCell, COLUMNS, CELL_COUNT } from '../blanket-geometry.js';
import { toggleNumber } from '../selection.js';

// The small sibling of the signature blankiet (src/components/blanket.js, which is the
// heatmap and stays exactly as it is). Same 7x7 coupon geometry, two jobs:
//   'highlight' — a read-only coupon with some numbers marked (a number's position on
//                 the slip, a played set, an archive row's six).
//   'pick'      — the coupon you fill in: every field is a real <button aria-pressed>,
//                 so keyboard, screen readers and focus rings come for free. That is
//                 why this is HTML+CSS grid rather than SVG like the big blankiet,
//                 where the fields are links inside one drawing.
// Placement comes from numberToCell() so the coupon layout has exactly one definition.

export function createMiniBlanket({
  mode = 'highlight',
  selected = [],
  max = 6,
  linked = false,
  onChange = () => {},
  ariaLabel = 'Blankiet 7 na 7',
} = {}) {
  const picking = mode === 'pick';
  let current = [...selected];
  const cells = new Map();

  function cellNode(n) {
    const { row, col } = numberToCell(n);
    const style = { 'grid-row': String(row + 1), 'grid-column': String(col + 1) };
    const text = String(n);

    if (picking) {
      return el(
        'button',
        {
          class: 'mini-blanket__cell mono',
          type: 'button',
          style,
          'aria-pressed': 'false',
          'aria-label': `Liczba ${n}`,
          dataset: { number: text },
          onClick: () => {
            const next = toggleNumber(current, n, max);
            if (next.length === current.length && next.every((x, i) => x === current[i])) {
              // Rejected because the coupon is full: say so instead of doing nothing.
              onChange(current, { rejected: n });
              return;
            }
            current = next;
            paint();
            onChange(current, { toggled: n });
          },
        },
        text
      );
    }

    if (linked) {
      return el(
        'a',
        { class: 'mini-blanket__cell mono', style, href: `/liczba/${n}`, dataset: { number: text }, 'aria-label': `Liczba ${n} — kariera` },
        text
      );
    }

    return el('span', { class: 'mini-blanket__cell mono', style, dataset: { number: text } }, text);
  }

  function paint() {
    const set = new Set(current);
    for (const [n, node] of cells) {
      const on = set.has(n);
      node.classList.toggle('is-on', on);
      if (picking) node.setAttribute('aria-pressed', String(on));
    }
  }

  const grid = el(
    'div',
    {
      class: `mini-blanket mini-blanket--${mode}`,
      role: picking ? 'group' : 'img',
      'aria-label': ariaLabel,
      style: { '--mini-cols': String(COLUMNS) },
    },
    Array.from({ length: CELL_COUNT }, (_, i) => {
      const n = i + 1;
      const node = cellNode(n);
      cells.set(n, node);
      return node;
    })
  );

  paint();

  return {
    node: grid,
    getSelected: () => [...current],
    setSelected(next) {
      current = [...next];
      paint();
    },
    clear() {
      current = [];
      paint();
    },
  };
}
