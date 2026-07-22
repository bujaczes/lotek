// History-API SPA router. `matchRoute` is a pure function (unit-tested);
// `createRouter` wires it to the DOM: link interception + popstate.

export const routes = [
  { name: 'home', pattern: '/' },
  { name: 'stats', pattern: '/statystyki' },
  { name: 'number', pattern: '/liczba/:n' },
  { name: 'draw', pattern: '/losowanie/:nr' },
  { name: 'typer', pattern: '/typer' },
  { name: 'wehikul', pattern: '/wehikul' },
];

function normalizePath(pathname) {
  const path = pathname.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

function matchPattern(pattern, path) {
  const pSeg = pattern.split('/');
  const aSeg = path.split('/');
  if (pSeg.length !== aSeg.length) return null;
  const params = {};
  for (let i = 0; i < pSeg.length; i += 1) {
    if (pSeg[i].startsWith(':')) {
      if (aSeg[i] === '') return null;
      // Malformed percent-encoding (e.g. "%zz") makes decodeURIComponent throw a
      // URIError; treat the segment as a non-match so it falls through to 404
      // instead of crashing the click/popstate handler.
      let decoded;
      try {
        decoded = decodeURIComponent(aSeg[i]);
      } catch {
        return null;
      }
      params[pSeg[i].slice(1)] = decoded;
    } else if (pSeg[i] !== aSeg[i]) {
      return null;
    }
  }
  return params;
}

export function matchRoute(pathname, routeList = routes) {
  const path = normalizePath(pathname);
  for (const route of routeList) {
    const params = matchPattern(route.pattern, path);
    if (params) return { name: route.name, params };
  }
  return { name: 'notfound', params: {} };
}

export function createRouter(onNavigate) {
  function render() {
    onNavigate(matchRoute(window.location.pathname));
  }

  function navigate(href, { replace = false } = {}) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = href;
      return;
    }
    const to = url.pathname + url.search + url.hash;
    if (replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    window.scrollTo(0, 0);
    render();
  }

  // Intercept plain left-clicks on internal links; let modified clicks,
  // new-tab targets and download/external links behave natively.
  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  }

  function start() {
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', render);
    render();
  }

  return { start, navigate };
}
