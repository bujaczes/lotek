import { el, clear } from '../dom.js';
import { createMiniBlanket } from './mini-blanket.js';
import { sectionError, sectionLoading } from './stats/section.js';
import { formatShortDate } from '../format.js';
import { pageWindow, resultSummary, isFiltered, searchFromArchiveState } from '../archive.js';
import { SET_SIZE } from '../selection.js';

// The archive on /losowanie: a filter bar (year, "zawiera liczby" as a clickable mini
// blankiet, draw-number lookup) over a paginated newest-first list. The component owns
// its controls and its own repaint; the view owns fetching and hands results back in.

export function miniBalls(numbers) {
  return el(
    'span',
    { class: 'mini-balls', 'aria-label': `Wylosowane liczby: ${numbers.join(', ')}` },
    numbers.map((n) => el('span', { class: 'mini-ball mono', 'aria-hidden': 'true' }, String(n)))
  );
}

function drawRow(draw, search) {
  const href = `/losowanie/${draw.drawNumber}${search ? `?${search}` : ''}`;
  return el('li', { class: 'archive-row' }, [
    el('a', { class: 'archive-row__link', href }, [
      el('span', { class: 'archive-row__nr mono' }, `nr ${draw.drawNumber}`),
      el('span', { class: 'archive-row__date mono' }, formatShortDate(draw.date)),
      miniBalls(draw.numbers),
      el('span', { class: 'archive-row__sum mono' }, [el('span', { class: 'archive-row__sumlabel' }, 'suma '), String(draw.sum)]),
    ]),
  ]);
}

function pager(payload, onPage) {
  const pages = pageWindow(payload.page, payload.totalPages);
  const link = (page) =>
    el(
      'button',
      {
        class: `pager__page mono${page === payload.page ? ' is-current' : ''}`,
        type: 'button',
        'aria-label': `Strona ${page}`,
        'aria-current': page === payload.page ? 'page' : null,
        onClick: () => onPage(page),
      },
      String(page)
    );

  const step = (label, page, disabled, aria) =>
    el(
      'button',
      { class: 'pager__step', type: 'button', disabled, 'aria-label': aria, onClick: () => onPage(page) },
      label
    );

  return el('nav', { class: 'pager', 'aria-label': 'Strony archiwum' }, [
    step('←', payload.page - 1, payload.page <= 1, 'Poprzednia strona'),
    el(
      'span',
      { class: 'pager__pages' },
      pages.map((p) => (p === null ? el('span', { class: 'pager__gap', 'aria-hidden': 'true' }, '…') : link(p)))
    ),
    step('→', payload.page + 1, payload.page >= payload.totalPages, 'Następna strona'),
  ]);
}

