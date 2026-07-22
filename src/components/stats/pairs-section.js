import { el } from '../../dom.js';
import { formatInt, formatDecimal } from '../../format.js';
import { formatLift, liftBar } from '../../charts/transforms.js';
import { statsSection, chartNote } from './section.js';

// SPEC 6.4. Top 15 pairs and triples with their lift over expectation. The story is
// that the "hottest" duo is barely 1.3x expected — exactly the size of deviation you
// get for free when you take the maximum over 1176 pairs.

const PAIR_COUNT = 1176; // C(49,2)
const TRIPLE_COUNT = 18424; // C(49,3)
// Pairs are observed ~94x and triples ~8x, so their sampling noise differs by an order of
// magnitude. One shared domain would flatten every pair bar to nothing; each column gets
// its own fixed domain instead, spelled out under the list.
const PAIR_DOMAIN = 0.5;
const TRIPLE_DOMAIN = 2;

function ball(n) {
  return el('a', { class: 'miniball miniball--sm mono', href: `/liczba/${n}` }, String(n));
}

function liftRow(numbers, entry, pos, domain) {
  const { side, ratio } = liftBar(entry.lift, domain);
  return el('li', { class: 'lift-row' }, [
    el('span', { class: 'lift-row__pos mono', 'aria-hidden': 'true' }, String(pos)),
    el('span', { class: 'lift-row__balls' }, numbers.map(ball)),
    el('span', { class: 'lift-row__cnt' }, [
      el('b', { class: 'mono' }, formatInt(entry.cnt)),
      ' × · oczekiwane ',
      el('span', { class: 'mono' }, formatDecimal(entry.expected, 1)),
    ]),
    el('span', { class: 'lift-bar', 'aria-hidden': 'true' }, [
      el('span', { class: 'lift-bar__axis' }),
      el('span', {
        class: `lift-bar__fill lift-bar__fill--${side}`,
        style: { '--ratio': String(ratio) },
      }),
    ]),
    el('span', { class: 'lift-row__lift mono' }, formatLift(entry.lift)),
  ]);
}

function liftColumn(title, hint, rows, domain) {
  return el('div', { class: 'panel card lift-col' }, [
    el('div', { class: 'structure__head' }, [
      el('h3', { class: 'panel__title' }, title),
      el('span', { class: 'panel__hint' }, hint),
    ]),
    el('ol', { class: 'lift-list' }, rows),
    el('p', { class: 'lift-legend' }, `pasek: odchylenie od liftu 1,00 (skala ±${formatDecimal(domain, 2)})`),
  ]);
}

export function createPairsSection(data) {
  const pairs = data.pairs.map((p, i) => liftRow([p.a, p.b], p, i + 1, PAIR_DOMAIN));
  const triples = data.triples.map((t, i) => liftRow(t.numbers, t, i + 1, TRIPLE_DOMAIN));
  const topPair = data.pairs[0];
  const topTriple = data.triples[0];

  const node = statsSection({
    index: 4,
    id: 'pary',
    title: 'Pary i trójki',
    lead:
      'Szansa, że konkretna para wypadnie w jednym losowaniu, to 6·5/(49·48) ≈ 1,276%. ' +
      'Lift to stosunek „ile razy padła” do „ile razy powinna”. Przy 1 176 parach ktoś musi być pierwszy — i to jedyny powód, dla którego czołówka istnieje.',
    children: [
      el('div', { class: 'structure__grid' }, [
        liftColumn('Top 15 par', `z ${formatInt(PAIR_COUNT)} możliwych`, pairs, PAIR_DOMAIN),
        liftColumn('Top 15 trójek', `z ${formatInt(TRIPLE_COUNT)} możliwych`, triples, TRIPLE_DOMAIN),
      ]),
      chartNote([
        'Najgorętsza para ma lift ',
        el('b', { class: 'mono' }, topPair ? formatLift(topPair.lift) : '—'),
        ', najgorętsza trójka ',
        el('b', { class: 'mono' }, topTriple ? formatLift(topTriple.lift) : '—'),
        '. To maksimum z tysięcy liczników — dokładnie tyle, ile daje sam szum. ' +
          'Żadna z tych par nie ma większej szansy w następnym losowaniu niż każda inna.',
      ]),
    ],
  });

  return { node };
}
