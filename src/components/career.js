import { el } from '../dom.js';
import { createBall } from './ball.js';
import { createMiniBlanket } from './mini-blanket.js';
import { chartBox, tableView, chartNote } from './stats/section.js';
import { formatInt, formatDecimal, formatShortDate, drawsAgo, pluralPl } from '../format.js';
import {
  yearSeries,
  bestYear,
  foldGapTail,
  geometricExpectation,
  zScorePoints,
  labelInterval,
  neighbourNumbers,
  GEOMETRIC_P,
} from '../charts/career-transforms.js';
import {
  baseOption,
  categoryAxis,
  valueAxis,
  grid,
  legend,
  tooltip,
  barSeries,
  lineSeries,
  CHART_COLORS,
  FONTS,
  MARKS,
} from '../charts/theme.js';

// The pieces of /liczba/:n (SPEC 6.11). Every panel is built from data the career
// endpoint already returns; the only outside number is the total draw count, used to
// put a theoretical reference next to the empirical one (CONVENTIONS, "Uczciwa rama").

const PER_DRAW_SHARE = GEOMETRIC_P;
const CHART_HEIGHT = 260;

const fmtZ = (z) => (z >= 0 ? '+' : '−') + Math.abs(z).toFixed(2).replace('.', ',');

function panel({ id, eyebrow, title, lead, children }) {
  return el('section', { class: 'career-panel', id }, [
    el('header', { class: 'career-panel__head' }, [
      eyebrow ? el('p', { class: 'eyebrow' }, eyebrow) : null,
      el('h2', { class: 'section__title' }, title),
      lead ? el('p', { class: 'career-panel__lead' }, lead) : null,
    ]),
    el('div', { class: 'panel card' }, Array.isArray(children) ? children : [children]),
  ]);
}

function navLink(number, direction) {
  if (number == null) {
    return el('span', { class: `career-nav__link is-disabled career-nav__link--${direction}`, 'aria-hidden': 'true' }, [
      el('span', { class: 'career-nav__arrow' }, direction === 'prev' ? '←' : '→'),
    ]);
  }
  return el(
    'a',
    {
      class: `career-nav__link career-nav__link--${direction}`,
      href: `/liczba/${number}`,
      'aria-label': direction === 'prev' ? `Poprzednia liczba: ${number}` : `Następna liczba: ${number}`,
    },
    direction === 'prev'
      ? [el('span', { class: 'career-nav__arrow' }, '←'), el('span', { class: 'career-nav__num mono' }, String(number))]
      : [el('span', { class: 'career-nav__num mono' }, String(number)), el('span', { class: 'career-nav__arrow' }, '→')]
  );
}

/** Big ball, the number's headline sentence, and the 1..49 walk (clamped, never wrapping). */
export function careerHeader(number, stats, totalDraws) {
  const { prev, next } = neighbourNumbers(number);
  const expected = totalDraws ? totalDraws * PER_DRAW_SHARE : null;

  const lead =
    expected == null
      ? `Wypadła ${formatInt(stats.totalCount)} ${pluralPl(stats.totalCount, ['raz', 'razy', 'razy'])} w historii Dużego Lotka.`
      : `Wypadła ${formatInt(stats.totalCount)} ${pluralPl(stats.totalCount, ['raz', 'razy', 'razy'])} w ${formatInt(totalDraws)} losowaniach — czysta teoria mówi ${formatDecimal(expected, 1)}.`;

  return el('header', { class: 'career-head' }, [
    el('div', { class: 'career-nav' }, [navLink(prev, 'prev'), navLink(next, 'next')]),
    el('div', { class: 'career-head__ball' }, [createBall(number, 0)]),
    el('div', { class: 'career-head__text' }, [
      el('p', { class: 'eyebrow' }, 'Kariera liczby'),
      el('h1', { class: 'career-head__title' }, `Liczba ${number}`),
      el('p', { class: 'career-head__lead' }, lead),
    ]),
  ]);
}

function tile(label, value, note) {
  return el('div', { class: 'career-tile' }, [
    el('p', { class: 'career-tile__label' }, label),
    el('p', { class: 'career-tile__value mono' }, value),
    note ? el('p', { class: 'career-tile__note' }, note) : null,
  ]);
}

