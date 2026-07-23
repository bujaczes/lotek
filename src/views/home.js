import { el, clear } from '../dom.js';
import { getLatestDraw, getBlanketStats, getRankingsStats, getTyper, ApiError } from '../api.js';
import { createHero, startCountdown } from '../components/hero.js';
import { createBlanket } from '../components/blanket.js';
import { createRankings } from '../components/rankings.js';
import { createTyperTeaser } from '../components/typer-teaser.js';

function sectionError(message) {
  return el('section', { class: 'section-error card' }, [
    el('p', { class: 'section-error__msg' }, message),
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
        // unmount() nulls `root` and aborts; bail before touching the DOM if the
        // user navigated away while the fetch was in flight.
        if (mine.signal.aborted || !root) return;
        clear(root);

        const hero = createHero(data);
        const blanketSlot = el('div', { class: 'home-slot' }, [el('p', { class: 'loading' }, 'Wczytuję blankiet…')]);
        const rankingsSlot = el('div', { class: 'home-slot' }, [el('p', { class: 'loading' }, 'Wczytuję rankingi…')]);
        // Teaser starts in its honest not-yet-live state and is upgraded to the real pick
        // once /api/typer resolves — its failure only costs the live numbers, never the page.
        const teaserSlot = el('div', { class: 'home-slot' }, [createTyperTeaser()]);
        root.append(hero, blanketSlot, rankingsSlot, teaserSlot);
        stopCountdown = startCountdown(hero);

        // Blankiet + rankings + teaser are non-fatal: each fills its slot independently, so
        // one failing endpoint never blanks the whole page.
        const [blanket, rankings, typer] = await Promise.allSettled([
          getBlanketStats({ signal: mine.signal }),
          getRankingsStats({ signal: mine.signal }),
          getTyper({ signal: mine.signal }),
        ]);
        if (mine.signal.aborted || !root) return;

        clear(blanketSlot);
        blanketSlot.append(
          blanket.status === 'fulfilled'
            ? createBlanket(blanket.value)
            : sectionError('Nie udało się wczytać blankietu.')
        );

        clear(rankingsSlot);
        rankingsSlot.append(
          rankings.status === 'fulfilled'
            ? createRankings(rankings.value)
            : sectionError('Nie udało się wczytać rankingów.')
        );

        if (typer.status === 'fulfilled' && typer.value?.current) {
          clear(teaserSlot);
          teaserSlot.append(createTyperTeaser(typer.value.current));
        }
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
