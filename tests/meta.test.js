// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { buildMeta, applyMeta } from '../src/meta.js';

describe('buildMeta — per-route title + description', () => {
  it('prefixes the brand and gives each static route its own title', () => {
    expect(buildMeta('home').title).toBe('LOTEK — Ostatnie losowanie');
    expect(buildMeta('stats').title).toBe('LOTEK — Statystyki');
    expect(buildMeta('typer').title).toBe('LOTEK — Typer');
    expect(buildMeta('wehikul').title).toBe('LOTEK — Wehikuł czasu');
  });

  it('folds the number param into the title and description', () => {
    const m = buildMeta('number', { n: '7' });
    expect(m.title).toBe('LOTEK — Liczba 7 — kariera');
    expect(m.description).toContain('liczby 7');
  });

  it('distinguishes the draw archive from a specific draw', () => {
    expect(buildMeta('draw', {}).title).toBe('LOTEK — Archiwum losowań');
    expect(buildMeta('draw', { nr: '7381' }).title).toBe('LOTEK — Losowanie nr 7381');
  });

  it('every route yields a non-empty description', () => {
    for (const name of ['home', 'stats', 'number', 'draw', 'typer', 'wehikul', 'notfound']) {
      expect(buildMeta(name, { n: '1', nr: '1' }).description.length).toBeGreaterThan(0);
    }
  });

  it('an unknown route falls back to the 404 metadata', () => {
    expect(buildMeta('bogus').title).toBe('LOTEK — Nie znaleziono');
  });
});

describe('applyMeta — writes into <head>', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.title = '';
  });

  it('sets document.title and creates missing description/OG/Twitter tags', () => {
    applyMeta({ title: 'LOTEK — Statystyki', description: 'Opis strony.' }, 'https://example.test/statystyki');

    expect(document.title).toBe('LOTEK — Statystyki');
    expect(document.head.querySelector('meta[name="description"]').content).toBe('Opis strony.');
    expect(document.head.querySelector('meta[property="og:title"]').content).toBe('LOTEK — Statystyki');
    expect(document.head.querySelector('meta[property="og:description"]').content).toBe('Opis strony.');
    expect(document.head.querySelector('meta[property="og:url"]').content).toBe('https://example.test/statystyki');
    expect(document.head.querySelector('meta[name="twitter:title"]').content).toBe('LOTEK — Statystyki');
  });

  it('updates an existing description tag in place instead of duplicating it', () => {
    const existing = document.createElement('meta');
    existing.setAttribute('name', 'description');
    existing.setAttribute('content', 'stary opis');
    document.head.appendChild(existing);

    applyMeta({ title: 'T', description: 'nowy opis' }, 'https://example.test/');

    const all = document.head.querySelectorAll('meta[name="description"]');
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('nowy opis');
  });
});
