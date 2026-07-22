// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const chart = vi.hoisted(() => ({ created: [], disposed: 0, explode: false }));
vi.mock('../src/charts/echarts.js', () => ({
  createChart: (container, option) => {
    if (chart.explode) throw new Error('no canvas');
    chart.created.push({ container, option });
    return () => {
      chart.disposed += 1;
    };
  },
}));

const api = vi.hoisted(() => ({ fail: null, drawsFail: false }));

const CAREER = {
  number: 7,
  stats: {
    totalCount: 894,
    countLast50: 9,
    countLast100: 15,
    countLast300: 38,
    decayedCount: 60.05,
    zScore: -0.3251276588971552,
    lastDrawnAt: '2026-07-14',
    lastDrawNumber: 7378,
    currentGap: 2,
    maxGap: 61,
    maxGapEndedAt: '1984-08-11',
    avgGap: 7.25,
    longestStreak: 4,
  },
  yearCounts: { 1957: 3, 1958: 4, 1959: 5, 1996: 22 },
  // Shaped like the real endpoint: zero-filled from 0 to maxGap, with a long sparse tail.
  gapHistogram: (() => {
    const head = [107, 106, 66, 73, 57, 50, 44, 38, 33, 29, 25, 22, 19, 16, 14, 12, 10, 9, 8, 7];
    const histogram = Array.from({ length: 62 }, (_, gap) => ({
      gap,
      count: gap < head.length ? head[gap] : gap % 7 === 0 ? 1 : 0,
    }));
    return { histogram, total: histogram.reduce((s, r) => s + r.count, 0), maxGap: 61 };
  })(),
  zScoreSeries: [
    { drawNumber: 100, drawnAt: '1959-01-11', k: 100, count: 7, zScore: -1.514387023041189 },
    { drawNumber: 200, drawnAt: '1960-12-11', k: 200, count: 21, zScore: -0.7124999999999997 },
  ],
  blanket: { row: 0, col: 6 },
};

class FakeApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

vi.mock('../src/api.js', () => ({
  ApiError: FakeApiError,
  getNumberCareer: (n) =>
    api.fail ? Promise.reject(api.fail) : Promise.resolve({ ...CAREER, number: n }),
  getDraws: () => (api.drawsFail ? Promise.reject(new Error('boom')) : Promise.resolve({ total: 7380, draws: [] })),
}));

const { createNumberView } = await import('../src/views/number.js');

function mountView(params) {
  const container = document.createElement('main');
  document.body.replaceChildren(container);
  const view = createNumberView();
  return { view, container, done: view.mount(container, params) };
}

beforeEach(() => {
  api.fail = null;
  api.drawsFail = false;
  chart.created.length = 0;
  chart.disposed = 0;
  chart.explode = false;
});

