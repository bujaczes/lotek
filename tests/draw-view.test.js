// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ drawFail: null, listFail: false, sumsFail: false, calls: [] }));

class FakeApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const DRAW_7380 = {
  drawNumber: 7380,
  date: '2026-07-18',
  numbers: [5, 6, 12, 38, 41, 43],
  sum: 145,
  verdict: { type: 'premiera' },
  chips: [
    { number: 5, countBefore: 912, lastSeenBefore: { drawNumber: 7376, date: '2026-07-09' } },
    { number: 6, countBefore: 944, lastSeenBefore: { drawNumber: 7359, date: '2026-05-30' } },
    { number: 12, countBefore: 855, lastSeenBefore: { drawNumber: 7353, date: '2026-05-16' } },
    { number: 38, countBefore: 955, lastSeenBefore: { drawNumber: 7379, date: '2026-07-16' } },
    { number: 41, countBefore: 883, lastSeenBefore: { drawNumber: 7368, date: '2026-06-20' } },
    { number: 43, countBefore: 838, lastSeenBefore: { drawNumber: 7378, date: '2026-07-14' } },
  ],
  nearestNeighbor: { drawNumber: 6520, date: '2021-01-19', shared: 4, sharedNumbers: [6, 38, 41, 43] },
  prev: { drawNumber: 7379, date: '2026-07-16' },
  next: null,
};

// The very first draw: nothing existed before it, so verdict has no prior, every chip is
// a first sighting, nearestNeighbor is null and prev is null.
const DRAW_1 = {
  drawNumber: 1,
  date: '1957-01-27',
  numbers: [8, 12, 31, 39, 43, 45],
  sum: 178,
  verdict: { type: 'premiera' },
  chips: [8, 12, 31, 39, 43, 45].map((number) => ({ number, countBefore: 0, lastSeenBefore: null })),
  nearestNeighbor: null,
  prev: null,
  next: { drawNumber: 2, date: '1957-02-03' },
};

const DRAWS = { 1: DRAW_1, 7380: DRAW_7380 };

const listPage = (query) => ({
  page: query.page || 1,
  perPage: query.perPage || 20,
  total: 7380,
  totalPages: Math.ceil(7380 / (query.perPage || 20)),
  draws: [
    { drawNumber: 7380, date: '2026-07-18', numbers: [5, 6, 12, 38, 41, 43], sum: 145 },
    { drawNumber: 7379, date: '2026-07-16', numbers: [14, 15, 18, 31, 38, 47], sum: 163 },
  ],
});

vi.mock('../src/api.js', () => ({
  ApiError: FakeApiError,
  getDraw: (nr) => {
    if (api.drawFail) return Promise.reject(api.drawFail);
    return DRAWS[nr] ? Promise.resolve(DRAWS[nr]) : Promise.reject(new FakeApiError('nope', 404));
  },
  getDraws: (query = {}) => {
    api.calls.push(query);
    if (api.listFail) return Promise.reject(new FakeApiError('boom', 500));
    if (query.perPage === 1) {
      const date = query.page && query.page > 1 ? '1957-01-27' : '2026-07-18';
      return Promise.resolve({ page: query.page || 1, perPage: 1, total: 7380, totalPages: 7380, draws: [{ drawNumber: 1, date, numbers: [1, 2, 3, 4, 5, 6], sum: 21 }] });
    }
    return Promise.resolve(listPage(query));
  },
  getSumsStats: () =>
    api.sumsFail
      ? Promise.reject(new Error('boom'))
      : Promise.resolve({
          histogram: [
            { sum: 145, count: 40 },
            { sum: 178, count: 30 },
            { sum: 279, count: 30 },
          ],
        }),
}));

const { createDrawView } = await import('../src/views/draw.js');

function mountView(params = {}, search = '') {
  window.history.replaceState({}, '', `/losowanie${params.nr ? `/${params.nr}` : ''}${search}`);
  const container = document.createElement('main');
  document.body.replaceChildren(container);
  const view = createDrawView();
  return { view, container, done: view.mount(container, params) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  api.drawFail = null;
  api.listFail = false;
  api.sumsFail = false;
  api.calls.length = 0;
});

