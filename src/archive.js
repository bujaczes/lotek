// Pure archive state: request shape, pagination arithmetic and result copy for
// /losowanie. No DOM, no fetch — the view feeds it filters and renders what comes back.

import { parseNumbers, serializeNumbers } from './selection.js';
import { pluralPl } from './format.js';

export const PER_PAGE = 20;
const WINDOW = 1; // pages shown either side of the current one

/** Filters -> the query object api.getDraws() turns into a query string. */
export function buildArchiveQuery({ page = 1, perPage = PER_PAGE, year, contains, number } = {}) {
  const query = { page, perPage };
  if (year) query.year = String(year);
  if (contains && contains.length) query.contains = serializeNumbers(contains);
  if (number !== undefined && number !== null && String(number).trim() !== '') {
    const raw = String(number).trim();
    if (/^\d+$/.test(raw)) query.number = raw;
  }
  return query;
}

export function clampPage(page, totalPages) {
  const last = Math.max(1, totalPages || 0);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), last);
}

/**
 * Compact pager: first page, a window around the current one, last page, with `null`
 * standing for an elision. A single skipped page is printed rather than elided — an
 * ellipsis hiding exactly one page costs a click and saves nothing.
 */
export function pageWindow(page, totalPages) {
  const last = Math.max(1, totalPages || 0);
  const current = clampPage(page, last);
  const wanted = new Set([1, last]);
  // The window keeps a constant width by sliding at the ends, so the pager never
  // shrinks to two links just because the user is on the first or last page.
  const start = Math.min(Math.max(current - WINDOW, 1), Math.max(1, last - 2 * WINDOW));
  for (let p = start; p <= Math.min(last, start + 2 * WINDOW); p += 1) wanted.add(p);
  const pages = [...wanted].sort((a, b) => a - b);
  const out = [];
  let previous = null;
  for (const p of pages) {
    if (previous !== null && p - previous > 1) out.push(p - previous === 2 ? p - 1 : null);
    out.push(p);
    previous = p;
  }
  return out;
}

export function resultSummary({ page, perPage, total }) {
  if (!total) return 'Brak losowań dla tych filtrów';
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return `${from}–${to} z ${total} ${pluralPl(total, ['losowania', 'losowań', 'losowań'])}`;
}

/** Years covered by the archive, newest first — the year <select> options. */
export function yearRange(oldestDate, newestDate) {
  if (!oldestDate || !newestDate) return [];
  const from = Number(String(oldestDate).slice(0, 4));
  const to = Number(String(newestDate).slice(0, 4));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const years = [];
  for (let y = to; y >= from; y -= 1) years.push(y);
  return years;
}

/**
 * Archive state travels in the query string (Polish keys, they are user-visible), so a
 * click into a draw and the browser Back button both come back to the same result page.
 * Anything unparseable falls back to the unfiltered first page rather than erroring.
 */
export function archiveStateFromSearch(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : '');
  const year = params.get('rok') || '';
  const number = params.get('nr') || '';
  const pageRaw = params.get('strona');
  return {
    page: /^\d+$/.test(pageRaw || '') ? Math.max(1, Number(pageRaw)) : 1,
    year: /^\d{4}$/.test(year) ? year : '',
    contains: parseNumbers(params.get('zawiera') || ''),
    number: /^\d+$/.test(number) ? number : '',
  };
}

export function searchFromArchiveState({ page = 1, year = '', contains = [], number = '' } = {}) {
  const params = new URLSearchParams();
  if (year) params.set('rok', String(year));
  if (contains.length) params.set('zawiera', serializeNumbers(contains));
  if (number) params.set('nr', String(number));
  if (page > 1) params.set('strona', String(page));
  return params.toString();
}

export function isFiltered({ year, contains, number } = {}) {
  return Boolean(year) || Boolean(contains && contains.length) || Boolean(number && String(number).trim());
}
