// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// Control the latest-draw fetch so we can unmount mid-flight. The blankiet and
// rankings fetches resolve immediately with minimal valid shapes so the home
// view's secondary sections render (or, when unmounted early, are never reached).
let resolveLatest;
vi.mock('../src/api.js', () => {
  const blanket = Array.from({ length: 49 }, (_, i) => ({
    number: i + 1,
    total: 900,
    last50: 5,
    last100: 10,
    currentGap: i,
    zScore: 0,
    lastDrawnAt: '2026-06-13',
  }));
  const ten = (start) => Array.from({ length: 10 }, (_, i) => ({ number: start + i, count: 10 - i, zScore: 0 }));
  const rankings = {
    hot: { all: ten(1), last100: ten(1), currentYear: ten(1) },
    cold: { all: ten(40), last100: ten(40), currentYear: ten(40) },
  };
  return {
    ApiError: class ApiError extends Error {},
    getLatestDraw: vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLatest = resolve;
        })
    ),
    getBlanketStats: vi.fn(() => Promise.resolve(blanket)),
    getRankingsStats: vi.fn(() => Promise.resolve(rankings)),
  };
});

import { createHomeView } from '../src/views/home.js';

const DRAW = {
  drawNumber: 7380,
  date: '2026-07-18',
  numbers: [5, 6, 12, 38, 41, 43],
  sum: 145,
  verdict: { type: 'premiera' },
  chips: [5, 6, 12, 38, 41, 43].map((number) => ({ number, countBefore: 100, lastSeenBefore: null })),
  nearestNeighbor: { drawNumber: 6520, date: '2021-01-19', shared: 4, sharedNumbers: [6, 38, 41, 43] },
  nextDraw: { date: '2026-07-23T20:00:00.000Z', drawNumber: 7381 },
};

describe('home view lifecycle', () => {
  it('does not throw when unmounted before the fetch resolves', async () => {
    const container = document.createElement('div');
    const view = createHomeView();

    const mounting = view.mount(container); // runs sync up to the awaited fetch
    view.unmount(); // navigate away while the request is in flight
    resolveLatest(DRAW); // late resolution must be a no-op, not a TypeError

    await expect(mounting).resolves.toBeUndefined();
    expect(container.childElementCount).toBe(0); // nothing re-appended after unmount
  });

  it('renders the hero when the fetch resolves while still mounted', async () => {
    const container = document.createElement('div');
    const view = createHomeView();

    const mounting = view.mount(container);
    resolveLatest(DRAW);
    await mounting;

    expect(container.querySelectorAll('.ball')).toHaveLength(6);
    // secondary sections fill their slots once their fetches resolve
    expect(container.querySelectorAll('.blanket__field')).toHaveLength(49);
    expect(container.querySelectorAll('.rank-col')).toHaveLength(2);
    expect(container.querySelector('.typer-teaser')).not.toBeNull();
    view.unmount();
  });
});
