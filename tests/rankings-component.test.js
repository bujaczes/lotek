// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRankings } from '../src/components/rankings.js';

const ten = (start) => Array.from({ length: 10 }, (_, i) => ({ number: start + i, count: 100 - i, zScore: (start + i - 25) / 10 }));

// Distinct number ranges per window so a tab switch is detectable.
const DATA = {
  hot: { all: ten(1), last100: ten(11), currentYear: ten(21) },
  cold: { all: ten(40).map((e) => ({ ...e, count: 0 })), last100: ten(30), currentYear: ten(20) },
};

describe('createRankings', () => {
  it('renders hot and cold columns with 10 rows each, linking to careers', () => {
    const node = createRankings(DATA);
    const cols = node.querySelectorAll('.rank-col');
    expect(cols).toHaveLength(2);
    const hotRows = node.querySelectorAll('.rank-col--hot .rank-row');
    const coldRows = node.querySelectorAll('.rank-col--cold .rank-row');
    expect(hotRows).toHaveLength(10);
    expect(coldRows).toHaveLength(10);
    expect(hotRows[0].getAttribute('href')).toBe(`/liczba/${DATA.hot.all[0].number}`);
  });

  it('defaults to the full-history window', () => {
    const node = createRankings(DATA);
    const allTab = node.querySelector('.rank-tab[data-window="all"]');
    expect(allTab.getAttribute('aria-pressed')).toBe('true');
    const firstHot = node.querySelector('.rank-col--hot .miniball').textContent;
    expect(firstHot).toBe(String(DATA.hot.all[0].number)); // 1
  });

  it('switches the window on tab click, re-rendering both columns', () => {
    const node = createRankings(DATA);
    node.querySelector('.rank-tab[data-window="last100"]').click();

    expect(node.querySelector('.rank-tab[data-window="last100"]').getAttribute('aria-pressed')).toBe('true');
    expect(node.querySelector('.rank-tab[data-window="all"]').getAttribute('aria-pressed')).toBe('false');

    const hotNumbers = [...node.querySelectorAll('.rank-col--hot .miniball')].map((b) => b.textContent);
    expect(hotNumbers).toEqual(DATA.hot.last100.map((e) => String(e.number))); // 11..20
    const coldNumbers = [...node.querySelectorAll('.rank-col--cold .miniball')].map((b) => b.textContent);
    expect(coldNumbers).toEqual(DATA.cold.last100.map((e) => String(e.number))); // 30..39
  });

  it('labels the z-score as whole-history in every window (honest)', () => {
    const node = createRankings(DATA);
    const scope = node.querySelector('.rank-row__z-scope');
    expect(scope.textContent).toBe('całość');
  });
});
