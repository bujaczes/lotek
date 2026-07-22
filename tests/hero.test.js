// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createHero } from '../src/components/hero.js';

const MOCK = {
  drawNumber: 7380,
  date: '2026-07-18',
  numbers: [5, 6, 12, 38, 41, 43],
  sum: 145,
  verdict: { type: 'premiera' },
  chips: [
    { number: 5, countBefore: 912, lastSeenBefore: { drawNumber: 7376, date: '2026-07-09' } },
    { number: 6, countBefore: 944, lastSeenBefore: { drawNumber: 7359, date: '2026-05-30' } },
    { number: 12, countBefore: 855, lastSeenBefore: { drawNumber: 7353, date: '2026-05-16' } },
    { number: 38, countBefore: 955, lastSeenBefore: { drawNumber: 7379, date: '2026-07-16' } },
    { number: 41, countBefore: 883, lastSeenBefore: { drawNumber: 7368, date: '2026-06-20' } },
    { number: 43, countBefore: 838, lastSeenBefore: { drawNumber: 7378, date: '2026-07-14' } },
  ],
  nearestNeighbor: { drawNumber: 6520, date: '2021-01-19', shared: 4, sharedNumbers: [6, 38, 41, 43] },
  nextDraw: { date: '2026-07-23T20:00:00.000Z', drawNumber: 7381 },
};

describe('createHero', () => {
  it('renders exactly six balls carrying the drawn numbers', () => {
    const el = createHero(MOCK);
    const balls = el.querySelectorAll('.ball');
    expect(balls).toHaveLength(6);
    const rendered = [...balls].map((b) => b.querySelector('.ball__num').textContent.trim());
    expect(rendered).toEqual(['5', '6', '12', '38', '41', '43']);
  });

  it('staggers the roll-in via per-ball animation-delay', () => {
    const el = createHero(MOCK);
    const delays = [...el.querySelectorAll('.ball')].map((b) => b.style.getPropertyValue('--roll-delay'));
    expect(delays).toEqual(['0ms', '100ms', '200ms', '300ms', '400ms', '500ms']);
  });

  it('shows the PREMIERA verdict for a first-ever combination', () => {
    const el = createHero(MOCK);
    const badge = el.querySelector('.verdict');
    expect(badge.classList.contains('verdict--premiera')).toBe(true);
    expect(badge.textContent).toContain('PREMIERA');
  });

  it('links a deja-vu verdict to the prior draw', () => {
    const dejavu = {
      ...MOCK,
      verdict: { type: 'dejavu', priorDrawNumber: 421, priorDate: '1965-03-07' },
    };
    const el = createHero(dejavu);
    const link = el.querySelector('.verdict a');
    expect(el.querySelector('.verdict').textContent).toContain('DÉJÀ VU');
    expect(link.getAttribute('href')).toBe('/losowanie/421');
  });

  it('renders one chip per number linking to its career page', () => {
    const el = createHero(MOCK);
    const chips = el.querySelectorAll('.chip');
    expect(chips).toHaveLength(6);
    expect(chips[0].getAttribute('href')).toBe('/liczba/5');
    expect(chips[3].getAttribute('href')).toBe('/liczba/38');
  });

  it('links the nearest-neighbour card to the historical draw', () => {
    const el = createHero(MOCK);
    const link = el.querySelector('.neighbor a');
    expect(link.getAttribute('href')).toBe('/losowanie/6520');
    expect(el.querySelector('.neighbor').textContent).toContain('4');
  });
});
