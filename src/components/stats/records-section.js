import { el } from '../../dom.js';
import { formatInt, formatPercent, formatShortDate, pluralPl } from '../../format.js';
import { statsSection, chartNote } from './section.js';

// SPEC 6.13 (+ 6.15 birthday-ness). Extremes are a KPI row of stat tiles, not a chart:
// each is a single number with one draw behind it.

function drawLink(draw) {
  return el('a', { class: 'record-card__draw', href: `/losowanie/${draw.drawNumber}` }, [
    el('span', { class: 'mono' }, `nr ${draw.drawNumber}`),
    ' · ',
    formatShortDate(draw.date),
  ]);
}

function balls(numbers, highlight = []) {
  const marked = new Set(highlight);
  return el(
    'span',
    { class: 'record-card__balls' },
    numbers.map((n) =>
      el('span', { class: `miniball miniball--sm mono${marked.has(n) ? ' miniball--marked' : ''}` }, String(n))
    )
  );
}

function card({ label, value, unit, meta = [], footer }) {
  return el('div', { class: 'panel card record-card' }, [
    el('span', { class: 'record-card__label' }, label),
    el('span', { class: 'record-card__value' }, [
      value,
      unit ? el('span', { class: 'record-card__unit' }, unit) : null,
    ]),
    ...meta,
    footer ? el('p', { class: 'record-card__foot' }, footer) : null,
  ]);
}

function tieNote(list) {
  const extra = list.length - 1;
  if (extra <= 0) return null;
  return el(
    'span',
    { class: 'record-card__tie' },
    ` i ${extra} ${pluralPl(extra, ['inne losowanie', 'inne losowania', 'innych losowań'])}`
  );
}

function sumCard(label, entry, footer) {
  const first = entry.draws[0];
  return card({
    label,
    value: formatInt(entry.value),
    meta: first ? [el('p', { class: 'record-card__meta' }, [drawLink(first), tieNote(entry.draws)]), balls(first.numbers)] : [],
    footer,
  });
}

export function createRecordsSection(data) {
  const run = data.longestRun.draws[0];
  const drought = data.longestDrought;
  const absence = data.recordAbsence;
  const birthday = data.birthdayness;

  const cards = [
    sumCard('Najwyższa suma', data.maxSum, 'Maksimum możliwe to 279 (44+45+46+47+48+49).'),
    sumCard('Najniższa suma', data.minSum, 'Minimum możliwe to 21 (1+2+3+4+5+6).'),
    card({
      label: 'Najdłuższy ciąg kolejnych liczb',
      value: formatInt(data.longestRun.length),
      unit: pluralPl(data.longestRun.length, ['liczba', 'liczby', 'liczb']),
      meta: run
        ? [el('p', { class: 'record-card__meta' }, [drawLink(run), tieNote(data.longestRun.draws)]), balls(run.numbers, run.run)]
        : [],
      footer: 'Ciąg sześciu kolejnych liczb jest możliwy — jest ich 44 na 13 983 816 zestawów.',
    }),
    card({
      label: 'Najdłuższa seria bez liczby z pierwszej dziesiątki',
      value: formatInt(drought.length),
      unit: pluralPl(drought.length, ['losowanie', 'losowania', 'losowań']),
      meta:
        drought.from && drought.to
          ? [
              el('p', { class: 'record-card__meta' }, [
                drawLink({ drawNumber: drought.from.drawNumber, date: drought.from.date }),
                ' → ',
                drawLink({ drawNumber: drought.to.drawNumber, date: drought.to.date }),
              ]),
            ]
          : [],
      footer: 'Szansa, że w losowaniu nie ma żadnej liczby 1–10, to C(39,6)/C(49,6) ≈ 23,3% — seria taka jak ta jest do przewidzenia.',
    }),
    card({
      label: 'Rekordowa absencja liczby',
      value: absence ? formatInt(absence.gap) : '—',
      unit: absence ? pluralPl(absence.gap, ['losowanie', 'losowania', 'losowań']) : null,
      meta: absence
        ? [
            el('p', { class: 'record-card__meta' }, [
              el('a', { class: 'record-card__draw', href: `/liczba/${absence.number}` }, [
                'liczba ',
                el('span', { class: 'mono' }, String(absence.number)),
              ]),
              absence.type === 'ongoing'
                ? ' · seria wciąż trwa'
                : absence.endedAt
                  ? ` · seria zakończona ${formatShortDate(absence.endedAt)}`
                  : '',
            ]),
          ]
        : [],
      footer: 'Przerwa nie zwiększa szansy. Średnia przerwa to 49/6 ≈ 8,2 losowania, a ogon rozkładu geometrycznego sięga daleko.',
    }),
    birthday
      ? card({
          label: 'Urodzinowość ostatniego losowania',
          value: `${birthday.count}/6`,
          meta: [
            el('p', { class: 'record-card__meta' }, [
              'liczby ≤ 31 · ',
              el('span', { class: 'mono' }, formatPercent(birthday.share, 0)),
              ' przy teorii ',
              el('span', { class: 'mono' }, formatPercent(birthday.theoretical, 0)),
            ]),
          ],
          footer: 'Im więcej liczb ≤ 31, tym więcej kuponów z datami urodzin trafia to samo — i tym bardziej dzieli się nagroda.',
        })
      : null,
  ].filter(Boolean);

  const node = statsSection({
    index: 7,
    id: 'rekordy',
    title: 'Rekordy',
    lead:
      'Skrajności z 70 lat. Każda z nich jest dokładnie tym, czego przy takiej liczbie losowań należało oczekiwać — ' +
      'rekord to nie anomalia, tylko maksimum z długiej serii.',
    children: [el('div', { class: 'records__grid' }, cards), chartNote('Kliknij numer losowania, żeby zobaczyć je w całości.')],
  });

  return { node };
}