/** The six read-at-a-glance facts. Each carries its own reference value, not just a number. */
export function careerTiles(data, totalDraws) {
  const s = data.stats;
  const best = bestYear(data.yearCounts);
  const expected = totalDraws ? totalDraws * PER_DRAW_SHARE : null;

  const streakWord = pluralPl(s.longestStreak, ['losowanie', 'losowania', 'losowań']);
  const maxGapWord = s.maxGap == null ? '' : pluralPl(s.maxGap, ['losowanie', 'losowania', 'losowań']);

  return el('div', { class: 'career-tiles' }, [
    tile(
      'Wystąpienia',
      formatInt(s.totalCount),
      expected == null ? 'w całej historii' : `teoria: ${formatDecimal(expected, 1)}`
    ),
    tile(
      'Z-score',
      s.zScore == null ? '—' : fmtZ(s.zScore),
      s.zScore == null ? 'brak danych' : 'szum mieści się w ±3σ'
    ),
    tile(
      'Aktualna przerwa',
      s.currentGap == null ? '—' : formatInt(s.currentGap),
      s.lastDrawnAt ? `ostatnio ${formatShortDate(s.lastDrawnAt)}` : 'nigdy nie wypadła'
    ),
    tile(
      'Najdłuższa seria',
      s.longestStreak ? `${formatInt(s.longestStreak)}×` : '—',
      s.longestStreak ? `${s.longestStreak} ${streakWord} z rzędu` : 'brak serii'
    ),
    tile(
      'Najlepszy rok',
      best ? String(best.year) : '—',
      best ? `${best.count} ${pluralPl(best.count, ['raz', 'razy', 'razy'])}` : 'brak danych'
    ),
    tile(
      'Rekordowa przerwa',
      s.maxGap == null ? '—' : formatInt(s.maxGap),
      s.maxGap == null ? 'brak danych' : `${maxGapWord}, do ${s.maxGapEndedAt ? formatShortDate(s.maxGapEndedAt) : '—'}`
    ),
  ]);
}

// ---- sparkline: how often per year -----------------------------------------

function yearOption(series) {
  const labels = series.years.map(String);
  return {
    ...baseOption(),
    grid: grid({ top: 26, bottom: 4 }),
    tooltip: tooltip({
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: CHART_COLORS.ink40, width: 1 } },
      formatter: (params) => `<b>${params[0].axisValue}</b><br>wypadła ${formatInt(params[0].value)}×`,
    }),
    xAxis: categoryAxis(labels, {
      axisLabel: { color: CHART_COLORS.ink55, fontFamily: FONTS.mono, fontSize: 10, interval: labelInterval(labels.length, 10) },
    }),
    yAxis: valueAxis({ minInterval: 1 }),
    series: [
      lineSeries('Wystąpienia w roku', series.counts, CHART_COLORS.empirical, {
        smooth: 0.25,
        areaStyle: { color: 'rgba(217, 154, 0, 0.14)' },
        markLine:
          series.mean == null
            ? undefined
            : {
                silent: true,
                symbol: ['none', 'none'],
                lineStyle: { color: CHART_COLORS.ink40, width: 1, type: 'solid' },
                label: {
                  formatter: `średnia ${formatDecimal(series.mean, 1)}/rok`,
                  position: 'insideEndTop',
                  color: CHART_COLORS.ink55,
                  fontFamily: FONTS.mono,
                  fontSize: 10,
                },
                data: [{ yAxis: series.mean }],
              },
      }),
    ],
  };
}

export function createYearSection(data) {
  const series = yearSeries(data.yearCounts);
  const best = bestYear(data.yearCounts);
  const box = chartBox(CHART_HEIGHT, `Częstość liczby ${data.number} w kolejnych latach`);

  const node = panel({
    id: 'lata',
    eyebrow: 'Rok po roku',
    title: 'Częstość w kolejnych latach',
    lead:
      'Ile razy ta liczba padała w każdym roku. Szczyty i doły są tym, czego się spodziewamy po rzucie ' +
      'monetą powtórzonym setki razy — nie zapowiedzią następnego losowania.',
    children: [
      box,
      chartNote(
        best
          ? [
              'Najlepszy rok: ',
              el('b', { class: 'mono' }, String(best.year)),
              ` — ${best.count} ${pluralPl(best.count, ['raz', 'razy', 'razy'])}. Średnia roczna: `,
              el('b', { class: 'mono' }, series.mean == null ? '—' : formatDecimal(series.mean, 1)),
              '.',
            ]
          : ['Ta liczba nie padła jeszcze ani razu.']
      ),
      tableView(
        `Wystąpienia liczby ${data.number} w kolejnych latach`,
        ['Rok', 'Wystąpienia'],
        series.years.map((y, i) => [String(y), formatInt(series.counts[i])])
      ),
    ],
  });

  let dispose = null;
  return {
    node,
    render(createChart) {
      if (!createChart || !series.years.length) return;
      dispose = createChart(box, yearOption(series));
    },
    destroy() {
      if (dispose) dispose();
      dispose = null;
    },
  };
}

