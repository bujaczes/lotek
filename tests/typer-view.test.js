// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ mode: 'ok' }));

// The chart library is behind a dynamic import in the view; mocking the module exercises
// the scorecard section without a canvas and lets us assert dispose-on-unmount.
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

const CURRENT = {
  prediction: {
    forDrawNumber: 7382,
    numbers: [5, 20, 36, 38, 43, 49],
    drawDate: '2026-07-23',
    alternatives: [
      [5, 20, 36, 38, 43, 48],
      [5, 20, 36, 38, 44, 49],
      [5, 20, 37, 38, 43, 49],
    ],
    scores: { bias: 0.12, popularity: 6.34, total: -6.22 },
    modelVersion: '1.0.0',
    createdAt: 1700000000000,
    hits: null,
    prizeTier: null,
    resultNumbers: null,
    numberStats: [
      { number: 5, total: 906, zScore: -0.31, lastDrawnAt: '2026-07-18', lastDrawNumber: 7380, currentGap: 1 },
      { number: 20, total: 889, zScore: -0.62, lastDrawnAt: '2026-07-14', lastDrawNumber: 7378, currentGap: 3 },
      { number: 36, total: 921, zScore: 0.4, lastDrawnAt: '2026-07-11', lastDrawNumber: 7377, currentGap: 4 },
      { number: 38, total: 915, zScore: 0.12, lastDrawnAt: '2026-07-09', lastDrawNumber: 7376, currentGap: 5 },
      { number: 43, total: 870, zScore: -1.05, lastDrawnAt: '2026-05-30', lastDrawNumber: 7360, currentGap: 21 },
      { number: 49, total: 902, zScore: -0.2, lastDrawnAt: '2026-07-16', lastDrawNumber: 7379, currentGap: 2 },
    ],
  },
  commentary:
    '**Typ na losowanie nr 7382 (czw, 23.07.2026): 5, 20, 36, 38, 43, 49**\n\n' +
    'Zacznijmy uczciwie: szansa tego kuponu na szóstkę to 1 : 13 983 816.\n\n' +
    '### Liczba po liczbie\n\n- **5** — wypadła 906 razy w historii.',
};

const PAYLOAD = {
  current: CURRENT,
  history: [
    {
      forDrawNumber: 7381,
      numbers: [1, 2, 3, 34, 35, 36],
      createdAt: 1699000000000,
      hits: 3,
      prizeTier: 4,
      resultNumbers: [3, 34, 35, 36, 40, 41],
    },
  ],
  nullHypothesis: { expectedPerCoupon: 36 / 49, evaluatedCount: 1, totalHits: 3, expectedHits: 0.7347 },
};

// Three evaluated coupons; cumulative hits land inside the ±2σ band at k=3 -> "w paśmie
// szumu" verdict. One coupon (nr 7379) is a IV-stopień win, one uses numbers >= 33.
const SCORECARD = {
  evaluatedCount: 3,
  variance: 0.5775718450645565,
  expectedPerCoupon: 36 / 49,
  perPrediction: [
    { forDrawNumber: 7379, date: '2026-07-16', numbers: [1, 2, 3, 4, 5, 6], hits: 3, prizeTier: 4 },
    { forDrawNumber: 7380, date: '2026-07-18', numbers: [33, 34, 35, 44, 45, 49], hits: 0, prizeTier: null },
    { forDrawNumber: 7381, date: '2026-07-21', numbers: [1, 2, 3, 4, 5, 6], hits: 0, prizeTier: null },
  ],
  cumulative: [
    { k: 1, forDrawNumber: 7379, date: '2026-07-16', cumHits: 3, expected: 0.7347, sigmaBand: 1.52 },
    { k: 2, forDrawNumber: 7380, date: '2026-07-18', cumHits: 3, expected: 1.4694, sigmaBand: 2.15 },
    { k: 3, forDrawNumber: 7381, date: '2026-07-21', cumHits: 3, expected: 2.2041, sigmaBand: 2.63 },
  ],
  distribution: {
    observed: { 0: 2, 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0 },
    expected: { 0: 1.3079, 1: 1.2391, 2: 0.3971, 3: 0.05295, 4: 0.002906, 5: 0.0000553, 6: 0.000000214 },
  },
  balance: { cost: 9, winnings: 24, net: 15 },
};
const SCORECARD_EMPTY = {
  evaluatedCount: 0,
  variance: 0.5775718450645565,
  expectedPerCoupon: 36 / 49,
  perPrediction: [],
  cumulative: [],
  distribution: {
    observed: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    expected: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  },
  balance: { cost: 0, winnings: 0, net: 0 },
};

