# LOTEK — plan implementacji (spec oryginalny)

> Dokument źródłowy dostarczony 21.07.2026. Decyzje stackowe z sekcji 0 i 2 zostały
> zrewidowane za zgodą autora — obowiązująca adaptacja: `docs/PLAN.md`.
> Merytoryka (sekcje 1, 3–6, 8, 10, 11) pozostaje wiążąca.

Aggregator i obserwatorium wyników Dużego Lotka (Lotto, 6 z 49) z automatycznym pobieraniem po każdym losowaniu, wizualizacjami, statystykami i deterministycznym "Typerem" opartym o realne modele statystyczne.

Stan wiedzy na dzień pisania planu (21.07.2026): ostatnie losowanie to **nr 7380 z 18.07.2026: 5, 6, 12, 38, 41, 43** (zweryfikowane w źródle mbnet). Najbliższe losowanie: dziś, wtorek 21.07, ok. 22:00 — czyli nr 7381 będzie pierwszym, które aplikacja może złapać "na żywo".

---

## 0. Decyzje projektowe (TL;DR)

| Obszar | Decyzja |
|---|---|
| Backend | Symfony 7.3 + PHP 8.4 na FrankenPHP (worker mode), wzorzec jak Hankometr/Panoramix |
| Baza | MariaDB 11.4 (jedna baza, ~7,4 tys. losowań to mikroskala — ale trzymamy konwencję stacku) |
| Kolejka/harmonogram | Redis 7 + Symfony Messenger + Symfony Scheduler |
| Mikroserwis statystyczny | Python 3.12 + FastAPI + numpy/scipy ("lotek-brain") — cały Typer i testy statystyczne |
| Frontend | Twig + Tailwind CSS 4 + Stimulus (Symfony UX) + Apache ECharts; custom SVG dla blankietu |
| Ollama | NIE w MVP. Komentarze Typera generujemy deterministycznie z szablonów (spójne z wymogiem "bez losowości"). Ollama jako opcjonalny "felietonista" w backlogu |
| Bootstrap danych | plik `dl.txt` (mbnet) — pełna historia od 27.01.1957 |
| Dane bieżące | oficjalne LOTTO OpenAPI (developers.lotto.pl) + fallback na nieoficjalny endpoint lotto.pl |
| Klucz kombinacji | bitmaska 49-bitowa w `BIGINT UNSIGNED` — O(1) wykrywanie powtórek, `BIT_COUNT(a & b)` = liczba trafień |
| Typer | pełna enumeracja wszystkich 13 983 816 kombinacji + deterministyczny scoring (Bayes bias + anty-popularność). Zero RNG |
| Lotto Plus | schemat gotowy (`game_type`), import w backlogu |

Uwaga porządkowa: w uploads nie było plików Hankometru, więc stack odtwarzam z tego, co o nim ustaliliśmy wcześniej (Symfony/FrankenPHP + FastAPI + Redis + MariaDB). Konwencje Dockera/Doctrine/testów bierzemy z Panoramixa jako architektury referencyjnej.

---

## 1. Cel i uczciwa rama

Aplikacja robi trzy rzeczy: (1) gromadzi kompletną historię losowań i dopisuje nowe automatycznie, (2) opowiada tę historię statystykami i wizualizacjami, (3) generuje jeden zestaw liczb na następne losowanie wraz z pisemnym uzasadnieniem.

Rama intelektualna, którą aplikacja komunikuje wprost (i której trzymamy się w kodzie):

1. **Każde losowanie jest niezależne.** Żaden model nie podniesie P(6/6) powyżej 1/13 983 816 w uczciwej maszynie. Aplikacja nigdy nie twierdzi inaczej.
2. **Są dwie rzeczy, które MOŻNA modelować uczciwie:** (a) czy maszyna/kule wykazują fizyczny bias (test χ², estymacja bayesowska) i jeśli tak — które liczby na tym korzystają; (b) wartość oczekiwaną wygranej *pod warunkiem* trafienia — bo pule II–IV stopnia dzieli się między graczy, a gracze wybierają liczby bardzo niejednorodnie. Kombinacje "niepopularne" mają wielokrotnie wyższe EV|win. To jedyna przewaga potwierdzona w literaturze (Stern & Cover 1989; Clotfelter & Cook 1989; Simon 1999 na danych UK; Ziemba, "Dr Z's 6/49 Lotto Guidebook").
3. **Typer sam się rozlicza.** Moduł "Sprawdzam!" porównuje trafienia Typera z teoretyczną wartością oczekiwaną (0,7347 trafienia na kupon). To zamienia predykcję w trwający eksperyment naukowy zamiast wróżenia.