describe('createDrawView — archive', () => {
  it('shows the archive alone on the bare /losowanie route', async () => {
    const { container, done } = mountView();
    await done;
    await settle();
    expect(container.querySelector('.archive')).not.toBeNull();
    expect(container.querySelector('.draw-detail')).toBeNull();
    expect(container.querySelector('.archive__disclosure')).toBeNull(); // list open, not folded
    expect(container.querySelectorAll('.archive-row')).toHaveLength(2);
  });

  it('lists nr, date, six mini balls and the sum, linking into the detail', async () => {
    const { container, done } = mountView();
    await done;
    await settle();
    const row = container.querySelector('.archive-row__link');
    expect(row.getAttribute('href')).toBe('/losowanie/7380');
    expect(row.querySelector('.archive-row__nr').textContent).toBe('nr 7380');
    expect(row.querySelector('.archive-row__date').textContent).toBe('18.07.2026');
    expect(row.querySelectorAll('.mini-ball')).toHaveLength(6);
    expect(row.querySelector('.archive-row__sum').textContent).toContain('145');
  });

  it('requests newest-first page 1 with no filters by default', async () => {
    const { done } = mountView();
    await done;
    await settle();
    expect(api.calls[0]).toEqual({ page: 1, perPage: 20 });
  });

  it('restores filters from the query string and sends them on', async () => {
    const { container, done } = mountView({}, '?rok=1997&zawiera=5,12&strona=3');
    await done;
    await settle();
    expect(api.calls[0]).toEqual({ page: 3, perPage: 20, year: '1997', contains: '5,12' });
    expect(container.querySelector('#archive-year').value).toBe('1997');
    expect([...container.querySelectorAll('.contains .is-on')].map((c) => c.dataset.number)).toEqual(['5', '12']);
  });

  it('refetches from page 1 when a number is picked on the contains blankiet', async () => {
    const { container, done } = mountView();
    await done;
    await settle();
    api.calls.length = 0;
    container.querySelector('.contains .mini-blanket__cell[data-number="7"]').click();
    await settle();
    expect(api.calls.at(-1)).toEqual({ page: 1, perPage: 20, contains: '7' });
    expect(window.location.search).toBe('?zawiera=7');
  });

  it('looks a draw number up through the form', async () => {
    const { container, done } = mountView();
    await done;
    await settle();
    const input = container.querySelector('#archive-nr');
    input.value = '3512';
    container.querySelector('.field--lookup').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(api.calls.at(-1)).toEqual({ page: 1, perPage: 20, number: '3512' });
  });

  it('carries the active filters into each row link so Back keeps the result page', async () => {
    const { container, done } = mountView({}, '?rok=1997');
    await done;
    await settle();
    expect(container.querySelector('.archive-row__link').getAttribute('href')).toBe('/losowanie/7380?rok=1997');
  });

  it('offers a pager and moves pages through it', async () => {
    const { container, done } = mountView();
    await done;
    await settle();
    const pages = [...container.querySelectorAll('.pager__page')].map((b) => b.textContent);
    expect(pages).toEqual(['1', '2', '3', '369']);
    container.querySelectorAll('.pager__page')[1].click();
    await settle();
    expect(api.calls.at(-1)).toEqual({ page: 2, perPage: 20 });
  });

  it('shows an archive error without touching the rest of the page', async () => {
    api.listFail = true;
    const { container, done } = mountView({ nr: '7380' });
    await done;
    await settle();
    expect(container.querySelector('.archive .section-error__msg').textContent).toContain('archiwum');
    expect(container.querySelector('.draw-detail')).not.toBeNull();
  });

  it('fills the year select from the oldest and newest draw', async () => {
    const { container, done } = mountView();
    await done;
    await settle();
    const options = [...container.querySelectorAll('#archive-year option')].map((o) => o.value);
    expect(options[0]).toBe('');
    expect(options[1]).toBe('2026');
    expect(options.at(-1)).toBe('1957');
  });
});

