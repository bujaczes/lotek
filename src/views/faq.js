import { el } from '../dom.js';

// Static educational FAQ. Plain-language answers in the app's honest voice:
// nothing here may imply any coupon has a better-than-1/13,983,816 chance, and
// every "hot/cold/overdue" idea is explicitly tied back to the gambler's fallacy.
// Data-driven so the list renders (and tests) from one source of truth.
export const FAQ = [
  {
    q: 'Czy Typer zwiększa moją szansę na trafienie szóstki?',
    a: [
      'Nie — i mówimy to wprost. Każdy kupon, ten z Typera i każdy inny, ma dokładnie tę samą szansę na szóstkę: 1 : 13 983 816. Żaden model tego nie zmieni w uczciwej maszynie losującej.',
      'Jedyna przewaga, jaką Typer realnie ma, to wyższa oczekiwana wypłata, GDYBY szóstka padła (patrz EV niżej): wybiera zestawy, których typuje mało ludzi, więc ewentualną pulę dzieliłoby się na mniej osób. Szansa na trafienie jest taka sama — zmienia się tylko to, ile byś dostał w razie wygranej.',
    ],
  },
  {
    q: 'Co oznacza z-score?',
    a: [
      'Z-score mówi, o ile dana wartość odbiega od średniej, mierząc to w „odchyleniach standardowych” — naturalnej jednostce rozrzutu danych. z = 0 to dokładnie średnia, z = +1 to jedno odchylenie powyżej, z = −2 to dwa poniżej.',
      'Dla losowych danych prawie wszystko (ok. 99,7%) mieści się w przedziale od −3 do +3. Dlatego w LOTKU nawet „rekordowa” liczba ma z-score rzędu +2 — to wciąż zwykły szum, a nie znak, że liczba jest „gorąca”. Z-score opisuje przeszłość, nie przepowiada przyszłości.',
    ],
  },
  {
    q: 'Co to jest test χ² i „p-value”?',
    a: [
      'Test χ² („chi-kwadrat”) sprawdza, czy maszyna losująca nie faworyzuje którychś liczb — czyli czy jakaś kula nie wypada częściej, niżby wynikało z czystego przypadku.',
      'p-value to prawdopodobieństwo, że przy w pełni uczciwej maszynie zobaczylibyśmy dane odchylone tak samo albo bardziej. Wysokie p (np. 0,98) znaczy „żadnych śladów nierówności — wszystko jak przy czystym losowaniu”. Dopiero niskie p (poniżej 0,05) byłoby sygnałem, że warto się przyjrzeć maszynie.',
    ],
  },
  {
    q: 'Co znaczy EV (wartość oczekiwana)?',
    a: [
      'EV (z ang. expected value) to przeciętny wynik na dłuższą metę. Tu chodzi o oczekiwaną wypłatę pod warunkiem wygranej: ile średnio dostałbyś za trafienie danym zestawem.',
      'Nagrody I–III stopnia dzieli się między wszystkich, którzy trafili. Gracze typują skrajnie nierówno (daty urodzin, „szczęśliwe” 7, wzory na blankiecie), więc zestaw omijający te schematy dzieliłby pulę z mniejszą liczbą osób — wyższe EV przy tej samej szansie na trafienie.',
    ],
  },
  {
    q: 'Czy „gorące” i „zimne” liczby coś znaczą dla następnego losowania?',
    a: [
      'Nie. Kule nie mają pamięci — każde losowanie jest niezależne od poprzednich. To, że liczba padała ostatnio często („gorąca”) albo rzadko („zimna”), nie zmienia jej szans w kolejnym losowaniu.',
      'Rankingi gorących i zimnych liczb pokazujemy jako ciekawostkę i lekcję o losowości, nie jako prognozę. Wiara, że gorąca liczba „będzie dalej padać” albo zimna „musi nadrobić”, to klasyczne złudzenie gracza (gambler’s fallacy).',
    ],
  },
  {
    q: 'Skoro liczba nie padła od dawna, czy „musi” w końcu paść?',
    a: [
      'Nie. To najczystsza postać złudzenia gracza. Prawdopodobieństwo, że dana liczba padnie, jest takie samo w każdym losowaniu (6 z 49), niezależnie od tego, jak długo jej nie było.',
      'Długość przerw układa się w rozkład geometryczny — bardzo długie przerwy są rzadkie, ale całkowicie normalne. Sekcja „Spóźnialscy” pokazuje to obok krzywej teoretycznej właśnie po to, żeby było widać, że przerwa nie zwiększa szansy.',
    ],
  },
  {
    q: 'Co znaczy „premiera” i „déjà vu” przy losowaniu?',
    a: [
      '„Premiera” to werdykt, że dokładnie ta szóstka liczb nigdy wcześniej nie padła w całej historii od 1957 roku. Przy prawie 14 milionach możliwych kombinacji to niemal zawsze prawda — stąd napis pojawia się przy większości losowań.',
      '„Déjà vu” oznacza, że identyczna szóstka już kiedyś padła — rzadka ciekawostka (paradoks dnia urodzin przewiduje ok. 2 takich kolizji w całej historii). Klikając w werdykt, przejdziesz do tamtego losowania.',
    ],
  },
  {
    q: 'Co to jest pasmo ±2σ na wykresie „Sprawdzam!”?',
    a: [
      'To zakres, w którym powinny się mieścić trafienia Typera, jeśli działa wyłącznie przypadek. Przeciętny kupon trafia 0,7347 z 6 wylosowanych liczb (to po prostu 36/49), a „σ” (sigma) to miara typowego wahania wokół tej wartości.',
      '„±2σ” to dwie sigmy w każdą stronę — czyli szeroki, ale skończony margines normalnej losowości. Dopóki skumulowane trafienia Typera siedzą w tym paśmie, wszystko jest zgodne z teorią: model nie bije losowości w liczbie trafień i nie powinien.',
    ],
  },
  {
    q: 'Skąd pochodzą dane?',
    a: [
      'Kompletną historię losowań (od pierwszego, 27 stycznia 1957) bierzemy z publicznego pliku dl.txt serwisu mbnet, a nowe wyniki dociągamy z API lotto.pl. Wyniki oficjalne obowiązują wyłącznie na lotto.pl.',
      'To projekt hobbystyczny do analizy publicznych danych — nie sprzedajemy gier ani zakładów. Gra dozwolona od 18 lat; hazard może uzależniać, graj odpowiedzialnie.',
    ],
  },
];

export function createFaqView() {
  let root = null;
  return {
    mount(container) {
      const items = FAQ.map((item) =>
        el('article', { class: 'faq-item' }, [
          el('h2', { class: 'faq-item__q' }, item.q),
          ...item.a.map((p) => el('p', { class: 'faq-item__a' }, p)),
        ])
      );
      root = el('section', { class: 'view view--faq' }, [
        el('p', { class: 'eyebrow' }, 'FAQ'),
        el('h1', { class: 'faq__title' }, 'Najczęstsze pytania'),
        el('p', { class: 'faq__lead' },
          'Krótkie, uczciwe wyjaśnienia pojęć, których używa LOTEK. Zasada jest jedna: ' +
            'żaden zestaw nie ma większej szansy na szóstkę niż 1 : 13 983 816 — i nigdzie nie twierdzimy inaczej.'),
        el('div', { class: 'faq-list' }, items),
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