vi.mock('../src/api.js', () => ({
  ApiError: class ApiError extends Error {},
  getTyper: () => {
    if (state.mode === 'error') return Promise.reject(new Error('boom'));
    if (state.mode === 'empty') {
      return Promise.resolve({
        current: null,
        history: [],
        nullHypothesis: { expectedPerCoupon: 36 / 49, evaluatedCount: 0, totalHits: 0, expectedHits: 0 },
      });
    }
    return Promise.resolve(PAYLOAD);
  },
  getTyperScorecard: () => {
    if (state.mode === 'scorecard-error') return Promise.reject(new Error('boom'));
    if (state.mode === 'empty') return Promise.resolve(SCORECARD_EMPTY);
    return Promise.resolve(SCORECARD);
  },
}));

const { createTyperView } = await import('../src/views/typer.js');

function mountView() {
  const container = document.createElement('main');
  document.body.replaceChildren(container);
  const view = createTyperView();
  return { view, container, done: view.mount(container) };
}

beforeEach(() => {
  state.mode = 'ok';
  chart.created.length = 0;
  chart.disposed = 0;
  chart.explode = false;
});

describe('createTyperView', () => {
  it('shows a loading state before the data arrives', () => {
    const { container } = mountView();
    expect(container.querySelector('.loading')).not.toBeNull();
  });

  it('renders the current pick as six highlighted balls', async () => {
    const { container, done } = mountView();
    await done;
    const balls = container.querySelectorAll('.typer-hero .ball');
    expect(balls).toHaveLength(6);
    expect([...balls].map((b) => b.querySelector('.ball__num').textContent)).toEqual(
      ['5', '20', '36', '38', '43', '49']
    );
  });

  it('renders the full rationale from the commentary markdown (honest frame included)', async () => {
    const { container, done } = mountView();
    await done;
    const article = container.querySelector('.typer-rationale');
    expect(article).not.toBeNull();
    expect(article.querySelector('h3')).not.toBeNull();
    expect(article.querySelectorAll('p.md-p').length).toBeGreaterThanOrEqual(1);
    expect(article.textContent).toContain('1 : 13 983 816');
    // rendered safely, no raw markup leaked as elements
    expect(article.querySelector('script')).toBeNull();
  });

  it('lists the three backup sets', async () => {
    const { container, done } = mountView();
    await done;
    expect(container.querySelectorAll('.typer-alts__item')).toHaveLength(3);
  });

  it('renders the per-number data table with one row per chosen number', async () => {
    const { container, done } = mountView();
    await done;
    const rows = container.querySelectorAll('.typer-numbers__table tbody tr');
    expect(rows).toHaveLength(6);
    expect(rows[0].querySelector('.typer-numbers__n').textContent).toBe('5');
  });

  it('renders the honest null-hypothesis section with the 0,7347 reference', async () => {
    const { container, done } = mountView();
    await done;
    const section = container.querySelector('.typer-null');
    expect(section).not.toBeNull();
    expect(section.textContent).toContain('0,7347');
    expect(section.textContent).toContain('NIE pobije losowości');
  });

  it('renders the history with past picks and their hits', async () => {
    const { container, done } = mountView();
    await done;
    const items = container.querySelectorAll('.typer-hist__item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('nr 7381');
    expect(items[0].textContent).toContain('IV stopień');
  });

  it('renders the "Sprawdzam!" scorecard: two charts, honest copy, verdict, balance', async () => {
    const { container, done } = mountView();
    await done;
    const section = container.querySelector('.typer-scorecard');
    expect(section).not.toBeNull();
    // honest null-hypothesis sentence, no probability overstatement
    expect(section.textContent).toContain('NIE pobije losowości');
    expect(section.textContent).toContain('EV | wygrana');
    // verdict inside the band
    const verdict = section.querySelector('.typer-scorecard__verdict');
    expect(verdict.getAttribute('data-status')).toBe('within');
    expect(verdict.textContent.toLowerCase()).toContain('w paśmie szumu');
    // two charts inited (cumulative + distribution)
    expect(chart.created).toHaveLength(2);
    expect(chart.created[0].option.series.some((s) => s.name === 'Pasmo ±2σ')).toBe(true);
    expect(chart.created[1].option.series[0].type).toBe('bar');
    // documents the frozen Var value
    expect(section.textContent).toContain('0,5776');
    // balance tiles: cost, winnings, net
    const tiles = section.querySelectorAll('.typer-scorecard__balance .typer-null__tile');
    expect(tiles).toHaveLength(3);
    expect(section.querySelector('.typer-scorecard__net').textContent).toContain('+');
    // relief channel: table views for the amber-fill charts
    expect(section.querySelectorAll('.chart-table').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the scorecard empty state (no charts) when nothing is evaluated yet', async () => {
    state.mode = 'empty';
    const { container, done } = mountView();
    await done;
    expect(container.querySelector('.typer-empty')).not.toBeNull();
    expect(container.querySelector('.typer-hero')).toBeNull();
    const section = container.querySelector('.typer-scorecard');
    expect(section).not.toBeNull();
    expect(section.querySelector('.typer-scorecard__empty')).not.toBeNull();
    // still states the null hypothesis, honestly, even with no data
    expect(section.textContent).toContain('NIE pobije losowości');
    // no charts drawn on an empty scorecard
    expect(chart.created).toHaveLength(0);
  });

  it('keeps the page alive with a section error when the scorecard endpoint fails', async () => {
    state.mode = 'scorecard-error';
    const { container, done } = mountView();
    await done;
    // the rest of the page rendered fine
    expect(container.querySelector('.typer-hero')).not.toBeNull();
    // scorecard degraded to a section error, not a blank page
    expect(container.querySelector('.typer-scorecard-slot .section-error')).not.toBeNull();
    expect(chart.created).toHaveLength(0);
  });

  it('keeps the scorecard copy, tables and balance when the chart refuses to init', async () => {
    chart.explode = true;
    const { container, done } = mountView();
    await done;
    const section = container.querySelector('.typer-scorecard');
    expect(section).not.toBeNull();
    expect(section.querySelector('.typer-scorecard__balance')).not.toBeNull();
    expect(section.querySelectorAll('.chart-table').length).toBeGreaterThanOrEqual(2);
  });

  it('shows an empty state when no prediction has been computed yet', async () => {
    state.mode = 'empty';
    const { container, done } = mountView();
    await done;
    expect(container.querySelector('.typer-empty')).not.toBeNull();
    expect(container.querySelector('.typer-hero')).toBeNull();
  });

  it('shows an error card when the endpoint fails', async () => {
    state.mode = 'error';
    const { container, done } = mountView();
    await done;
    expect(container.querySelector('.error')).not.toBeNull();
  });

  it('disposes the scorecard charts and detaches the view on unmount', async () => {
    const { view, container, done } = mountView();
    await done;
    view.unmount();
    expect(chart.disposed).toBe(2);
    expect(container.querySelector('.view--typer')).toBeNull();
  });
});