W stopce: informacja, że to projekt hobbystyczny do analizy danych publicznych, gra 18+, wyniki oficjalne wyłącznie na lotto.pl.

---

## 2. Architektura (oryginalna — zrewidowana, patrz PLAN.md)

```
                ┌─────────────────────────────────────────────┐
                │  FrankenPHP (Symfony 7.3, worker mode)      │
   Twig+ECharts │  ├─ Controllers (strony + /api/* JSON)      │
  ◄────────────►│  ├─ Messenger (Redis transport)             │
                │  ├─ Scheduler (wt/czw/sob 22:05 Europe/Wwa) │
                │  └─ Console commands (import, rebuild, ...)  │
                └───────┬───────────────────┬─────────────────┘
                        │ Doctrine          │ HTTP (internal)
                  ┌─────▼─────┐      ┌──────▼───────────┐
                  │ MariaDB 11 │      │ lotek-brain      │
                  │ draws,     │      │ FastAPI+numpy/   │
                  │ stats,     │      │ scipy: χ², Bayes,│
                  │ predictions│      │ Typer, ewaluacja │
                  └───────────┘      └──────────────────┘
                        ▲
                  ┌─────┴─────┐
                  │  Redis 7  │  (Messenger + cache statystyk)
                  └───────────┘
Źródła zewn.: mbnet dl.txt (bootstrap) · LOTTO OpenAPI (bieżące) · lotto.pl (fallback)
```

Docker Compose: `app` (FrankenPHP), `db` (MariaDB), `redis`, `brain` (uvicorn), `worker` (messenger:consume). Wolumeny i konwencje jak w Panoramiksie.

---

## 3. Źródła danych (zweryfikowane 21.07.2026)

**3.1. Bootstrap historii — `http://www.mbnet.com.pl/dl.txt`.** Legendarny plik płaski, kompletna historia Dużego Lotka od losowania nr 1 (27.01.1957). Format wiersza:

```
7380. 18.07.2026 5,6,12,38,41,43
```

Pułapki potwierdzone w danych, które parser MUSI obsłużyć:

- **Daty się powtarzają** — w latach ~1965–1991 bywały dwa losowania tego samego dnia (np. nr 421 i 422 oba z 07.03.1965). Kluczem unikalności jest wyłącznie numer losowania, nigdy data.
- Występują tygodnie bez losowania (np. brak 21.04.1957). Ciągłość numeracji jest jedyną gwarancją.
- Liczby w wierszu są posortowane rosnąco — walidować: 6 liczb, zakres 1–49, unikalne, rosnące.
- Dostępne siostrzane pliki: `dl_plus.txt` (Lotto Plus) i `dl_razem.txt` — na przyszłość.

Po sparsowaniu commitujemy snapshot jako fixture (`var/fixtures/dl_snapshot.txt.gz`), żeby projekt nie zależał od dostępności mbnet.

**3.2. Bieżące wyniki — LOTTO OpenAPI (developers.lotto.pl).** Oficjalne REST API Totalizatora Sportowego, darmowe, wymaga rejestracji i klucza przekazywanego w nagłówku `secret: {key}`. Kluczowe endpointy: `GET /api/open/v1/lotteries/draw-results/by-date-per-game` (wyniki dla daty i gry), informacje o kumulacji i o następnym losowaniu. Klucz trzymamy w `.env.local`, klient jako `LottoOpenApiClient` na `symfony/http-client` z retry i logowaniem.

