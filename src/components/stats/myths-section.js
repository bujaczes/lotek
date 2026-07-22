import { el } from '../../dom.js';
import { formatInt, formatPercent, formatDecimal } from '../../format.js';
import { statsSection, chartNote } from './section.js';

// SPEC 6.7 + 6.8. Two numbers that beat intuition, so the form is a stat tile with a
// meter (a one-bar bar chart would be worse) — empirical fill, theoretical tick.

function deltaLabel(empirical, theoretical) {
  const pp = (empirical - theoretical) * 100;
  const sign = pp >= 0 ? '+' : '−';
  return `${sign}${formatDecimal(Math.abs(pp), 2)} p.p. względem teorii`;
}

function statTile({ label, empirical, theoretical, basis, myth }) {
  const pct = (v) => `${Math.min(100, Math.max(0, v * 100))}%`;
  return el('div', { class: 'panel card stat-tile' }, [
    el('span', { class: 'stat-tile__label' }, label),
    el('strong', { class: 'stat-tile__value' }, formatPercent(empirical)),
    el('span', { class: 'stat-tile__delta' }, deltaLabel(empirical, theoretical)),
    el('div', { class: 'meter', role: 'img', 'aria-label': `Empiria ${formatPercent(empirical)}, teoria ${formatPercent(theoretical)}` }, [
      el('span', { class: 'meter__fill', style: { width: pct(empirical) } }),
      el('span', { class: 'meter__tick', style: { left: pct(theoretical) } }),
    ]),
    el('div', { class: 'meter__legend' }, [
      el('span', { class: 'meter__key meter__key--empirical' }, 'empiria'),
      el('span', { class: 'meter__key meter__key--theoretical' }, [
        'teoria ',
        el('b', { class: 'mono' }, formatPercent(theoretical)),
      ]),
    ]),
    el('p', { class: 'stat-tile__basis mono' }, basis),
    el('p', { class: 'stat-tile__myth' }, myth),
  ]);
}

export function createMythsSection({ consecutive, repeats }) {
  const node = statsSection({
    index: 5,
    id: 'mity',
    title: 'Sąsiadujące i powtórki',
    lead:
      'Dwie liczby, w które prawie nikt nie wierzy, dopóki ich nie policzy. Obie wynikają wprost z kombinatoryki ' +
      'i obie potwierdza 70 lat losowań — z dokładnością do ułamka punktu procentowego.',
    children: [
      el('div', { class: 'structure__grid' }, [
        statTile({
          label: 'Losowania z parą kolejnych liczb',
          empirical: consecutive.empiricalShare,
          theoretical: consecutive.theoretical,
          basis: `${formatInt(consecutive.draws)} losowań`,
          myth:
            'Wielu graczy skreśla „rozrzucone” liczby, bo para 23–24 nie wygląda losowo. ' +
            'A wygląda: 1 − C(44,6)/C(49,6) = 49,52%, czyli mniej więcej co drugie losowanie.',
        }),
        statTile({
          label: 'Losowania ze wspólną liczbą z poprzednim',
          empirical: repeats.empiricalShare,
          theoretical: repeats.theoretical,
          basis: `${formatInt(repeats.comparedDraws)} par kolejnych losowań`,
          myth:
            '„Ta liczba dopiero co padła, teraz odpoczywa” — nie odpoczywa. ' +
            '1 − C(43,6)/C(49,6) = 56,40% losowań ma co najmniej jedną wspólną liczbę z poprzednim.',
        }),
      ]),
      chartNote(
        'Kule nie mają pamięci. Obie empiryczne wartości trzymają się teorii w granicach jednego punktu procentowego ' +
          '— i to najlepszy dowód, że w losowaniu nie ma nic poza losowaniem.'
      ),
    ],
  });

  return { node };
}
