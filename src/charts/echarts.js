// The only module that imports echarts. It is pulled in with a dynamic import from
// the /statystyki view, so the whole charting library lands in its own chunk and the
// home page never pays for it. Modular imports: only the four chart types and the
// components the page actually uses (no `echarts` barrel import — that would drag in
// every chart, map, and toolbox).

import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Init a chart into an already-attached container and keep it sized. Returns a
 * disposer the view calls on unmount — an undisposed ECharts instance keeps a
 * canvas, a resize listener and the whole dataset alive.
 */
export function createChart(container, option) {
  const chart = echarts.init(container, null, { renderer: 'canvas' });
  chart.setOption(reducedMotion() ? { ...option, animation: false } : option);

  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
  }

  return () => {
    if (observer) observer.disconnect();
    chart.dispose();
  };
}
