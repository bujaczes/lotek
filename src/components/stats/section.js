import { el } from '../../dom.js';

// Shared shell for every /statystyki section: eyebrow number, title, one or two
// sentences of context, then the panel. Keeps the seven sections visually identical
// so the page reads as one document rather than seven widgets.

export function statsSection({ index, title, lead, children = [], id }) {
  return el('section', { class: 'stats-section', id }, [
    el('header', { class: 'stats-section__head' }, [
      el('span', { class: 'stats-section__idx mono', 'aria-hidden': 'true' }, String(index).padStart(2, '0')),
      el('h2', { class: 'stats-section__title' }, title),
      lead ? el('p', { class: 'stats-section__lead' }, lead) : null,
    ]),
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

/** An attached, sized box for ECharts to init into. */
export function chartBox(height, label) {
  return el('div', {
    class: 'chart-box',
    style: { height: `${height}px` },
    role: 'img',
    'aria-label': label,
  });
}

/**
 * The table-view twin. Required relief for the sub-3:1 amber fill (see charts/theme.js)
 * and the keyboard/screen-reader path to every value a tooltip would show.
 */
export function tableView(caption, headers, rows) {
  return el('details', { class: 'chart-table' }, [
    el('summary', { class: 'chart-table__summary' }, 'Pokaż dane w tabeli'),
    el('div', { class: 'chart-table__scroll' }, [
      el('table', { class: 'chart-table__table mono' }, [
        el('caption', { class: 'chart-table__caption' }, caption),
        el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { scope: 'col' }, h)))]),
        el(
          'tbody',
          {},
          rows.map((cells) => el('tr', {}, cells.map((c) => el('td', {}, c))))
        ),
      ]),
    ]),
  ]);
}

export function chartNote(children) {
  return el('p', { class: 'chart-note' }, children);
}

export function sectionError(message) {
  return el('div', { class: 'section-error card' }, [el('p', { class: 'section-error__msg' }, message)]);
}

export function sectionLoading(message) {
  return el('p', { class: 'loading' }, message);
}