**3.3. Fallback** — nieoficjalny endpoint używany przez samą stronę: `https://www.lotto.pl/api/lotteries/draw-results/by-gametype?game=Lotto&index=1&size=10&sort=drawDate&order=DESC`. Bez klucza, ale bez gwarancji stabilności. Implementujemy jako drugi provider za wspólnym interfejsem `DrawResultsProviderInterface`; łańcuch: OpenAPI → lotto.pl → (alert).

**3.4. Rekoncyliacja.** Raz w tygodniu (niedziela rano) job pobiera świeży `dl.txt`, diffuje z bazą i raportuje rozjazdy (powinno być zero — to nasz test integralności danych).

---

## 4. Model danych (oryginalny MariaDB — adaptacja SQLite w PLAN.md)

```sql
-- Główna tabela faktów. ~7 400 wierszy + 3/tydzień.
CREATE TABLE draw (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_type     ENUM('lotto','lotto_plus') NOT NULL DEFAULT 'lotto',
  draw_number   INT UNSIGNED NOT NULL,
  drawn_at      DATE NOT NULL,               -- godzina nieznana dla historii
  n1 TINYINT UNSIGNED NOT NULL, n2 TINYINT UNSIGNED NOT NULL,
  n3 TINYINT UNSIGNED NOT NULL, n4 TINYINT UNSIGNED NOT NULL,
  n5 TINYINT UNSIGNED NOT NULL, n6 TINYINT UNSIGNED NOT NULL,
  mask          BIGINT UNSIGNED NOT NULL,    -- Σ 2^(n-1); 49 bitów
  sum_numbers   SMALLINT UNSIGNED AS (n1+n2+n3+n4+n5+n6) STORED,
  source        ENUM('mbnet','openapi','lottopl','manual') NOT NULL,
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uq_game_draw (game_type, draw_number),
  KEY idx_mask (game_type, mask),
  KEY idx_date (game_type, drawn_at)
);
```

Bitmaska to serce modelu: `mask = 2^(n1-1) | ... | 2^(n6-1)` mieści się w BIGINT (49 bitów). Daje nam:

- powtórka kombinacji: `SELECT ... WHERE mask = :m` — O(1) z indeksem;
- liczba wspólnych liczb dwóch losowań: `BIT_COUNT(a.mask & b.mask)` — jedna funkcja robi całą hypergeometrię "ile trafień";
- "najbliższy historyczny sąsiad" ostatniego losowania: `ORDER BY BIT_COUNT(mask & :m) DESC LIMIT 1`;
- Wehikuł czasu (pkt 6.14): trafienia zestawu użytkownika w całej historii jednym zapytaniem.

Tabele pochodne (materializowane — przy 49/1176 wierszach pełny rebuild po każdym imporcie kosztuje ułamek sekundy, więc zero logiki inkrementalnej):

```sql
CREATE TABLE number_stat (        -- 49 wierszy na game_type
  game_type ENUM('lotto','lotto_plus'),
  number TINYINT UNSIGNED,
  total_count INT, count_last50 INT, count_last100 INT, count_last300 INT,
  decayed_count DOUBLE,           -- z wagą λ^wiek (patrz Typer)
  z_score DOUBLE,                 -- odchylenie od oczekiwanej częstości
  last_drawn_at DATE, last_draw_number INT,
  current_gap INT,                -- ile losowań temu
  max_gap INT, max_gap_ended_at DATE,
  avg_gap DOUBLE,
  longest_streak INT,             -- najdłuższa seria losowań z rzędu
  year_counts JSON,               -- {"1957": 4, ...} do sparkline'ów
  PRIMARY KEY (game_type, number)
);

CREATE TABLE pair_stat (          -- 1176 par; opcjonalnie triple_stat (18 424)
  game_type ENUM('lotto','lotto_plus'),
  a TINYINT UNSIGNED, b TINYINT UNSIGNED,
  cnt INT, expected DOUBLE, lift DOUBLE,   -- lift = cnt/expected
  PRIMARY KEY (game_type, a, b)
);

CREATE TABLE prediction (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  for_draw_number INT UNSIGNED NOT NULL UNIQUE,
  numbers JSON NOT NULL, mask BIGINT UNSIGNED NOT NULL,
  model_version VARCHAR(16) NOT NULL,
  bias_score DOUBLE, popularity_score DOUBLE, total_score DOUBLE,
  alternatives JSON,              -- top-3 zapasowe zestawy z wynikami
  commentary MEDIUMTEXT,          -- markdown, wygenerowany deterministycznie
  created_at DATETIME NOT NULL,
  -- wypełniane po losowaniu:
  result_draw_id INT UNSIGNED NULL,
  hits TINYINT UNSIGNED NULL, prize_tier TINYINT UNSIGNED NULL
);

CREATE TABLE import_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(16), started_at DATETIME, finished_at DATETIME,
  draws_added INT, last_draw_number INT, status ENUM('ok','partial','failed'),
  message TEXT
);
```

