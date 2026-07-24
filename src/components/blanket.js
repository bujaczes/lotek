import { el } from '../dom.js';
import { s } from '../svg.js';
import { numberToCell, CELL_COUNT } from '../blanket-geometry.js';
import { buildFieldData, freshnessDotColor, textColorFor, DIVERGING, HEAT_STOPS } from '../blanket-scale.js';
import { formatInt, formatShortDate, drawsAgo, pluralPl } from '../format.js';

// The signature element: the 49 Lotto numbers laid out exactly as on a coupon
// (7x7, per CONVENTIONS geometry), each a luminous SVG ball colored as a heatmap.
// Three modes recolor the same balls in place with a smooth transition; a corner
// micro-dot always carries freshness; hover/focus shows a tooltip; each ball links
// to that number's career page.

const MODES = [
  { id: 'frequency', label: 'Częstość' },
  { id: 'freshness', label: 'Świeżość' },
  { id: 'zscore', label: 'Z-score' },
];

const CELL = 100;
const R = 40;
const DOT_R = 8.5;
const VIEW = (CELL_COUNT / 7) * CELL; // 7 rows * CELL = 700

const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS[0]}, ${HEAT_STOPS[1]}, ${HEAT_STOPS[2]})`;
const DIVERGING_GRADIENT = `linear-gradient(90deg, ${DIVERGING.cool}, ${DIVERGING.neutral}, ${DIVERGING.hot})`;

const LEGEND = {
  frequency: { gradient: HEAT_GRADIENT, low: 'rzadko', mid: '', high: 'często' },
  freshness: { gradient: HEAT_GRADIENT, low: 'dawno', mid: '', high: 'świeżo' },
  zscore: { gradient: DIVERGING_GRADIENT, low: '−3σ', mid: '0', high: '+3σ' },
};

const fmtZ = (z) => (z >= 0 ? '+' : '−') + Math.abs(z).toFixed(1).replace('.', ',');

function fieldLabel(e) {
  const razy = pluralPl(e.total, ['raz', 'razy', 'razy']);
  return `Liczba ${e.number}: wypadła ${e.total} ${razy}, ostatnio ${formatShortDate(e.lastDrawnAt)}, ${drawsAgo(e.currentGap)}. Otwórz karierę liczby.`;
}

function buildLegend() {
  const bar = el('span', { class: 'blanket-legend__bar' });
  const low = el('span', { class: 'blanket-legend__end' });
  const mid = el('span', { class: 'blanket-legend__mid' });
  const high = el('span', { class: 'blanket-legend__end' });
  const node = el('div', { class: 'blanket-legend', 'aria-hidden': 'true' }, [low, el('span', { class: 'blanket-legend__track' }, [bar, mid]), high]);
  return {
    node,
    update(mode) {
      const cfg = LEGEND[mode];
      bar.style.setProperty('--legend-gradient', cfg.gradient);
      low.textContent = cfg.low;
      high.textContent = cfg.high;
      mid.textContent = cfg.mid;
      mid.hidden = !cfg.mid;
    },
  };
}

function buildTooltip(stage) {
  const tip = el('div', { class: 'blanket-tip', role: 'tooltip', hidden: true });
  stage.append(tip);
  return {
    show(field, entry) {
      tip.replaceChildren(
        el('span', { class: 'blanket-tip__num mono' }, String(entry.number)),
        el('span', { class: 'blanket-tip__row' }, [
          'Wypadła ',
          el('b', { class: 'mono' }, formatInt(entry.total)),
          ` ${pluralPl(entry.total, ['raz', 'razy', 'razy'])}`,
        ]),
        el('span', { class: 'blanket-tip__row' }, ['Ostatnio ', el('b', { class: 'mono' }, formatShortDate(entry.lastDrawnAt))]),
        el('span', { class: 'blanket-tip__row blanket-tip__gap' }, drawsAgo(entry.currentGap)),
      );
      tip.hidden = false; // must be display:flex before we can measure it
      const s0 = stage.getBoundingClientRect();
      const f0 = field.getBoundingClientRect();
      const ballCx = f0.left - s0.left + f0.width / 2; // ball center within the stage
      const top = f0.top - s0.top;

      // 1) Place the box centered above the ball, caret centered and pointing down.
      tip.style.left = `${ballCx}px`;
      tip.style.top = `${top}px`;
      tip.style.setProperty('--caret-x', '50%');

      // 2) Measure the *rendered* box and slide it back inside the stage so the ~14
      // first/last-column balls never overflow (worst on a narrow viewport). Working
      // from the real rect sidesteps padding/border-box and text-wrap subtleties that
      // a hand-computed clamp gets wrong. The caret is then offset to keep pointing at
      // the ball. jsdom has no layout (all rects 0), so real numbers come from the
      // component test's mocked rects, not from here.
      const tr = tip.getBoundingClientRect();
      const MARGIN = 6;
      let dx = 0;
      if (tr.width >= s0.width - 2 * MARGIN) {
        dx = s0.left + s0.width / 2 - (tr.left + tr.width / 2); // wider than stage -> center
      } else if (tr.left < s0.left + MARGIN) {
        dx = s0.left + MARGIN - tr.left;
      } else if (tr.right > s0.right - MARGIN) {
        dx = s0.right - MARGIN - tr.right;
      }
      if (dx !== 0) {
        tip.style.left = `${ballCx + dx}px`;
        const caretX = Math.min(Math.max(tr.width / 2 - dx, 12), Math.max(tr.width - 12, 12));
        tip.style.setProperty('--caret-x', `${caretX}px`);
      }
    },
    hide() {
      tip.hidden = true;
    },
  };
}

export function createBlanket(entries) {
  const sorted = [...entries].sort((a, b) => a.number - b.number);
  const byNumber = new Map(sorted.map((e) => [e.number, e]));
  const maxGap = Math.max(1, ...sorted.map((e) => e.currentGap));
  const zValues = sorted.map((e) => e.zScore).filter((z) => z != null);
  const zMin = zValues.length ? Math.min(...zValues) : 0;
  const zMax = zValues.length ? Math.max(...zValues) : 0;

  let mode = 'frequency';
  const refs = new Map(); // number -> { disc, label }

  // ---- SVG grid ----------------------------------------------------------
  const gloss = s('radialGradient', { id: 'blanket-gloss', cx: '0.5', cy: '0.5', fx: '0.35', fy: '0.30', r: '0.65' }, [
    s('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.92' }),
    s('stop', { offset: '16%', 'stop-color': '#ffffff', 'stop-opacity': '0.18' }),
    s('stop', { offset: '48%', 'stop-color': '#ffffff', 'stop-opacity': '0' }),
    s('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': '0.20' }),
  ]);

  const fieldNodes = sorted.map((entry) => {
    const { row, col } = numberToCell(entry.number);
    const cx = col * CELL + CELL / 2;
    const cy = row * CELL + CELL / 2;

    const disc = s('circle', { class: 'blanket__disc', cx, cy, r: R });
    const label = s(
      'text',
      { class: 'blanket__label mono', x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central' },
      String(entry.number)
    );
    const dot = s('circle', {
      class: 'blanket__dot',
      cx: cx + 27,
      cy: cy - 27,
      r: DOT_R,
      style: { fill: freshnessDotColor(entry.currentGap, maxGap) },
    });

    refs.set(entry.number, { disc, label });

    return s(
      'a',
      {
        class: 'blanket__field',
        href: `/liczba/${entry.number}`,
        tabindex: '0',
        'aria-label': fieldLabel(entry),
        dataset: { number: String(entry.number) },
      },
      [
        s('title', {}, `Liczba ${entry.number}`),
        disc,
        s('circle', { class: 'blanket__gloss', cx, cy, r: R, fill: 'url(#blanket-gloss)' }),
        dot,
        label,
      ]
    );
  });

  const svg = s(
    'svg',
    {
      class: 'blanket',
      viewBox: `0 0 ${VIEW} ${VIEW}`,
      role: 'group',
      'aria-label': 'Blankiet 7 na 7 — mapa ciepła 49 liczb Lotto',
    },
    [s('defs', {}, [gloss]), ...fieldNodes]
  );

  // ---- tooltip + keyboard (delegated) ------------------------------------
  const stage = el('div', { class: 'blanket__stage' }, [svg]);
  const tooltip = buildTooltip(stage);

  const fieldFrom = (e) => e.target.closest('.blanket__field');
  svg.addEventListener('pointerover', (e) => {
    const field = fieldFrom(e);
    if (field) tooltip.show(field, byNumber.get(Number(field.dataset.number)));
  });
  svg.addEventListener('pointerout', (e) => {
    const field = fieldFrom(e);
    const to = e.relatedTarget;
    if (field && (!to || !field.contains(to))) tooltip.hide();
  });
  svg.addEventListener('focusin', (e) => {
    const field = fieldFrom(e);
    if (field) tooltip.show(field, byNumber.get(Number(field.dataset.number)));
  });
  svg.addEventListener('focusout', () => tooltip.hide());
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const field = fieldFrom(e);
    if (!field) return;
    e.preventDefault(); // own activation for SVG <a> (browsers don't guarantee it)
    // SVGAElement has no HTMLElement.click(); dispatch a bubbling click so the
    // router's document-level handler intercepts it and does an SPA navigate.
    field.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

  // ---- mode switch -------------------------------------------------------
  const legend = buildLegend();
  const caption = el('p', { class: 'blanket__caption' });

  const buttons = MODES.map((m) =>
    el('button', { class: 'modeswitch__btn', type: 'button', dataset: { mode: m.id }, onClick: () => applyMode(m.id) }, m.label)
  );

  function applyMode(next) {
    mode = next;
    const fields = buildFieldData(sorted, mode);
    for (const f of fields) {
      const ref = refs.get(f.number);
      ref.disc.style.fill = f.fill;
      ref.label.style.fill = textColorFor(f.fill);
    }
    for (const m of MODES) {
      const active = m.id === mode;
      const btn = buttons[MODES.indexOf(m)];
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    svg.classList.remove('is-mode-frequency', 'is-mode-freshness', 'is-mode-zscore');
    svg.classList.add(`is-mode-${mode}`);
    legend.update(mode);
    caption.replaceChildren(...captionFor(mode));
  }

  function captionFor(m) {
    if (m === 'zscore' && zValues.length) {
      return [
        `Nawet skrajne z-score (${fmtZ(zMin)} … ${fmtZ(zMax)}) mieszczą się w ±3σ — to szum, nie przewaga. `,
        el('b', {}, 'Każde losowanie jest niezależne.'),
      ];
    }
    if (m === 'freshness') {
      return ['Świeżość = ile losowań temu liczba wypadła. Przerwa nie zmienia szans następnego losowania — to złudzenie gracza.'];
    }
    return [
      'Kolor = jak często liczba padła przez całą historię. Różnice mieszczą się w szumie ±3σ — ',
      el('b', {}, 'żadna liczba nie jest „gorąca” w sensie przewagi.'),
    ];
  }

  applyMode('frequency');

  // ---- assemble ----------------------------------------------------------
  return el('section', { class: 'blanket-section' }, [
    el('header', { class: 'blanket-section__head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow' }, 'Blankiet 7×7'),
        el('h2', { class: 'section__title' }, 'Mapa ciepła 49 liczb'),
      ]),
      el('div', { class: 'modeswitch', role: 'group', 'aria-label': 'Tryb mapy ciepła' }, buttons),
    ]),
    stage,
    el('div', { class: 'blanket-foot' }, [legend.node, caption]),
  ]);
}
