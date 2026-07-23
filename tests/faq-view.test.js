// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createFaqView, FAQ } from '../src/views/faq.js';
import { buildMeta } from '../src/meta.js';

function mount() {
  const container = document.createElement('main');
  const view = createFaqView();
  view.mount(container);
  return { container, view };
}

describe('createFaqView', () => {
  it('renders one question (h2) per FAQ entry', () => {
    const { container } = mount();
    const questions = container.querySelectorAll('.faq-item__q');
    expect(questions).toHaveLength(FAQ.length);
    expect(questions[0].textContent).toBe(FAQ[0].q);
  });

  it('leads with the "does the Typer improve my odds" question', () => {
    expect(FAQ[0].q.toLowerCase()).toContain('szans');
    const { container } = mount();
    expect(container.querySelector('.faq-item__q').textContent.toLowerCase()).toContain('typer');
  });

  it('renders every answer paragraph', () => {
    const { container } = mount();
    const expectedParas = FAQ.reduce((n, item) => n + item.a.length, 0);
    expect(container.querySelectorAll('.faq-item__a')).toHaveLength(expectedParas);
  });

  it('states the honest odds frame in the lead', () => {
    const { container } = mount();
    expect(container.querySelector('.faq__lead').textContent).toContain('1 : 13 983 816');
  });

  it('never claims any coupon has better winning odds', () => {
    const { container } = mount();
    const text = container.textContent.toLowerCase();
    for (const phrase of ['większa szansa', 'większe szanse', 'większą szansę', 'zwiększa szansę']) {
      expect(text).not.toContain(phrase);
    }
  });

  it('unmount detaches the view', () => {
    const { container, view } = mount();
    view.unmount();
    expect(container.querySelector('.view--faq')).toBeNull();
  });

  it('has a meta entry with an FAQ title', () => {
    expect(buildMeta('faq').title).toBe('LOTEK — FAQ');
  });
});
