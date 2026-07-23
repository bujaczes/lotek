import { el, clear } from '../dom.js';
import { getTyper, getTyperScorecard, ApiError } from '../api.js';
import {
  typerHero,
  rationaleSection,
  alternativesSection,
  numbersTable,
  nullHypothesisSection,
  historySection,
} from '../components/typer.js';
import { createScorecardSection } from '../components/typer-scorecard.js';
import { sectionError } from '../components/stats/section.js';

// /typer — SPEC §8.4/§8.5. getTyper drives the page: the current pick as six highlighted
// balls, the full deterministic "dlaczego te liczby" narrative (rendered from our own
// markdown via the safe renderer), the three backup sets, a per-number data table, the
// honest null-hypothesis section, and the history. A second call, getTyperScorecard,
// drives the "Sprawdzam!" self-scorecard (cumulative hits vs expected with a ±2σ band, the
// hit distribution, the hypothetical balance). ECharts is code-split and pulled in only
// here; the scorecard has its own error state so a dead endpoint never blanks the page.

function emptyState() {
  return el('div', { class: 'typer-empty card' }, [
    el('p', { class: 'eyebrow' }, 'Typer'),
    el('h1', { class: 'typer-empty__title' }, 'Typ jeszcze nie policzony'),
    el('p', { class: 'typer-empty__lead' },
      'Silnik nie wygenerował jeszcze predykcji na najbliższe losowanie. Wróć po najbliższym przeliczeniu.'),
  ]);
}

export function createTyperView() {
  let root = null;
  let controller = null;
  let scorecardSection = null;

  return {
    async mount(container) {
      controller = new AbortController();
      const mine = controller;
      const stale = () => mine.signal.aborted || !root;

      root = el('div', { class: 'view view--typer' }, [
        el('p', { class: 'loading' }, 'Wczytuję typ na najbliższe losowanie…'),
      ]);
      container.append(root);

      // Kick off the scorecard fetch and the chart-library import alongside the main fetch.
      // Both are section-isolated: their failure degrades to a section error, never the page.
      const chartApi = import('../charts/echarts.js').then((m) => m.createChart, () => null);
      const scorecardData = getTyperScorecard({ signal: mine.signal }).then(
        (d) => d,
        () => null
      );

      let data;
      try {
        data = await getTyper({ signal: mine.signal });
      } catch (err) {
        if (stale()) return;
        clear(root);
        root.append(
          el('div', { class: 'error card' }, [
            el('p', { class: 'error__title' }, 'Nie udało się wczytać Typera'),
            el('p', { class: 'error__msg' }, err instanceof ApiError ? err.message : 'Coś poszło nie tak.'),
            el('button', { class: 'btn', onClick: () => this.reload(container) }, 'Spróbuj ponownie'),
          ])
        );
        return;
      }
      if (stale()) return;

      clear(root);

      if (!data.current) {
        root.append(emptyState(), historySection(data.history));
      } else {
        const { prediction, commentary } = data.current;
        root.append(
          typerHero(prediction),
          rationaleSection(commentary),
          alternativesSection(prediction.alternatives),
          numbersTable(prediction.numberStats),
          nullHypothesisSection(data.nullHypothesis),
          historySection(data.history)
        );
      }

      // "Sprawdzam!" self-scorecard — appended in both branches, error-isolated.
      const slot = el('div', { class: 'typer-scorecard-slot' });
      root.append(slot);

      const scorecard = await scorecardData;
      if (stale()) return;

      if (!scorecard) {
        slot.append(sectionError('Nie udało się wczytać samorozliczenia „Sprawdzam!”.'));
        return;
      }

      try {
        scorecardSection = createScorecardSection(scorecard, await chartApi);
      } catch {
        slot.append(sectionError('Nie udało się wczytać samorozliczenia „Sprawdzam!”.'));
        return;
      }
      if (stale()) return;
      slot.append(scorecardSection.node);
      try {
        scorecardSection.render();
      } catch {
        // A chart that refuses to init must not take the section's copy, tables and
        // balance down with it.
      }
    },

    reload(container) {
      this.unmount();
      this.mount(container);
    },

    unmount() {
      if (controller) controller.abort();
      controller = null;
      if (scorecardSection && scorecardSection.destroy) scorecardSection.destroy();
      scorecardSection = null;
      if (root) root.remove();
      root = null;
    },
  };
}
