import { el } from '../../dom.js';
import { formatInt, formatDecimal, formatPercent } from '../../format.js';
import { structureSeries } from '../../charts/transforms.js';
import {
  baseOption,
  categoryAxis,
  valueAxis,
  grid,
  legend,
  tooltip,
  barSeries,
  CHART_COLORS,
  FONTS,
} from '../../charts/theme.js';
import { statsSection, chartBox, tableView, chartNote } from './section.js';

// SPEC 6.6. Even/odd and low/high splits: empirical share vs the exact hypergeometric
// probability (24 even numbers and 24 low numbers among 49 — not a coin flip).

const CHART_HEIGHT = 270;

function buildOption(series) {
  const peak = series.empirical.indexOf(Math.max(...series.empirical));

  return {
    ...baseOption(),
    grid: grid({ top: 42, bottom: 4 }),
    legend: legend({ data: ['Empiria', 'Teoria'] }),
    tooltip: tooltip({
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const i = params[0].dataIndex;
        return [
          `<b>${series.categories[i]}</b>`,
          `empiria: ${formatDecimal(series.empirical[i], 2)}% (${formatInt(series.counts[i])})`,
          `teoria: ${formatDecimal(series.theoretical[i], 2)}%`,
        ].join('<br>');
      },
    }),
    xAxis: categoryAxis(series.categories),
    yAxis: valueAxis({
      axisLabel: {
        color: CHART_COLORS.ink55,
        fontFamily: FONTS.mono,
        fontSize: 11,
        formatter: (v) => `${v}%`,
      },
    }),
    series: [
      barSeries('Empiria', series.empirical, CHART_COLORS.empirical, {
        barWidth: 14,
        barGap: '15%', // ~2px of surface between the pair — the dataviz "surface gap"
        label: {
          show: true,
          position: 'top',
          color: CHART_COLORS.ink70,
          fontFamily: FONTS.mono,
          fontSize: 10,
          formatter: (p) => (p.dataIndex === peak ? `${formatDecimal(p.value, 1)}%` : ''),
        },
      }),
      barSeries('Teoria', series.theoretical, CHART_COLORS.theoretical, { barWidth: 14 }),
    ],
  };
}

function subPanel({ title, hint, rows, labelFor, tableCaption, tableHeaders, chartLabel }) {
  const series = structureSeries(rows, labelFor);
  const box = chartBox(CHART_HEIGHT, chartLabel);
  const node = el('div', { class: 'panel card structure__panel' }, [
    el('div', { class: 'structure__head' }, [
      el('h3', { class: 'panel__title' }, title),
      el('span', { class: 'panel__hint' }, hint),
    ]),
    box,
    tableView(
      tableCaption,
      tableHeaders,
      rows.map((r, i) => [
        series.categories[i],
        formatInt(r.empiricalCount),
        formatPercent(r.empiricalShare),
        formatPercent(r.theoretical),
      ])
    ),
  ]);
  return { node, box, series };
}

export function createStructureSection(data, createChart) {
  const even = subPanel({
    title: 'Parzyste : nieparzyste',
    hint: '24 parzyste na 49',
    rows: data.even,
    labelFor: (k) => `${k}:${6 - k}`,
    tableCaption: 'Podział parzyste : nieparzyste w losowaniu',
    tableHeaders: ['Podział', 'Losowań', 'Empiria', 'Teoria'],
    chartLabel: 'Rozkład liczby parzystych w losowaniu — empiria vs teoria',
  });
  const low = subPanel({
    title: 'Niskie : wysokie',
    hint: '1–24 kontra 25–49',
    rows: data.low,
    labelFor: (k) => `${k}:${6 - k}`,
    tableCaption: 'Podział niskie (1–24) : wysokie (25–49) w losowaniu',
    tableHeaders: ['Podział', 'Losowań', 'Empiria', 'Teoria'],
    chartLabel: 'Rozkład liczby niskich w losowaniu — empiria vs teoria',
  });

  const evenPeak = data.even.reduce((a, b) => (b.theoretical > a.theoretical ? b : a));

  const node = statsSection({
    index: 3,
    id: 'struktura',
    title: 'Struktura losowania',
    lead:
      'Podział 3:3 wygląda na „sprawiedliwy” i rzeczywiście wypada najczęściej — ale nie dlatego, że losowanie dba o równowagę. ' +
      'Po prostu takich zestawów jest najwięcej. Rozkład jest hipergeometryczny, nie dwumianowy: nieparzystych liczb jest 25, parzystych 24.',
    children: [
      el('div', { class: 'structure__grid' }, [even.node, low.node]),
      chartNote([
        'Teoria dla podziału ',
        el('b', {}, `${evenPeak.k}:${6 - evenPeak.k}`),
        ' (parzyste:nieparzyste): ',
        el('b', { class: 'mono' }, formatPercent(evenPeak.theoretical)),
        ' — empiria: ',
        el('b', { class: 'mono' }, formatPercent(evenPeak.empiricalShare)),
        '. Odchylenia rzędu dziesiątych części procenta to szum próby, nie tendencja.',
      ]),
    ],
  });

  const disposers = [];
  return {
    node,
    render() {
      if (!createChart) return;
      disposers.push(createChart(even.box, buildOption(even.series)));
      disposers.push(createChart(low.box, buildOption(low.series)));
    },
    destroy() {
      for (const d of disposers) d();
      disposers.length = 0;
    },
  };
}
