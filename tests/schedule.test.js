import { describe, expect, it } from 'vitest';
import { nextDrawDate } from '../src/server/lib/schedule.js';

// Ground truth for every case below was cross-checked independently with Node's own
// Intl (Europe/Warsaw) via a throwaway script — see task-6-report.md — not hand-computed
// offsets, to avoid encoding the same potential mistake into both the test and the code.
describe('nextDrawDate(after) — Tue/Thu/Sat 22:00 Europe/Warsaw, strictly after `after`', () => {
  it('from a Tuesday morning (before 22:00): returns the same day 22:00 Warsaw', () => {
    // 2026-07-21 is a Tuesday; 10:00Z = 12:00 Warsaw (CEST, UTC+2) — well before 22:00 local.
    const after = new Date('2026-07-21T10:00:00Z');
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-07-21T20:00:00.000Z');
  });

  it('from a Tuesday just after 22:00 Warsaw: returns Thursday same week, not the same Tuesday', () => {
    const after = new Date('2026-07-21T20:30:00Z'); // 30 min after the Tue 22:00 Warsaw slot
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-07-23T20:00:00.000Z');
  });

  it('boundary: `after` exactly equal to a draw instant is NOT returned (strictly after)', () => {
    const after = new Date('2026-07-21T20:00:00.000Z'); // exactly the Tue slot
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-07-23T20:00:00.000Z'); // Thursday, not the same instant
  });

  it('from just after Thursday 22:00 Warsaw: returns Saturday same week', () => {
    const after = new Date('2026-07-23T20:15:00Z');
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-07-25T20:00:00.000Z');
  });

  it('Sat -> Tue crossing: from just after Saturday 22:00 Warsaw, returns the following Tuesday (skips Sun/Mon)', () => {
    const after = new Date('2026-07-25T20:30:00Z');
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-07-28T20:00:00.000Z');
  });

  it('midnight crossing: UTC calendar date is still Monday, but Europe/Warsaw local date is already Tuesday', () => {
    // 2026-07-20T23:00Z is Monday in UTC, but Warsaw (CEST, UTC+2) local time is
    // 2026-07-21T01:00 — already Tuesday, well before the 22:00 local slot. A buggy
    // implementation that reads the weekday from the raw UTC date (Monday, not a draw
    // day) instead of resolving the Warsaw local calendar date first would not treat
    // this as "already Tuesday" for the purposes of the same-day/next-day boundary.
    const after = new Date('2026-07-20T23:00:00Z');
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-07-21T20:00:00.000Z');
  });

  it('DST spring-forward (last Sunday of March 2026): Sat 28.03 draw -> next Tue 31.03 draw, offset shifts CET(+1) -> CEST(+2)', () => {
    const after = new Date('2026-03-28T21:05:00Z'); // just after Sat 22:00 Warsaw (CET, 21:00Z)
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-03-31T20:00:00.000Z'); // Tue 22:00 Warsaw is now CEST, 20:00Z
  });

  it('DST spring-forward: the Tuesday/Thursday/Saturday draws immediately before the transition are still CET (+1)', () => {
    expect(nextDrawDate(new Date('2026-03-24T10:00:00Z')).toISOString()).toBe('2026-03-24T21:00:00.000Z');
    expect(nextDrawDate(new Date('2026-03-24T21:30:00Z')).toISOString()).toBe('2026-03-26T21:00:00.000Z');
  });

  it('DST fall-back (last Sunday of October 2026): Sat 24.10 draw -> next Tue 27.10 draw, offset shifts CEST(+2) -> CET(+1)', () => {
    const after = new Date('2026-10-24T20:05:00Z'); // just after Sat 22:00 Warsaw (CEST, 20:00Z)
    const next = nextDrawDate(after);
    expect(next.toISOString()).toBe('2026-10-27T21:00:00.000Z'); // Tue 22:00 Warsaw is now CET, 21:00Z
  });

  it('DST fall-back: the Tuesday/Thursday draws immediately before the transition are still CEST (+2)', () => {
    expect(nextDrawDate(new Date('2026-10-20T10:00:00Z')).toISOString()).toBe('2026-10-20T20:00:00.000Z');
    expect(nextDrawDate(new Date('2026-10-22T10:00:00Z')).toISOString()).toBe('2026-10-22T20:00:00.000Z');
  });

  it('always lands on a Tuesday, Thursday or Saturday (Europe/Warsaw calendar date) regardless of the starting instant', () => {
    const starts = [
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-05-15T13:45:00Z'),
      new Date('2026-12-31T23:59:00Z'),
    ];
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', weekday: 'short' });
    for (const start of starts) {
      const next = nextDrawDate(start);
      expect(next.getTime()).toBeGreaterThan(start.getTime());
      expect(['Tue', 'Thu', 'Sat']).toContain(fmt.format(next));
    }
  });
});
