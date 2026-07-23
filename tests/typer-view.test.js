// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ mode: 'ok' }));

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

vi.mock('../src/api.js', () => ({
  ApiError: class ApiError extends Error {},
  getTyper: () => {
    if (state.mode === 'error') return Promise.reject(new Error('boom'));
    if (state.mode === 'empty') {
      return Promise.resolve({ current: null, history: [], nullHypothesis: { expectedPerCoupon: 6 / 49, evaluatedCount: 0, totalHits: 0, expectedHits: 0 } });
    }
    return Promise.resolve(PAYLOAD);
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

  it('detaches the view on unmount', async () => {
    const { view, container, done } = mountView();
    await done;
    view.unmount();
    expect(container.querySelector('.view--typer')).toBeNull();
  });
});