// ---- gap histogram vs the geometric law ------------------------------------

function gapOption(bins, expected) {
  const labels = bins.map((b) => b.label);
  return {
    ...baseOption(),
    grid: grid({ top: 40, bottom: 4 }),
    legend: legend({ data: ['Empiria', 'Teoria (geometryczny)'], left: 'auto', right: 0 }),
    tooltip: tooltip({
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const i = params[0].dataIndex;
        const head = bins[i].isTail ? `przerwa ${bins[i].label} losowań` : `przerwa ${bins[i].label}`;
        return [`<b>${head}</b>`, `empiria: ${formatInt(bins[i].count)}`, `teoria: ${formatDecimal(expected[i], 1)}`].join('<br>');
      },
    }),
    // No axis name: it is the last thing on the row and gets clipped by the grid edge.
    // The panel lead and the note below already say what the axis counts.
    xAxis: categoryAxis(labels, {
      axisLabel: { color: CHART_COLORS.ink55, fontFamily: FONTS.mono, fontSize: 10, interval: labelInterval(labels.length, 12) },
    }),
    yAxis: valueAxis({ minInterval: 1 }),
    series: [
      barSeries('Empiria', bins.map((b) => b.count), CHART_COLORS.empirical),
      lineSeries('Teoria (geometryczny)', expected, CHART_COLORS.theoretical, { z: 3, smooth: false }),
    ],
  };
}

export function createGapSection(data) {
  const { bins, tailFrom } = foldGapTail(data.gapHistogram.histogram, 0.995);
  const total = data.gapHistogram.total;
  const expected = geometricExpectation(bins, total);
  const box = chartBox(CHART_HEIGHT, `Rozkład przerw między wystąpieniami liczby ${data.number}`);

  const node = panel({
    id: 'przerwy',
    eyebrow: 'Przerwy',
    title: 'Ile losowań czeka ta liczba',
    lead:
      'Słupki to zmierzone przerwy między kolejnymi wystąpieniami, linia to rozkład geometryczny z p = 6/49 — ' +
      'czyli to, co dałby czysty przypadek. Pokrywają się, i właśnie dlatego długa przerwa nie zapowiada powrotu.',
    children: [
      box,
      chartNote([
        'Zmierzone przerwy: ',
        el('b', { class: 'mono' }, formatInt(total)),
        '. Średnia teoretyczna: ',
        el('b', { class: 'mono' }, formatDecimal(1 / GEOMETRIC_P - 1, 1)),
        ' losowania',
        tailFrom == null ? '' : `. Ostatni słupek zbiera wszystkie przerwy od ${tailFrom} w górę.`,
      ]),
      tableView(
        `Rozkład przerw liczby ${data.number} — empiria vs rozkład geometryczny`,
        ['Przerwa', 'Empiria', 'Teoria'],
        bins.map((b, i) => [b.label, formatInt(b.count), formatDecimal(expected[i], 1)])
      ),
    ],
  });

  let dispose = null;
  return {
    node,
    render(createChart) {
      if (!createChart || !bins.length) return;
      dispose = createChart(box, gapOption(bins, expected));
    },
    destroy() {
      if (dispose) dispose();
      dispose = null;
    },
  };
}

// ---- z-score over time ------------------------------------------------------

