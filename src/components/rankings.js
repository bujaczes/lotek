import { el } from '../dom.js';
import { formatInt, pluralPl } from '../format.js';

// Hot / cold top-10 with a shared time-window switch. Each row is a mini Lotto
// ball linking to that number's career. z-score is materialized only for the full
// history, so it is shown in every window but honestly labeled "z (całość)".

const WINDOWS = [
  { id: 'all', label: 'całość' },
  { id: 'last100', label: 'ostatnie 100' },
  { id: 'currentYear', label: 'bieżący rok' },
];

const fmtZ = (z) => (z == null ? '—' : (z >= 0 ? '+' : '−') + Math.abs(z).toFixed(1).replace('.', ','));

function rankRow(entry, pos) {
  return el('a', { class: 'rank-row', href: `/liczba/${entry.number}` }, [
    el('span', { class: 'rank-row__pos mono', 'aria-hidden': 'true' }, String(pos)),
    el('span', { class: 'miniball mono', 'aria-hidden': 'true' }, String(entry.number)),
    el('span', { class: 'rank-row__meta' }, [
      el('span', { class: 'rank-row__count' }, [
        el('b', { class: 'mono' }, formatInt(entry.count)),
        ` ${pluralPl(entry.count, ['raz', 'razy', 'razy'])}`,
      ]),
      el('span', { class: 'rank-row__z mono' }, [`z ${fmtZ(entry.zScore)}`, el('span', { class: 'rank-row__z-scope' }, 'całość')]),
    ]),
  ]);
}

function column(kind, title, hint) {
  const list = el('ol', { class: 'rank-list' });
  const node = el('div', { class: `rank-col rank-col--${kind} card` }, [
    el('div', { class: 'rank-col__head' }, [
      el('span', { class: `rank-col__flag rank-col__flag--${kind}`, 'aria-hidden': 'true' }),
      el('h3', { class: 'rank-col__title' }, title),
      el('span', { class: 'rank-col__hint' }, hint),
    ]),
    list,
  ]);
  return { node, list };
}

export function createRankings(data) {
  let window = 'all';
  const hot = column('hot', 'Gorące', 'najczęściej');
  const cold = column('cold', 'Zimne', 'najrzadziej');

  function render() {
    hot.list.replaceChildren(...data.hot[window].map((e, i) => rankRow(e, i + 1)));
    cold.list.replaceChildren(...data.cold[window].map((e, i) => rankRow(e, i + 1)));
  }

  const tabs = WINDOWS.map((w) =>
    el(
      'button',
      {
        class: 'rank-tab',
        type: 'button',
        'aria-pressed': String(w.id === window),
        dataset: { window: w.id },
        onClick: () => {
          window = w.id;
          for (const t of tabList) t.setAttribute('aria-pressed', String(t.dataset.window === window));
          render();
        },
      },
      w.label
    )
  );
  const tabList = tabs;

  render();

  return el('section', { class: 'rankings-section' }, [
    el('header', { class: 'rankings-section__head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow' }, 'Rankingi'),
        el('h2', { class: 'section__title' }, 'Gorące i zimne'),
      ]),
      el('div', { class: 'rank-tabs', role: 'group', 'aria-label': 'Okno czasowe' }, tabs),
    ]),
    el('div', { class: 'rank-grid' }, [hot.node, cold.node]),
    el('p', { class: 'rankings__caption' }, 'z-score zawsze liczony z całej historii — nawet rekordzistki mieszczą się w ±3σ.'),
  ]);
}
