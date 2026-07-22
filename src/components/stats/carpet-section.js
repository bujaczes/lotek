import { el } from '../../dom.js';
import { formatInt, formatShortDate } from '../../format.js';
import { yearTicks } from '../../charts/transforms.js';
import { baseOption, valueAxis, grid, tooltip, CHART_COLORS, FONTS } from '../../charts/theme.js';
import { statsSection, chartBox, chartNote } from './section.js';

// SPEC 6.12. Every ball ever drawn as one dot: x = draw index (time), y = 1..49.
// ~44 000 points, so `large: true` + a 2px symbol — the whole point of the panel is
// the texture, not the individual dot.

const CHART_HEIGHT = 380;
const YEAR_TICK_STEP = 10;
const DOT_SIZE = 2;

function buildOption(points, dates) {
  const ticks = yearTicks(dates, YEAR_TICK_STEP);
  const labelByIndex = new Map(ticks.map((t) => [t.index, t.label]));

  return {
    ...baseOption(),
    animation: false, // 44k points: an entry animation is jank, not delight
    grid: grid({ top: 12, bottom: 4, right: 16 }),
    tooltip: tooltip({
      trigger: 'item',
      formatter: (p) => {
        const [index, number] = p.data;
        const date = dates[index];
        return [
          `<b>liczba ${number}</b>`,
          `losowanie ${formatInt(index + 1)}`,
          date ? formatShortDate(date) : '',
        ]
          .filter(Boolean)
          .join('<br>');
      },
    }),
    xAxis: valueAxis({
      min: 0,
      max: Math.max(dates.length - 1, 1),
      splitLine: { show: false },
      axisTick: { show: true, customValues: ticks.map((t) => t.index), lineStyle: { color: CHART_COLORS.line } },
      axisLine: { show: true, lineStyle: { color: CHART_COLORS.line } },
      axisLabel: {
        customValues: ticks.map((t) => t.index),
        formatter: (v) => labelByIndex.get(v) ?? '',
        color: CHART_COLORS.ink55,
        fontFamily: FONTS.mono,
        fontSize: 11,
      },
    }),
    yAxis: valueAxis({
      min: 1,
      max: 49,
      interval: 7,
      splitLine: { lineStyle: { color: CHART_COLORS.line, width: 1, type: 'solid' } },
      axisLabel: { color: CHART_COLORS.ink55, fontFamily: FONTS.mono, fontSize: 11 },
    }),
    series: [
      {
        type: 'scatter',
        large: true,
        largeThreshold: 2000,
        symbolSize: DOT_SIZE,
        itemStyle: { color: CHART_COLORS.carpet },
        data: points,
      },
    ],
  };
}

export function createCarpetSection(data, createChart) {
  const box = chartBox(CHART_HEIGHT, 'Dywan losowań: każda wylosowana liczba jako punkt w czasie');

  const node = statsSection({
    index: 2,
    id: 'dywan',
    title: 'Dywan losowań',
    lead:
      'Każda kula, jaka kiedykolwiek wypadła: w poziomie czas, w pionie liczba 1–49. ' +
      'Gdyby w losowaniach był jakikolwiek wzór — pasy, zagęszczenia, przekątne — zobaczyłbyś go tutaj gołym okiem.',
    children: [
      el('div', { class: 'panel card' }, [
        box,
        el('p', { class: 'carpet__caption' }, '70 lat, zero wzoru — i o to chodzi'),
        chartNote([
          el('b', { class: 'mono' }, formatInt(data.points.length)),
          ' punktów z ',
          el('b', { class: 'mono' }, formatInt(data.dates.length)),
          ' losowań. Rozkład każdej z 49 liczb z osobna sprawdzisz na ',
          el('a', { href: '/', class: 'link-inline' }, 'blankiecie'),
          '.',
        ]),
      ]),
    ],
  });

  let dispose = null;
  return {
    node,
    render() {
      if (!createChart) return;
      dispose = createChart(box, buildOption(data.points, data.dates));
    },
    destroy() {
      if (dispose) dispose();
      dispose = null;
    },
  };
}