function zOption(points) {
  const bound = Math.max(3, Math.ceil(points.maxAbs));
  const band = (value, label) => ({
    yAxis: value,
    lineStyle: { color: CHART_COLORS.ink40, width: 1, type: value === 0 ? 'solid' : 'dashed' },
    label: { formatter: label, position: 'insideEndTop', color: CHART_COLORS.ink40, fontFamily: FONTS.mono, fontSize: 10 },
  });

  return {
    ...baseOption(),
    grid: grid({ top: 26, bottom: 4 }),
    tooltip: tooltip({
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: CHART_COLORS.ink40, width: 1 } },
      formatter: (params) => {
        const i = params[0].dataIndex;
        const p = points.points[i];
        return [
          `<b>po ${formatInt(p.k)} losowaniach</b> (${points.years[i]})`,
          `wystąpienia: ${formatInt(p.count)}`,
          `z-score: ${fmtZ(p.zScore)}`,
        ].join('<br>');
      },
    }),
    xAxis: categoryAxis(points.categories, {
      axisLabel: {
        color: CHART_COLORS.ink55,
        fontFamily: FONTS.mono,
        fontSize: 10,
        interval: labelInterval(points.categories.length, 8),
      },
    }),
    yAxis: valueAxis({ min: -bound, max: bound, interval: 1 }),
    series: [
      lineSeries('Z-score', points.values, CHART_COLORS.empirical, {
        lineStyle: { color: CHART_COLORS.empirical, width: MARKS.lineWidth, cap: 'round', join: 'round' },
        markLine: { silent: true, symbol: ['none', 'none'], data: [band(0, '0'), band(2, '+2σ'), band(-2, '−2σ')] },
      }),
    ],
  };
}

export function createZScoreSection(data) {
  const points = zScorePoints(data.zScoreSeries);
  const extreme = points.values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
  const box = chartBox(CHART_HEIGHT, `Z-score liczby ${data.number} w czasie`);

  const node = panel({
    id: 'zscore',
    eyebrow: 'Z-score w czasie',
    title: 'Jak daleko od średniej, co 100 losowań',
    lead:
      'Z-score liczony wyłącznie z losowań widzianych do danego punktu. Linia błąka się wokół zera i nie ucieka ' +
      'z pasa ±2σ — tak wygląda liczba, która nie ma żadnej przewagi.',
    children: [
      box,
      chartNote(
        points.values.length
          ? [
              'Największe odchylenie w historii tej liczby: ',
              el('b', { class: 'mono' }, fmtZ(extreme)),
              '. Wartość ±3σ to granica, poza którą nie wychodzi żadna z 49 liczb.',
            ]
          : ['Za mało losowań, żeby policzyć choć jeden punkt kontrolny.']
      ),
      tableView(
        `Z-score liczby ${data.number} w kolejnych punktach kontrolnych`,
        ['Po losowaniu', 'Wystąpienia', 'Z-score'],
        points.points.map((p) => [formatInt(p.k), formatInt(p.count), fmtZ(p.zScore)])
      ),
    ],
  });

  let dispose = null;
  return {
    node,
    render(createChart) {
      if (!createChart || !points.values.length) return;
      dispose = createChart(box, zOption(points));
    },
    destroy() {
      if (dispose) dispose();
      dispose = null;
    },
  };
}

// ---- position on the coupon -------------------------------------------------

export function createPositionSection(data) {
  const { row, col } = data.blanket;
  const mini = createMiniBlanket({
    selected: [data.number],
    linked: true,
    ariaLabel: `Blankiet 7 na 7 z zaznaczoną liczbą ${data.number}`,
  });

  return panel({
    id: 'blankiet',
    eyebrow: 'Na kuponie',
    title: 'Gdzie jej szukać na blankiecie',
    lead: `Wiersz ${row + 1}, kolumna ${col + 1}. Każde pole prowadzi do kariery swojej liczby.`,
    children: [el('div', { class: 'career-mini' }, [mini.node])],
  });
}

// ---- absence read-out -------------------------------------------------------

export function absenceNote(stats) {
  if (stats.currentGap == null) return null;
  return el('p', { class: 'career-absence' }, [
    'Ostatnio wypadła ',
    el('b', { class: 'mono' }, stats.lastDrawnAt ? formatShortDate(stats.lastDrawnAt) : '—'),
    stats.lastDrawNumber ? ' w losowaniu ' : '',
    stats.lastDrawNumber ? el('a', { class: 'mono', href: `/losowanie/${stats.lastDrawNumber}` }, `nr ${stats.lastDrawNumber}`) : null,
    ` — ${drawsAgo(stats.currentGap)}.`,
  ]);
}
