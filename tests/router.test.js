import { describe, expect, it } from 'vitest';
import { matchRoute } from '../src/router.js';

describe('matchRoute', () => {
  it('matches the home route', () => {
    expect(matchRoute('/')).toEqual({ name: 'home', params: {} });
  });

  it('ignores a trailing slash on non-root paths', () => {
    expect(matchRoute('/statystyki/')).toEqual({ name: 'stats', params: {} });
  });

  it('matches a static route', () => {
    expect(matchRoute('/statystyki')).toEqual({ name: 'stats', params: {} });
    expect(matchRoute('/typer')).toEqual({ name: 'typer', params: {} });
    expect(matchRoute('/wehikul')).toEqual({ name: 'wehikul', params: {} });
  });

  it('captures the :n param for a number career', () => {
    expect(matchRoute('/liczba/7')).toEqual({ name: 'number', params: { n: '7' } });
    expect(matchRoute('/liczba/49')).toEqual({ name: 'number', params: { n: '49' } });
  });

  it('captures the :nr param for a draw', () => {
    expect(matchRoute('/losowanie/7380')).toEqual({ name: 'draw', params: { nr: '7380' } });
  });

  it('matches the bare archive route (no draw number)', () => {
    expect(matchRoute('/losowanie')).toEqual({ name: 'draw', params: {} });
    expect(matchRoute('/losowanie/')).toEqual({ name: 'draw', params: {} });
  });

  it('strips query string and hash before matching', () => {
    expect(matchRoute('/liczba/12?foo=bar#top')).toEqual({ name: 'number', params: { n: '12' } });
  });

  it('does not match a param route with an extra trailing segment', () => {
    expect(matchRoute('/liczba/7/extra')).toEqual({ name: 'notfound', params: {} });
  });

  it('returns notfound for an unknown path', () => {
    expect(matchRoute('/nope')).toEqual({ name: 'notfound', params: {} });
  });

  it('treats a malformed percent-encoded param as notfound instead of throwing', () => {
    // decodeURIComponent('%zz') throws URIError; must not escape matchRoute.
    expect(() => matchRoute('/liczba/%zz')).not.toThrow();
    expect(matchRoute('/liczba/%zz')).toEqual({ name: 'notfound', params: {} });
  });
});
