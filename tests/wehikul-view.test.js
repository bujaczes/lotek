// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ fail: null, calls: [] }));

class FakeApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// A set with numbers >= 33 — bit positions 32-48, the range JS's 32-bit `&` truncates.
const RESULT = {
  numbers: [33, 35, 40, 42, 45, 49],
  hits: { 3: 139, 4: 5, 5: 0, 6: 0 },
  occurrences: [
    ...Array.from({ length: 139 }, (_, i) => ({ drawNumber: 100 + i, date: '1959-01-11', hits: 3 })),
    ...Array.from({ length: 5 }, (_, i) => ({ drawNumber: 4000 + i, date: '2003-05-10', hits: 4 })),
  ],
  balance: { drawsPlayed: 7380, cost: 22140, winnings: 4336, net: -17804 },
  prizes: { 3: 24, 4: 200, 5: 6000, 6: 2000000, betPrice: 3.0 },
  disclaimer: 'To szacunek edukacyjny: zakłada regularną grę tym samym zestawem…',
};

vi.mock('../src/api.js', () => ({
  ApiError: FakeApiError,
  postWehikul: (numbers) => {
    api.calls.push(numbers);
    return api.fail ? Promise.reject(api.fail) : Promise.resolve({ ...RESULT, numbers });
  },
}));

const { createWehikulView } = await import('../src/views/wehikul.js');

function mountView(search = '') {
  window.history.replaceState({}, '', `/wehikul${search}`);
  const container = document.createElement('main');
  document.body.replaceChildren(container);
  const view = createWehikulView();
  view.mount(container);
  return { view, container };
}

const NBSP = '\u00A0';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const cell = (container, n) => container.querySelector(`.picker .mini-blanket__cell[data-number="${n}"]`);
const pick = (container, numbers) => numbers.forEach((n) => cell(container, n).click());

beforeEach(() => {
  api.fail = null;
  api.calls.length = 0;
});

describe('createWehikulView — picker', () => {
  it('starts empty, with a 0/6 counter and a disabled CTA', () => {
    const { container } = mountView();
    expect(container.querySelector('.picker__counter').textContent).toBe('0/6');
    expect(container.querySelector('.picker__cta').disabled).toBe(true);
    expect(container.querySelector('.picker__message').textContent).toBe('Zaznacz 6 liczb na blankiecie.');
    expect(container.querySelectorAll('.picker__slot')).toHaveLength(6);
  });

  it('counts up and counts down as fields are toggled', () => {
    const { container } = mountView();
    pick(container, [5, 12, 33]);
    expect(container.querySelector('.picker__counter').textContent).toBe('3/6');
    expect(container.querySelector('.picker__message').textContent).toBe('Zaznacz jeszcze 3 liczby.');
    expect(container.querySelectorAll('.picker__chosen .ball')).toHaveLength(3);
    cell(container, 12).click();
    expect(container.querySelector('.picker__counter').textContent).toBe('2/6');
    expect(container.querySelector('.picker__message').textContent).toBe('Zaznacz jeszcze 4 liczby.');
  });

  it('enables the CTA at exactly six', () => {
    const { container } = mountView();
    pick(container, [33, 35, 40, 42, 45, 49]);
    expect(container.querySelector('.picker__counter').textContent).toBe('6/6');
    expect(container.querySelector('.picker__cta').disabled).toBe(false);
    expect(container.querySelector('.picker__message').textContent).toBe('Zestaw gotowy.');
  });

  it('explains a rejected seventh pick instead of silently ignoring it', () => {
    const { container } = mountView();
    pick(container, [1, 2, 3, 4, 5, 6]);
    cell(container, 7).click();
    expect(container.querySelector('.picker__counter').textContent).toBe('6/6');
    expect(container.querySelector('.picker__message').textContent).toContain('odznacz którąś');
  });

  it('clears the whole coupon', () => {
    const { container } = mountView();
    pick(container, [1, 2, 3]);
    [...container.querySelectorAll('.picker .btn')].find((b) => b.textContent === 'Wyczyść').click();
    expect(container.querySelector('.picker__counter').textContent).toBe('0/6');
    expect(container.querySelectorAll('.picker .is-on')).toHaveLength(0);
  });
});

