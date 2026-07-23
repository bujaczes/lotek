import { el } from '../dom.js';
import { formatInt, formatDecimal, formatPln, formatSignedPln } from '../format.js';
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
} from '../charts/theme.js';
import { bucketDistribution, bandSeries, scorecardVerdict } from '../charts/scorecard-transforms.js';
import { chartBox, tableView, chartNote } from './stats/section.js';

// SPEC §8.5 — the Typer's honest self-scorecard. States the null hypothesis up front,
// then puts the model's cumulative hits against the expected 0,7347/coupon inside a ±2σ
// noise band, the observed vs hypergeometric hit distribution, and the hypothetical
// balance. Follows the /statystyki section contract: { node, render(), destroy() } with
// the chart lazily inited into an attached box and disposed on unmount. k=0 renders a
// genuine "still collecting evidence" state, not empty charts.

const CUMULATIVE_HEIGHT = 320;
const DISTRIBUTION_HEIGHT = 260;
// #3e6c8e (theoretical) at low alpha — the recessive noise band, not a fourth hue.
const BAND_FILL = 'rgba(62, 108, 142, 0.14)';

const NULL_HYPOTHESIS =
  'Hipoteza zerowa jest prosta: model NIE pobije losowości w liczbie trafień — i nie ' +
  'powinien. Jego przewaga siedzi w EV | wygrana (oczekiwanej wypłacie, jeśli szóstka ' +
  'padnie), a tego nie zmierzymy bez wygranej. Ten wykres tylko sprawdza, czy trafienia ' +
  'trzymają się teorii — powinny siedzieć w paśmie ±2σ wokół 0,7347 na kupon.';

const HIT_LABELS = { 0: '0', 1: '1', 2: '2', 3: '3+' };

function axisName(text) {
  return { name: text, nameTextStyle: { color: CHART_COLORS.ink40, fontSize: 10, align: 'left' } };
}

function buildCumulativeOption(cumulative, band) {
  const categories = cumulative.map((c) => `nr ${c.forDrawNumber}`);
  const last = cumulative.length - 1;

  return {
    ...baseOption(),
    grid: grid({ top: 44, bottom: 4 }),
    legend: legend({ data: ['Trafienia (model)', 'Oczekiwane', 'Pasmo ±2σ'], left: 'auto', right: 0 }),
    tooltip: tooltip({
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: CHART_COLORS.line, width: 1 } },
      formatter: (params) => {
        const i = params[0].dataIndex;
        const c = cumulative[i];
        return [
          `<b>nr ${c.forDrawNumber}</b> · kupon ${c.k}`,
          `model: ${formatInt(c.cumHits)} traf.`,
          `oczekiwane: ${formatDecimal(c.expected, 2)}`,
          `pasmo ±2σ: ${formatDecimal(band.lower[i], 2)}–${formatDecimal(band.upper[i], 2)}`,
        ].join('<br>');
      },
    }),
    xAxis: categoryAxis(categories),
    yAxis: valueAxis({ min: 0, ...axisName('skumulowane trafienia') }),
    series: [
      // ±2σ band: an invisible baseline (band.lower) with the filled range stacked on top.
      // Both share the 'band' stack and come first; the two real lines carry no stack.
      {
        name: '__band_base',
        type: 'line',
        data: band.lower,
        stack: 'band',
        symbol: 'none',
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        z: 1,
      },
      {
        name: 'Pasmo ±2σ',
        type: 'line',
        data: band.range,
        stack: 'band',
        symbol: 'none',
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { color: BAND_FILL },
        z: 1,
      },
      lineSeries('Oczekiwane', cumulative.map((c) => c.expected), CHART_COLORS.theoretical, {
        smooth: false,
        z: 2,
      }),
      lineSeries('Trafienia (model)', cumulative.map((c) => c.cumHits), CHART_COLORS.empirical, {
        smooth: false,
        symbol: 'circle',
        symbolSize: 8,
        z: 3,
        label: {
          show: true,
          position: 'top',
          color: CHART_COLORS.ink70,
          fontFamily: FONTS.mono,
          fontSize: 10,
          formatter: (p) => (p.dataIndex === last ? formatInt(p.value) : ''),
        },
      }),
    ],
  };
}

function buildDistributionOption(dist) {
  const peak = dist.observed.indexOf(Math.max(...dist.observed));

  return {
    ...baseOption(),
    grid: grid({ top: 42, bottom: 4 }),
    legend: legend({ data: ['Zaobserwowane', 'Oczekiwane (teoria)'] }),
    tooltip: tooltip({
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const i = params[0].dataIndex;
        return [
          `<b>${dist.categories[i]} trafień</b>`,
          `zaobserwowane: ${formatInt(dist.observed[i])}`,
          `teoria: ${formatDecimal(dist.expected[i], 2)}`,
        ].join('<br>');
      },
    }),
    xAxis: categoryAxis(dist.categories, axisName('trafień')),
    yAxis: valueAxis(axisName('liczba typów')),
    series: [
      barSeries('Zaobserwowane', dist.observed, CHART_COLORS.empirical, {
        barWidth: 18,
        barGap: '15%',
        label: {
          show: true,
          position: 'top',
          color: CHART_COLORS.ink70,
          fontFamily: FONTS.mono,
          fontSize: 10,
          formatter: (p) => (p.dataIndex === peak && p.value > 0 ? formatInt(p.value) : ''),
        },
      }),
      barSeries('Oczekiwane (teoria)', dist.expected.map((v) => Number(v.toFixed(4))), CHART_COLORS.theoretical, {
        barWidth: 18,
      }),
    ],
  };
}