---

## 5. Import i harmonogram

**Komendy konsolowe:**

- `lotek:import:history` — pobiera `dl.txt` (lub fixture), parsuje, waliduje ciągłość numeracji, wstawia batchami po 500, na końcu `lotek:stats:rebuild`. Idempotentna (upsert po `(game_type, draw_number)`).
- `lotek:fetch:latest` — pyta providerów o wyniki od `MAX(draw_number)+1`; dopisuje, loguje do `import_log`.
- `lotek:stats:rebuild` — pełna rematerializacja `number_stat` i `pair_stat` + inwalidacja cache.
- `lotek:predict` — woła brain `/predict`, zapisuje `prediction` dla następnego numeru losowania.
- `lotek:evaluate` — po dopisaniu losowania N: znajduje `prediction WHERE for_draw_number = N`, liczy `hits = BIT_COUNT(pred.mask & draw.mask)`, ustala `prize_tier` (3+ trafienia).

**Scheduler (strefa `Europe/Warsaw` — jawnie, przez DST):** losowania odbywają się we wtorki, czwartki i soboty ok. 22:00.

```
22:05 wt/czw/sob → FetchLatestDraw
   └─ sukces → łańcuch: RebuildStats → EvaluatePredictions → GeneratePrediction
   └─ brak nowego losowania → retry co 10 min, max 12 prób (do ~00:05), potem alert w import_log
niedziela 08:00 → ReconcileWithMbnet (diff pełnej historii)
```

Handler `FetchLatestDraw` jest odporny na podwójne uruchomienie (lock + unikalny indeks w bazie).

---

## 6. Silnik statystyk

Wszystkie liczniki materializujemy (pkt 4); endpointy `/api/stats/*` serwują JSON do ECharts z cache (TTL do następnego losowania). Poniżej katalog statystyk — każda z krótkim "dlaczego ciekawa" i, gdzie się da, teoretyczną wartością odniesienia, którą pokazujemy obok empirycznej (to nadaje aplikacji charakter edukacyjny i daje darmowe asercje do testów).

**6.1. Blankiet — mapa ciepła 49 liczb** (wizualizacja centralna, opis w pkt 7). Częstość każdej liczby + tryb "świeżość" (ile losowań temu).

**6.2. Rankingi gorących i zimnych.** Top 10 najczęściej i najrzadziej losowanych: całość historii / ostatnie 100 / bieżący rok. Obok każdej liczby jej z-score: `z = (c − N·6/49) / sqrt(N·6·(1/49)·(48/49))` — użytkownik widzi, że nawet "rekordzistka" mieści się zwykle w ±3σ, czyli w szumie.

**6.3. Spóźnialscy.** Aktualnie najdłużej nieobecne liczby (current_gap) zestawione z historycznymi rekordami absencji (max_gap). Z jawną adnotacją: przerwa nie zwiększa szansy — to gambler's fallacy, i pokazujemy to danymi (rozkład długości przerw vs geometryczny p=6/49).

**6.4. Pary i trójki.** Najczęstsze duety/tercety z liftem względem oczekiwań: P(konkretna para w losowaniu) = 6·5/(49·48) ≈ 0,01276; expected_pair = N·0,01276. Lift ~1,0 wszędzie = kolejna lekcja losowości; wyjątki to smaczki.

**6.5. Suma losowania.** Histogram sum (zakres 21–279, średnia 150) z nałożoną krzywą teoretyczną i markerem ostatniego losowania ("suma 145 — sektor typowy, 62. percentyl").

