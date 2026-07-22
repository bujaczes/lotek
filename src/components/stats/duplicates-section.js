import { el } from '../../dom.js';
import { formatInt, formatDecimal, formatPercent, formatShortDate } from '../../format.js';
import { pairsOf, poissonZero } from '../../charts/transforms.js';
import { statsSection, chartNote } from './section.js';

// SPEC 6.9. Has any full six ever repeated? The panel is a verdict, not a chart —
// there is one number and it is either 0 or very small.

const ALL_COMBINATIONS = 13983816;

function collisionGroup(group) {
  return el('li', { class: 'dup-group' }, [
    el('span', { class: 'dup-group__balls' }, group.numbers.map((n) => el('span', { class: 'miniball miniball--sm mono' }, String(n)))),
    el(
      'span',
      { class: 'dup-group__when' },
      group.occurrences
        .map((o) => `nr ${o.drawNumber} (${formatShortDate(o.date)})`)
        .join(' · ')
    ),
  ]);
}

export function createDuplicatesSection(data, drawsCount) {
  const found = data.groups.length;
  const expected = data.expectedCollisions;
  const pairs = drawsCount != null ? pairsOf(drawsCount) : null;

  const verdict = found === 0
    ? el('div', { class: 'verdict verdict--premiera dup__verdict' }, 'Ani jedna szóstka nie powtórzyła się nigdy')
    : el('div', { class: 'verdict verdict--dejavu dup__verdict' }, `Powtórzone szóstki: ${formatInt(found)}`);

  const node = statsSection({
    index: 6,
    id: 'szostki',
    title: 'Powtórzone szóstki',
    lead:
      'Czy jakakolwiek pełna szóstka padła w historii dwa razy? Intuicja mówi „na pewno nie”, paradoks dnia urodzin mówi „to bliższe niż myślisz”. ' +
      'Rozstrzyga jedno zapytanie po masce bitowej.',
    children: [
      el('div', { class: 'panel card dup' }, [
        verdict,
        found > 0 ? el('ul', { class: 'dup-list' }, data.groups.map(collisionGroup)) : null,
        el('dl', { class: 'dup-math' }, [
          el('div', { class: 'dup-math__row' }, [
            el('dt', {}, 'Par losowań do porównania'),
            el('dd', { class: 'mono' }, pairs == null ? '—' : formatInt(pairs)),
          ]),
          el('div', { class: 'dup-math__row' }, [
            el('dt', {}, 'Szansa pary na kolizję'),
            el('dd', { class: 'mono' }, `1 / ${formatInt(ALL_COMBINATIONS)}`),
          ]),
          el('div', { class: 'dup-math__row' }, [
            el('dt', {}, 'Oczekiwane kolizje'),
            el('dd', { class: 'mono' }, formatDecimal(expected, 2)),
          ]),
          el('div', { class: 'dup-math__row' }, [
            el('dt', {}, 'Znalezione kolizje'),
            el('dd', { class: 'mono' }, formatInt(found)),
          ]),
        ]),
        chartNote([
          'To nie jest sprzeczność: oczekiwane ',
          el('b', { class: 'mono' }, formatDecimal(expected, 2)),
          ' to średnia, a nie obietnica. Przy rozkładzie Poissona z takim parametrem szansa na ',
          el('b', {}, 'zero'),
          ' kolizji wynosi ',
          el('b', { class: 'mono' }, formatPercent(poissonZero(expected), 0)),
          '. Paradoks dnia urodzin dotyczy par, nie losowań: par jest kwadratowo więcej niż losowań i dlatego ' +
            'kolizja jest w ogóle w zasięgu, mimo 13,98 mln możliwych zestawów.',
        ]),
      ]),
    ],
  });

  return { node };
}
