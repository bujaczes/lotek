import { el } from '../dom.js';

// Minimal "w budowie" view for routes owned by later tasks. Keeps the shell,
// router and design language exercised end-to-end before those views land.
export function stubView({ eyebrow = 'W budowie', title, buildLead }) {
  let root = null;
  return {
    mount(container, params = {}) {
      root = el('section', { class: 'view view--stub' }, [
        el('p', { class: 'eyebrow' }, eyebrow),
        el('h1', { class: 'stub__title' }, typeof title === 'function' ? title(params) : title),
        el('p', { class: 'stub__lead' }, buildLead(params)),
        el('a', { class: 'link-back', href: '/' }, '← Wróć na stronę główną'),
      ]);
      container.append(root);
    },
    unmount() {
      if (root) root.remove();
      root = null;
    },
  };
}