describe('createNumberView', () => {
  it('shows a loading state before the career arrives', () => {
    const { container } = mountView({ n: '7' });
    expect(container.querySelector('.loading').textContent).toContain('liczby 7');
  });

  it('renders the header, the six tiles and all four panels', async () => {
    const { container, done } = mountView({ n: '7' });
    await done;
    expect(container.querySelector('.career-head__title').textContent).toBe('Liczba 7');
    expect(container.querySelectorAll('.career-tile')).toHaveLength(6);
    expect([...container.querySelectorAll('.career-panel')].map((p) => p.id)).toEqual([
      'lata',
      'przerwy',
      'zscore',
      'blankiet',
    ]);
    expect(container.querySelectorAll('.loading')).toHaveLength(0);
  });

  it('puts the theoretical count next to the empirical one', async () => {
    const { container, done } = mountView({ n: '7' });
    await done;
    // 7380 draws x 6/49 = 903.7
    expect(container.querySelector('.career-head__lead').textContent).toContain('903,7');
    expect(container.querySelector('.career-tile__note').textContent).toContain('903,7');
  });

  it('drops the theoretical reference (but keeps the page) when the draw count fails', async () => {
    api.drawsFail = true;
    const { container, done } = mountView({ n: '7' });
    await done;
    expect(container.querySelector('.career-head__lead').textContent).not.toContain('903,7');
    expect(container.querySelectorAll('.career-panel')).toHaveLength(4);
  });

  it('reports the best year and the record absence in the tiles', async () => {
    const { container, done } = mountView({ n: '7' });
    await done;
    const text = container.querySelector('.career-tiles').textContent;
    expect(text).toContain('1996');
    expect(text).toContain('22 razy');
    expect(text).toContain('61');
    expect(text).toContain('11.08.1984');
  });

  it('clamps the prev/next walk at 1 and 49 instead of wrapping', async () => {
    const first = mountView({ n: '1' });
    await first.done;
    const firstLinks = first.container.querySelectorAll('.career-nav a');
    expect(firstLinks).toHaveLength(1);
    expect(firstLinks[0].getAttribute('href')).toBe('/liczba/2');
    first.view.unmount();

    const last = mountView({ n: '49' });
    await last.done;
    const lastLinks = last.container.querySelectorAll('.career-nav a');
    expect(lastLinks).toHaveLength(1);
    expect(lastLinks[0].getAttribute('href')).toBe('/liczba/48');
  });

  it('inits one chart per chart panel and gives each a table view', async () => {
    const { container, done } = mountView({ n: '7' });
    await done;
    expect(chart.created).toHaveLength(3);
    expect(chart.created[0].option.series[0].type).toBe('line');
    expect(chart.created[1].option.series[0].type).toBe('bar');
    expect(chart.created[1].option.series[1].name).toBe('Teoria (geometryczny)');
    expect(container.querySelectorAll('.chart-table')).toHaveLength(3);
  });

  it('folds the sparse gap tail into one bucket instead of 60 empty bars', async () => {
    const { container, done } = mountView({ n: '7' });
    await done;
    const labels = chart.created[1].option.xAxis.data;
    expect(labels.length).toBeLessThan(CAREER.gapHistogram.histogram.length); // not one bar per gap
    expect(labels.at(-1)).toMatch(/^\d+\+$/);
    expect(container.querySelector('#przerwy .chart-note').textContent).toMatch(/od \d+ w górę/);
    // nothing is dropped: the bars still sum to every measured gap
    const bars = chart.created[1].option.series[0].data;
    expect(bars.reduce((s, v) => s + v, 0)).toBe(CAREER.gapHistogram.total);
  });

  it('highlights the number on the mini blankiet at its coupon position', async () => {
    const { container, done } = mountView({ n: '7' });
    await done;
    const on = container.querySelectorAll('#blankiet .mini-blanket__cell.is-on');
    expect(on).toHaveLength(1);
    expect(on[0].dataset.number).toBe('7');
    expect(container.querySelector('#blankiet .career-panel__lead').textContent).toContain('Wiersz 1, kolumna 7');
  });

  it('refuses an out-of-range number without calling the API', async () => {
    const { container, done } = mountView({ n: '50' });
    await done;
    expect(container.querySelector('.error__title').textContent).toBe('Nie ma takiej liczby');
    expect(container.querySelector('.career-head')).toBeNull();
  });

  it('turns an API 400 into the same not-found state', async () => {
    api.fail = new FakeApiError('nope', 400);
    const { container, done } = mountView({ n: '7' });
    await done;
    expect(container.querySelector('.error__title').textContent).toBe('Nie ma takiej liczby');
  });

  it('offers a retry on a real failure', async () => {
    api.fail = new FakeApiError('Brak połączenia z serwerem.', 0);
    const { container, done } = mountView({ n: '7' });
    await done;
    expect(container.querySelector('.error__msg').textContent).toContain('Brak połączenia');
    expect(container.querySelector('button.btn').textContent).toBe('Spróbuj ponownie');
  });

  it('keeps the panels when a chart refuses to init', async () => {
    chart.explode = true;
    const { container, done } = mountView({ n: '7' });
    await done;
    expect(container.querySelectorAll('.career-panel')).toHaveLength(4);
    expect(container.querySelectorAll('.section-error')).toHaveLength(0);
    expect(container.querySelector('#lata .chart-table tbody tr')).not.toBeNull();
  });

  it('disposes every chart and detaches on unmount', async () => {
    const { view, container, done } = mountView({ n: '7' });
    await done;
    view.unmount();
    expect(chart.disposed).toBe(3);
    expect(container.querySelector('.view--number')).toBeNull();
  });

  it('renders nothing after an unmount that races the fetch', async () => {
    const { view, container, done } = mountView({ n: '7' });
    view.unmount();
    await done;
    expect(container.querySelector('.view--number')).toBeNull();
    expect(chart.created).toHaveLength(0);
  });
});
