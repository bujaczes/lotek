import { el, clear } from '../dom.js';
import {
  getSumsStats,
  getCarpetStats,
  getStructureStats,
  getPairsStats,
  getConsecutiveStats,
  getRepeatsStats,
  getDuplicateSixesStats,
  getRecordsStats,
} from '../api.js';
import { sectionError, sectionLoading } from '../components/stats/section.js';
import { createSumSection } from '../components/stats/sum-section.js';
import { createCarpetSection } from '../components/stats/carpet-section.js';
import { createStructureSection } from '../components/stats/structure-section.js';
import { createPairsSection } from '../components/stats/pairs-section.js';
import { createMythsSection } from '../components/stats/myths-section.js';
import { createDuplicatesSection } from '../components/stats/duplicates-section.js';
import { createRecordsSection } from '../components/stats/records-section.js';

// /statystyki — SPEC 6.4-6.9, 6.12, 6.13. Seven independent sections: each has its own
// loading state and its own failure state, so one dead endpoint never blanks the page.
// ECharts is code-split and pulled in only when this route is entered.

const SLOTS = [
  { key: 'sums', loading: 'Wczytuję rozkład sum…' },
  { key: 'carpet', loading: 'Wczytuję dywan losowań…' },
  { key: 'structure', loading: 'Wczytuję strukturę losowań…' },
  { key: 'pairs', loading: 'Wczytuję pary i trójki…' },
  { key: 'myths', loading: 'Wczytuję sąsiadujące i powtórki…' },
  { key: 'duplicates', loading: 'Sprawdzam powtórzone szóstki…' },
  { key: 'records', loading: 'Wczytuję rekordy…' },
];

function pageHead() {
  return el('header', { class: 'stats-head' }, [
    el('p', { class: 'eyebrow' }, 'Statystyki'),
    el('h1', { class: 'stats-head__title' }, 'Siedem sposobów, żeby zobaczyć przypadek'),
    el('p', { class: 'stats-head__lead' },
      'Przy każdej liczbie empirycznej stoi tu wartość teoretyczna. Nie po to, żeby wskazać zestaw, ' +
        'który wygra — taki nie istnieje — tylko po to, żeby pokazać, jak dokładnie 70 lat losowań trafia w matematykę.'),
  ]);
}

export function createStatsView() {
  let root = null;
  let controller = null;
  const sections = [];

  return {
    async mount(container) {
      controller = new AbortController();
      const mine = controller;
      const signal = mine.signal;
      const stale = () => mine.signal.aborted || !root;

      const slots = new Map(
        SLOTS.map((s) => [s.key, el('div', { class: 'stats-slot' }, [sectionLoading(s.loading)])])
      );
      root = el('div', { class: 'view view--stats' }, [pageHead(), ...slots.values()]);
      container.append(root);

      // The chart library is a route-level dynamic import: it lands in its own chunk and
      // a failed load degrades to the text/table content instead of killing the section.
      const chartApi = import('../charts/echarts.js').then(
        (m) => m.createChart,
        () => null
      );

      const data = {
        sums: getSumsStats({ signal }),
        carpet: getCarpetStats({ signal }),
        structure: getStructureStats({ signal }),
        pairs: getPairsStats({ signal }),
        consecutive: getConsecutiveStats({ signal }),
        repeats: getRepeatsStats({ signal }),
        duplicates: getDuplicateSixesStats({ signal }),
        records: getRecordsStats({ signal }),
      };

      async function fill(key, message, build) {
        const slot = slots.get(key);
        let section;
        try {
          section = await build();
        } catch {
          if (stale()) return;
          clear(slot);
          slot.append(sectionError(message));
          return;
        }
        if (stale()) return;
        clear(slot);
        slot.append(section.node);
        sections.push(section);
        try {
          if (section.render) section.render();
        } catch {
          // A chart that refuses to init must not take its section's text, numbers and
          // table view down with it.
        }
      }

      await Promise.all([
        fill('sums', 'Nie udało się wczytać rozkładu sum.', async () =>
          createSumSection(await data.sums, await chartApi)
        ),
        fill('carpet', 'Nie udało się wczytać dywanu losowań.', async () =>
          createCarpetSection(await data.carpet, await chartApi)
        ),
        fill('structure', 'Nie udało się wczytać struktury losowań.', async () =>
          createStructureSection(await data.structure, await chartApi)
        ),
        fill('pairs', 'Nie udało się wczytać par i trójek.', async () => createPairsSection(await data.pairs)),
        fill('myths', 'Nie udało się wczytać sąsiadujących i powtórek.', async () =>
          createMythsSection({ consecutive: await data.consecutive, repeats: await data.repeats })
        ),
        fill('duplicates', 'Nie udało się sprawdzić powtórzonych szóstek.', async () => {
          const drawsCount = await data.consecutive.then((d) => d.draws, () => null);
          return createDuplicatesSection(await data.duplicates, drawsCount);
        }),
        fill('records', 'Nie udało się wczytać rekordów.', async () => createRecordsSection(await data.records)),
      ]);
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
