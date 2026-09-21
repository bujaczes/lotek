// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPrizesCard } from '../src/components/prizes.js';
import { createHero } from '../src/components/hero.js';
import { createDrawDetail } from '../src/components/draw-detail.js';

const OK = {
  status: 'ok',
  tiers: [
    { hits: 6, winners: 1, amount: 44794855 },
    { hits: 5, winners: 107, amount: 8874 },
    { hits: 4, winners: 6221, amount: 200.7 },
    { hits: 3, winners: 110146, amount: 35 },
  ],
};

describe('createPrizesCard', () => {
  it('renders one row per tier: hits, winners, amount of one win', () => {
    const rows = [...createPrizesCard(OK).querySelectorAll('.prizes__row')];
    expect(rows).toHaveLength(4);

    const cells = (row) => [...row.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
    expect(cells(rows[0])).toEqual(['6 trafień', '1 wygrana', '44 794 855,00 zł']);
    expect(cells(rows[1])).toEqual(['5 trafień', '107 wygranych', '8874,00 zł']);
    expect(cells(rows[2])).toEqual(['4 trafienia', '6221 wygranych', '200,70 zł']);
    expect(cells(rows[3])).toEqual(['3 trafienia', '110 146 wygranych', '35,00 zł']);
  });

  it('a six nobody hit reads "brak — kumulacja"', () => {
    const jackpot = { ...OK, tiers: [{ hits: 6, winners: 0, amount: 0 }, ...OK.tiers.slice(1)] };
    const first = createPrizesCard(jackpot).querySelector('.prizes__row');
    expect(first.querySelector('.prizes__winners').textContent).toBe('brak');
    expect(first.querySelector('.prizes__amount').textContent).toBe('kumulacja');
  });

  it('pending: says the prizes will appear once announced', () => {
    const card = createPrizesCard({ status: 'pending' });
    expect(card.classList.contains('prizes--pending')).toBe(true);
    expect(card.querySelector('.prizes__note').textContent).toBe('Wygrane pojawią się, gdy Totalizator je ogłosi.');
  });

  it('unavailable: explains the data starts on 25.08.2011', () => {
    const card = createPrizesCard({ status: 'unavailable' });
    expect(card.querySelector('.prizes__note').textContent).toBe('Totalizator udostępnia wygrane od 25.08.2011.');
  });

  it('no prizes field at all: nothing is rendered', () => {
    expect(createPrizesCard(undefined)).toBeNull();
  });
});

describe('placement', () => {
  const DRAW = {
    drawNumber: 7407,
    date: '2026-09-19',
    numbers: [3, 6, 9, 22, 40, 48],
    sum: 128,
    verdict: { type: 'premiera' },
    chips: [],
    // hero.js has no null branch for the neighbour card (the latest draw always has one)
    nearestNeighbor: { drawNumber: 6520, date: '2021-01-19', shared: 4, sharedNumbers: [6, 38, 41, 43] },
    prizes: OK,
  };

  it('hero: right after the verdict, before the countdown', () => {
    const hero = createHero({ ...DRAW, nextDraw: { date: '2026-09-22T20:00:00.000Z', drawNumber: 7408 } });
    const card = hero.querySelector('.prizes');
    expect(card).not.toBeNull();
    expect(card.previousElementSibling.classList.contains('hero__verdict')).toBe(true);
    expect(card.nextElementSibling.classList.contains('countdown')).toBe(true);
  });

  it('draw detail: right after the verdict, before the sum block', () => {
    const detail = createDrawDetail({ ...DRAW, prev: null, next: null });
    const card = detail.querySelector('.prizes');
    expect(card.previousElementSibling.classList.contains('draw-detail__verdict')).toBe(true);
    expect(card.nextElementSibling.classList.contains('draw-sum')).toBe(true);
  });
});
