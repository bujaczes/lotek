import { el, clear } from '../dom.js';
import { getTyper, ApiError } from '../api.js';
import {
  typerHero,
  rationaleSection,
  alternativesSection,
  numbersTable,
  nullHypothesisSection,
  historySection,
} from '../components/typer.js';

// /typer — SPEC §8.4/§8.5. One fetch (getTyper) drives the whole page: the current pick as
// six highlighted balls, the full deterministic "dlaczego te liczby" narrative (rendered
// from our own markdown via the safe renderer), the three backup sets, a per-number data
// table, the honest null-hypothesis section, and the self-scorecard history.

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

  return {
    async mount(container) {
      controller = new AbortController();
      const mine = controller;
      const stale = () => mine.signal.aborted || !root;

      root = el('div', { class: 'view view--typer' }, [
        el('p', { class: 'loading' }, 'Wczytuję typ na najbliższe losowanie…'),
      ]);
      container.append(root);

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
        return;
      }

      const { prediction, commentary } = data.current;
      root.append(
        typerHero(prediction),
        rationaleSection(commentary),
        alternativesSection(prediction.alternatives),
        numbersTable(prediction.numberStats),
        nullHypothesisSection(data.nullHypothesis),
        historySection(data.history)
      );
    },

    reload(container) {
      this.unmount();
      this.mount(container);
    },

    unmount() {
      if (controller) controller.abort();
      controller = null;
      if (root) root.remove();
      root = null;
    },
  };
}
