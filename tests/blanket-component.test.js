// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createBlanket } from '../src/components/blanket.js';

// 49 mock entries with a monotonic spread so scale endpoints are well-defined.
const ENTRIES = Array.from({ length: 49 }, (_, i) => {
  const number = i + 1;
  return {
    number,
    total: 820 + i * 3, // 820..964, strictly increasing
    last50: 5,
    last100: 10,
    currentGap: i, // 0..48
    zScore: (i - 24) / 10, // -2.4 .. +2.4, crosses 0 at number 25
    lastDrawnAt: '2026-06-13',
  };
});

describe('createBlanket', () => {
  it('renders exactly 49 focusable ball fields, one linking to each number career', () => {
    const node = createBlanket(ENTRIES);
    const fields = node.querySelectorAll('.blanket__field');
    expect(fields).toHaveLength(49);
    for (const f of fields) {
      const n = Number(f.dataset.number);
      expect(f.getAttribute('href')).toBe(`/liczba/${n}`);
      expect(f.getAttribute('tabindex')).toBe('0');
      expect(f.getAttribute('aria-label')).toContain(`Liczba ${n}`);
    }
    // labels carry the numeral 1..49
    const labels = [...node.querySelectorAll('.blanket__label')].map((t) => t.textContent);
    expect(labels).toEqual(ENTRIES.map((e) => String(e.number)));
  });

  it('places balls at the CONVENTIONS 7x7 coordinates (n->cx,cy)', () => {
    const node = createBlanket(ENTRIES);
    const discOf = (n) => node.querySelector(`.blanket__field[data-number="${n}"] .blanket__disc`);
    expect(discOf(1).getAttribute('cx')).toBe('50'); // row0 col0
    expect(discOf(1).getAttribute('cy')).toBe('50');
    expect(discOf(7).getAttribute('cx')).toBe('650'); // row0 col6
    expect(discOf(7).getAttribute('cy')).toBe('50');
    expect(discOf(8).getAttribute('cx')).toBe('50'); // row1 col0
    expect(discOf(8).getAttribute('cy')).toBe('150');
    expect(discOf(49).getAttribute('cx')).toBe('650'); // row6 col6
    expect(discOf(49).getAttribute('cy')).toBe('650');
  });

  it('starts in frequency mode and colors the most frequent number hottest', () => {
    const node = createBlanket(ENTRIES);
    const btns = node.querySelectorAll('.modeswitch__btn');
    expect(btns).toHaveLength(3);
    expect(btns[0].getAttribute('aria-pressed')).toBe('true'); // Częstość
    expect(node.querySelector('.blanket').classList.contains('is-mode-frequency')).toBe(true);

    // number 49 has the max total -> top of heat scale -> hot red
    const disc49 = node.querySelector('.blanket__field[data-number="49"] .blanket__disc');
    expect(disc49.style.fill).toBe('#e4372e');
    const disc1 = node.querySelector('.blanket__field[data-number="1"] .blanket__disc');
    expect(disc1.style.fill).toBe('#fff3c4'); // rarest -> palest
  });

  it('switches modes without rebuilding: recolors in place and updates state', () => {
    const node = createBlanket(ENTRIES);
    const disc1 = node.querySelector('.blanket__field[data-number="1"] .blanket__disc');
    const freqFill = disc1.style.fill;

    const freshnessBtn = node.querySelector('.modeswitch__btn[data-mode="freshness"]');
    freshnessBtn.click();

    expect(freshnessBtn.getAttribute('aria-pressed')).toBe('true');
    expect(node.querySelector('.blanket').classList.contains('is-mode-freshness')).toBe(true);
    // number 1 (gap 0, freshest) becomes hottest under freshness -> different from freq fill
    expect(disc1.style.fill).toBe('#e4372e');
    expect(disc1.style.fill).not.toBe(freqFill);

    // z-score mode: number 25 (z=0.1) near neutral; extremes diverge
    node.querySelector('.modeswitch__btn[data-mode="zscore"]').click();
    expect(node.querySelector('.blanket').classList.contains('is-mode-zscore')).toBe(true);
  });

  it('keeps the tooltip inside the stage for every column (measure-and-correct)', () => {
    const node = createBlanket(ENTRIES);
    document.body.append(node);
    const stage = node.querySelector('.blanket__stage');
    const tip = node.querySelector('.blanket-tip');
    const svg = node.querySelector('.blanket');

    // jsdom has no layout. Mock a 300px stage (0..300) and a 140px tooltip whose
    // rect TRACKS the applied `left` (translate(-50%) centers on it) so the
    // component's measure-and-correct pass is genuinely exercised.
    const STAGE = { left: 0, right: 300, width: 300, top: 100, bottom: 400, height: 300 };
    stage.getBoundingClientRect = () => STAGE;
    const TIPW = 140;
    tip.getBoundingClientRect = () => {
      const center = parseFloat(tip.style.left) || 0; // stage-relative center
      return { left: center - TIPW / 2, right: center + TIPW / 2, width: TIPW, top: 0, bottom: 60, height: 60 };
    };

    const hover = (n, rect) => {
      const field = node.querySelector(`.blanket__field[data-number="${n}"]`);
      field.getBoundingClientRect = () => rect;
      field.dispatchEvent(new Event('pointerover', { bubbles: true }));
      return tip.getBoundingClientRect();
    };
    const within = (tr) => tr.left >= STAGE.left && tr.right <= STAGE.right;
    const caretPx = () => parseFloat(tip.style.getPropertyValue('--caret-x'));

    // column-0 ball at the left edge: raw center 25 would push the box to -45.
    let tr = hover(1, { left: 10, top: 120, width: 30, height: 30 });
    expect(tip.hidden).toBe(false);
    expect(within(tr)).toBe(true); // slid fully inside
    expect(caretPx()).toBeGreaterThanOrEqual(12); // caret stays on the box, toward the ball
    expect(caretPx()).toBeLessThan(TIPW / 2);

    // column-6 ball at the right edge: raw center 285 would overflow the right.
    tr = hover(7, { left: 270, top: 120, width: 30, height: 30 });
    expect(within(tr)).toBe(true);
    expect(caretPx()).toBeGreaterThan(TIPW / 2); // caret leans right, toward the ball

    // a middle ball is untouched: center passes through, caret centered.
    tr = hover(4, { left: 135, top: 120, width: 30, height: 30 });
    expect(within(tr)).toBe(true);
    expect(tip.style.left).toBe('150px');
    expect(tip.style.getPropertyValue('--caret-x')).toBe('50%');

    svg.dispatchEvent(new Event('focusout', { bubbles: true }));
    expect(tip.hidden).toBe(true);
    node.remove();
  });

  it('activates a field with Enter via a bubbling click (router-compatible)', () => {
    const node = createBlanket(ENTRIES);
    document.body.append(node);
    const field = node.querySelector('.blanket__field[data-number="7"]');
    const onClick = vi.fn();
    document.addEventListener('click', onClick);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onClick).toHaveBeenCalled();
    const evt = onClick.mock.calls[0][0];
    expect(evt.target.closest('.blanket__field')).toBe(field);
    document.removeEventListener('click', onClick);
    node.remove();
  });
});