function balanceTile(label, value, sub, valueClass) {
  return el('div', { class: 'typer-null__tile' }, [
    el('span', { class: 'typer-null__label' }, label),
    el('span', { class: valueClass || 'typer-null__value' }, value),
    sub ? el('span', { class: 'typer-null__sub' }, sub) : null,
  ]);
}

function balanceBlock(balance) {
  const netClass =
    balance.net >= 0
      ? 'typer-null__value typer-scorecard__net typer-scorecard__net--pos'
      : 'typer-null__value typer-scorecard__net typer-scorecard__net--neg';
  return el('div', { class: 'typer-scorecard__balance' }, [
    el('h3', { class: 'panel__title' }, 'Bilans hipotetyczny'),
    el('div', { class: 'typer-null__tiles' }, [
      balanceTile('Koszt kuponów', formatPln(balance.cost), '3 zł za kupon'),
      balanceTile('Wygrane', formatPln(balance.winnings), 'z konfiguracji stawek'),
      balanceTile('Wynik', formatSignedPln(balance.net), 'wygrane − koszt', netClass),
    ]),
    chartNote(
      'Szacunek edukacyjny, nie prognoza. Każde losowanie jest niezależne, a szansa na ' +
        'szóstkę zawsze wynosi 1 : 13 983 816.'
    ),
  ]);
}

function header(verdict) {
  return el('div', { class: 'typer-scorecard__head' }, [
    el('h2', { class: 'typer-section__title' }, 'Sprawdzam! — samorozliczenie'),
    el('p', { class: 'typer-section__lead' }, NULL_HYPOTHESIS),
    el('p', { class: 'typer-scorecard__verdict', 'data-status': verdict.status }, verdict.text),
  ]);
}

function emptyBody() {
  return el('div', { class: 'typer-scorecard__empty' }, [
    el('p', { class: 'typer-scorecard__empty-lead' },
      'Na razie zero rozliczonych typów. Po pierwszym losowaniu „Sprawdzam!” zacznie tu ' +
        'rysować skumulowane trafienia na tle pasma ±2σ, rozkład trafień i bilans. ' +
        'To eksperyment w toku — zbieramy dowody, nie wróżymy.'),
  ]);
}

export function createScorecardSection(scorecard, createChart) {
  const verdict = scorecardVerdict(scorecard.cumulative);
  const children = [header(verdict)];

  const disposers = [];
  let cumulativeBox = null;
  let distributionBox = null;

  if (scorecard.evaluatedCount === 0) {
    children.push(emptyBody());
    const node = el('section', { class: 'typer-scorecard card' }, children);
    return { node, render() {}, destroy() {} };
  }

  const band = bandSeries(scorecard.cumulative);
  const dist = bucketDistribution(scorecard.distribution.observed, scorecard.distribution.expected);

  cumulativeBox = chartBox(CUMULATIVE_HEIGHT, 'Skumulowane trafienia Typera na tle oczekiwanej z pasmem ±2σ');
  distributionBox = chartBox(DISTRIBUTION_HEIGHT, 'Rozkład liczby trafień: zaobserwowany vs teoretyczny');

  children.push(
    el('div', { class: 'panel card typer-scorecard__panel' }, [
      el('h3', { class: 'panel__title' }, 'Skumulowane trafienia vs oczekiwane'),
      cumulativeBox,
      chartNote([
        'Linia teorii to k · 0,7347; pasmo to ±2 · √(k · Var), gdzie Var = ',
        el('b', { class: 'mono' }, formatDecimal(scorecard.variance, 4)),
        ' (wariancja trafień pojedynczego kuponu z dokładnego rozkładu hipergeometrycznego).',
      ]),
      tableView(
        'Skumulowane trafienia: model vs oczekiwane, z granicami pasma ±2σ',
        ['Losowanie', 'Kupon', 'Model', 'Oczekiwane', 'Dolna ±2σ', 'Górna ±2σ'],
        scorecard.cumulative.map((c, i) => [
          `nr ${c.forDrawNumber}`,
          String(c.k),
          formatInt(c.cumHits),
          formatDecimal(c.expected, 2),
          formatDecimal(band.lower[i], 2),
          formatDecimal(band.upper[i], 2),
        ])
      ),
    ]),
    el('div', { class: 'panel card typer-scorecard__panel' }, [
      el('h3', { class: 'panel__title' }, 'Rozkład trafień vs teoria' ),
      distributionBox,
      tableView(
        'Rozkład liczby trafień na kupon: zaobserwowany vs teoretyczny (pmf · k)',
        ['Trafień', 'Zaobserwowane', 'Teoria'],
        dist.categories.map((cat, i) => [
          HIT_LABELS[i] || cat,
          formatInt(dist.observed[i]),
          formatDecimal(dist.expected[i], 3),
        ])
      ),
    ]),
    balanceBlock(scorecard.balance)
  );

  const node = el('section', { class: 'typer-scorecard card' }, children);

  return {
    node,
    render() {
      if (!createChart) return;
      disposers.push(createChart(cumulativeBox, buildCumulativeOption(scorecard.cumulative, band)));
      disposers.push(createChart(distributionBox, buildDistributionOption(dist)));
    },
    destroy() {
      for (const d of disposers) d();
      disposers.length = 0;
    },
  };
}
