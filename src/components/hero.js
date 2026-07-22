import { el } from '../dom.js';
import { createBall } from './ball.js';
import { formatInt, formatLongDate, formatShortDate, formatCountdown } from '../format.js';

// Weekday + long date in Warsaw wall-clock time, for the next-draw instant
// (`nextDraw.date` is a UTC timestamp for ~22:00 Europe/Warsaw).
const warsawDate = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function verdictBlock(verdict) {
  if (verdict.type === 'dejavu') {
    return el('div', { class: 'verdict-wrap' }, [
      el('span', { class: 'verdict verdict--dejavu' }, [
        'DÉJÀ VU',
        el('a', { href: `/losowanie/${verdict.priorDrawNumber}` }, `nr ${verdict.priorDrawNumber}`),
      ]),
      el('p', { class: 'verdict-note' }, [
        `Ta szóstka padła już ${formatShortDate(verdict.priorDate)} — identyczna kombinacja.`,
      ]),
    ]);
  }
  return el('div', { class: 'verdict-wrap' }, [
    el('span', { class: 'verdict verdict--premiera' }, 'PREMIERA'),
    el('p', { class: 'verdict-note' }, 'Ta szóstka nigdy wcześniej nie padła.'),
  ]);
}

function chipCard(chip) {
  const seen = chip.lastSeenBefore
    ? `ostatnio ${formatShortDate(chip.lastSeenBefore.date)}`
    : 'pierwszy raz';
  return el('a', { class: 'chip', href: `/liczba/${chip.number}` }, [
    el('span', { class: 'chip__num mono' }, String(chip.number)),
    el('span', { class: 'chip__count' }, [
      el('b', { class: 'mono' }, formatInt(chip.countBefore)),
      ` ${chip.countBefore === 1 ? 'raz' : 'razy'} wcześniej`,
    ]),
    el('span', { class: 'chip__seen' }, seen),
  ]);
}

function neighborCard(nn) {
  return el('div', { class: 'neighbor card' }, [
    el('p', { class: 'eyebrow' }, 'Najbliższy historyczny sąsiad'),
    el('p', { class: 'neighbor__lead' }, [
      el('a', { class: 'mono', href: `/losowanie/${nn.drawNumber}` }, `nr ${nn.drawNumber}`),
      ` — ${formatShortDate(nn.date)}`,
    ]),
    el('p', { class: 'neighbor__shared' }, [
      el('b', { class: 'mono' }, String(nn.shared)),
      ' wspólne liczby: ',
      el('span', { class: 'mono' }, nn.sharedNumbers.join('  ')),
    ]),
  ]);
}

export function createHero(data) {
  const remaining = new Date(data.nextDraw.date).getTime() - Date.now();

  return el('section', { class: 'hero' }, [
    el('header', { class: 'hero__head' }, [
      el('p', { class: 'eyebrow' }, 'Ostatnie losowanie'),
      el('p', { class: 'hero__drawno mono' }, `nr ${data.drawNumber}`),
    ]),

    el(
      'div',
      { class: 'balls', role: 'group', 'aria-label': `Wylosowane liczby: ${data.numbers.join(', ')}` },
      data.numbers.map((n, i) => createBall(n, i))
    ),

    el('div', { class: 'hero__verdict' }, [
      verdictBlock(data.verdict),
      el('p', { class: 'hero__meta' }, [
        el('span', {}, formatLongDate(data.date)),
        el('span', { class: 'dot' }, '·'),
        'suma ',
        el('b', { class: 'mono' }, String(data.sum)),
      ]),
    ]),

    el('div', { class: 'countdown card' }, [
      el('p', { class: 'eyebrow' }, 'Następne losowanie'),
      el(
        'p',
        {
          class: 'countdown__value mono',
          'data-countdown-target': data.nextDraw.date,
          'aria-live': 'off',
        },
        formatCountdown(remaining)
      ),
      el('p', { class: 'countdown__sub' }, [
        el('span', { class: 'mono' }, `nr ${data.nextDraw.drawNumber}`),
        el('span', { class: 'dot' }, '·'),
        warsawDate.format(new Date(data.nextDraw.date)),
      ]),
    ]),

    el('div', { class: 'chips-block' }, [
      el('p', { class: 'eyebrow' }, 'Historia tych liczb'),
      el('div', { class: 'chips' }, data.chips.map(chipCard)),
    ]),

    neighborCard(data.nearestNeighbor),
  ]);
}

// Called by the home view after mount. Ticks every second, updates the value
// text in place, and stops itself once the draw time passes. Returns a cleanup.
export function startCountdown(root) {
  const node = root.querySelector('[data-countdown-target]');
  if (!node) return () => {};
  const target = new Date(node.getAttribute('data-countdown-target')).getTime();
  let timer = null;
  const tick = () => {
    const remaining = target - Date.now();
    node.textContent = formatCountdown(remaining);
    if (remaining <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  tick();
  timer = setInterval(tick, 1000);
  return () => {
    if (timer) clearInterval(timer);
  };
}
