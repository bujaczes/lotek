import { maskFromNumbers } from './lib/mask.js';
import { loadPrizes, prizeForHits } from './lib/config.js';

const GAME_TYPE = 'lotto';
const MIN_HIT_TIER = 3;

const DISCLAIMER =
  'To szacunek edukacyjny: zakłada regularną grę tym samym zestawem we wszystkich losowaniach ' +
  'w historii Dużego Lotka i nie stanowi rekomendacji, prognozy ani gwarancji wygranej — każde ' +
  'losowanie jest niezależne, a szansa na szóstkę zawsze wynosi 1 : 13 983 816. Gra hazardowa 18+.';

function parseNumbers(body) {
  const numbers = body && body.numbers;
  if (!Array.isArray(numbers) || numbers.length !== 6) return null;
  if (!numbers.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 49)) return null;
  if (new Set(numbers).size !== 6) return null;
  return numbers;
}

export function wehikulHandler(db) {
  const prizes = loadPrizes();

  return (req, res) => {
    const numbers = parseNumbers(req.body);
    if (!numbers) {
      return res.status(400).json({ error: 'numbers must be an array of exactly 6 unique integers, 1-49' });
    }

    // Hits computed entirely in SQL (bit_count(mask & @userMask), SQLite integers are
    // 64-bit) -- NEVER JS's native `&`, which coerces to 32-bit and would silently
    // truncate any user number >=33 (bit positions 32-48). Same bug class fixed in
    // draws.js's nearestNeighbor in Task 6.
    const userMask = maskFromNumbers(numbers);
    const rows = db
      .prepare(
        `SELECT draw_number, drawn_at, bit_count(mask & @userMask) AS hits
         FROM draw WHERE game_type = @gameType ORDER BY draw_number ASC`
      )
      .all({ userMask, gameType: GAME_TYPE });

    const hits = { 3: 0, 4: 0, 5: 0, 6: 0 };
    const occurrences = [];
    let winnings = 0;

    for (const row of rows) {
      if (row.hits >= MIN_HIT_TIER) {
        hits[row.hits] = (hits[row.hits] || 0) + 1;
        occurrences.push({ drawNumber: row.draw_number, date: row.drawn_at, hits: row.hits });
        winnings += prizeForHits(prizes, row.hits);
      }
    }

    const drawsPlayed = rows.length;
    const cost = prizes.betPrice * drawsPlayed;

    res.json({
      numbers,
      hits,
      occurrences,
      balance: { drawsPlayed, cost, winnings, net: winnings - cost },
      // The stakes travel with the result: the page has to state what the balance
      // assumed, and config/prizes.json is the only source of truth for that.
      prizes: { 3: prizes['3'], 4: prizes['4'], 5: prizes['5'], 6: prizes['6'], betPrice: prizes.betPrice },
      disclaimer: DISCLAIMER,
    });
  };
}