describe('createWehikulView — results', () => {
  async function run(numbers = [33, 35, 40, 42, 45, 49]) {
    const mounted = mountView();
    pick(mounted.container, numbers);
    mounted.container.querySelector('.picker').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    return mounted;
  }

  it('posts exactly the six picked numbers', async () => {
    await run();
    expect(api.calls).toEqual([[33, 35, 40, 42, 45, 49]]);
  });

  it('shows a tile per tier with its theoretical twin', async () => {
    const { container } = await run();
    const tiles = container.querySelectorAll('.hit-tile');
    expect(tiles).toHaveLength(4);
    expect([...tiles].map((t) => t.querySelector('.hit-tile__label').textContent)).toEqual([
      '6 trafień',
      '5 trafień',
      '4 trafień',
      '3 trafień',
    ]);
    const threes = tiles[3];
    expect(threes.querySelector('.hit-tile__value').textContent).toBe('139');
    // 7380 x 246820/13983816 = 130,25
    expect(threes.querySelector('.hit-tile__note').textContent).toContain('130,3');
    expect(tiles[0].querySelector('.hit-tile__odds').textContent).toContain(`13${NBSP}983${NBSP}816`);
  });

  it('formats the balance in zloty, with a signed net and the estimate label', async () => {
    const { container } = await run();
    const balance = container.querySelector('.balance');
    expect(balance.querySelector('.badge-estimate').textContent).toBe('szacunek edukacyjny');
    expect(balance.textContent).toContain(`22${NBSP}140,00${NBSP}zł`);
    expect(balance.textContent).toContain(`4336,00${NBSP}zł`);
    expect(balance.querySelector('.balance__net-value').textContent).toBe(`−17${NBSP}804,00${NBSP}zł`);
    expect(balance.querySelector('.balance__net').classList.contains('is-loss')).toBe(true);
  });

  it('spells out the configured stakes the balance assumed', async () => {
    const { container } = await run();
    const stakes = container.querySelector('.balance__stakes').textContent;
    expect(stakes).toContain(`2${NBSP}000${NBSP}000,00${NBSP}zł`);
    expect(stakes).toContain(`6000,00${NBSP}zł`);
    expect(stakes).toContain(`200,00${NBSP}zł`);
    expect(stakes).toContain(`24,00${NBSP}zł`);
    expect(stakes).toContain('config/prizes.json');
  });

  it('lists the winning draws, folding the long tier away', async () => {
    const { container } = await run();
    const groups = container.querySelectorAll('.occurrence-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].tagName).toBe('DIV'); // 5 fours, shown open
    expect(groups[0].textContent).toContain('4 trafień — 5 losowań');
    expect(groups[1].tagName).toBe('DETAILS'); // 139 threes, folded
    expect(groups[1].querySelectorAll('.occurrence')).toHaveLength(139);
    expect(groups[1].querySelector('.occurrence').getAttribute('href')).toBe('/losowanie/100');
  });

  it('carries the disclaimer through', async () => {
    const { container } = await run();
    expect(container.querySelector('.wehikul-disclaimer').textContent).toContain('szacunek edukacyjny');
  });

  it('puts the played set in the URL', async () => {
    await run();
    expect(window.location.search).toBe('?zestaw=33,35,40,42,45,49');
  });

  it('runs a set handed over in the query string', async () => {
    const { container } = mountView('?zestaw=5,6,12,38,41,43');
    expect(container.querySelector('.picker__counter').textContent).toBe('6/6');
    await settle();
    expect(api.calls).toEqual([[5, 6, 12, 38, 41, 43]]);
    expect(container.querySelector('.wehikul-results')).not.toBeNull();
  });

  it('ignores a malformed set in the query string', async () => {
    const { container } = mountView('?zestaw=5,6,99');
    await settle();
    expect(container.querySelector('.picker__counter').textContent).toBe('0/6');
    expect(api.calls).toEqual([]);
  });

  it('reports a failed run and leaves the coupon usable', async () => {
    api.fail = new FakeApiError('boom', 500);
    const { container } = await run();
    expect(container.querySelector('.section-error__msg').textContent).toContain('Nie udało się sprawdzić');
    expect(container.querySelector('.picker__cta').disabled).toBe(false);
  });

  it('detaches on unmount', async () => {
    const { view, container } = await run();
    view.unmount();
    expect(container.querySelector('.view--wehikul')).toBeNull();
  });
});
