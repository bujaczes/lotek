import { el } from '../dom.js';
import { createBall } from './ball.js';
import { createMiniBlanket } from './mini-blanket.js';
import { miniBalls } from './archive.js';
import { formatInt, formatDecimal, formatPln, formatSignedPln, formatShortDate, pluralPl } from '../format.js';
import { validateSet, SET_SIZE } from '../selection.js';
import { expectedHits, oddsFor } from '../hits-theory.js';

// /wehikul — SPEC 6.14. The coupon is the interface: pick six fields, get the honest
// history of that exact set. Every result panel carries its theoretical twin, and the
// balance is labelled an educational estimate wherever it appears.

const TIERS = [6, 5, 4, 3];

export function createPicker({ selected = [], onSubmit }) {
  const counter = el('p', { class: 'picker__counter mono' });
  const message = el('p', { class: 'picker__message', role: 'status', 'aria-live': 'polite' });
  const submit = el('button', { class: 'btn btn--primary picker__cta', type: 'submit' }, 'Sprawdź swój zestaw');
  const chosen = el('div', { class: 'picker__chosen', 'aria-live': 'polite' });

  const picker = createMiniBlanket({
    mode: 'pick',
    max: SET_SIZE,
    selected,
    ariaLabel: 'Blankiet — zaznacz sześć liczb swojego zestawu',
    onChange: (next, meta) => paint(next, meta),
  });

  const clearButton = el(
    'button',
    {
      class: 'btn btn--quiet',
      type: 'button',
      onClick: () => {
        picker.clear();
        paint([], {});
      },
    },
    'Wyczyść'
  );

  function paint(current, meta = {}) {
    const check = validateSet(current);
    counter.textContent = `${current.length}/${SET_SIZE}`;
    counter.classList.toggle('is-complete', check.ok);
    submit.disabled = !check.ok;
    clearButton.hidden = current.length === 0;
    message.textContent = meta.rejected
      ? `Masz już ${SET_SIZE} liczb — odznacz którąś, żeby dodać ${meta.rejected}.`
      : check.ok
        ? 'Zestaw gotowy.'
        : check.message;
    chosen.replaceChildren(
      ...current.map((n, i) => createBall(n, i)),
      ...Array.from({ length: SET_SIZE - current.length }, () => el('span', { class: 'picker__slot', 'aria-hidden': 'true' }))
    );
  }

  const form = el(
    'form',
    {
      class: 'picker card',
      onSubmit: (e) => {
        e.preventDefault();
        const current = picker.getSelected();
        if (!validateSet(current).ok) return;
        onSubmit(current);
      },
    },
    [
      el('div', { class: 'picker__head' }, [
        el('p', { class: 'eyebrow' }, 'Twój zestaw'),
        counter,
      ]),
      picker.node,
      chosen,
      message,
      el('div', { class: 'picker__actions' }, [submit, clearButton]),
    ]
  );

  paint(picker.getSelected());

  return {
    node: form,
    getSelected: () => picker.getSelected(),
    setBusy(busy) {
      submit.disabled = busy || !validateSet(picker.getSelected()).ok;
      submit.textContent = busy ? 'Liczę…' : 'Sprawdź swój zestaw';
    },
  };
}

// A six is expected 0.0005 times in 7380 draws; "0,00" would read as "impossible"
// rather than "vanishingly rare", so tiny expectations keep their digits.
const formatExpected = (v) => formatDecimal(v, v < 0.1 ? 4 : v < 10 ? 2 : 1);

function tierTile(hits, count, expected) {
  return el('div', { class: `hit-tile hit-tile--${hits}${count > 0 ? ' is-hit' : ''}` }, [
    el('p', { class: 'hit-tile__label' }, `${hits} trafień`),
    el('p', { class: 'hit-tile__value mono' }, formatInt(count)),
    el('p', { class: 'hit-tile__note mono' }, `teoria: ${formatExpected(expected)}`),
    el('p', { class: 'hit-tile__odds' }, `szansa 1 : ${formatInt(oddsFor(hits))}`),
  ]);
}