**6.6. Struktura: parzyste/nieparzyste i niskie(1–24)/wysokie(25–49).** Rozkłady empiryczne vs dwumianowe.

**6.7. Liczby sąsiadujące.** Jak często w losowaniu jest ≥1 para kolejnych liczb: teoria mówi 1 − C(44,6)/C(49,6) = **49,52%** — intuicja ludzi mówi "rzadko". Świetny "myth-buster".

**6.8. Powtórka z poprzedniego losowania.** P(≥1 wspólna liczba z poprzednim losowaniem) = 1 − C(43,6)/C(49,6) = **56,4%**. Pokazujemy empirię obok.

**6.9. Powtórzone szóstki w historii.** Czy jakakolwiek pełna kombinacja padła dwa razy? Paradoks dnia urodzin przewiduje przy ~7 400 losowaniach ok. C(7400,2)/13 983 816 ≈ **1,96 kolizji** — sprawdzamy jednym zapytaniem po masce i pokazujemy wynik z wyjaśnieniem.

**6.10. Panel ostatniego losowania (hero).** Stale widoczny: 6 kul, data, nr losowania, kumulacja i licznik do następnego losowania. Werdykt: **"PREMIERA — ta szóstka nigdy wcześniej nie padła"** (los ~99,95% wszystkich możliwych) albo **"DÉJÀ VU — identyczna padła w losowaniu nr X z DD.MM.RRRR"**. Pod spodem chip dla każdej z 6 liczb: ile razy padła w historii (bez wliczania bieżącego losowania) i kiedy ostatnio przedtem. Do tego "najbliższy sąsiad": historyczne losowanie z największą liczbą wspólnych liczb (`BIT_COUNT`).

**6.11. Kariera liczby** — podstrona `/liczba/{1..49}`: licznik, sparkline częstości rocznej, rozkład przerw, najdłuższa seria z rzędu, najlepszy rok, pozycja na blankiecie, z-score w czasie.

**6.12. Dywan losowań.** Scatter: oś X = czas (7,4 tys. losowań), oś Y = liczby 1–49, punkt = wylosowana kula. Z daleka widać... jednorodny szum. Podpis: "70 lat, zero wzoru — i o to chodzi". Wizualnie mocne i intelektualnie uczciwe.

**6.13. Rekordy i ciekawostki.** Najwyższa/najniższa suma w historii, losowanie z najdłuższym ciągiem kolejnych liczb, najdłuższa seria losowań bez liczby z pierwszej dziesiątki itp. Generator "ciekawostki dnia" po każdym losowaniu (deterministyczne reguły, np. próg percentyla sumy, seria liczby, rocznica).

**6.14. Wehikuł czasu.** Użytkownik wpisuje swój ulubiony zestaw 6 liczb → aplikacja liczy w jednym zapytaniu: ile razy miałby 3/4/5/6 trafień od 1957, kiedy, oraz hipotetyczny bilans (koszt 3,00 zł/zakład × liczba losowań vs szacunkowe wygrane wg konfigurowalnych stawek; wygrana za 6 = kumulacja min. 2 mln). Etykieta "szacunek edukacyjny". To będzie najbardziej wiralowa funkcja aplikacji.

**6.15. Urodzinowość.** Procent liczb ≤31 w ostatnim losowaniu + wyjaśnienie, czemu to wpływa na dzielenie nagród (most do sekcji Typera).

---

## 7. Frontend i design

Kierunek: jasny, świetlisty, zbudowany ze świata przedmiotu — kul i blankietu — a nie z szablonu dashboardu. Bez dark mode.

**Tokeny:**

