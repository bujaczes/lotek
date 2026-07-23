import { el } from '../dom.js';

// "Ciekawostka dnia" card shown just under the hero. Purely presentational — the honest,
// deterministic copy is built server-side in src/server/lib/facts.js. Returns null when
// there is no fact (e.g. an empty database), so the caller can skip appending anything.
export function createFactCard(fact) {
  if (!fact || !fact.text) return null;
  return el('section', { class: 'fact-card card', dataset: { factType: fact.type || '' } }, [
    el('p', { class: 'eyebrow' }, 'Ciekawostka dnia'),
    el('p', { class: 'fact-card__text' }, fact.text),
  ]);
}
