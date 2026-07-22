import { cached } from './lib/cache.js';
import { nextDrawDate } from './lib/schedule.js';
import { numbersFromMask } from './lib/mask.js';

const GAME_TYPE = 'lotto';
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const YEAR_RE = /^\d{4}$/;
const NR_RE = /^\d+$/;

function toDrawView(row) {
  return {
    drawNumber: row.draw_number,
    date: row.drawn_at,
    numbers: [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6],
    sum: row.sum_numbers,
  };
}

/**
 * verdict/chips/nearestNeighbor computed against state strictly BEFORE `cutoffDrawNumber`
 * (draw_number < cutoff) — this is what makes the same function correct for both
 * `/api/draws/latest` (cutoff = the latest draw's own number) and `/api/draws/:nr`
 * (cutoff = nr, so a historical draw's verdict never "sees" draws that came after it).
 */
function buildRetrospectiveFields(db, { targetRow, cutoffDrawNumber }) {
  const numbers = [targetRow.n1, targetRow.n2, targetRow.n3, targetRow.n4, targetRow.n5, targetRow.n6];
  const targetMask = targetRow.mask;

  const priorSameMask = db
    .prepare(
      `SELECT draw_number, drawn_at FROM draw
       WHERE game_type = @gameType AND draw_number < @cutoff AND mask = @mask
       ORDER BY draw_number DESC LIMIT 1`
    )
    .get({ gameType: GAME_TYPE, cutoff: cutoffDrawNumber, mask: targetMask });

  const verdict = priorSameMask
    ? { type: 'dejavu', priorDrawNumber: priorSameMask.draw_number, priorDate: priorSameMask.drawn_at }
    : { type: 'premiera' };

  const countStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM draw
     WHERE game_type = @gameType AND draw_number < @cutoff AND (mask & @bit) = @bit`
  );
  const lastSeenStmt = db.prepare(
    `SELECT draw_number, drawn_at FROM draw
     WHERE game_type = @gameType AND draw_number < @cutoff AND (mask & @bit) = @bit
     ORDER BY draw_number DESC LIMIT 1`
  );
  const chips = numbers.map((number) => {
    const bit = 2 ** (number - 1);
    const params = { gameType: GAME_TYPE, cutoff: cutoffDrawNumber, bit };
    const countBefore = countStmt.get(params).c;
    const last = countBefore > 0 ? lastSeenStmt.get(params) : null;
    return {
      number,
      countBefore,
      lastSeenBefore: last ? { drawNumber: last.draw_number, date: last.drawn_at } : null,
    };
  });

  // The AND itself is computed in SQL (SQLite integers are 64-bit) and selected as
  // `combinedMask`, not recomputed with JS's `&` operator afterwards: JS bitwise
  // operators coerce to 32-bit ints, which would silently mangle any shared numbers
  // >=33 (bit positions 32-48) — the same overflow `mask.js`'s popcount() avoids.
  const neighborRow = db
    .prepare(
      `SELECT draw_number, drawn_at, bit_count(mask & @targetMask) AS shared, (mask & @targetMask) AS combinedMask
       FROM draw
       WHERE game_type = @gameType AND draw_number < @cutoff
       ORDER BY shared DESC, draw_number DESC
       LIMIT 1`
    )
    .get({ gameType: GAME_TYPE, cutoff: cutoffDrawNumber, targetMask });

  const nearestNeighbor = neighborRow
    ? {
        drawNumber: neighborRow.draw_number,
        date: neighborRow.drawn_at,
        shared: neighborRow.shared,
        sharedNumbers: numbersFromMask(neighborRow.combinedMask),
      }
    : null;

  return { verdict, chips, nearestNeighbor };
}

export function latestDrawHandler(db) {
  return (req, res) => {
    const payload = cached('draws:latest', () => {
      const target = db
        .prepare('SELECT * FROM draw WHERE game_type = ? ORDER BY draw_number DESC LIMIT 1')
        .get(GAME_TYPE);
      if (!target) return null;

      const retro = buildRetrospectiveFields(db, { targetRow: target, cutoffDrawNumber: target.draw_number });
      const next = nextDrawDate(new Date());

      return {
        ...toDrawView(target),
        ...retro,
        nextDraw: { date: next.toISOString(), drawNumber: target.draw_number + 1 },
      };
    });

    if (!payload) return res.status(404).json({ error: 'no draws available' });
    res.json(payload);
  };
}

export function drawDetailHandler(db) {
  return (req, res) => {
    const raw = req.params.nr;
    if (!NR_RE.test(raw)) return res.status(400).json({ error: 'invalid draw number' });
    const nr = Number(raw);
    if (nr < 1) return res.status(400).json({ error: 'invalid draw number' });

    const payload = cached(`draws:detail:${nr}`, () => {
      const target = db
        .prepare('SELECT * FROM draw WHERE game_type = ? AND draw_number = ?')
        .get(GAME_TYPE, nr);
      if (!target) return null;

      const retro = buildRetrospectiveFields(db, { targetRow: target, cutoffDrawNumber: nr });

      const prevRow = db
        .prepare(
          `SELECT draw_number, drawn_at FROM draw
           WHERE game_type = ? AND draw_number < ? ORDER BY draw_number DESC LIMIT 1`
        )
        .get(GAME_TYPE, nr);
      const nextRow = db
        .prepare(
          `SELECT draw_number, drawn_at FROM draw
           WHERE game_type = ? AND draw_number > ? ORDER BY draw_number ASC LIMIT 1`
        )
        .get(GAME_TYPE, nr);

      return {
        ...toDrawView(target),
        ...retro,
        prev: prevRow ? { drawNumber: prevRow.draw_number, date: prevRow.drawn_at } : null,
        next: nextRow ? { drawNumber: nextRow.draw_number, date: nextRow.drawn_at } : null,
      };
    });

    if (!payload) return res.status(404).json({ error: 'draw not found' });
    res.json(payload);
  };
}

function parseContains(raw) {
  const tokens = raw.split(',').map((t) => t.trim());
  const numbers = tokens.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 49)) return null;
  // De-duped before mask-building: `2**(n-1)` is summed per number below, so a repeated
  // number (e.g. "1,1") would otherwise double-count its bit and silently produce a mask
  // that means a *different* number, not an error and not "contains 1" — a correctness
  // trap, not just redundant input.
  return [...new Set(numbers)];
}

export function drawsListHandler(db) {
  return (req, res) => {
    const { page: pageRaw, perPage: perPageRaw, year: yearRaw, contains: containsRaw, number: numberRaw } = req.query;

    let page = 1;
    if (pageRaw !== undefined) {
      if (!/^\d+$/.test(pageRaw) || Number(pageRaw) < 1) return res.status(400).json({ error: 'invalid page' });
      page = Number(pageRaw);
    }

    let perPage = DEFAULT_PER_PAGE;
    if (perPageRaw !== undefined) {
      if (!/^\d+$/.test(perPageRaw) || Number(perPageRaw) < 1 || Number(perPageRaw) > MAX_PER_PAGE) {
        return res.status(400).json({ error: 'invalid perPage' });
      }
      perPage = Number(perPageRaw);
    }

    if (yearRaw !== undefined && !YEAR_RE.test(yearRaw)) {
      return res.status(400).json({ error: 'invalid year' });
    }

    let containsMask = null;
    if (containsRaw !== undefined) {
      const numbers = parseContains(containsRaw);
      if (!numbers) return res.status(400).json({ error: 'invalid contains' });
      containsMask = numbers.reduce((mask, n) => mask + 2 ** (n - 1), 0);
    }

    let number = null;
    if (numberRaw !== undefined) {
      if (!NR_RE.test(numberRaw)) return res.status(400).json({ error: 'invalid number' });
      number = Number(numberRaw);
    }

    const cacheKey = `draws:list:${page}:${perPage}:${yearRaw || ''}:${containsRaw || ''}:${numberRaw || ''}`;
    const payload = cached(cacheKey, () => {
      const where = ['game_type = @gameType'];
      const params = { gameType: GAME_TYPE };
      if (yearRaw !== undefined) {
        where.push('drawn_at LIKE @yearPattern');
        params.yearPattern = `${yearRaw}-%`;
      }
      if (number !== null) {
        where.push('draw_number = @number');
        params.number = number;
      }
      if (containsMask !== null) {
        where.push('(mask & @containsMask) = @containsMask');
        params.containsMask = containsMask;
      }
      const whereSql = where.join(' AND ');

      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM draw WHERE ${whereSql}`).get(params);
      const offset = (page - 1) * perPage;
      const rows = db
        .prepare(`SELECT * FROM draw WHERE ${whereSql} ORDER BY draw_number DESC LIMIT @perPage OFFSET @offset`)
        .all({ ...params, perPage, offset });

      return {
        page,
        perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
        draws: rows.map(toDrawView),
      };
    });

    res.json(payload);
  };
}
