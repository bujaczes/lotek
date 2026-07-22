import './styles/main.css';
import { el } from './dom.js';
import { createRouter } from './router.js';
import { createHomeView } from './views/home.js';
import { createStatsView } from './views/stats.js';
import { createNumberView } from './views/number.js';
import { createDrawView } from './views/draw.js';
import { createTyperView } from './views/typer.js';
import { createWehikulView } from './views/wehikul.js';
import { createNotFoundView } from './views/notfound.js';

const viewFactories = {
  home: createHomeView,
  stats: createStatsView,
  number: createNumberView,
  draw: createDrawView,
  typer: createTyperView,
  wehikul: createWehikulView,
  notfound: createNotFoundView,
};

const NAV = [
  { href: '/statystyki', label: 'Statystyki', route: 'stats' },
  { href: '/typer', label: 'Typer', route: 'typer' },
  { href: '/wehikul', label: 'Wehikuł', route: 'wehikul' },
];

const TITLES = {
  home: 'Ostatnie losowanie',
  stats: 'Statystyki',
  number: 'Kariera liczby',
  draw: 'Losowanie',
  typer: 'Typer',
  wehikul: 'Wehikuł czasu',
  notfound: 'Nie znaleziono',
};

function buildShell() {
  const navLinks = NAV.map((item) =>
    el('a', { class: 'nav__link', href: item.href, dataset: { route: item.route } }, item.label)
  );

  const header = el('header', { class: 'site-header' }, [
    el('div', { class: 'site-header__inner' }, [
      el('a', { class: 'wordmark', href: '/', 'aria-label': 'LOTEK — strona główna' }, [
        el('span', { class: 'wordmark__dot' }, ''),
        'LOTEK',
      ]),
      el('nav', { class: 'nav', 'aria-label': 'Główna nawigacja' }, navLinks),
    ]),
  ]);

  const viewContainer = el('main', { id: 'view', class: 'site-main', tabindex: '-1' });

  const footer = el('footer', { class: 'site-footer' }, [
    el('div', { class: 'site-footer__inner' }, [
      el('p', { class: 'site-footer__line' }, 'Projekt hobbystyczny do analizy publicznych danych o losowaniach.'),
      el('p', { class: 'site-footer__line site-footer__warn' }, [
        el('span', { class: 'badge-18' }, '18+'),
        'Hazard może uzależniać. Graj odpowiedzialnie.',
      ]),
      el('p', { class: 'site-footer__line site-footer__muted' }, [
        'Wyniki oficjalne wyłącznie na ',
        el('a', { href: 'https://www.lotto.pl', target: '_blank', rel: 'noopener' }, 'lotto.pl'),
        '.',
      ]),
    ]),
  ]);

  const root = el('div', { class: 'shell' }, [header, viewContainer, footer]);

  function setActive(routeName) {
    for (const link of navLinks) {
      const active = link.dataset.route === routeName;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  return { root, viewContainer, setActive };
}

function boot() {
  const app = document.getElementById('app');
  const shell = buildShell();
  app.replaceChildren(shell.root);

  let currentView = null;

  const router = createRouter((match) => {
    if (currentView) currentView.unmount();
    shell.setActive(match.name);
    document.title = `LOTEK — ${TITLES[match.name] || ''}`.trim();
    const factory = viewFactories[match.name] || viewFactories.notfound;
    currentView = factory();
    currentView.mount(shell.viewContainer, match.params);
  });

  router.start();
}

boot();
