import { el } from '../dom.js';
import { createBall } from './ball.js';
import { renderMarkdown } from '../markdown.js';
import {
  formatInt,
  formatDecimal,
  formatLongDate,
  formatShortDate,
  pluralPl,
} from '../format.js';

const HITS_FORMS = ['trafienie', 'trafienia', 'trafień'];
const TIER_LABEL = { 1: 'I stopień', 2: 'II stopień', 3: 'III stopień', 4: 'IV stopień' };

function signedDecimal(value, digits = 2) {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : '−'}${formatDecimal(Math.abs(value), digits)}`;
}

function ballRow(numbers, { alt = false } = {}) {
  return el(
    'div',
    { class: alt ? 'typer-balls typer-balls--alt' : 'typer-balls' },
    numbers.map((n, i) => createBall(n, i))
  );
}

// The glanceable pick: the 6 highlighted balls plus draw number/date. The full written
// argument is the rationale article below — this hero is the "what", that is the "why".
export function typerHero(prediction) {
  const children = [
    el('p', { class: 'eyebrow' }, 'Typer'),
    el('h1', { class: 'typer-hero__title' }, `Typ na losowanie nr ${prediction.forDrawNumber}`),
  ];
  if (prediction.drawDate) {
    children.push(el('p', { class: 'typer-hero__meta' }, formatLongDate(prediction.drawDate)));
  }
  children.push(ballRow(prediction.numbers));
  children.push(
    el('p', { class: 'typer-hero__honest' }, [
      'Uczciwie: szansa na szóstkę to ',
      el('b', {}, '1 : 13 983 816'),
      ' — jak każdego kuponu. Ten zestaw nie jest bardziej prawdopodobny, jest lepiej opłacalny, jeśli wygra.',
    ])
  );
  return el('header', { class: 'typer-hero' }, children);
}

// Full "dlaczego te liczby" narrative, rendered from our own markdown via the safe
// renderer (headings/bold/lists/paragraphs, no innerHTML).
export function rationaleSection(commentary) {
  const body = commentary
    ? renderMarkdown(commentary)
    : el('p', { class: 'md-p' }, 'Komentarz do tego typu jeszcze się generuje.');
  return el('article', { class: 'typer-rationale card' }, [body]);
}

export function alternativesSection(alternatives) {
  if (!alternatives || alternatives.length === 0) return null;
  return el('section', { class: 'typer-alts card' }, [
    el('h2', { class: 'typer-section__title' }, 'Zestawy zapasowe'),
    el('p', { class: 'typer-section__lead' }, 'Trzy kolejne miejsca z tej samej, deterministycznej enumeracji.'),
    el(
      'ol',
      { class: 'typer-alts__list' },
      alternatives.map((set, i) =>
        el('li', { class: 'typer-alts__item' }, [
          el('span', { class: 'typer-alts__rank' }, `#${i + 2}`),
          ballRow(set, { alt: true }),
        ])
      )
    ),
  ]);
}

export function numbersTable(numberStats) {
  if (!numberStats || numberStats.length === 0) return null;
  const head = el('thead', {}, [
    el('tr', {}, [
      el('th', {}, 'Liczba'),
      el('th', {}, 'W historii'),
      el('th', {}, 'Ostatnio'),
      el('th', {}, 'z-score'),
      el('th', {}, 'Przerwa'),
    ]),
  ]);
  const body = el(
    'tbody',
    {},
    numberStats.map((s) =>
      el('tr', {}, [
        el('td', { class: 'typer-numbers__n' }, String(s.number)),
        el('td', {}, s.total != null ? formatInt(s.total) : '—'),
        el(
          'td',
          {},
          s.lastDrawNumber != null && s.lastDrawnAt
            ? `nr ${s.lastDrawNumber} · ${formatShortDate(s.lastDrawnAt)}`
            : '—'
        ),
        el('td', {}, signedDecimal(s.zScore)),
        el('td', {}, s.currentGap != null ? String(s.currentGap) : '—'),
      ])
    )
  );
  return el('section', { class: 'typer-numbers card' }, [
    el('h2', { class: 'typer-section__title' }, 'Liczba po liczbie'),
    el('div', { class: 'typer-numbers__scroll' }, [el('table', { class: 'typer-numbers__table' }, [head, body])]),
  ]);
}

