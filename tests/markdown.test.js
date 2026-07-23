// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';

function render(md) {
  const host = document.createElement('div');
  host.append(renderMarkdown(md));
  return host;
}

describe('renderMarkdown — our own markdown subset', () => {
  it('renders "### heading" as an <h3>', () => {
    const host = render('### Liczba po liczbie');
    const h3 = host.querySelector('h3');
    expect(h3).not.toBeNull();
    expect(h3.textContent).toBe('Liczba po liczbie');
    expect(h3.classList.contains('md-h--3')).toBe(true);
  });

  it('renders **bold** as a <strong> inside a paragraph', () => {
    const host = render('To jest **ważne** zdanie.');
    const p = host.querySelector('p.md-p');
    expect(p).not.toBeNull();
    const strong = p.querySelector('strong');
    expect(strong.textContent).toBe('ważne');
    expect(p.textContent).toBe('To jest ważne zdanie.');
  });

  it('groups contiguous "- " lines into a single <ul> with one <li> each', () => {
    const host = render('- **5** — a\n- **20** — b\n- **43** — c');
    const uls = host.querySelectorAll('ul.md-list');
    expect(uls).toHaveLength(1);
    const lis = uls[0].querySelectorAll('li');
    expect(lis).toHaveLength(3);
    expect(lis[0].querySelector('strong').textContent).toBe('5');
    expect(lis[0].textContent).toBe('5 — a');
  });

  it('separates blank-line-delimited blocks into distinct elements', () => {
    const host = render('Pierwszy akapit.\n\n### Nagłówek\n\n- jeden\n- dwa\n\nOstatni akapit.');
    expect(host.querySelectorAll('p.md-p')).toHaveLength(2);
    expect(host.querySelectorAll('h3')).toHaveLength(1);
    expect(host.querySelectorAll('ul.md-list li')).toHaveLength(2);
  });

  it('never produces raw HTML — angle-bracket markup in the source stays literal text', () => {
    const host = render('Uwaga <script>alert(1)</script> i <b>pogrubione</b>.');
    // No injected elements: the only child is our own <p>.
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    const p = host.querySelector('p.md-p');
    expect(p.textContent).toContain('<script>alert(1)</script>');
    expect(p.textContent).toContain('<b>pogrubione</b>');
  });

  it('renders bold inside a heading', () => {
    const host = render('### **Typ** na losowanie');
    const h3 = host.querySelector('h3');
    expect(h3.querySelector('strong').textContent).toBe('Typ');
    expect(h3.textContent).toBe('Typ na losowanie');
  });

  it('returns an empty fragment for non-string input', () => {
    const host = render(null);
    expect(host.childNodes).toHaveLength(0);
    const host2 = render(undefined);
    expect(host2.childNodes).toHaveLength(0);
  });

  it('leaves an unpaired ** as literal text', () => {
    const host = render('Cena to 5 ** 2.');
    const p = host.querySelector('p.md-p');
    expect(p.querySelector('strong')).toBeNull();
    expect(p.textContent).toBe('Cena to 5 ** 2.');
  });
});
