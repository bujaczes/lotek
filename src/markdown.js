import { el } from './dom.js';

// A deliberately tiny renderer for OUR OWN generated markdown subset (SPEC §8.4 commentary):
//   - `#`/`##`/`###` headings         -> <h1>/<h2>/<h3>
//   - contiguous `- ` lines           -> <ul><li>…</li></ul>
//   - blank-line-separated paragraphs -> <p>
//   - inline `**bold**`               -> <strong>
// Everything is built with el()/textContent — NEVER innerHTML. The commentary is our own
// text, but rendering it through text nodes means no substring of it can ever become live
// markup (a stray "<script>" is shown literally), so the discipline holds regardless of
// what reaches the string.

const BOLD_RE = /\*\*([^*]+)\*\*/g;

// Splits a line into text nodes and <strong> spans on `**bold**`. Returns an array of
// (string | HTMLElement) suitable as el() children. Unpaired `**` stays literal.
function inline(text) {
  const nodes = [];
  let last = 0;
  BOLD_RE.lastIndex = 0;
  let m;
  while ((m = BOLD_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(el('strong', {}, m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [''];
}

/**
 * Renders `md` into a DocumentFragment of block elements. Blocks are separated by blank
 * lines; a block is a heading (single `#…` line), an unordered list (every line `- `), or
 * a paragraph (soft-wrapped lines joined with a space). Non-string input renders to an
 * empty fragment.
 */
export function renderMarkdown(md) {
  const frag = document.createDocumentFragment();
  if (typeof md !== 'string') return frag;

  const blocks = md
    .split(/\n{2,}/)
    .map((b) => b.replace(/\s+$/, ''))
    .filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.split('\n');
    const heading = lines.length === 1 && lines[0].match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      frag.append(el(`h${level}`, { class: `md-h md-h--${level}` }, inline(heading[2])));
      continue;
    }
    if (lines.every((l) => l.startsWith('- '))) {
      frag.append(
        el(
          'ul',
          { class: 'md-list' },
          lines.map((l) => el('li', { class: 'md-li' }, inline(l.slice(2))))
        )
      );
      continue;
    }
    frag.append(el('p', { class: 'md-p' }, inline(lines.join(' '))));
  }
  return frag;
}