export function createArchive({ state, onChange, collapsed = false }) {
  let current = { ...state, contains: [...state.contains] };

  const emit = () => onChange({ ...current, contains: [...current.contains] });

  // --- controls -------------------------------------------------------------
  const yearSelect = el('select', {
    class: 'field__input',
    id: 'archive-year',
    onChange: (e) => {
      current = { ...current, year: e.target.value, page: 1 };
      emit();
    },
  });

  function paintYears(years) {
    clear(yearSelect);
    yearSelect.append(el('option', { value: '' }, 'Wszystkie lata'));
    for (const year of years) {
      yearSelect.append(el('option', { value: String(year), selected: String(year) === current.year }, String(year)));
    }
    yearSelect.value = current.year || '';
  }
  paintYears([]);

  const numberInput = el('input', {
    class: 'field__input mono',
    id: 'archive-nr',
    type: 'search',
    inputmode: 'numeric',
    placeholder: 'np. 7380',
    value: current.number,
  });

  const lookupForm = el(
    'form',
    {
      class: 'field field--lookup',
      onSubmit: (e) => {
        e.preventDefault();
        const raw = numberInput.value.trim();
        current = { ...current, number: /^\d+$/.test(raw) ? raw : '', page: 1 };
        numberInput.value = current.number;
        emit();
      },
    },
    [
      el('label', { class: 'field__label', for: 'archive-nr' }, 'Numer losowania'),
      el('div', { class: 'field__row' }, [numberInput, el('button', { class: 'btn btn--quiet', type: 'submit' }, 'Znajdź')]),
    ]
  );

  const containsCount = el('span', { class: 'contains__count mono' });
  const picker = createMiniBlanket({
    mode: 'pick',
    max: SET_SIZE,
    selected: current.contains,
    ariaLabel: 'Blankiet — wybierz liczby, które ma zawierać losowanie',
    onChange: (selected) => {
      current = { ...current, contains: selected, page: 1 };
      paintContainsCount();
      emit();
    },
  });

  function paintContainsCount() {
    const n = current.contains.length;
    containsCount.textContent = n ? `${n}/${SET_SIZE}: ${current.contains.join(', ')}` : 'dowolne';
  }
  paintContainsCount();

  const containsField = el('details', { class: 'contains', open: current.contains.length > 0 }, [
    el('summary', { class: 'contains__summary' }, [
      el('span', {}, 'Zawiera liczby'),
      containsCount,
    ]),
    el('div', { class: 'contains__body' }, [
      picker.node,
      el('p', { class: 'contains__hint' }, 'Klikaj pola blankietu — pokażemy tylko losowania, w których padły wszystkie zaznaczone liczby.'),
    ]),
  ]);

  const resetButton = el(
    'button',
    {
      class: 'btn btn--quiet archive-filters__reset',
      type: 'button',
      onClick: () => {
        current = { page: 1, year: '', contains: [], number: '' };
        yearSelect.value = '';
        numberInput.value = '';
        picker.clear();
        paintContainsCount();
        paintReset();
        emit();
      },
    },
    'Wyczyść filtry'
  );

  function paintReset() {
    resetButton.hidden = !isFiltered(current);
  }
  paintReset();

  const filters = el('div', { class: 'archive-filters' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'archive-year' }, 'Rok'),
      yearSelect,
    ]),
    lookupForm,
    containsField,
    resetButton,
  ]);

  // --- results --------------------------------------------------------------
  const summary = el('p', { class: 'archive-summary mono' });
  const results = el('div', { class: 'archive-results' }, [sectionLoading('Wczytuję archiwum…')]);

  const body = el('div', { class: 'archive__body' }, [summary, results]);
  const disclosure = collapsed
    ? el('details', { class: 'archive__disclosure' }, [
        el('summary', { class: 'archive__disclosure-summary' }, 'Przeglądaj listę losowań'),
        body,
      ])
    : body;

  const node = el('section', { class: 'archive' }, [
    el('header', { class: 'archive__head' }, [
      el('p', { class: 'eyebrow' }, 'Archiwum'),
      el('h2', { class: 'section__title' }, 'Wszystkie losowania Dużego Lotka'),
    ]),
    filters,
    disclosure,
  ]);

  return {
    node,
    setYears(years) {
      paintYears(years);
    },
    setLoading() {
      summary.textContent = '';
      clear(results);
      results.append(sectionLoading('Wczytuję archiwum…'));
    },
    setError(message) {
      summary.textContent = '';
      clear(results);
      results.append(sectionError(message));
    },
    setResults(payload) {
      paintReset();
      summary.textContent = resultSummary(payload);
      clear(results);
      if (!payload.draws.length) {
        results.append(
          el('p', { class: 'archive-empty' }, 'Żadne losowanie nie pasuje do tych filtrów. Spróbuj zdjąć jeden z nich.')
        );
        return;
      }
      const search = searchFromArchiveState(current);
      results.append(
        el('ol', { class: 'archive-list' }, payload.draws.map((d) => drawRow(d, search))),
        payload.totalPages > 1
          ? pager(payload, (page) => {
              current = { ...current, page };
              emit();
            })
          : null
      );
    },
  };
}
