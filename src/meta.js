// Per-route document metadata (title + description + Open Graph/Twitter). `buildMeta` is a
// pure function (unit-tested); `applyMeta` writes it into <head>. The router calls both on
// every navigation so shared links and browser tabs reflect the actual page, not a static
// index.html default.

const BRAND = 'LOTEK';

const DEFAULT_DESCRIPTION =
  'Obserwatorium Dużego Lotka (6 z 49): ostatnie losowanie, statystyki historyczne i uczciwy, ' +
  'deterministyczny Typer. Projekt hobbystyczny do analizy danych publicznych.';

// Each entry maps a route name to a function of its params -> { title, description }. `title`
// is the page-specific part; buildMeta prefixes the brand. Param routes (number/draw) fold
// the id into both the title and the description.
const ROUTE_META = {
  home: () => ({
    title: 'Ostatnie losowanie',
    description: DEFAULT_DESCRIPTION,
  }),
  stats: () => ({
    title: 'Statystyki',
    description:
      'Rozkłady sum, struktura parzyste/nieparzyste, pary i trójki, dywan 70 lat losowań — ' +
      'każda statystyka obok teoretycznej wartości odniesienia.',
  }),
  number: (p) => ({
    title: `Liczba ${p.n} — kariera`,
    description:
      `Kariera liczby ${p.n} w Dużym Lotku: częstość, z-score w czasie, rozkład przerw, ` +
      'najdłuższa seria i najlepszy rok.',
  }),
  draw: (p) =>
    p.nr
      ? {
          title: `Losowanie nr ${p.nr}`,
          description: `Szczegóły losowania nr ${p.nr}: wylosowane liczby, werdykt premiera/déjà vu i historyczny sąsiad.`,
        }
      : {
          title: 'Archiwum losowań',
          description: 'Pełne archiwum losowań Dużego Lotka od 1957 roku z wyszukiwarką po numerze, roku i liczbach.',
        },
  typer: () => ({
    title: 'Typer',
    description:
      'Deterministyczny typ na następne losowanie z pełnym uzasadnieniem oraz „Sprawdzam!” — ' +
      'samorozliczenie trafień względem oczekiwanych 0,7347 na kupon.',
  }),
  wehikul: () => ({
    title: 'Wehikuł czasu',
    description:
      'Wpisz swój zestaw sześciu liczb i sprawdź, ile razy trafiłby 3/4/5/6 od 1957 roku oraz jaki byłby hipotetyczny bilans.',
  }),
  faq: () => ({
    title: 'FAQ',
    description:
      'Uczciwe, proste wyjaśnienia pojęć LOTKA: z-score, test χ², wartość oczekiwana (EV), pasmo ±2σ i dlaczego żaden zestaw nie ma większej szansy na szóstkę.',
  }),
  notfound: () => ({
    title: 'Nie znaleziono',
    description: DEFAULT_DESCRIPTION,
  }),
};

/** Pure: route name + params -> { title, description }. Unknown route falls back to 404. */
export function buildMeta(routeName, params = {}) {
  const entry = (ROUTE_META[routeName] || ROUTE_META.notfound)(params);
  return { title: `${BRAND} — ${entry.title}`, description: entry.description };
}

function upsertMeta(selector, attr, name, content) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute(attr, name);
    document.head.appendChild(node);
  }
  node.setAttribute('content', content);
}

/** Side-effecting: write title + description + OG/Twitter tags into <head>. */
export function applyMeta({ title, description }, url = window.location.href) {
  document.title = title;
  upsertMeta('meta[name="description"]', 'name', 'description', description);
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', title);
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', description);
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', url);
  upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
  upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
}