function balancePanel(balance, prizes) {
  const line = (label, value, extra) =>
    el('div', { class: `balance__line${extra ? ` balance__line--${extra}` : ''}` }, [
      el('span', { class: 'balance__label' }, label),
      el('span', { class: 'balance__value mono' }, value),
    ]);

  return el('div', { class: 'balance card' }, [
    el('header', { class: 'balance__head' }, [
      el('p', { class: 'eyebrow' }, 'Bilans'),
      el('span', { class: 'badge-estimate' }, 'szacunek edukacyjny'),
    ]),
    el('div', { class: 'balance__lines' }, [
      line(`Koszt (${formatInt(balance.drawsPlayed)} × ${formatPln(prizes.betPrice)})`, formatPln(balance.cost)),
      line('Wygrane', formatPln(balance.winnings)),
    ]),
    el('div', { class: `balance__net${balance.net < 0 ? ' is-loss' : ' is-gain'}` }, [
      el('p', { class: 'balance__net-label' }, 'Wynik'),
      el('p', { class: 'balance__net-value mono' }, formatSignedPln(balance.net)),
    ]),
    el('div', { class: 'balance__stakes' }, [
      el('p', { class: 'balance__stakes-title' }, 'Przyjęte stawki (config/prizes.json)'),
      el(
        'ul',
        { class: 'balance__stakes-list mono' },
        TIERS.map((t) =>
          el('li', {}, [
            el('span', {}, `${t} trafień`),
            el('span', {}, t === 6 ? `${formatPln(prizes[t])} (minimalna kumulacja)` : formatPln(prizes[t])),
          ])
        )
      ),
      el('p', { class: 'balance__stakes-note' },
        'Nagrody I–III stopnia są w rzeczywistości pulowe i zmienne — powyższe kwoty to stałe założenia przyjęte ' +
          'w konfiguracji, żeby bilans dało się w ogóle policzyć. Nie są prognozą wypłaty.'),
    ]),
  ]);
}

function occurrenceList(occurrences) {
  const byTier = new Map(TIERS.map((t) => [t, []]));
  for (const occ of occurrences) {
    if (byTier.has(occ.hits)) byTier.get(occ.hits).push(occ);
  }

  const groups = TIERS.filter((t) => byTier.get(t).length).map((t) => {
    const rows = byTier.get(t);
    const list = el(
      'ol',
      { class: 'occurrence-list' },
      rows.map((occ) =>
        el('li', {}, [
          el('a', { class: 'occurrence', href: `/losowanie/${occ.drawNumber}` }, [
            el('span', { class: 'occurrence__nr mono' }, `nr ${occ.drawNumber}`),
            el('span', { class: 'occurrence__date mono' }, formatShortDate(occ.date)),
          ]),
        ])
      )
    );
    const head = `${t} trafień — ${rows.length} ${pluralPl(rows.length, ['losowanie', 'losowania', 'losowań'])}`;
    // Long tiers (the threes run into the hundreds) fold away; the rare, interesting
    // tiers stay open.
    return rows.length > 12
      ? el('details', { class: 'occurrence-group' }, [el('summary', { class: 'occurrence-group__summary' }, head), list])
      : el('div', { class: 'occurrence-group is-open' }, [el('p', { class: 'occurrence-group__summary' }, head), list]);
  });

  if (!groups.length) {
    return el('p', { class: 'wehikul-empty' }, 'Ten zestaw nigdy nie trafił nawet trójki. To najczęstszy wynik — i nie mówi nic o przyszłości.');
  }
  return el('div', { class: 'occurrence-groups' }, groups);
}

export function createWehikulResults(data) {
  const expected = expectedHits(data.balance.drawsPlayed);
  const totalHits = TIERS.reduce((s, t) => s + (data.hits[t] || 0), 0);

  return el('section', { class: 'wehikul-results' }, [
    el('header', { class: 'wehikul-results__head' }, [
      el('p', { class: 'eyebrow' }, 'Wynik'),
      el('h2', { class: 'section__title' }, [
        'Twój zestaw ',
        el('span', { class: 'wehikul-results__set' }, [miniBalls(data.numbers)]),
      ]),
      el('p', { class: 'wehikul-results__lead' }, [
        `Grając nim w każdym z ${formatInt(data.balance.drawsPlayed)} losowań od 1957 roku trafiłbyś co najmniej trójkę `,
        el('b', { class: 'mono' }, formatInt(totalHits)),
        ` ${pluralPl(totalHits, ['raz', 'razy', 'razy'])}.`,
      ]),
    ]),

    el('div', { class: 'hit-tiles' }, TIERS.map((t) => tierTile(t, data.hits[t] || 0, expected[t]))),

    balancePanel(data.balance, data.prizes),

    el('div', { class: 'wehikul-occurrences card' }, [
      el('p', { class: 'eyebrow' }, 'Kiedy to było'),
      occurrenceList(data.occurrences),
    ]),

    el('p', { class: 'wehikul-disclaimer' }, data.disclaimer),
  ]);
}
