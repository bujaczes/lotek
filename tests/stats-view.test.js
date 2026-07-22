// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The chart library is behind a dynamic import in the view; mocking the module means
// the sections are exercised without a canvas, and we can assert dispose-on-unmount.
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

const api = vi.hoisted(() => ({ fail: new Set() }));

const SUMS = {
  histogram: Array.from({ length: 259 }, (_, i) => ({ sum: 21 + i, count: i === 129 ? 90 : 1 })),
  theoretical: Array.from({ length: 259 }, (_, i) => ({ sum: 21 + i, expected: i === 129 ? 88 : 1.2 })),
  lastSum: 145,
  percentile: 45.6775,
  sector: 'typowy',
};
const CARPET = {
  dates: ['1957-01-27', '1960-02-03', '1970-01-05'],
  points: [[0, 5], [0, 12], [1, 44], [2, 7]],
};
const structureRows = (peak) =>
  Array.from({ length: 7 }, (_, k) => ({
    k,
    empiricalCount: k === peak ? 2515 : 100,
    empiricalShare: k === peak ? 0.34 : 0.11,
    theoretical: k === peak ? 0.3329 : 0.1111,
  }));
const STRUCTURE = { even: structureRows(3), low: structureRows(3) };
const PAIRS = {
  pairs: Array.from({ length: 15 }, (_, i) => ({ a: i + 1, b: i + 20, cnt: 124 - i, expected: 94.13, lift: 1.32 - i * 0.01 })),
  triples: Array.from({ length: 15 }, (_, i) => ({ numbers: [1, 17, 38 - i], cnt: 21 - i, expected: 8.01, lift: 2.62 - i * 0.05 })),
};
const CONSECUTIVE = { empiricalShare: 0.4996, theoretical: 0.4952, draws: 7380 };
const REPEATS = { empiricalShare: 0.5547, theoretical: 0.5640, comparedDraws: 7379 };
const DUPLICATES = { groups: [], expectedCollisions: 1.9471444704363958 };
const RECORDS = {
  maxSum: { value: 265, draws: [{ drawNumber: 5696, date: '2015-10-15', numbers: [40, 41, 42, 46, 47, 49] }] },
  minSum: { value: 35, draws: [{ drawNumber: 4767, date: '2009-11-07', numbers: [1, 2, 3, 5, 7, 17] }] },
  longestRun: {
    length: 5,
    draws: [{ drawNumber: 4988, date: '2011-04-07', numbers: [15, 16, 17, 18, 19, 42], run: [15, 16, 17, 18, 19] }],
  },
  longestDrought: {
    length: 5,
    from: { drawNumber: 3926, date: '2002-11-20' },
    to: { drawNumber: 3930, date: '2002-12-04' },
  },
  recordAbsence: { number: 48, gap: 94, type: 'historical', endedAt: '1968-12-01' },
  birthdayness: { lastDrawNumber: 7380, count: 3, share: 0.5, theoretical: 0.6326530612244898 },
};

vi.mock('../src/api.js', () => {
  const endpoint = (name, payload) => () =>
    api.fail.has(name) ? Promise.reject(new Error('boom')) : Promise.resolve(payload);
  return {
    ApiError: class ApiError extends Error {},
    getSumsStats: endpoint('sums', SUMS),
    getCarpetStats: endpoint('carpet', CARPET),
    getStructureStats: endpoint('structure', STRUCTURE),
    getPairsStats: endpoint('pairs', PAIRS),
    getConsecutiveStats: endpoint('consecutive', CONSECUTIVE),
    getRepeatsStats: endpoint('repeats', REPEATS),
    getDuplicateSixesStats: endpoint('duplicates', DUPLICATES),
    getRecordsStats: endpoint('records', RECORDS),
  };
});

const { createStatsView } = await import('../src/views/stats.js');

function mountView() {
  const container = document.createElement('main');
  document.body.replaceChildren(container);
  const view = createStatsView();
  return { view, container, done: view.mount(container) };
}

beforeEach(() => {
  api.fail.clear();
  chart.created.length = 0;
  chart.disposed = 0;
  chart.explode = false;
});

