// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// Control the fetch promise so we can unmount mid-flight.
let resolveLatest;
vi.mock('../src/api.js', () => ({
  ApiError: class ApiError extends Error {},
  getLatestDraw: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveLatest = resolve;
      })
  ),
}));

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
    view.unmount();
  });
});
