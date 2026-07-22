import { el } from '../../dom.js';
import { formatInt, formatDecimal } from '../../format.js';
import { binSumHistogram, binIndexForSum, meanFromHistogram, percentileLabel } from '../../charts/transforms.js';
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
} from '../../charts/theme.js';
import { statsSection, chartBox, tableView, chartNote } from './section.js';

// SPEC 6.5. The empirical histogram of draw sums against the exact theoretical curve
// (the DP over all C(49,6) subsets, scaled to N draws), plus a marker on the last draw.

const BIN_WIDTH = 5;
const THEORETICAL_MEAN = 150;
const CHART_HEIGHT = 330;

function buildOption(bins, markerIndex, lastSum) {
  const counts = bins.map((b) => b.count);
  const peakIndex = counts.indexOf(Math.max(...counts));
  // The last-draw marker is itself a direct label; when it lands next to the modal bin
  // the two texts would overlap, so the peak label yields to it.
  const peak = markerIndex >= 0 && Math.abs(peakIndex - markerIndex) <= 2 ? -1 : peakIndex;

  return {
    ...baseOption(),
    grid: grid({ top: 44, bottom: 4 }),
    legend: legend({ data: ['Empiria', 'Teoria'], left: 'auto', right: 0 }),
    tooltip: tooltip({
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const bin = bins[params[0].dataIndex];
        return [
          `<b>suma ${bin.label}</b>`,
          `empiria: ${formatInt(bin.count)}`,
          `teoria: ${formatDecimal(bin.expected, 1)}`,
        ].join('<br>');
      },
    }),
    xAxis: categoryAxis(
      bins.map((b) => b.label),
      { axisLabel: { color: CHART_COLORS.ink55, fontFamily: FONTS.mono, fontSize: 10, interval: 3 } }
    ),
    yAxis: valueAxis({ name: 'losowań', nameTextStyle: { color: CHART_COLORS.ink40, fontSize: 10, align: 'left' } }),
    series: [
      barSeries('Empiria', counts, CHART_COLORS.empirical, {
        // Label selectively: only the modal bin carries a number; the rest live in the
        // tooltip and the table view.
        label: {
          show: true,
          position: 'top',
          color: CHART_COLORS.ink70,
          fontFamily: FONTS.mono,
          fontSize: 10,
          formatter: (p) => (p.dataIndex === peak ? formatInt(p.value) : ''),
        },
        markLine:
          markerIndex >= 0
            ? {
                silent: true,
                symbol: ['none', 'none'],
                lineStyle: { color: CHART_COLORS.ink, width: 1.5, type: 'solid' },
                label: {
                  formatter: `suma ${lastSum}`,
                  position: 'end',
                  color: CHART_COLORS.ink,
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                },
                data: [{ xAxis: markerIndex }],
              }
            : undefined,
      }),
      lineSeries('Teoria', bins.map((b) => b.expected), CHART_COLORS.theoretical, { z: 3 }),
    ],
  };
}

export function createSumSection(data, createChart) {
  const bins = binSumHistogram(data.histogram, data.theoretical, BIN_WIDTH);
  const markerIndex = binIndexForSum(bins, data.lastSum);
  const mean = meanFromHistogram(data.histogram);
  const draws = data.histogram.reduce((acc, r) => acc + r.count, 0);

  const box = chartBox(CHART_HEIGHT, 'Histogram sum losowań z krzywą teoretyczną');

  const marker =
    data.lastSum == null
      ? null
      : el('p', { class: 'chart-note chart-note--marker' }, [
          'Ostatnie losowanie: suma ',
          el('b', { class: 'mono' }, String(data.lastSum)),
          ' — ',
          el('b', {}, percentileLabel(data.percentile) || '—'),
          ', sektor ',
          el('b', {}, data.sector || '—'),
          '.',
        ]);

  const node = statsSection({
    index: 1,
    id: 'suma',
    title: 'Suma losowania',
    lead:
      'Sumę 21 daje dokładnie jeden zestaw, sumę 150 — aż 165 772. Skrajne sumy nie padają nie dlatego, ' +
      'że są „nielubiane”, tylko dlatego, że jest ich po prostu mniej. Linia to teoria, słupki to 70 lat praktyki.',
    children: [
      el('div', { class: 'panel card' }, [
        box,
        marker,
        chartNote([
          `Średnia empiryczna po ${formatInt(draws)} losowaniach: `,
          el('b', { class: 'mono' }, mean == null ? '—' : formatDecimal(mean, 1)),
          ' — teoretyczna: ',
          el('b', { class: 'mono' }, formatDecimal(THEORETICAL_MEAN, 1)),
          '.',
        ]),
        tableView(
          `Sumy losowań w przedziałach po ${BIN_WIDTH} — empiria vs teoria`,
          ['Suma', 'Empiria', 'Teoria'],
          bins.map((b) => [b.label, formatInt(b.count), formatDecimal(b.expected, 1)])
        ),
      ]),
    ],
  });

  let dispose = null;
  return {
    node,
    render() {
      if (!createChart) return;
      dispose = createChart(box, buildOption(bins, markerIndex, data.lastSum));
    },
    destroy() {
      if (dispose) dispose();
      dispose = null;
    },
  };
}