describe('createStatsView', () => {
  it('shows a loading state for every section before the data arrives', () => {
    const { container } = mountView();
    expect(container.querySelectorAll('.stats-slot')).toHaveLength(7);
    expect(container.querySelectorAll('.stats-slot .loading')).toHaveLength(7);
  });

  it('renders all seven sections on real-shaped data', async () => {
    const { container, done } = mountView();
    await done;
    const titles = [...container.querySelectorAll('.stats-section__title')].map((h) => h.textContent);
    expect(titles).toEqual([
      'Suma losowania',
      'Dywan losowań',
      'Struktura losowania',
      'Pary i trójki',
      'Sąsiadujące i powtórki',
      'Powtórzone szóstki',
      'Rekordy',
    ]);
    expect(container.querySelectorAll('.loading')).toHaveLength(0);
    expect(container.querySelectorAll('.section-error')).toHaveLength(0);
  });

  it('inits one chart per chart panel (sum, carpet, two structure charts)', async () => {
    const { done } = mountView();
    await done;
    expect(chart.created).toHaveLength(4);
    expect(chart.created[0].option.series[0].type).toBe('bar');
    expect(chart.created[1].option.series[0]).toMatchObject({ type: 'scatter', large: true, symbolSize: 2 });
  });

  it('marks the last draw and its percentile on the sum histogram', async () => {
    const { container, done } = mountView();
    await done;
    const marker = container.querySelector('.chart-note--marker').textContent;
    expect(marker).toContain('145');
    expect(marker).toContain('46. percentyl');
    expect(marker).toContain('typowy');
    const markLine = chart.created[0].option.series[0].markLine;
    expect(markLine.data[0].xAxis).toBe(24); // sum 145 sits in the 141-145 bin
  });

  it('keeps every other section alive when one endpoint fails', async () => {
    api.fail.add('carpet');
    const { container, done } = mountView();
    await done;
    expect(container.querySelectorAll('.section-error')).toHaveLength(1);
    expect(container.querySelector('.section-error__msg').textContent).toContain('dywanu');
    expect(container.querySelectorAll('.stats-section')).toHaveLength(6);
    // charts: sum + two structure panels, carpet never got built
    expect(chart.created).toHaveLength(3);
  });

  it('still renders the duplicate-sixes panel when the draw count is unavailable', async () => {
    api.fail.add('consecutive');
    const { container, done } = mountView();
    await done;
    const dup = container.querySelector('#szostki');
    expect(dup).not.toBeNull();
    expect(dup.textContent).toContain('1,95');
    // the myths section is the only casualty
    expect(container.querySelectorAll('.section-error')).toHaveLength(1);
  });

  it('renders top-15 pair and triple lists with lift bars', async () => {
    const { container, done } = mountView();
    await done;
    const lists = container.querySelectorAll('#pary .lift-list');
    expect(lists).toHaveLength(2);
    expect(lists[0].querySelectorAll('.lift-row')).toHaveLength(15);
    expect(lists[1].querySelectorAll('.lift-row')).toHaveLength(15);
    expect(lists[0].querySelector('.lift-row__lift').textContent).toBe('1,32×');
    expect(lists[0].querySelector('.lift-bar__fill').classList.contains('lift-bar__fill--above')).toBe(true);
  });

  it('puts the theoretical value next to the empirical one in both myth tiles', async () => {
    const { container, done } = mountView();
    await done;
    const tiles = container.querySelectorAll('#mity .stat-tile');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector('.stat-tile__value').textContent).toBe('49,96%');
    expect(tiles[0].querySelector('.meter__key--theoretical').textContent).toContain('49,52%');
    expect(tiles[1].querySelector('.stat-tile__value').textContent).toBe('55,47%');
    expect(tiles[1].querySelector('.meter__key--theoretical').textContent).toContain('56,40%');
  });

  it('renders the record cards with their draws', async () => {
    const { container, done } = mountView();
    await done;
    const cards = container.querySelectorAll('#rekordy .record-card');
    expect(cards).toHaveLength(6);
    expect(cards[0].querySelector('.record-card__value').textContent).toContain('265');
    expect(cards[0].querySelector('.record-card__draw').getAttribute('href')).toBe('/losowanie/5696');
    expect(container.querySelector('#rekordy').textContent).toContain('liczba 48');
  });

  it('gives every chart a table view (the relief channel for the amber fill)', async () => {
    const { container, done } = mountView();
    await done;
    expect(container.querySelectorAll('.chart-table').length).toBeGreaterThanOrEqual(3);
    const rows = container.querySelectorAll('#struktura .chart-table')[0].querySelectorAll('tbody tr');
    expect(rows).toHaveLength(7);
  });

  it('keeps a section (text, numbers, table view) when its chart refuses to init', async () => {
    chart.explode = true;
    const { container, done } = mountView();
    await done;
    expect(container.querySelectorAll('.stats-section')).toHaveLength(7);
    expect(container.querySelectorAll('.section-error')).toHaveLength(0);
    expect(container.querySelector('#suma .chart-table tbody tr')).not.toBeNull();
  });

  it('disposes every chart and detaches the view on unmount', async () => {
    const { view, container, done } = mountView();
    await done;
    view.unmount();
    expect(chart.disposed).toBe(4);
    expect(container.querySelector('.view--stats')).toBeNull();
  });

  it('renders nothing after an unmount that races the fetches', async () => {
    const { view, container, done } = mountView();
    view.unmount();
    await done;
    expect(container.querySelector('.view--stats')).toBeNull();
    expect(chart.created).toHaveLength(0);
  });
});