describe('createDrawView — detail', () => {
  it('folds the archive list away when a draw is open', async () => {
    const { container, done } = mountView({ nr: '7380' });
    await done;
    await settle();
    const disclosure = container.querySelector('.archive__disclosure');
    expect(disclosure).not.toBeNull();
    expect(disclosure.open).toBe(false);
  });

  it('renders balls, date, verdict, chips, neighbour and steps', async () => {
    const { container, done } = mountView({ nr: '7380' });
    await done;
    await settle();
    expect(container.querySelector('.draw-detail__title').textContent).toBe('nr 7380');
    expect(container.querySelectorAll('.draw-detail .ball')).toHaveLength(6);
    expect(container.querySelector('.draw-detail__date').textContent).toContain('2026');
    expect(container.querySelector('.verdict--premiera')).not.toBeNull();
    expect(container.querySelectorAll('.draw-detail .chip')).toHaveLength(6);
    expect(container.querySelector('.neighbor__lead a').getAttribute('href')).toBe('/losowanie/6520');
    expect(container.querySelector('.draw-step--prev').getAttribute('href')).toBe('/losowanie/7379');
    expect(container.querySelector('.draw-step--next').tagName).toBe('SPAN'); // latest draw
  });

  it('places the sum on the historical percentile scale', async () => {
    const { container, done } = mountView({ nr: '7380' });
    await done;
    await settle();
    expect(container.querySelector('.draw-sum__value').textContent).toBe('145');
    // 40 of 100 draws are at or below sum 145
    expect(container.querySelector('.draw-sum__note').textContent).toContain('40. percentyl');
    expect(container.querySelector('.draw-sum__note').textContent).toContain('typowy');
  });

  it('keeps the sum block when the histogram fails, minus the percentile', async () => {
    api.sumsFail = true;
    const { container, done } = mountView({ nr: '7380' });
    await done;
    await settle();
    expect(container.querySelector('.draw-sum__value').textContent).toBe('145');
    expect(container.querySelector('.draw-sum__scale')).toBeNull();
    expect(container.querySelector('.draw-sum__note').textContent).toContain('21–279');
  });

  it('offers to replay the set in the wehikuł', async () => {
    const { container, done } = mountView({ nr: '7380' });
    await done;
    await settle();
    expect(container.querySelector('.draw-detail__cta a').getAttribute('href')).toBe('/wehikul?zestaw=5,6,12,38,41,43');
  });

  it('handles the FIRST draw, where there is no prior state at all', async () => {
    const { container, done } = mountView({ nr: '1' });
    await done;
    await settle();
    expect(container.querySelector('.draw-detail__title').textContent).toBe('nr 1');
    expect(container.querySelector('.neighbor--none').textContent).toContain('pierwsze losowanie');
    expect(container.querySelectorAll('.draw-detail .chip')).toHaveLength(6);
    expect(container.querySelector('.chip__seen').textContent).toBe('pierwszy raz');
    expect(container.querySelector('.chip__count').textContent).toContain('0 razy');
    const prev = container.querySelector('.draw-step--prev');
    expect(prev.tagName).toBe('SPAN');
    expect(prev.textContent).toContain('to pierwsze losowanie');
    expect(container.querySelector('.draw-step--next').getAttribute('href')).toBe('/losowanie/2');
  });

  it('shows a not-found state for a draw that does not exist', async () => {
    const { container, done } = mountView({ nr: '50000' });
    await done;
    await settle();
    expect(container.querySelector('.error__title').textContent).toBe('Nie ma takiego losowania');
    expect(container.querySelector('.archive')).not.toBeNull();
  });

  it('renders nothing after an unmount that races the fetches', async () => {
    const { view, container, done } = mountView({ nr: '7380' });
    view.unmount();
    await done;
    await settle();
    expect(container.querySelector('.view--draw')).toBeNull();
  });
});