- Kolory: tło `#FCFCFA` (świeży, chłodny biały — celowo nie kremowy), tekst/atrament `#191A2E`, akcent główny `#FFC400` (żółć kuli Lotto), akcent gorący `#E4372E` (tylko dla ekstremów heatmapy i "hot"), sukces `#0E9F6E` (werdykt "premiera"), linie/ramki `#E7E5DE`. Skala heatmapy: od `#FFF3C4` przez `#FFC400` do `#E4372E`.
- Typografia: display **Bricolage Grotesque** (nagłówki i wielkie liczby — ma charakter, nie jest domyślnym wyborem), tekst **Instrument Sans**, dane tabelaryczne i numery losowań **JetBrains Mono** (tabular-nums).
- Element podpisowy (signature): **Blankiet 7×7** — heatmapa ułożona dokładnie jak pola na prawdziwym kuponie Lotto. Każde pole to kula (radialny gradient bieli + kolor wypełnienia wg częstości), w rogu mikro-kropka koloru świeżości. Hover: tooltip (ile razy, kiedy ostatnio, current gap); klik: przejście do kariery liczby. Przełącznik trybu: Częstość / Świeżość / Z-score. To jedna rzecz, którą ta aplikacja będzie zapamiętana — reszta layoutu zdyscyplinowana i cicha.
- Motion: jedna orkiestrowana scena — kule ostatniego losowania "wtaczają się" kolejno przy wejściu na stronę (CSS, ~600 ms, `prefers-reduced-motion` respektowane). Poza tym tylko mikrohovery.

**Strony:** `/` (hero ostatniego losowania + werdykt + countdown → blankiet → rankingi → zajawka Typera), `/statystyki` (pkt 6.4–6.9, 6.12–6.13), `/liczba/{n}`, `/losowanie/{nr}` (+ archiwum z wyszukiwarką), `/typer` (aktualna predykcja + pełne uzasadnienie + historia "Sprawdzam!"), `/wehikul`.

