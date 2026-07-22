import { el, clear } from '../dom.js';
import { getDraw, getDraws, getSumsStats, ApiError } from '../api.js';
import { sectionError, sectionLoading } from '../components/stats/section.js';
import { createArchive } from '../components/archive.js';
import { createDrawDetail } from '../components/draw-detail.js';
import { buildArchiveQuery, archiveStateFromSearch, searchFromArchiveState, yearRange } from '../archive.js';

// /losowanie and /losowanie/:nr — SPEC 6.10 + 7 ("archiwum z wyszukiwarką"). The archive
// sits above the detail per the brief; when a draw is open its list collapses into a
// disclosure so the draw the user actually clicked stays the top of the page.
// Filter state lives in the query string so stepping into a draw and back keeps it.

function drawNotFound(nr) {
  return el('div', { class: 'error card' }, [
    el('p', { class: 'error__title' }, 'Nie ma takiego losowania'),
    el('p', { class: 'error__msg' }, `Losowanie nr ${nr} nie istnieje. Numeracja biegnie od 1 do ostatniego losowania.`),
  ]);
}

export function createDrawView() {
  let root = null;
  let controller = null;
  let listController = null;
  let archive = null;
  let state = null;

  function currentSearch() {
    return searchFromArchiveState(state);
  }

  return {
    async mount(container, params = {}) {
      controller = new AbortController();
      const mine = controller;
      const signal = mine.signal;
      const stale = () => mine.signal.aborted || !root;

      const nr = typeof params.nr === 'string' && /^\d+$/.test(params.nr) ? Number(params.nr) : null;
      const hasDetail = params.nr !== undefined;
      state = archiveStateFromSearch(typeof window === 'undefined' ? '' : window.location.search);

      const detailSlot = el('div', { class: 'draw-slot' });
      archive = createArchive({
        state,
        collapsed: hasDetail,
        onChange: (next) => {
          state = next;
          this.syncUrl();
          this.loadList();
        },
      });

      root = el('div', { class: 'view view--draw' }, [archive.node, detailSlot]);
      container.append(root);

      if (hasDetail) {
        detailSlot.append(sectionLoading(`Wczytuję losowanie nr ${params.nr}…`));
      }

      // Archive list, year range and the draw detail are three independent failures.
      this.loadList();

      const yearsPromise = getDraws({ perPage: 1 }, { signal }).then(async (newest) => {
        if (!newest.total) return [];
        const oldest = await getDraws({ perPage: 1, page: newest.total }, { signal });
        return yearRange(oldest.draws[0]?.date, newest.draws[0]?.date);
      });
      yearsPromise.then(
        (years) => {
          if (!stale()) archive.setYears(years);
        },
        () => {}
      );

      if (!hasDetail) return;

      if (nr === null || nr < 1) {
        clear(detailSlot);
        detailSlot.append(drawNotFound(String(params.nr)));
        return;
      }

      // The sum histogram only powers the percentile line; it must never block or break
      // the detail, so it is settled separately and defaults to null.
      const sumsPromise = getSumsStats({ signal }).then(
        (s) => s.histogram,
        () => null
      );

      let data;
      try {
        data = await getDraw(nr, { signal });
      } catch (err) {
        if (stale()) return;
        clear(detailSlot);
        detailSlot.append(
          err instanceof ApiError && (err.status === 404 || err.status === 400)
            ? drawNotFound(nr)
            : sectionError('Nie udało się wczytać tego losowania.')
        );
        return;
      }
      if (stale()) return;

      const sumHistogram = await sumsPromise;
      if (stale()) return;

      clear(detailSlot);
      detailSlot.append(createDrawDetail(data, { sumHistogram }));
    },

    syncUrl() {
      if (typeof window === 'undefined' || !window.history) return;
      const search = currentSearch();
      window.history.replaceState({}, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
    },

    async loadList() {
      if (listController) listController.abort();
      listController = new AbortController();
      const mine = listController;
      archive.setLoading();
      try {
        const payload = await getDraws(buildArchiveQuery(state), { signal: mine.signal });
        if (mine.signal.aborted || !root) return;
        archive.setResults(payload);
      } catch (err) {
        if (mine.signal.aborted || !root) return;
        archive.setError(
          err instanceof ApiError && err.status === 400
            ? 'Te filtry są nieprawidłowe. Wyczyść je i spróbuj jeszcze raz.'
            : 'Nie udało się wczytać archiwum.'
        );
      }
    },

    unmount() {
      if (controller) controller.abort();
      if (listController) listController.abort();
      controller = null;
      listController = null;
      archive = null;
      if (root) root.remove();
      root = null;
    },
  };
}
