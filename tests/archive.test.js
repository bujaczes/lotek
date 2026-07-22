import { describe, expect, it } from 'vitest';
import {
  PER_PAGE,
  buildArchiveQuery,
  clampPage,
  pageWindow,
  resultSummary,
  yearRange,
  isFiltered,
  archiveStateFromSearch,
  searchFromArchiveState,
} from '../src/archive.js';

describe('archive state in the query string', () => {
  it('reads the Polish query keys', () => {
    expect(archiveStateFromSearch('?rok=1997&zawiera=5,12&nr=3512&strona=4')).toEqual({
      page: 4,
      year: '1997',
      contains: [5, 12],
      number: '3512',
    });
  });

  it('falls back to the unfiltered first page on junk', () => {
    expect(archiveStateFromSearch('?rok=zeszly&zawiera=99&nr=abc&strona=-2')).toEqual({
      page: 1,
      year: '',
      contains: [],
      number: '',
    });
    expect(archiveStateFromSearch('')).toEqual({ page: 1, year: '', contains: [], number: '' });
    expect(archiveStateFromSearch(undefined)).toEqual({ page: 1, year: '', contains: [], number: '' });
  });

  it('writes only the parts that are set, and omits page 1', () => {
    expect(searchFromArchiveState({ page: 1 })).toBe('');
    expect(searchFromArchiveState({ page: 2, year: '1997', contains: [12, 5], number: '' })).toBe(
      'rok=1997&zawiera=5%2C12&strona=2'
    );
  });

  it('round-trips', () => {
    const state = { page: 7, year: '2001', contains: [3, 9], number: '' };
    expect(archiveStateFromSearch(`?${searchFromArchiveState(state)}`)).toEqual(state);
  });
});

describe('buildArchiveQuery', () => {
  it('sends page and perPage on an unfiltered request', () => {
    expect(buildArchiveQuery({ page: 1 })).toEqual({ page: 1, perPage: PER_PAGE });
  });

  it('drops empty filters instead of sending blank values', () => {
    expect(buildArchiveQuery({ page: 2, year: '', contains: [], number: '' })).toEqual({
      page: 2,
      perPage: PER_PAGE,
    });
  });

  it('serializes the contains selection as a comma list', () => {
    expect(buildArchiveQuery({ page: 1, contains: [12, 5] })).toEqual({
      page: 1,
      perPage: PER_PAGE,
      contains: '5,12',
    });
  });

  it('passes year and draw-number lookups through', () => {
    expect(buildArchiveQuery({ page: 1, year: '1997', number: '3512' })).toEqual({
      page: 1,
      perPage: PER_PAGE,
      year: '1997',
      number: '3512',
    });
  });

  it('ignores a non-numeric draw-number lookup', () => {
    expect(buildArchiveQuery({ page: 1, number: 'abc' })).toEqual({ page: 1, perPage: PER_PAGE });
  });
});

describe('clampPage', () => {
  it('keeps a page inside 1..totalPages', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(5, 10)).toBe(5);
    expect(clampPage(99, 10)).toBe(10);
  });

  it('never returns 0 when there are no results', () => {
    expect(clampPage(3, 0)).toBe(1);
  });
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('anchors the first and last page and elides the rest', () => {
    expect(pageWindow(200, 369)).toEqual([1, null, 199, 200, 201, null, 369]);
  });

  it('does not elide a single skipped page', () => {
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, null, 7]);
  });

  it('keeps the window inside range at both ends', () => {
    expect(pageWindow(1, 369)).toEqual([1, 2, 3, null, 369]);
    expect(pageWindow(369, 369)).toEqual([1, null, 367, 368, 369]);
  });
});

describe('resultSummary', () => {
  it('describes the visible slice of the result set', () => {
    expect(resultSummary({ page: 1, perPage: 20, total: 7380 })).toBe('1–20 z 7380 losowań');
    expect(resultSummary({ page: 369, perPage: 20, total: 7380 })).toBe('7361–7380 z 7380 losowań');
  });

  it('clips the last page to the real total', () => {
    expect(resultSummary({ page: 2, perPage: 20, total: 25 })).toBe('21–25 z 25 losowań');
  });

  it('says so when nothing matched', () => {
    expect(resultSummary({ page: 1, perPage: 20, total: 0 })).toBe('Brak losowań dla tych filtrów');
  });

  it('agrees with the Polish plural for one result', () => {
    expect(resultSummary({ page: 1, perPage: 20, total: 1 })).toBe('1–1 z 1 losowania');
  });
});

describe('yearRange', () => {
  it('lists years newest first, inclusive at both ends', () => {
    expect(yearRange('1957-01-27', '1960-03-01')).toEqual([1960, 1959, 1958, 1957]);
  });

  it('is empty when either bound is missing', () => {
    expect(yearRange(null, '2026-07-18')).toEqual([]);
    expect(yearRange('1957-01-27', null)).toEqual([]);
  });
});

describe('isFiltered', () => {
  it('is false only when nothing is set', () => {
    expect(isFiltered({ year: '', contains: [], number: '' })).toBe(false);
    expect(isFiltered({ year: '1997', contains: [], number: '' })).toBe(true);
    expect(isFiltered({ year: '', contains: [7], number: '' })).toBe(true);
    expect(isFiltered({ year: '', contains: [], number: '12' })).toBe(true);
  });
});
