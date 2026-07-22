import { el, clear } from '../dom.js';
import { postWehikul, ApiError } from '../api.js';
import { sectionError, sectionLoading } from '../components/stats/section.js';
import { createPicker, createWehikulResults } from '../components/wehikul.js';
import { parseNumbers, serializeNumbers } from '../selection.js';

// /wehikul — SPEC 6.14. Pick six, get the whole history of that coupon. A set can also
// arrive prefilled from another page (?zestaw=5,6,12,38,41,43); it is parsed as untrusted
// input and either yields a complete valid six or nothing at all.

function pageHead() {
  return el('header', { class: 'wehikul-head' }, [
    el('p', { class: 'eyebrow' }, 'Wehikuł czasu'),
    el('h1', { class: 'wehikul-head__title' }, 'Co by było, gdybyś grał tym zestawem od 1957 roku?'),
    el('p', { class: 'wehikul-head__lead' },
      'Zaznacz sześć liczb na blankiecie. Sprawdzimy je w każdym losowaniu Dużego Lotka w historii i pokażemy, ' +
        'ile razy trafiłbyś trójkę, czwórkę, piątkę i szóstkę — oraz jak wyszedłby na tym Twój portfel.'),
  ]);
}

export function createWehikulView() {
  let root = null;
  let controller = null;
  let runController = null;

  return {
    mount(container) {
      controller = new AbortController();
      const mine = controller;

      const resultSlot = el('div', { class: 'wehikul-slot' });

      const prefilled =
        typeof window === 'undefined'
          ? []
          : parseNumbers(new URLSearchParams(window.location.search).get('zestaw') || '');

      const picker = createPicker({
        selected: prefilled,
        onSubmit: (numbers) => run(numbers),
      });

      root = el('div', { class: 'view view--wehikul' }, [pageHead(), picker.node, resultSlot]);
      container.append(root);

      async function run(numbers) {
        if (runController) runController.abort();
        runController = new AbortController();
        const runMine = runController;
        const stale = () => runMine.signal.aborted || mine.signal.aborted || !root;

        picker.setBusy(true);
        clear(resultSlot);
        resultSlot.append(sectionLoading(`Przeglądam całą historię pod kątem zestawu ${numbers.join(', ')}…`));

        let data;
        try {
          data = await postWehikul(numbers, { signal: runMine.signal });
        } catch (err) {
          if (stale()) return;
          picker.setBusy(false);
          clear(resultSlot);
          resultSlot.append(
            sectionError(
              err instanceof ApiError && err.status === 400
                ? 'Ten zestaw jest nieprawidłowy — potrzebujemy sześciu różnych liczb od 1 do 49.'
                : 'Nie udało się sprawdzić zestawu. Spróbuj jeszcze raz.'
            )
          );
          return;
        }
        if (stale()) return;

        picker.setBusy(false);
        clear(resultSlot);
        resultSlot.append(createWehikulResults(data));

        // Keep the played set in the URL so the result page is shareable and survives
        // a reload; replaceState, because it is not a separate history entry.
        if (typeof window !== 'undefined' && window.history) {
          window.history.replaceState({}, '', `${window.location.pathname}?zestaw=${serializeNumbers(numbers)}`);
        }
      }

      if (prefilled.length === 6) run(prefilled);
    },

    unmount() {
      if (controller) controller.abort();
      if (runController) runController.abort();
      controller = null;
      runController = null;
      if (root) root.remove();
      root = null;
    },
  };
}
