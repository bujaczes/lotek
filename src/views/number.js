import { el, clear } from '../dom.js';
import { getNumberCareer, getDraws, ApiError } from '../api.js';
import { sectionError, sectionLoading } from '../components/stats/section.js';
import {
  careerHeader,
  careerTiles,
  absenceNote,
  createYearSection,
  createGapSection,
  createZScoreSection,
  createPositionSection,
} from '../components/career.js';

// /liczba/:n — SPEC 6.11. One fetch drives the whole page (the career endpoint), so the
// page-level failure state is the honest one here; the three charts are still isolated
// from each other so a single broken option never blanks the numbers around it.
// Navigation between numbers is CLAMPED, not wrapping: 1 has no previous, 49 no next.

function isValidNumberParam(raw) {
  return typeof raw === 'string' && /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 49;
}

function notFound(raw) {
  return el('div', { class: 'error card' }, [
    el('p', { class: 'error__title' }, 'Nie ma takiej liczby'),
    el('p', { class: 'error__msg' }, `W Dużym Lotku losuje się liczby od 1 do 49. „${raw}” nie jest jedną z nich.`),
    el('a', { class: 'btn', href: '/liczba/7' }, 'Zobacz karierę liczby 7'),
  ]);
}

export function createNumberView() {
  let root = null;
  let controller = null;
  const sections = [];

  return {
    async mount(container, params = {}) {
      controller = new AbortController();
      const mine = controller;
      const signal = mine.signal;
      const stale = () => mine.signal.aborted || !root;

      root = el('div', { class: 'view view--number' });
      container.append(root);

      if (!isValidNumberParam(params.n)) {
        root.append(notFound(String(params.n ?? '')));
        return;
      }
      const number = Number(params.n);
      root.append(sectionLoading(`Wczytuję karierę liczby ${number}…`));

      let data;
      try {
        data = await getNumberCareer(number, { signal });
      } catch (err) {
        if (stale()) return;
        clear(root);
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
          root.append(notFound(String(number)));
          return;
        }
        root.append(
          el('div', { class: 'error card' }, [
            el('p', { class: 'error__title' }, `Nie udało się wczytać kariery liczby ${number}`),
            el('p', { class: 'error__msg' }, err instanceof ApiError ? err.message : 'Coś poszło nie tak.'),
            el('button', { class: 'btn', onClick: () => this.reload(container, params) }, 'Spróbuj ponownie'),
          ])
        );
        return;
      }
      if (stale()) return;

      // The theoretical reference (N x 6/49) needs the draw count, which the career
      // endpoint does not carry. It is a one-row list request, and its failure only
      // costs the comparison — never the page.
      const totalDraws = await getDraws({ perPage: 1 }, { signal }).then(
        (list) => list.total,
        () => null
      );
      if (stale()) return;

      const chartApi = import('../charts/echarts.js').then(
        (m) => m.createChart,
        () => null
      );

      const slots = {
        year: el('div', { class: 'career-slot' }, [sectionLoading('Wczytuję wykres roczny…')]),
        gaps: el('div', { class: 'career-slot' }, [sectionLoading('Wczytuję rozkład przerw…')]),
        zscore: el('div', { class: 'career-slot' }, [sectionLoading('Wczytuję z-score…')]),
        blanket: el('div', { class: 'career-slot' }),
      };

      clear(root);
      root.append(
        careerHeader(number, data.stats, totalDraws),
        careerTiles(data, totalDraws),
        absenceNote(data.stats),
        slots.year,
        slots.gaps,
        slots.zscore,
        slots.blanket
      );

      const createChart = await chartApi;
      if (stale()) return;

      const build = (slot, message, factory) => {
        let section;
        try {
          section = factory();
        } catch {
          clear(slot);
          slot.append(sectionError(message));
          return;
        }
        clear(slot);
        slot.append(section.node);
        sections.push(section);
        try {
          section.render(createChart);
        } catch {
          // A chart that refuses to init must not take its panel's numbers and table
          // view down with it.
        }
      };

      build(slots.year, 'Nie udało się narysować wykresu rocznego.', () => createYearSection(data));
      build(slots.gaps, 'Nie udało się narysować rozkładu przerw.', () => createGapSection(data));
      build(slots.zscore, 'Nie udało się narysować z-score.', () => createZScoreSection(data));
      try {
        slots.blanket.append(createPositionSection(data));
      } catch {
        slots.blanket.append(sectionError('Nie udało się narysować blankietu.'));
      }
    },

    reload(container, params) {
      this.unmount();
      this.mount(container, params);
    },

    unmount() {
      if (controller) controller.abort();
      controller = null;
      for (const section of sections) {
        if (section.destroy) section.destroy();
      }
      sections.length = 0;
      if (root) root.remove();
      root = null;
    },
  };
}
