import { el, clear } from '../dom.js';
import { getLatestDraw, ApiError } from '../api.js';
import { createHero, startCountdown } from '../components/hero.js';

// Sections below the hero are owned by later tasks (blankiet, rankings, Typer
// teaser). We render their frames now so the page composition is final and
// those tasks only fill the body.
function panel(eyebrow, title, note) {
  return el('section', { class: 'panel' }, [
    el('p', { class: 'eyebrow' }, eyebrow),
    el('h2', { class: 'panel__title' }, title),
    el('p', { class: 'panel__note' }, note),
    el('span', { class: 'panel__soon' }, 'Wkrótce'),
  ]);
}

export function createHomeView() {
  let root = null;
  let stopCountdown = null;
  let controller = null;

  return {
    async mount(container) {
      controller = new AbortController();
      const mine = controller;
      root = el('div', { class: 'view view--home' }, [
        el('p', { class: 'loading' }, 'Wczytuję ostatnie losowanie…'),
      ]);
      container.append(root);

      try {
        const data = await getLatestDraw({ signal: mine.signal });
        // The user may have navigated away while the fetch was in flight;
        // unmount() nulls `root` and aborts, so bail before touching the DOM.
        if (mine.signal.aborted || !root) return;
        clear(root);
        const hero = createHero(data);
        root.append(
          hero,
          panel('Blankiet 7×7', 'Mapa ciepła 49 liczb', 'Każda liczba jako kula na kuponie — jaśniejsza, im częściej pada. Tryby: częstość, świeżość, z-score.'),
          panel('Rankingi', 'Gorące i zimne', 'Najczęściej i najrzadziej losowane liczby, każda z z-score obok — żeby było widać, że rekordzistki mieszczą się w szumie.'),
          panel('Typer', 'Sprawdź swój zestaw', 'Jeden zestaw na następne losowanie z uczciwym uzasadnieniem i historią własnych trafień.')
        );
        stopCountdown = startCountdown(hero);
      } catch (err) {
        if (mine.signal.aborted || !root) return;
        clear(root);
        const message = err instanceof ApiError ? err.message : 'Coś poszło nie tak.';
        root.append(
          el('div', { class: 'error card' }, [
            el('p', { class: 'error__title' }, 'Nie udało się wczytać ostatniego losowania'),
            el('p', { class: 'error__msg' }, message),
            el('button', { class: 'btn', onClick: () => this.reload(container) }, 'Spróbuj ponownie'),
          ])
        );
      }
    },

    reload(container) {
      this.unmount();
      this.mount(container);
    },

    unmount() {
      if (controller) controller.abort();
      controller = null;
      if (stopCountdown) stopCountdown();
      stopCountdown = null;
      if (root) root.remove();
      root = null;
    },
  };
}
