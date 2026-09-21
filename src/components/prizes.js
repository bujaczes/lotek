import { el } from '../dom.js';
import { formatInt, formatPln, pluralPl } from '../format.js';

// "Wygrane" card, shared by the home hero and /losowanie/:nr: winners and the amount of
// ONE win per tier, straight from the API's `prizes` field (see src/server/lib/prize-store.js).

const HITS_FORMS = ['trafienie', 'trafienia', 'trafień'];
const WINNERS_FORMS = ['wygrana', 'wygrane', 'wygranych'];
const NOTES = {
  pending: 'Wygrane pojawią się, gdy Totalizator je ogłosi.',
  unavailable: 'Totalizator udostępnia wygrane od 25.08.2011.',
};

function tierRow(tier) {
  const jackpot = tier.hits === 6 && tier.winners === 0;
  return el('li', { class: 'prizes__row' }, [
    el('span', { class: 'prizes__hits' }, `${tier.hits} ${pluralPl(tier.hits, HITS_FORMS)}`),
    el(
      'span',
      { class: 'prizes__winners' },
      jackpot ? 'brak' : `${formatInt(tier.winners)} ${pluralPl(tier.winners, WINNERS_FORMS)}`
    ),
    el('span', { class: 'prizes__amount mono' }, jackpot ? 'kumulacja' : formatPln(tier.amount)),
  ]);
}

export function createPrizesCard(prizes) {
  if (!prizes) return null;
  const body =
    prizes.status === 'ok'
      ? el('ul', { class: 'prizes__list' }, prizes.tiers.map(tierRow))
      : el('p', { class: 'prizes__note' }, NOTES[prizes.status] ?? NOTES.pending);
  return el('div', { class: `prizes card prizes--${prizes.status}` }, [el('p', { class: 'eyebrow' }, 'Wygrane'), body]);
}
