import { el } from '../../dom.js';
import { formatDecimal, formatInt, formatPln, formatShortDate, pluralPl } from '../../format.js';
import { baseOption, valueAxis, grid, tooltip, lineSeries, CHART_COLORS, FONTS } from '../../charts/theme.js';
import { statsSection, chartBox, tableView, chartNote } from './section.js';
import { card, drawLink, balls, tieNote } from './records-section.js';

// Section 08: what the draws actually paid, from the OpenAPI prize data (25.08.2011 on).
// Records are KPI tiles like section 07; the trójka amount is a step line with a table twin.

const CHART_HEIGHT = 260;
const TITLE = 'Wygrane od 2011';
const WINNERS_FORMS = ['wygrana', 'wygrane', 'wygranych'];

/** Big-number tile value: "44,8" + "mln zł" above a million, "25 000" + "zł" below. */
function compactPln(value) {
  if (value >= 1e6) return { value: formatDecimal(value / 1e6, 1), unit: 'mln zł' };
  return { value: formatInt(Math.round(value)), unit: 'zł' };
}

function recordCard(label, entry, { value, unit, footer }) {
  if (!entry) return null;
  const first = entry.draws[0];
  return card({
    label,
    value,
    unit,
    meta: [el('p', { class: 'record-card__meta' }, [drawLink(first), tieNote(entry.draws)]), balls(first.numbers)],
    footer: footer(first),
  });
}

function recordCards(records) {
  const moneyCard = (label, entry, footer) => recordCard(label, entry, { ...compactPln(entry?.value ?? 0), footer });
  const countCard = (label, entry, forms, footer) =>
    recordCard(label, entry, { value: formatInt(entry?.value ?? 0), unit: pluralPl(entry?.value ?? 0, forms), footer });

  return [
    moneyCard('Rekordowa wygrana za szóstkę', records.topJackpot, (d) => `Dokładnie ${formatPln(d.amount)} na jeden zwycięski kupon.`),
    countCard('Najwięcej szóstek w jednym losowaniu', records.mostSixes, ['szóstka', 'szóstki', 'szóstek'], (d) =>
      `Każda warta ${formatPln(d.amount)}.`
    ),
    moneyCard('Najwyższa kwota za piątkę', records.maxFive, (d) =>
      `${formatInt(d.winners)} ${pluralPl(d.winners, WINNERS_FORMS)} po ${formatPln(d.amount)}.`
    ),
    moneyCard('Najwyższa kwota za czwórkę', records.maxFour, (d) =>
      `${formatInt(d.winners)} ${pluralPl(d.winners, WINNERS_FORMS)} po ${formatPln(d.amount)}.`
    ),
    countCard('Najwięcej trójek w jednym losowaniu', records.mostThrees, ['trójka', 'trójki', 'trójek'], (d) =>
      `Każda po ${formatPln(d.amount)}.`
    ),
  ].filter(Boolean);
}

/** The table twin lists changes only — the trailing "still the same" point is not one. */
function changesOnly(points) {
  return points.filter((p, i) => i === 0 || p.amount !== points[i - 1].amount);
}

function buildThreeOption(points) {
  const isRepeat = (i) => i > 0 && points[i].amount === points[i - 1].amount;
  return {
    ...baseOption(),
    grid: grid({ top: 28, right: 24 }),
    tooltip: tooltip({
      trigger: 'axis',
      formatter: (params) => {
        const p = points[params[0].dataIndex];
        return `<b>${formatPln(p.amount)}</b><br>losowanie nr ${p.drawNumber} (${formatShortDate(p.date)})`;
      },
    }),
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: CHART_COLORS.line } },
      axisTick: { show: false },
      axisLabel: { color: CHART_COLORS.ink55, fontFamily: FONTS.mono, fontSize: 11 },
    },
    yAxis: valueAxis({
      min: 0,
      axisLabel: { color: CHART_COLORS.ink55, fontFamily: FONTS.mono, fontSize: 11, formatter: (v) => `${v} zł` },
    }),
    series: [
      lineSeries('Trójka', points.map((p) => [p.date, p.amount]), CHART_COLORS.empirical, {
        step: 'end',
        smooth: false,
        symbol: 'circle',
        symbolSize: 6,
        // Direct labels on every change (the amber line needs a relief channel, see theme.js).
        label: {
          show: true,
          position: 'top',
          color: CHART_COLORS.ink70,
          fontFamily: FONTS.mono,
          fontSize: 11,
          formatter: (p) => (isRepeat(p.dataIndex) ? '' : formatPln(p.value[1])),
        },
      }),
    ],
  };
}

export function createPrizesSection(data, createChart) {
  if (!data.coverage) {
    return {
      node: statsSection({
        index: 8,
        id: 'wygrane',
        title: TITLE,
        lead: 'Liczba wygranych i ich kwoty z oficjalnego API Totalizatora Sportowego.',
        children: [chartNote('Dane o wygranych jeszcze się wczytują — zajrzyj za chwilę.')],
      }),
    };
  }

  const { fromDrawNumber, fromDate, draws, complete } = data.coverage;
  const lead = complete
    ? `Totalizator Sportowy udostępnia liczbę wygranych i ich kwoty od losowania nr ${fromDrawNumber} ` +
      `(${formatShortDate(fromDate)}) — to ${formatInt(draws)} ` +
      `${pluralPl(draws, ['losowanie', 'losowania', 'losowań'])}. Wcześniejszych nie ma.`
    : `Trwa pobieranie historii wygranych z API Totalizatora Sportowego — na razie od losowania nr ${fromDrawNumber} ` +
      `(${formatShortDate(fromDate)}), ${formatInt(draws)} ${pluralPl(draws, ['losowanie', 'losowania', 'losowań'])}. ` +
      `Rekordy uzupełnią się same.`;

  const box = chartBox(CHART_HEIGHT, 'Kwota za trzy trafienia od 2011 roku');

  const threeNote = (() => {
    if (data.threeAmount.length === 0) return null;
    const steps = changesOnly(data.threeAmount);
    const first = steps[0];
    const last = steps[steps.length - 1];
    const changes = steps.length - 1;
    return changes === 0
      ? `Kwota za trójkę jest stała (ustala ją regulamin gry) — od ${formatShortDate(first.date)} wynosi ${formatPln(first.amount)}.`
      : `Kwota za trójkę jest stała (ustala ją regulamin gry) — od ${formatShortDate(first.date)} zmieniła się ` +
        `${changes} ${pluralPl(changes, ['raz', 'razy', 'razy'])}: z ${formatPln(first.amount)} na ${formatPln(last.amount)}.`;
  })();

  const node = statsSection({
    index: 8,
    id: 'wygrane',
    title: TITLE,
    lead,
    children: [
      el('div', { class: 'records__grid' }, recordCards(data.records)),
      el('div', { class: 'panel card' }, [
        el('p', { class: 'eyebrow' }, 'Kwota za trójkę'),
        box,
        chartNote(threeNote),
        tableView(
          'Zmiany kwoty za trzy trafienia',
          ['Od losowania', 'Data', 'Kwota'],
          changesOnly(data.threeAmount).map((p) => [`nr ${p.drawNumber}`, formatShortDate(p.date), formatPln(p.amount)])
        ),
      ]),
    ],
  });

  let dispose = null;
  return {
    node,
    render() {
      if (!createChart || data.threeAmount.length === 0) return;
      dispose = createChart(box, buildThreeOption(data.threeAmount));
    },
    destroy() {
      if (dispose) dispose();
      dispose = null;
    },
  };
}
