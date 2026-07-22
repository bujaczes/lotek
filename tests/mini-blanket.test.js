// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMiniBlanket } from '../src/components/mini-blanket.js';
import { numberToCell } from '../src/blanket-geometry.js';

const cellFor = (node, n) => node.querySelector(`[data-number="${n}"]`);

describe('createMiniBlanket', () => {
  it('lays all 49 fields out on the coupon geometry', () => {
    const { node } = createMiniBlanket();
    expect(node.querySelectorAll('.mini-blanket__cell')).toHaveLength(49);
    for (const n of [1, 7, 8, 43, 49]) {
      const { row, col } = numberToCell(n);
      const cell = cellFor(node, n);
      expect(cell.style.gridRow).toBe(String(row + 1));
      expect(cell.style.gridColumn).toBe(String(col + 1));
    }
  });

  it('marks the highlighted numbers and nothing else', () => {
    const { node } = createMiniBlanket({ selected: [7, 42] });
    expect([...node.querySelectorAll('.is-on')].map((c) => c.dataset.number)).toEqual(['7', '42']);
    expect(node.querySelector('button')).toBeNull();
  });

  it('links every field to its career page when asked', () => {
    const { node } = createMiniBlanket({ linked: true, selected: [7] });
    expect(cellFor(node, 7).getAttribute('href')).toBe('/liczba/7');
  });

  describe('pick mode', () => {
    it('renders real buttons carrying their pressed state', () => {
      const { node } = createMiniBlanket({ mode: 'pick', selected: [3] });
      expect(cellFor(node, 3).tagName).toBe('BUTTON');
      expect(cellFor(node, 3).getAttribute('aria-pressed')).toBe('true');
      expect(cellFor(node, 4).getAttribute('aria-pressed')).toBe('false');
    });

    it('selects and deselects on click, reporting the new set', () => {
      const onChange = vi.fn();
      const picker = createMiniBlanket({ mode: 'pick', onChange });
      cellFor(picker.node, 12).click();
      cellFor(picker.node, 5).click();
      expect(picker.getSelected()).toEqual([5, 12]);
      expect(onChange).toHaveBeenLastCalledWith([5, 12], { toggled: 5 });

      cellFor(picker.node, 12).click();
      expect(picker.getSelected()).toEqual([5]);
      expect(cellFor(picker.node, 12).getAttribute('aria-pressed')).toBe('false');
    });

    it('refuses a seventh pick and says which one bounced', () => {
      const onChange = vi.fn();
      const picker = createMiniBlanket({ mode: 'pick', selected: [1, 2, 3, 4, 5, 6], onChange });
      cellFor(picker.node, 7).click();
      expect(picker.getSelected()).toEqual([1, 2, 3, 4, 5, 6]);
      expect(onChange).toHaveBeenLastCalledWith([1, 2, 3, 4, 5, 6], { rejected: 7 });
      expect(cellFor(picker.node, 7).getAttribute('aria-pressed')).toBe('false');
    });

    it('honours a custom limit', () => {
      const picker = createMiniBlanket({ mode: 'pick', max: 2 });
      cellFor(picker.node, 1).click();
      cellFor(picker.node, 2).click();
      cellFor(picker.node, 3).click();
      expect(picker.getSelected()).toEqual([1, 2]);
    });

    it('repaints from the outside via setSelected and clear', () => {
      const picker = createMiniBlanket({ mode: 'pick' });
      picker.setSelected([9, 11]);
      expect([...picker.node.querySelectorAll('.is-on')].map((c) => c.dataset.number)).toEqual(['9', '11']);
      picker.clear();
      expect(picker.node.querySelectorAll('.is-on')).toHaveLength(0);
      expect(picker.getSelected()).toEqual([]);
    });
  });
});
