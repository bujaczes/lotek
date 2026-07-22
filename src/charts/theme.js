// One place where every chart on the site gets its look. ECharts is NOT imported
// here — this module is pure option fragments + tokens, so it loads eagerly and
// stays unit-testable while echarts itself is code-split (src/charts/echarts.js).
//
// Colors are the project palette (docs/CONVENTIONS.md §Styl) only; nothing new is
// invented. Two series ever share a chart, so two slots suffice:
//   empirical   = --ball-edge #d99a00 — the dark step of the Lotto amber. The bright
//                 #ffc400 sits at OKLCH L 0.85 with 1.6:1 on white: legal as a ball,
//                 illegal as a chart fill. #d99a00 is inside the lightness band.
//   theoretical = #3e6c8e — the cool pole already defined in src/blanket-scale.js
//                 (DIVERGING.cool) and used for the "cold" ranking flag.
// Validated with the dataviz validator: lightness band PASS, CVD separation PASS
// (worst all-pairs ΔE 25.6 protan, well over the 8 target), normal-vision floor PASS.
// Contrast of #d99a00 on white is 2.45:1 — a WARN, which obligates a relief channel:
// every chart that uses it also ships direct labels AND a `<details>` table view.

export const CHART_COLORS = {
  ink: '#191a2e',
  ink70: 'rgba(25, 26, 46, 0.7)',
  ink55: 'rgba(25, 26, 46, 0.55)',
  ink40: 'rgba(25, 26, 46, 0.4)',
  line: '#e7e5de',
  surface: '#ffffff',
  empirical: '#d99a00',
  theoretical: '#3e6c8e',
  hot: '#e4372e',
  carpet: 'rgba(25, 26, 46, 0.5)',
};

export const FONTS = {
  text: "'Instrument Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

/** Mark specs from the dataviz skill: ≤24px bars, 4px rounded data-end, 2px lines. */
export const MARKS = {
  maxBarWidth: 24,
  lineWidth: 2,
  barRadius: [4, 4, 0, 0],
};

const axisText = { color: CHART_COLORS.ink55, fontFamily: FONTS.mono, fontSize: 11 };

/** Recessive category axis: hairline solid base, no grid, no ticks. */
export function categoryAxis(data, extra = {}) {
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: CHART_COLORS.line } },
    axisTick: { show: false },
    axisLabel: { ...axisText },
    ...extra,
  };
}

/** Value axis: hairline solid gridlines (never dashed), no axis line of its own. */
export function valueAxis(extra = {}) {
  return {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: CHART_COLORS.line, width: 1, type: 'solid' } },
    axisLabel: { ...axisText },
    ...extra,
  };
}

export function grid(extra = {}) {
  return { left: 8, right: 12, top: 34, bottom: 6, containLabel: true, ...extra };
}

export function tooltip(extra = {}) {
  return {
    backgroundColor: CHART_COLORS.surface,
    borderColor: CHART_COLORS.line,
    borderWidth: 1,
    padding: [8, 11],
    extraCssText: 'box-shadow: 0 8px 24px rgba(25,26,46,0.10); border-radius: 10px;',
    textStyle: { color: CHART_COLORS.ink, fontFamily: FONTS.text, fontSize: 12 },
    ...extra,
  };
}

/** Legend — always present for two or more series; line keys, text in ink tokens. */
export function legend(extra = {}) {
  return {
    top: 0,
    left: 0,
    itemWidth: 14,
    itemHeight: 8,
    itemGap: 16,
    icon: 'roundRect',
    textStyle: { color: CHART_COLORS.ink70, fontFamily: FONTS.text, fontSize: 12 },
    ...extra,
  };
}

/** Shared frame every chart option spreads first. */
export function baseOption(extra = {}) {
  return {
    animationDuration: 420,
    textStyle: { fontFamily: FONTS.text, color: CHART_COLORS.ink },
    grid: grid(),
    tooltip: tooltip(),
    ...extra,
  };
}

export function barSeries(name, data, color, extra = {}) {
  return {
    name,
    type: 'bar',
    data,
    barMaxWidth: MARKS.maxBarWidth,
    itemStyle: { color, borderRadius: MARKS.barRadius },
    ...extra,
  };
}

export function lineSeries(name, data, color, extra = {}) {
  return {
    name,
    type: 'line',
    data,
    symbol: 'none',
    smooth: true,
    lineStyle: { color, width: MARKS.lineWidth, cap: 'round', join: 'round' },
    itemStyle: { color },
    ...extra,
  };
}