function tile(label, value, sub) {
  return el('div', { class: 'typer-null__tile' }, [
    el('span', { class: 'typer-null__label' }, label),
    el('span', { class: 'typer-null__value' }, value),
    sub ? el('span', { class: 'typer-null__sub' }, sub) : null,
  ]);
}

export function nullHypothesisSection(nullHypothesis) {
  const nh = nullHypothesis || { expectedPerCoupon: 36 / 49, evaluatedCount: 0, totalHits: 0, expectedHits: 0 };
  const tiles = [
    tile('Oczekiwane / kupon', formatDecimal(nh.expectedPerCoupon, 4), '36/49 — stała teoretyczna'),
  ];
  if (nh.evaluatedCount > 0) {
    tiles.push(tile('Rozliczone typy', formatInt(nh.evaluatedCount), null));
    tiles.push(
      tile(
        'Trafienia: model vs oczekiwane',
        `${formatInt(nh.totalHits)} vs ${formatDecimal(nh.expectedHits, 2)}`,
        'skumulowane'
      )
    );
  }
  return el('section', { class: 'typer-null card' }, [
    el('h2', { class: 'typer-section__title' }, 'Hipoteza zerowa: „Sprawdzam!”'),
    el('p', { class: 'typer-section__lead' },
      'Piszemy to z góry: model NIE pobije losowości w liczbie trafień — i nie powinien. ' +
        'Jego przewaga siedzi w EV | wygrana (oczekiwanej wypłacie, jeśli szóstka padnie), ' +
        'a tego nie zmierzymy bez wygranej. To jest uczciwe i to jest fajne.'),
    el('div', { class: 'typer-null__tiles' }, tiles),
  ]);
}

function hitsText(entry) {
  if (entry.hits == null) return el('span', { class: 'typer-hist__pending' }, 'czeka na wynik');
  const label = `${entry.hits} ${pluralPl(entry.hits, HITS_FORMS)}`;
  const tier = entry.prizeTier != null ? ` · ${TIER_LABEL[entry.prizeTier] || `stopień ${entry.prizeTier}`}` : '';
  const cls = entry.prizeTier != null ? 'typer-hist__hits typer-hist__hits--win' : 'typer-hist__hits';
  return el('span', { class: cls }, `${label}${tier}`);
}

export function historySection(history) {
  const children = [
    el('h2', { class: 'typer-section__title' }, 'Historia typów'),
  ];
  if (!history || history.length === 0) {
    children.push(
      el('p', { class: 'typer-section__lead' },
        'Pierwszy typ dopiero czeka na swoje losowanie. Po nim „Sprawdzam!” dopisze tu trafienia.')
    );
  } else {
    children.push(
      el(
        'ul',
        { class: 'typer-hist__list' },
        history.map((entry) =>
          el('li', { class: 'typer-hist__item' }, [
            el('span', { class: 'typer-hist__draw' }, `nr ${entry.forDrawNumber}`),
            el('span', { class: 'typer-hist__nums' }, entry.numbers.join(' · ')),
            entry.resultNumbers
              ? el('span', { class: 'typer-hist__result' }, `wynik: ${entry.resultNumbers.join(' · ')}`)
              : null,
            hitsText(entry),
          ])
        )
      )
    );
  }
  children.push(
    el('p', { class: 'typer-hist__note' },
      'Wykres skumulowanych trafień vs oczekiwane 0,7347 na kupon (pasmo ±2σ) dołączy w kolejnym kroku.')
  );
  return el('section', { class: 'typer-history card' }, children);
}
