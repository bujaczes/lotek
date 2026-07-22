import { el } from '../dom.js';
import { createBall } from './ball.js';
import { formatInt, formatLongDate, formatShortDate, pluralPl } from '../format.js';
import { sumPercentile, sumSector } from '../charts/career-transforms.js';
import { percentileLabel } from '../charts/transforms.js';
import { serializeNumbers } from '../selection.js';

// The detail half of /losowanie/:nr. Everything retrospective (verdict, chips, nearest
// neighbour) is computed by the API against the state BEFORE this draw — which means
// draw nr 1 legitimately has no neighbour, no prior sightings and no previous draw.
// Every one of those is rendered as a first-draw statement, not as a missing value.

function verdictBlock(verdict) {
  if (!verdict) return null;
  if (verdict.type === 'dejavu') {
    return el('div', { class: 'verdict-wrap' }, [
      el('span', { class: 'verdict verdict--dejavu' }, [
        'DÉJÀ VU',
        el('a', { href: `/losowanie/${verdict.priorDrawNumber}` }, `nr ${verdict.priorDrawNumber}`),
      ]),
      el('p', { class: 'verdict-note' }, `Ta szóstka padła już ${formatShortDate(verdict.priorDate)} — identyczna kombinacja.`),
    ]);
  }
  return el('div', { class: 'verdict-wrap' }, [
    el('span', { class: 'verdict verdict--premiera' }, 'PREMIERA'),
    el('p', { class: 'verdict-note' }, 'Ta szóstka nigdy wcześniej nie padła.'),
  ]);
}

function chipCard(chip) {
  const seen = chip.lastSeenBefore ? `ostatnio ${formatShortDate(chip.lastSeenBefore.date)}` : 'pierwszy raz';
  return el('a', { class: 'chip', href: `/liczba/${chip.number}` }, [
    el('span', { class: 'chip__num mono' }, String(chip.number)),
    el('span', { class: 'chip__count' }, [
      el('b', { class: 'mono' }, formatInt(chip.countBefore)),
      ` ${pluralPl(chip.countBefore, ['raz', 'razy', 'razy'])} wcześniej`,
    ]),
    el('span', { class: 'chip__seen' }, seen),
  ]);
}

function neighborCard(nn) {
  if (!nn) {
    return el('div', { class: 'neighbor card neighbor--none' }, [
      el('p', { class: 'eyebrow' }, 'Najbliższy historyczny sąsiad'),
      el('p', { class: 'neighbor__lead' }, 'Brak — to pierwsze losowanie w historii, nie miało z czym się porównać.'),
    ]);
  }
  return el('div', { class: 'neighbor card' }, [
    el('p', { class: 'eyebrow' }, 'Najbliższy historyczny sąsiad'),
    el('p', { class: 'neighbor__lead' }, [
      el('a', { class: 'mono', href: `/losowanie/${nn.drawNumber}` }, `nr ${nn.drawNumber}`),
      ` — ${formatShortDate(nn.date)}`,
    ]),
    el('p', { class: 'neighbor__shared' }, [
      el('b', { class: 'mono' }, String(nn.shared)),
      ` ${pluralPl(nn.shared, ['wspólna liczba', 'wspólne liczby', 'wspólnych liczb'])}: `,
      el('span', { class: 'mono' }, nn.sharedNumbers.join('  ')),
    ]),
  ]);
}

function stepLink(target, direction) {
  if (!target) {
    return el('span', { class: `draw-step is-disabled draw-step--${direction}` }, [
      el('span', { class: 'draw-step__arrow' }, direction === 'prev' ? '←' : '→'),
      el('span', { class: 'draw-step__label' }, direction === 'prev' ? 'to pierwsze losowanie' : 'to ostatnie losowanie'),
    ]);
  }
  const label = [
    el('span', { class: 'draw-step__nr mono' }, `nr ${target.drawNumber}`),
    el('span', { class: 'draw-step__date mono' }, formatShortDate(target.date)),
  ];
  return el(
    'a',
    {
      class: `draw-step draw-step--${direction}`,
      href: `/losowanie/${target.drawNumber}`,
      'aria-label': `${direction === 'prev' ? 'Poprzednie' : 'Następne'} losowanie: nr ${target.drawNumber}`,
    },
    direction === 'prev'
      ? [el('span', { class: 'draw-step__arrow' }, '←'), el('span', { class: 'draw-step__body' }, label)]
      : [el('span', { class: 'draw-step__body' }, label), el('span', { class: 'draw-step__arrow' }, '→')]
  );
}

/** Sum read-out. `sumHistogram` may be null — then the percentile line is simply absent. */
function sumBlock(sum, sumHistogram) {
  const percentile = sumPercentile(sumHistogram || [], sum);
  const sector = sumSector(percentile);
  const position = percentile == null ? null : Math.min(100, Math.max(0, percentile));

  return el('div', { class: 'draw-sum card' }, [
    el('div', { class: 'draw-sum__head' }, [
      el('p', { class: 'eyebrow' }, 'Suma losowania'),
      el('p', { class: 'draw-sum__value mono' }, String(sum)),
    ]),
    percentile == null
      ? el('p', { class: 'draw-sum__note' }, 'Zakres możliwych sum: 21–279, średnia 150.')
      : el('div', { class: 'draw-sum__scale' }, [
          el('div', { class: 'draw-sum__track' }, [
            el('span', { class: 'draw-sum__marker', style: { left: `${position}%` }, 'aria-hidden': 'true' }),
          ]),
          el('p', { class: 'draw-sum__note' }, [
            el('b', {}, percentileLabel(percentile) || '—'),
            ` — sektor ${sector}. Zakres 21–279, średnia 150.`,
          ]),
        ]),
  ]);
}

export function createDrawDetail(data, { sumHistogram = null } = {}) {
  const wehikulHref = `/wehikul?zestaw=${serializeNumbers(data.numbers)}`;

  return el('article', { class: 'draw-detail', id: 'losowanie' }, [
    el('header', { class: 'draw-detail__head' }, [
      el('p', { class: 'eyebrow' }, 'Losowanie'),
      el('h1', { class: 'draw-detail__title mono' }, `nr ${data.drawNumber}`),
      el('p', { class: 'draw-detail__date' }, formatLongDate(data.date)),
    ]),

    el(
      'div',
      { class: 'balls', role: 'group', 'aria-label': `Wylosowane liczby: ${data.numbers.join(', ')}` },
      data.numbers.map((n, i) => createBall(n, i))
    ),

    el('div', { class: 'draw-detail__verdict' }, [verdictBlock(data.verdict)]),

    sumBlock(data.sum, sumHistogram),

    el('div', { class: 'chips-block' }, [
      el('p', { class: 'eyebrow' }, 'Historia tych liczb przed tym losowaniem'),
      el('div', { class: 'chips' }, (data.chips || []).map(chipCard)),
    ]),

    neighborCard(data.nearestNeighbor),

    el('p', { class: 'draw-detail__cta' }, [
      el('a', { class: 'btn', href: wehikulHref }, 'Zagraj tym zestawem w wehikule'),
    ]),

    el('nav', { class: 'draw-steps', 'aria-label': 'Sąsiednie losowania' }, [
      stepLink(data.prev, 'prev'),
      stepLink(data.next, 'next'),
    ]),
  ]);
}
