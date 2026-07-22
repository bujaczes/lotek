import { el } from '../dom.js';

// Quiet CTA card bridging the home page to the Typer (live in Faza 5). Until then
// it states the not-yet-live status honestly and links to the Typer page.
export function createTyperTeaser() {
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