Wykresy: ECharts (histogramy, scatter "dywan", sparkline'y); blankiet jako custom SVG (pełna kontrola nad kulą). Copy po polsku, konkretne i czynne ("Sprawdź swój zestaw", nie "Symulacja historyczna").

---

## 8. Typer — model predykcyjny (rdzeń intelektualny)

### 8.1. Czego świadomie NIE robimy i dlaczego

- **"Liczby na wykresie gęstości / hot numbers jako prognoza"** — częstość historyczna nie przenosi się na przyszłość w uczciwej maszynie; to opis, nie predykcja.
- **"Spóźnione liczby muszą nadrobić"** — gambler's fallacy; prawo wielkich liczb działa przez rozcieńczenie, nie przez korektę.
- **LSTM/Markov/ML na sekwencji wyników** — uczenie się szumu; każdy backtest "działa" do momentu, aż przestaje. Brak mechanizmu przyczynowego = brak modelu.

### 8.2. Co robimy: model dwuskładnikowy z literatury

**Składnik A — detekcja biasu fizycznego (Dirichlet-multinomial z wygaszaniem).** Jeśli którakolwiek kula/maszyna jest fizycznie nieidealna, objawi się to trwałym odchyleniem częstości. Problem: sprzęt i zestawy kul wymieniano przez 70 lat, więc stary sygnał jest bezwartościowy. Rozwiązanie — licznik wykładniczo wygaszany:

```
c̃_i = Σ_k  λ^(age_k) · 1[liczba i padła w losowaniu k],   λ = 0.5^(1/300)
```

(półtrwanie 300 losowań ≈ 2 lata; parametr w configu). Estymata bayesowska z silnym priorem uczciwości: posterior Dirichleta `p_i = (c̃_i + α) / (Ñ·6 + 49α)` z α dobranym tak, by prior ważył tyle co ~5 lat danych — model z założenia jest sceptyczny i tylko mocny, świeży sygnał odchyli go od 1/49. Score: `bias_i = z̃_i` (standaryzowane odchylenie na wygaszonych licznikach). Do tego globalny test Pearsona χ² (df=48) na oknie wygaszonym: jeśli p-value > 0.05 (a tak będzie niemal zawsze), aplikacja uczciwie pisze "brak dowodów na bias — składnik A jest dziś praktycznie neutralny" i waga składnika A w praktyce ~znika. Ale infrastruktura czuwa: gdyby TS kiedyś wprowadził wadliwy zestaw kul, Lotek to wykryje pierwszy.

**Składnik B — anty-popularność (maksymalizacja EV | wygrana).** Jedyna dźwignia z dowodami. Pule dzielone są między trafiających, a gracze wybierają skrajnie niejednorodnie: daty urodzin (1–31, podwójnie 1–12), "szczęśliwe" 7/3/13, wzory geometryczne na blankiecie (linie, przekątne, rogi), ciągi arytmetyczne (1-2-3-4-5-6 gra co tydzień tłum ludzi), poprzednie wyniki. Badania Sterna i Covera na kanadyjskim 6/49 oraz Simona na loterii brytyjskiej pokazały kilkukrotne różnice obłożenia kombinacji — czyli kilkukrotne różnice EV|win przy identycznym P(win). Budujemy deterministyczny model popularności kuponu:

```
popularity(S) = Σ_i w(n_i)  +  Π kary_wzorcowe(S)

w(n): baza 1.0
  +0.35 gdy n ≤ 31 (urodziny)   +0.25 dodatkowo gdy n ≤ 12 (dzień i miesiąc)
  piki mnożnikowe dla {7, 3, 13, 9, 11, 17} (lucky numbers)
  dyskonto dla 40–49 (najrzadziej grywane)

kary wzorcowe (mnożniki > 1 = popularne = złe):
  ciąg ≥3 kolejnych liczb · linia/kolumna/przekątna na blankiecie 7×7
  wszystkie 6 ≤ 31 · suma < 120 (masa kuponów urodzinowych)
  identyczność z dowolną historyczną wygraną szóstką (ludzie je odgrywają)
  ⚠ pułapka 2. rzędu: wszystkie 6 ≥ 32 — klaster "sprytnych" grających anty-urodzinowo;
    też karzemy. Cel: profil mieszany z przewagą wysokich, bez wzoru, suma ~160–200
```

Wagi w configu, skalibrowane na wartościach z literatury (nie mamy danych sprzedażowych TS — model jest heurystyczny, ale kierunkowo pewny i tak go opisujemy w komentarzu).

### 8.3. Optymalizacja: pełna enumeracja, zero losowości

```
score(S) = w_A · Σ bias_i(S)  −  w_B · popularity(S)
```

Przestrzeń ma tylko 13 983 816 kombinacji — scoring wektorowy wszystkich trwa sekundy (część separowalna per liczba + kary wzorcowe na masce). Uruchamiane 3×/tydzień, więc koszt pomijalny, a wynik jest **globalnym optimum i jest w pełni deterministyczny**: te same dane wejściowe → ten sam zestaw. Remisy rozstrzyga porządek leksykograficzny. Zwracamy zwycięzcę + 3 kolejne miejsca jako "zestawy zapasowe". Silnik zwraca `{numbers, alternatives, bias_report, popularity_report, chi2}`; aplikacja zapisuje `prediction` i renderuje komentarz.

### 8.4. Komentarz "dlaczego te liczby" — generowany deterministycznie

Szablon składany z faktów, przykład docelowego tonu:

> **Typ na losowanie nr 7381 (wt, 21.07.2026): 4, 27, 33, 38, 44, 47**
> Zacznijmy uczciwie: szansa tego kuponu na szóstkę to 1 : 13 983 816 — identyczna jak każdego innego. Ten zestaw nie jest "bardziej prawdopodobny"; jest **lepiej opłacalny, jeśli wygra**. Test χ² na ostatnich ~300 losowaniach nie wykrywa biasu maszyny (p = 0,41), więc o wyborze zdecydował model popularności: kupon omija strefę urodzinową (tylko jedna liczba ≤ 31), nie układa się w żadną linię na blankiecie, nie zawiera ciągu i ma sumę 193 — daleko od masy kuponów grających datami. Według modelu dzieliłby ewentualną pulę z kilkukrotnie mniejszą liczbą graczy niż typowy zestaw. Ciekawostka: 44 nie padła od 21 losowań — ale to bez znaczenia dla szans i mówimy to wprost.

Sekcja per liczba (częstość, ostatnio, z-score) + sekcja "czego uniknęliśmy" (np. "odrzucono 1-2-3-4-5-6: najpopularniejszy kupon w Polsce").

### 8.5. "Sprawdzam!" — samorozliczenie

Po każdym losowaniu ewaluacja dopisuje trafienia. Strona Typera pokazuje: historię typów z trafieniami, **skumulowane trafienia vs oczekiwane 0,7347/kupon** (wykres z pasmem ±2σ), rozkład 0/1/2/3+ trafień vs hypergeometryczny, hipotetyczny bilans (3 zł/kupon vs wygrane). Z góry piszemy hipotezę zerową: model NIE pobije losowości w trafieniach (i nie powinien — jego przewaga siedzi w EV|win, którego nie zmierzymy bez wygranej). To jest uczciwe i to jest fajne.

---

## 9. Fazy wdrożenia (oryginalne — mapowanie na zadania w PLAN.md)

**Faza 0 — Szkielet.** Infrastruktura, baza, layout bazowy, CI. DoD: całość się stawia, testy przechodzą.

**Faza 1 — Dane historyczne.** Parser `dl.txt` (z obsługą duplikatów dat i dziur w tygodniach), import, fixture-snapshot, walidacje, `import_log`. DoD: baza zawiera komplet do nr 7380+, `COUNT(*) = MAX(draw_number)`, testy parsera na spreparowanych fixture'ach.

**Faza 2 — Silnik statystyk.** Rebuild, materializacja `number_stat`/`pair_stat`, serwisy + endpointy `/api/stats/*`, cache. DoD: testy asercyjne na stałych teoretycznych (sąsiadujące ≈ 49,5% ±2 p.p. na pełnej historii, powtórka z poprzedniego ≈ 56,4% ±2 p.p., suma średnia ≈ 150 ±2).

**Faza 3 — Frontend rdzeń.** Hero ostatniego losowania z werdyktem i countdownem, Blankiet SVG (3 tryby), rankingi, strony liczby i losowania, dywan losowań, Wehikuł czasu. DoD: Lighthouse ≥ 90, działa na mobile, reduced-motion OK.

**Faza 4 — Automat.** Klient OpenAPI + fallback lotto.pl, fetch-latest, Scheduler wt/czw/sob 22:05 z retry, łańcuch rebuild→evaluate→predict, rekoncyliacja niedzielna. DoD: symulowany "nowy wynik" przechodzi cały łańcuch; idempotencja potwierdzona testem podwójnego wywołania.

**Faza 5 — Typer.** Wygaszone liczniki, Dirichlet, χ², model popularności, pełna enumeracja, strona `/typer`, generator komentarza. DoD: test determinizmu (2× ten sam input → bit-identyczny output), test wykrywalności (syntetyczne dane z zaszytym biasem 1,3× na liczbie 17 → model ją promuje, χ² odrzuca H0), czas < 120 s.

**Faza 6 — Sprawdzam + polish.** Ewaluacja, wykres vs oczekiwana, ciekawostki dnia, SEO-meta, stopka 18+, README. Backlog: Lotto Plus, powiadomienia (ntfy/HA webhook do Home Assistanta), Ollama-felietonista, triple_stat.

## 10. Testy — kotwice matematyczne

Testy aplikacji: parser (duplikaty dat, dziury, złe wiersze), maska (tam-i-z-powrotem, popcount vs naiwne przecięcie), stats vs stałe: C(49,6) = 13 983 816; P(3 trafienia) = 246 820/13 983 816 ≈ 1/56,7; P(4) ≈ 1/1 032; P(5) ≈ 1/54 201; E[trafienia] = 36/49. Typer: determinizm, wykrywalność biasu, zgodność χ² z wartościami referencyjnymi scipy, popularity — 1-2-3-4-5-6 musi mieć score popularności w top 0,01% wszystkich kombinacji.

## 11. Ryzyka

Dostępność mbnet → fixture-snapshot w repo. Klucz OpenAPI (rejestracja, limity) → fallback lotto.pl + alerty. Zmiana harmonogramu losowań przez TS → dni/godziny w configu, watchdog "brak losowania 24 h po terminie". DST → jawna strefa w Schedulerze. Godzina publikacji wyniku bywa >22:05 → dlatego retry do północy. Prawnie: agregujemy publiczne wyniki na własny użytek, nie sprzedajemy gier — stopka z odesłaniem do lotto.pl.
