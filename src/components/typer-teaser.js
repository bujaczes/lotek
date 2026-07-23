import { el } from '../dom.js';
import { createBall } from './ball.js';
import { formatLongDate } from '../format.js';

// Home -> Typer bridge card. With a live current pick it shows the real six balls and the
// draw it targets; without one (no prediction computed yet) it falls back to the honest
// "not yet live" state. Either way it links through to /typer.
export function createTyperTeaser(current = null) {
  if (current && current.prediction && Array.isArray(current.prediction.numbers)) {
    return liveTeaser(current.prediction);
  }
  return placeholderTeaser();
}

function liveTeaser(prediction) {
  const head = [el('p', { class: 'eyebrow' }, 'Typer'), el('span', { class: 'typer-teaser__status typer-teaser__status--live' }, 'Typ gotowy')];
  const meta = prediction.drawDate
    ? `Losowanie nr ${prediction.forDrawNumber} · ${formatLongDate(prediction.drawDate)}`
    : `Losowanie nr ${prediction.forDrawNumber}`;
  return el('section', { class: 'typer-teaser card' }, [
    el('div', { class: 'typer-teaser__body' }, [
      el('div', { class: 'typer-teaser__head' }, head),
      el('h2', { class: 'section__title' }, 'Typ na najbliższe losowanie'),
      el('p', { class: 'typer-teaser__meta' }, meta),
      el('div', { class: 'typer-balls typer-balls--alt' }, prediction.numbers.map((n, i) => createBall(n, i))),
      el('p', { class: 'typer-teaser__lead' }, [
        'Deterministyczny typ z pełnym „dlaczego te liczby”. Uczciwie: żaden model nie podnosi szansy na szóstkę — ',
        el('b', {}, 'liczy się opłacalność, jeśli wygra.'),
      ]),
      el('a', { class: 'typer-teaser__cta', href: '/typer' }, 'Zobacz uzasadnienie →'),
    ]),
  ]);
}

function placeholderTeaser() {
  return el('section', { class: 'typer-teaser card' }, [
    el('div', { class: 'typer-teaser__body' }, [
      el('div', { class: 'typer-teaser__head' }, [
        el('p', { class: 'eyebrow' }, 'Typer'),
        el('span', { class: 'typer-teaser__status' }, 'Startuje wkrótce'),
      ]),
      el('h2', { class: 'section__title' }, 'Jeden zestaw. Pełne uzasadnienie.'),
      el('p', { class: 'typer-teaser__lead' }, [
        'Deterministyczny typ na następne losowanie — bez losowości, z jawnym „dlaczego te liczby”. Potem ',
        el('b', {}, '„Sprawdzam!”'),
        ' rozlicza jego trafienia z oczekiwanymi 0,7347 na kupon. Uczciwie: żaden model nie podnosi szansy na szóstkę.',
      ]),
      el('a', { class: 'typer-teaser__cta', href: '/typer' }, 'Poznaj Typera →'),
    ]),
  ]);
}
