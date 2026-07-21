# LOTEK — plan wykonawczy (adaptacja Node)

## Kontekst

Spec merytoryczny: `docs/SPEC.md`. Konwencje wiążące: `docs/CONVENTIONS.md`.

Oryginalny plan zakładał Symfony/FrankenPHP + MariaDB + Redis + FastAPI "na wzór Hankometru/Panoramixa" — inspekcja obu projektów wykazała, że realny wzorzec domowy to Node 20+ + Express 5 + better-sqlite3 (WAL) + Vite + Vitest w jednym kontenerze (konwencje Paczkozy). Autor zatwierdził 21.07.2026 pivot na ten stack; silnik Typera w JS w procesie aplikacji (worker_thread), harmonogram in-process (croner), cache statystyk in-memory z inwalidacją po imporcie (bez Redisa).

Mapowanie faz na zadania (faza = branch, merge do master po review):

- Faza 0 `faza-0-szkielet`: Task 1–2
- Faza 1 `faza-1-dane`: Task 3–4
- Faza 2 `faza-2-statystyki`: Task 5–7
- Faza 3 `faza-3-frontend`: Task 8–11
- Faza 4 `faza-4-automat`: Task 12–13
- Faza 5 `faza-5-typer`: Task 14–16
- Faza 6 `faza-6-sprawdzam`: Task 17–18

Remote: `git@github.com:bujaczes/lotek.git`, branch główny `master`, push po zamknięciu fazy.

---

## Task 1: (Faza 0) Szkielet aplikacji — Express + SQLite + Vite + testy

**Cel:** działający szkielet: `npm run dev` stawia API (3005) i front (5177), `npm test` zielony.

Zakres:

- `package.json`: name `lotek`, `"type": "module"`, engines `>=22`. Deps: `express` (v5), `better-sqlite3` (najnowszy). DevDeps: `vite`, `vitest`, `supertest`, `concurrently`. Skrypty: `dev` (concurrently: vite + `node --watch server.js`), `build` (vite build), `start` (node server.js), `test` (vitest run), `test:watch`.
- `db/schema.sql` — idempotentny (IF NOT EXISTS), SQLite:
  - `draw`: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `game_type TEXT NOT NULL DEFAULT 'lotto' CHECK (game_type IN ('lotto','lotto_plus'))`, `draw_number INTEGER NOT NULL`, `drawn_at TEXT NOT NULL` (ISO data), `n1..n6 INTEGER NOT NULL` (każde `CHECK BETWEEN 1 AND 49`), `mask INTEGER NOT NULL`, `sum_numbers INTEGER GENERATED ALWAYS AS (n1+n2+n3+n4+n5+n6) STORED`, `source TEXT NOT NULL CHECK (source IN ('mbnet','openapi','lottopl','manual'))`, `created_at INTEGER NOT NULL`, `CHECK (n1<n2 AND n2<n3 AND n3<n4 AND n4<n5 AND n5<n6)`, `UNIQUE (game_type, draw_number)`; indeksy `(game_type, mask)` i `(game_type, drawn_at)`.
  - `number_stat`: PK `(game_type, number)`; kolumny: `total_count, count_last50, count_last100, count_last300 INTEGER`, `decayed_count REAL`, `z_score REAL`, `last_drawn_at TEXT`, `last_draw_number INTEGER`, `current_gap INTEGER`, `max_gap INTEGER`, `max_gap_ended_at TEXT`, `avg_gap REAL`, `longest_streak INTEGER`, `year_counts TEXT` (JSON).
  - `pair_stat`: PK `(game_type, a, b)`; `cnt INTEGER, expected REAL, lift REAL`.
  - `prediction`: `id INTEGER PK AUTOINCREMENT`, `for_draw_number INTEGER NOT NULL UNIQUE`, `numbers TEXT NOT NULL` (JSON), `mask INTEGER NOT NULL`, `model_version TEXT NOT NULL`, `bias_score REAL`, `popularity_score REAL`, `total_score REAL`, `alternatives TEXT` (JSON), `commentary TEXT`, `created_at INTEGER NOT NULL`, `result_draw_id INTEGER NULL REFERENCES draw(id)`, `hits INTEGER NULL`, `prize_tier INTEGER NULL`.
  - `import_log`: `id INTEGER PK AUTOINCREMENT`, `source TEXT`, `started_at INTEGER`, `finished_at INTEGER`, `draws_added INTEGER`, `last_draw_number INTEGER`, `status TEXT CHECK (status IN ('ok','partial','failed'))`, `message TEXT`.
- `db/index.js`: `openDatabase(path)` — pragmy WAL/NORMAL/foreign_keys, `exec(schema.sql)` (ścieżka względem pliku modułu), rejestracja `db.function('bit_count', {deterministic: true}, popcount)`.
- `src/server/lib/mask.js`: `maskFromNumbers`, `numbersFromMask`, `popcount` (bez BigInt — patrz CONVENTIONS).
- `src/server/app.js`: `createApp(db)` — `express.json()`, `GET /api/health` → `{ok: true, draws: <count>}`; w `NODE_ENV=production` statyczny `dist/` + SPA fallback (każdy nie-`/api` GET → `dist/index.html`).
- `server.js`: `PORT` (default 3005), `DB_PATH` (default `db/lotek.db`), boot + listen.
- `vite.config.js`: dev port 5177, proxy `/api` → `http://localhost:3005`, `outDir: 'dist'`, `emptyOutDir: true`.
- `index.html` + `src/main.js` + `src/styles/main.css`: minimalny placeholder "LOTEK" (właściwy front w Fazie 3).
- `.gitignore` (node_modules, dist, `db/*.db*`, .idea, .superpowers, .env, .DS_Store), `.dockerignore`, `README.md` (stub: nazwa, setup dev, porty).
- Testy (`tests/`): `smoke.test.js` (health przez supertest na `createApp(openDatabase(':memory:'))`), `mask.test.js` (round-trip maski, popcount, `bit_count` w SQL: `SELECT bit_count(? & ?)` dla {1..6}∩{4..9} = 3), `schema.test.js` (insert poprawnego losowania; odrzucenie: duplikat `(game_type, draw_number)`, liczby nierosnące, poza zakresem; `sum_numbers` generowane poprawnie).

DoD: `npm test` zielony; `npm run dev` działa (health odpowiada); `npm run build` przechodzi.

---

## Task 2: (Faza 0) Docker + CI

**Cel:** `docker compose up` stawia aplikację; workflow CI gotowe pod GitHub.

Zakres:

- `Dockerfile` dwustopniowy per CONVENTIONS (wzór: hankometr — stage build `node:22-alpine` npm ci + `npm run build`; stage runtime `node:22-alpine` z tymczasowym toolchainem `python3 make g++` dla better-sqlite3, `npm ci --omit=dev`, `apk del`; kopiuje `server.js`, `src/server`, `db/schema.sql`, `db/index.js`, `scripts` (jeśli są), `config` (jeśli jest), `data/fixtures` (jeśli są), `dist` z builda). ENV: `NODE_ENV=production`, `PORT=80`, `DB_PATH=/app/db/lotek.db`. EXPOSE 80.
- `docker-compose.yml`: serwis `app`, build lokalny, `ports: "3005:80"`, volume `./db:/app/db`, env jak wyżej, network `lotek`.
- `docker-compose.prod.yml`: `container_name: lotek-app`, `ports: !override []`, named volume `lotek-db:/app/db`, networks `lotek` + external `web`.
- `.github/workflows/test.yml`: push na master + PR; setup-node 22 z cache npm; `npm ci`, `npm test`, `npm run build`.
- `.github/workflows/deploy.yml`: `workflow_run` po sukcesie "Test" na master; `appleboy/ssh-action@v1` z sekretami `SSH_HOST`/`SSH_USER`/`SSH_KEY`; skrypt: `cd /home/dev/www/rockingchair/lotek && git pull origin master && docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d && docker image prune -f`.

DoD (zweryfikować realnie): `docker compose up -d --build` → `curl localhost:3005/api/health` zwraca ok → `docker compose down`. Workflow YAML poprawny składniowo.

---

## Task 3: (Faza 1) Parser dl.txt

**Cel:** czysty moduł parsujący pełną historię mbnet z twardą walidacją.

Zakres:

- `src/server/lib/parse-dl.js`:
  - `parseDlFile(text)` → `{draws, errors}`; `draws`: `{drawNumber, drawnAt (ISO 'YYYY-MM-DD'), numbers [6, rosnąco], mask}`. Format wiersza: `7380. 18.07.2026 5,6,12,38,41,43` (tolerować CRLF, nadmiarowe spacje, puste linie). Wiersz niepasujący do formatu → wpis w `errors` `{line, reason, raw}`, parsowanie idzie dalej.
  - Walidacje per wiersz: dokładnie 6 liczb, zakres 1–49, ściśle rosnące (implikuje unikalność); data poprawna kalendarzowo (dd.mm.yyyy).
  - Walidacje zbioru: duplikat `drawNumber` → error; **duplikaty dat są legalne** (np. 421 i 422 oba z 07.03.1965 — MUSI być test); `validateContinuity(draws)` → lista brakujących numerów w 1..max (dziury tygodniowe w datach są OK, dziury w numeracji NIE).
- Testy (`tests/parse-dl.test.js`), fixtures inline lub w `tests/fixtures/`: poprawny plik kilkuwierszowy; duplikat dat legalny; duplikat numeru → error; dziura w numeracji wykryta; wiersze złe (5 liczb, 7 liczb, liczba 0, liczba 50, nierosnące, śmieci, pusta linia); CRLF; maska liczona poprawnie (porównanie z `maskFromNumbers`).

DoD: `npm test` zielony; parser nie rzuca wyjątków na złych danych (zbiera errors).

---

## Task 4: (Faza 1) Import historii + fixture-snapshot

**Cel:** pełna historia w bazie; projekt niezależny od dostępności mbnet.

Zakres:

- `scripts/import-history.js` — CLI: `node scripts/import-history.js [--file <ścieżka>] [--db <ścieżka>]`; bez `--file` pobiera `http://www.mbnet.com.pl/dl.txt` (Node fetch). Obsługa wejścia `.gz` (zlib gunzip po rozszerzeniu). Przebieg: parse → `validateContinuity` (błędy → status `failed`, bez zapisu) → w jednej transakcji `INSERT ... ON CONFLICT(game_type, draw_number) DO NOTHING` batchami (prepared statement), `source='mbnet'` → wpis do `import_log` (started/finished, draws_added = realnie dodane, last_draw_number, status, message) → wypis podsumowania. Eksportowana funkcja `importHistory(db, text)` (czysta względem sieci) + cienki CLI wrapper.
- Skrypt npm: `"import:history": "node scripts/import-history.js"`.
- **Snapshot**: pobrać świeży `dl.txt`, zapisać jako `data/fixtures/dl_snapshot.txt.gz` i **scommitować** (≈100–150 KB). To źródło bootstrapu offline i danych do testów integracyjnych następnych faz.
- Wykonać realny import do `db/lotek.db` (dev, plik git-ignored).
- Testy: import małego fixture → wiersze w bazie, maski poprawne; idempotencja (drugi run → draws_added=0, count bez zmian); dziura w numeracji → `failed`, baza nietknięta; `import_log` zapisany. Test integracyjny na snapshot gz: import do `:memory:`, asercje: `COUNT(*) = MAX(draw_number)`, count ≥ 7380, losowanie 7380 = {5,6,12,38,41,43}, brak duplikatów masek per draw_number.

DoD: `npm test` zielony; `db/lotek.db` zawiera komplet ≥7380 losowań; snapshot w repo.

---

## Task 5: (Faza 2) Rematerializacja statystyk (number_stat, pair_stat)

**Cel:** pełny rebuild tabel pochodnych po każdym imporcie; fundament pod API i Typera.

Zakres:

- `src/server/lib/rebuild-stats.js` — `rebuildStats(db, {gameType='lotto'})`: czyta wszystkie losowania (rosnąco po draw_number), liczy i zapisuje w transakcji:
  - `number_stat` (49 wierszy): `total_count`; `count_last50/100/300` (okna po draw_number od najnowszego); `decayed_count` = Σ λ^age, λ = 0.5^(1/300), age = maxDrawNumber − drawNumber (parametr half-life z `config/typer.json`, na razie stała 300 w module z TODO na config); `z_score` = (c − N·6/49)/√(N·6·(1/49)·(48/49)); `last_drawn_at`, `last_draw_number`; `current_gap` = maxDrawNumber − last_draw_number; przerwy: dla kolejnych wystąpień p_k liczby gap = p_{k+1} − p_k − 1; `max_gap` (+ `max_gap_ended_at` = data losowania kończącego rekordową przerwę), `avg_gap` (średnia ukończonych przerw); `longest_streak` = najdłuższy ciąg kolejnych draw_number z liczbą; `year_counts` = JSON `{"1957": 4, ...}`.
  - `pair_stat` (1176 wierszy a<b): `cnt`, `expected = N·5/392`, `lift = cnt/expected` (0 gdy expected 0).
- `scripts/rebuild-stats.js` CLI + npm `"stats:rebuild"`; wpięcie na koniec `importHistory` (po udanym imporcie z nowymi wierszami).
- Testy: syntetyczny mały zbiór (5–10 losowań ułożonych ręcznie) → ręcznie policzone total/gapy/streak/decayed (λ^0=1, λ^300=0.5) i pary; z_score zgodny ze wzorem; year_counts. Test integracyjny na snapshot: suma total_count = 6·N; suma cnt w pair_stat = 15·N; każdy |z_score| < 5.

DoD: `npm test` zielony; po `npm run stats:rebuild` na dev-bazie tabele wypełnione (49 + 1176 wierszy).

---

## Task 6: (Faza 2) API rdzenia: losowania, hero, blankiet, rankingi, spóźnialscy

**Cel:** JSON-owe API pod stronę główną i archiwum.

Zakres (handlery w `src/server/*.js`, montowane w `createApp`; cache in-memory w `src/server/lib/cache.js` — `cached(key, fn)` + `invalidateCache()` wołane po imporcie/rebuildzie):

- `GET /api/draws/latest` — hero payload: losowanie (nr, data, liczby, suma), `verdict`: `{type: 'premiera'}` gdy maska nie wystąpiła wcześniej, `{type: 'dejavu', priorDrawNumber, priorDate}` gdy wystąpiła; `chips` per liczba: `{number, countBefore, lastSeenBefore: {drawNumber, date} | null}` (bez bieżącego losowania); `nearestNeighbor`: wcześniejsze losowanie o max `bit_count(mask & :m)` (remis → nowsze), `{drawNumber, date, shared, sharedNumbers}`; `nextDraw`: `{date, drawNumber}` wyliczone z harmonogramu wt/czw/sob 22:00 Europe/Warsaw (czysta funkcja `nextDrawDate(after)` w `src/server/lib/schedule.js`, testowalna, poprawna przy DST).
- `GET /api/draws?page=&perPage=&year=&contains=1,2,3&number=` — archiwum: paginacja od najnowszych, filtry: rok, "zawiera wszystkie z podanych liczb" (maska AND), konkretny numer losowania.
- `GET /api/draws/:nr` — szczegół + prev/next + ten sam zestaw pól co hero (verdict/chips/neighbor liczone względem stanu PRZED tym losowaniem).
- `GET /api/stats/blanket` — 49 × `{number, total, last50, last100, currentGap, zScore, lastDrawnAt}` (frontend renderuje 3 tryby z jednego payloadu).
- `GET /api/stats/rankings` — `{hot, cold}` × okna `{all, last100, currentYear}`, po 10 wpisów `{number, count, zScore}`.
- `GET /api/stats/gaps` — spóźnialscy: top 10 `currentGap` z `{number, currentGap, maxGap, avgGap}`; rekordy historyczne max_gap top 10; rozkład długości ukończonych przerw (histogram) + krzywa geometryczna `P(gap=g) = p(1−p)^g, p=6/49` przeskalowana do liczby obserwacji.
- Testy supertest na seedowanej znanej bazie: werdykt déjà vu (wstawić duplikat maski), chips liczone bez bieżącego, neighbor po bit_count, filtr `contains`, paginacja, rankingi posortowane, geometryczna krzywa sumuje się sensownie; `nextDrawDate`: przypadki wt/czw/sob, przejście przez północ, zmiana czasu (marzec/październik).

DoD: `npm test` zielony; endpointy odpowiadają na dev-bazie.

---

## Task 7: (Faza 2) API rozkładów, ciekawostek i wehikułu czasu

**Cel:** komplet danych pod `/statystyki` i `/wehikul`; kotwice teoretyczne w kodzie i testach.

Zakres (moduł teorii: `src/server/lib/theory.js` — dokładne kombinatoryczne stałe/funkcje, liczone na double, bez zaokrągleń ręcznych):

- `theory.js`: `C(n,k)` (double, dokładne dla naszych zakresów), `P_CONSECUTIVE = 1 − C(44,6)/C(49,6)`, `P_REPEAT_PREV = 1 − C(43,6)/C(49,6)`, `hypergeomPmf(k)` (N=49,K=6,n=6), `sumDistribution()` — DP: liczba 6-elementowych podzbiorów 1..49 o sumie s (s=21..279; suma wszystkich = C(49,6) — asercja w teście), `evenOddDist()` i `lowHighDist()` (hipergeometryczne: parzyste 24/nieparz. 25; niskie 1–24, wysokie 25–49).
- `GET /api/stats/pairs` — top 15 par (z pair_stat) i top 15 trójek (liczone on-the-fly z draws, C(6,3)=20 na losowanie) z `{cnt, expected, lift}`; expected trójki = N·120/110544.
- `GET /api/stats/sums` — histogram empiryczny sum + krzywa teoretyczna (rozkład × N) + `{lastSum, percentile, sector}` ostatniego losowania.
- `GET /api/stats/structure` — rozkład liczby parzystych 0..6 i niskich 0..6: empiryczny vs teoretyczny.
- `GET /api/stats/consecutive` — `{empiricalShare, theoretical: P_CONSECUTIVE, draws: N}`.
- `GET /api/stats/repeats` — `{empiricalShare, theoretical: P_REPEAT_PREV}` (udział losowań mających ≥1 wspólną z poprzednim, po draw_number).
- `GET /api/stats/duplicate-sixes` — pełne powtórki: grupy masek z ≥2 wystąpieniami `{numbers, occurrences: [{drawNumber, date}]}` + `expectedCollisions = C(N,2)/13983816`.
- `GET /api/stats/records` — `{maxSum, minSum}` (z losowaniami), najdłuższy ciąg kolejnych liczb w jednym losowaniu, najdłuższa seria losowań bez żadnej liczby 1–10, najwyższy current_gap w historii (= rekordowa absencja z number_stat), urodzinowość ostatniego losowania (udział liczb ≤31 + średnia historyczna 31·6/49/6 ≈ 0.6327 — teoretyczny udział E[#≤31]/6 = (6·31/49)/6 = 31/49).
- `GET /api/stats/carpet` — kompaktowo: `{dates: [...], points: [[drawIndex, number], ...]}` dla scattera.
- `GET /api/numbers/:n` — kariera liczby: pełny number_stat + `year_counts` + histogram przerw tej liczby + seria z-score w czasie (checkpointy co 100 losowań, wyliczane z draws) + pozycja na blankiecie (z `blanket.js`).
- `POST /api/wehikul` body `{numbers: [6]}` (walidacja: 6 liczb 1–49 unikalnych) → `{hits: {3: cnt, 4: cnt, 5: cnt, 6: cnt}, occurrences: [{drawNumber, date, hits}] (hits≥3), balance: {drawsPlayed, cost, winnings, net}, disclaimer}` — wygrane wg `config/prizes.json` (utworzyć per CONVENTIONS), koszt = betPrice × liczba losowań.
- Testy: DP sum sumuje się do C(49,6) DOKŁADNIE; hypergeomPmf sumuje do 1 i zgadza się z kotwicami z CONVENTIONS; empiria na snapshot (test integracyjny): consecutive ±2 p.p. od 49,52%, repeats ±2 p.p. od 56,4%, średnia suma 150 ±2; wehikuł na seedowanej bazie z ręcznie policzonym wynikiem; walidacja wejścia wehikułu (400).

DoD: `npm test` zielony; wszystkie endpointy działają na dev-bazie.

---

## Task 8: (Faza 3) SPA shell, design system, hero

**Cel:** właściwy frontend — layout, tokeny, router, strona główna z hero.

Przed implementacją przeczytać SPEC §7 (design) i użyć skilla `frontend-design`. Zakres:

- Router SPA (History API) w `src/main.js` + `src/router.js`: trasy `/`, `/statystyki`, `/liczba/:n`, `/losowanie/:nr`, `/typer`, `/wehikul`, 404; widoki w `src/views/*.js` (fabryki renderujące do kontenera, bez frameworka), komponenty w `src/components/*.js`, `src/api.js` (fetch wrapper z obsługą błędów), format liczb/dat PL w `src/format.js`.
- `src/styles/main.css`: tokeny CSS (custom properties) per CONVENTIONS/SPEC §7; fonty Google (Bricolage Grotesque 600/700, Instrument Sans 400/500/600, JetBrains Mono 400/500 z `font-variant-numeric: tabular-nums`); reset; layout (header z logo LOTEK i nawigacją, main, footer: hobbystyczny projekt, 18+, wyniki oficjalne na lotto.pl, "Graj odpowiedzialnie").
- Hero (`src/views/home.js` + `src/components/hero.js`): 6 kul (komponent `ball.js` — radialny gradient, żółć #FFC400, numer w JetBrains Mono) z animacją wtaczania (CSS, stagger ~100 ms/kula, łącznie ~600 ms, pełny respekt `prefers-reduced-motion`); werdykt PREMIERA (zielony #0E9F6E) / DÉJÀ VU (z linkiem do pierwotnego losowania); data + nr losowania; countdown do następnego losowania (odliczanie klienckie do `nextDraw.date` z API, format "za 2 dni 03:12:45"); chipy 6 liczb (ile razy padła, kiedy ostatnio, link do `/liczba/n`); karta "najbliższy historyczny sąsiad".
- Sekcje-placeholdery na home poniżej hero (blankiet, rankingi, zajawka Typera — wypełniane w Task 9/16) — struktura strony gotowa.
- Responsywność mobile-first; brak dark mode.
- Testy (Vitest + jsdom, lekkie): router (parsowanie tras z parametrami), `format.js`, countdown (czysta funkcja różnicy czasu), hero renderuje 6 kul z danych mockowych.

DoD: `npm test` zielony; `npm run dev` — strona główna wygląda zgodnie z tokenami, animacja działa, countdown tyka.

---

## Task 9: (Faza 3) Blankiet 7×7 SVG + rankingi + kompletna strona główna

**Cel:** element podpisowy aplikacji.

Zakres:

- `src/components/blanket.js` — custom SVG 7×7 (geometria z `src/server/lib/blanket.js` — zduplikować wzór `row/col` w prostym module frontowym `src/blanket-geometry.js` z komentarzem o źródle prawdy, LUB współdzielić moduł przez alias — wybrać prostsze): każde pole = kula (radialny gradient bieli + wypełnienie wg wartości trybu), skala heatmapy `#FFF3C4 → #FFC400 → #E4372E` (interpolacja w OKLCH lub prosty lerp RGB — wybrać wizualnie lepsze), mikro-kropka świeżości w rogu kuli (skala: świeża=zielona → dawno=czerwona), tooltip na hover (ile razy, kiedy ostatnio, current gap), klik → `/liczba/n`, focusowalne (dostępność: `role`, `aria-label`, obsługa klawiatury).
- Przełącznik trybów: Częstość (total), Świeżość (currentGap odwrotnie), Z-score (dywergentnie: ujemne chłodne → dodatnie gorące) — przełączanie bez przeładowania, płynna tranzycja kolorów.
- Legenda skali + podpis edukacyjny (wartości mieszczą się w szumie ±3σ).
- `src/components/rankings.js`: gorące/zimne top 10, zakładki okien (całość / ostatnie 100 / bieżący rok), z-score przy każdej liczbie, mini-kule.
- Zajawka Typera (karta z CTA do `/typer`; do Fazy 5 stan "Typer startuje wkrótce").
- Złożenie strony głównej: hero → blankiet → rankingi → zajawka.
- Testy: geometria blankietu (1→(0,0), 7→(0,6), 8→(1,0), 49→(6,6)), mapowanie wartość→kolor (krańce i środek skali), tryby przełączają dane.

DoD: `npm test` zielony; blankiet renderuje się z realnych danych, tryby i tooltipy działają, klik nawigujе.

---

## Task 10: (Faza 3) Strona /statystyki z wykresami ECharts

**Cel:** pełna strona statystyk (SPEC §6.4–6.9, 6.12, 6.13).

Przed implementacją użyć skilla `dataviz`. Zakres:

- ECharts z npm, importy modułowe (`echarts/core` + BarChart/LineChart/ScatterChart/CustomChart wg potrzeb + renderery) — pilnować rozmiaru bundla; wspólny moduł stylu wykresów `src/charts/theme.js` (tokeny projektu: kolory, fonty, siatka).
- Sekcje strony (każda: tytuł, wykres/panel, 1–2 zdania kontekstu edukacyjnego, wartość teoretyczna obok empirycznej):
  1. **Suma losowania** — histogram empiryczny + linia teoretyczna + marker ostatniego losowania z percentylem.
  2. **Dywan losowań** — scatter (oś X czas/nr losowania, oś Y 1–49, ~44 tys. punktów, `large: true`, punkt 2 px); podpis "70 lat, zero wzoru — i o to chodzi".
  3. **Struktura** — parzyste/nieparzyste i niskie/wysokie: słupki empiryczne vs teoretyczne (hipergeometryczne).
  4. **Pary i trójki** — dwie listy top 15 z liftem (pasek odchylenia od 1.0).
  5. **Sąsiadujące + powtórki** — dwa stat-tile'e: empiria vs teoria (49,52% / 56,4%) z krótkim myth-busterem.
  6. **Powtórzone szóstki** — panel: znalezione kolizje (lub ich brak) + oczekiwane ≈ C(N,2)/13 983 816 + wyjaśnienie paradoksu urodzin.
  7. **Rekordy** — karty: max/min suma, najdłuższy ciąg kolejnych, seria bez 1–10, rekordowa absencja.
- Lazy-loading modułu ECharts przy wejściu na trasę (dynamic import), stany ładowania.
- Testy: transformacje danych do serii (czyste funkcje) — histogram binning, percentyl, formatowanie liftu.

DoD: `npm test` zielony; strona renderuje wszystkie sekcje na realnych danych, responsywna.

---

## Task 11: (Faza 3) Podstrony: /liczba/:n, /losowanie/:nr + archiwum, /wehikul

**Cel:** komplet podstron frontendu.

Zakres:

- `/liczba/:n` — kariera liczby: nagłówek z wielką kulą, licznik wystąpień + z-score, sparkline częstości rocznej (ECharts, mini), histogram przerw + krzywa geometryczna, najdłuższa seria, najlepszy rok, mini-blankiet z zaznaczoną pozycją, linia z-score w czasie; nawigacja poprzednia/następna liczba (1..49).
- `/losowanie/:nr` — kule, data, suma z percentylem, werdykt premiera/déjà vu, chipy, najbliższy sąsiad, prev/next. Nad szczegółem: **archiwum** — wyszukiwarka (rok, "zawiera liczby" przez klikalny mini-blankiet, nr losowania) + paginowana lista (nr, data, 6 mini-kul, suma) → klik wchodzi w szczegół. Trasa `/losowanie` bez numeru pokazuje samo archiwum od najnowszych.
- `/wehikul` — picker 6 liczb jako interaktywny mini-blankiet (zaznaczanie/odznaczanie, licznik 0/6, walidacja) + CTA "Sprawdź swój zestaw" → wyniki: trafienia 3/4/5/6 z listą losowań i datami, bilans (koszt vs wygrane vs net, formaty PL zł) z wyraźną etykietą "szacunek edukacyjny" i wyjaśnieniem stawek z configu; link "zagraj tym zestawem w wehikule" z kart innych losowań mile widziany, bez przesady.
- Testy: transformacje danych widoków, walidacja pickera (6 unikalnych), routing parametryzowany, formatowanie bilansu.

DoD: `npm test` zielony; wszystkie trasy działają na realnych danych; mobile OK.

---

## Task 12: (Faza 4) Providerzy wyników + fetch-latest

**Cel:** automatyczne dociąganie nowych losowań z łańcuchem fallbacków.

Zakres:

- `src/server/providers/` — wspólny kontrakt: `provider.fetchSince(sinceDrawNumber, {fetchFn})` → `[{drawNumber, drawnAt, numbers, source}]` (rosnąco), rzuca przy błędzie:
  - `lottopl.js` — nieoficjalny endpoint `https://www.lotto.pl/api/lotteries/draw-results/by-gametype?game=Lotto&index=1&size=10&sort=drawDate&order=DESC` (rozszerzać `size` gdy trzeba dogonić więcej); NAJPIERW zbadać realny kształt odpowiedzi (curl) i zapisać przykład jako fixture testowy; mapowanie pól defensywne.
  - `openapi.js` — oficjalne API developers.lotto.pl: `GET https://developers.lotto.pl/api/open/v1/lotteries/draw-results/by-date-per-game?gameType=Lotto&drawDate=YYYY-MM-DD&index=1&size=10`, nagłówek `secret: LOTTO_API_KEY`; provider aktywny tylko gdy env ustawiony; iteracja po datach od ostatniego znanego losowania do dziś (harmonogram wt/czw/sob z `schedule.js`). Bez klucza w testach — mock.
  - `mbnet.js` — pełny `dl.txt` + `parseDlFile`, filtr `> sinceDrawNumber`; działa też jako źródło rekoncyliacji (zwraca komplet).
  - `index.js` — łańcuch `[openapi?, lottopl, mbnet]`: pierwszy provider, który zwróci wynik bez wyjątku, wygrywa; błędy logowane; wszystkie padły → throw.
- `src/server/lib/fetch-latest.js` — `fetchLatest(db, {providers, fetchFn, now})`: pyta łańcuch od `MAX(draw_number)+1`, waliduje ciągłość z bazą (nowe muszą zaczynać się od MAX+1 bez dziur; dziura → status `partial`, import tylko ciągłego prefiksu), wstawia w transakcji, `import_log` (source = provider, który dostarczył), po dodaniu: `rebuildStats` + `invalidateCache`. Zwraca `{added, lastNumber, provider}`.
- `scripts/fetch-latest.js` CLI + npm `"fetch:latest"`.
- Testy (wstrzykiwany `fetchFn`, fixtures z realnych odpowiedzi): mapowanie lottopl; openapi z nagłówkiem secret; fallback (lottopl rzuca → mbnet ratuje); nic nowego → `{added: 0}` bez rebuildu; idempotencja podwójnego wywołania; dziura między bazą a wynikami providera → partial; import_log kompletny.

DoD: `npm test` zielony; `npm run fetch:latest` na dev-bazie działa (realny strzał — dopisze 7381+, jeśli już opublikowane).

---

## Task 13: (Faza 4) Scheduler in-process + ewaluacja + rekoncyliacja

**Cel:** aplikacja sama dociąga wyniki po każdym losowaniu i utrzymuje łańcuch rebuild→evaluate→predict.

Zakres:

- Dep `croner`. `src/server/lib/scheduler.js` — `startScheduler(db, {hooks})`:
  - Wt/czw/sob **22:05 Europe/Warsaw**: `runFetchCycle` — `fetchLatest`; nowe losowanie → `evaluatePredictions` → `hooks.predict?.()` (Typer wpina się w Fazie 5; brak hooka = pominięcie bez błędu); brak nowego → retry co 10 min, max 12 prób, po wyczerpaniu wpis `import_log` status `failed`, message "brak wyniku do 00:05".
  - Niedziela 08:00: `reconcile(db)` — pełny dl.txt (mbnet), diff z bazą: brakujące/rozbieżne wiersze → `import_log` (`ok` + "0 rozjazdów" albo `partial` + szczegóły; rozbieżność danych NIE nadpisuje bazy automatycznie — tylko raport).
  - Codziennie 12:00: watchdog — jeśli od terminu ostatniego oczekiwanego losowania (z `schedule.js`) minęły >24 h bez wpisu → `import_log` `failed` "watchdog: brak losowania".
  - Ochrona przed nakładaniem: flaga in-process (cykl nie startuje, gdy poprzedni trwa) + naturalna idempotencja INSERT ON CONFLICT.
  - Dni/godziny harmonogramu w `config/schedule.json` (`{drawDays: [2,4,6], drawHour: 22, fetchMinute: 5, ...}`) — używane też przez `schedule.js` (refaktor z Task 6, jedna prawda).
- `src/server/lib/evaluate.js` — `evaluatePredictions(db)`: dla predykcji bez `result_draw_id`, gdy istnieje losowanie o `for_draw_number`: `hits = popcount(pred.mask & draw.mask)`, `prize_tier` = 7−hits gdy hits≥3 (I st.=6 trafień … IV st.=3), inaczej NULL; zapis `result_draw_id`.
- `server.js`: scheduler startuje, gdy `NODE_ENV !== 'test'` i `SCHEDULER_ENABLED !== '0'`.
- Testy: `evaluate` na seedowanych predykcjach i losowaniach (0–6 trafień, tiers); `runFetchCycle` z fake providerem — sukces uruchamia evaluate+hook, porażka planuje retry (fake timers / wstrzyknięty planner: logika retry wydzielona z cronera do czystej funkcji), wyczerpanie prób → failed log; reconcile diff (zgodność, brak, rozbieżność); podwójny start cyklu nie dubluje.

DoD: `npm test` zielony; symulowany "nowy wynik" (fake provider) przechodzi cały łańcuch; scheduler odpala się w dev bez błędów.

---

## Task 14: (Faza 5) Typer — rdzeń statystyczny (wygaszanie, Dirichlet, χ²)

**Cel:** komponent A modelu — detekcja biasu z uczciwym testem istotności.

Zakres:

- `config/typer.json` (jedno źródło parametrów, ładowane przez `src/server/lib/typer/config.js` z walidacją):
  ```json
  {
    "modelVersion": "1.0.0",
    "halfLifeDraws": 300,
    "priorStrengthDraws": 780,
    "chi2Alpha": 0.05,
    "weights": { "wA": 1.0, "wB": 1.0 },
    "popularity": { ... (Task 15) }
  }
  ```
- `src/server/lib/typer/bias.js`:
  - `decayedCounts(draws, halfLife)` → `{counts[49], effectiveN}`; λ = 0.5^(1/halfLife), waga losowania = λ^(maxDrawNumber − drawNumber), `effectiveN = Σ wag`, `counts[i] = Σ wag losowań zawierających i`; oraz `sumSqWeights = Σ wag²` (do wariancji).
  - `dirichletPosterior(counts, effectiveN, priorStrengthDraws)` → `p[49]`: α = priorStrengthDraws·6/49; `p_i = (c_i + α)/(effectiveN·6 + 49α)`. Prior ≈ 5 lat (780 losowań) uczciwych danych.
  - `biasZ(counts, effectiveN, sumSqWeights)` → `z̃[49]`: E = effectiveN·6/49, Var = (6/49)·(43/49)·sumSqWeights, `z̃_i = (c_i − E)/√Var`.
  - `chi2Stat(counts, effectiveN)` → `{stat, df: 48, p}`: klasyczny Pearson na wygaszonych licznikach (E = effectiveN·6/49); udokumentować w komentarzu, że przy wagach to przybliżenie.
- `src/server/lib/typer/chi2.js` — `chi2Sf(x, df)`: dla parzystego df forma zamknięta `exp(−x/2)·Σ_{j<df/2} (x/2)^j / j!` (sumowanie od najmniejszych składników / kompensowane, stabilne dla x do ~500); dla nieparzystego df regularyzowana górna gamma (Lentz). Testy wobec kotwic scipy (wartości dostarczone w brief).
- Testy: λ — losowanie sprzed `halfLife` waży 0.5, bieżące 1.0; posterior przy zerze danych = 1/49 dokładnie; posterior ściąga do 1/49 mimo skrajnej próbki przy silnym priorze; z̃ symetryczne (Σ counts stałe); `chi2Sf` vs kotwice (df=48 i df=10, ± 1e-10 względnie); **wykrywalność**: syntetyczny zbiór 2000 losowań z biasem 1,3× na liczbie 17 (generator deterministyczny — LCG ze stałym ziarnem w teście) → `z̃_17` = max, p < 0.05; zbiór uczciwy (LCG) → p > 0.05.

DoD: `npm test` zielony.

---

## Task 15: (Faza 5) Typer — model popularności + pełna enumeracja

**Cel:** komponent B + silnik: globalne optimum spośród 13 983 816 kombinacji, w pełni deterministyczne.

Zakres:

- `config/typer.json` → sekcja `popularity` (wartości domyślne — kalibracja heurystyczna wg SPEC §8.2):
  ```json
  "popularity": {
    "base": 1.0, "birthdayBonus": 0.35, "dayMonthBonus": 0.25,
    "luckyMultipliers": { "7": 1.25, "13": 1.2, "3": 1.15, "9": 1.1, "11": 1.1, "17": 1.1 },
    "highDiscount": 0.85,
    "penalties": {
      "run3": 1.3, "runPerExtra": 1.15,
      "line4plus": 1.25,
      "allBirthday": 1.5, "lowSum": 1.2, "lowSumThreshold": 120,
      "historicalWinner": 2.0, "allHigh": 1.3
    }
  }
  ```
- `src/server/lib/typer/popularity.js`:
  - `numberWeights(cfg)` → `w[49]`: baza + bonusy ≤31/≤12, mnożniki lucky, dyskonto 40–49 (`w *= highDiscount`).
  - `comboPenalty(numbers, cfg, winnerMasks)` → iloczyn kar: ciąg kolejnych długości L≥3 → `run3 · runPerExtra^(L−3)`; ≥4 liczby w jednej linii/kolumnie/przekątnej blankietu 7×7 (geometria z `blanket.js`; przekątne: obie orientacje, wszystkie przesunięcia o długości ≥4) → `line4plus`; wszystkie ≤31 → `allBirthday`; suma < `lowSumThreshold` → `lowSum`; maska ∈ zbiór historycznych zwycięskich masek → `historicalWinner`; wszystkie ≥32 → `allHigh` (pułapka 2. rzędu).
  - `popularity(numbers)` = `(Σ w(n_i)) · comboPenalty(...)` (operacjonalizacja wzoru ze SPEC — mnożenie, nie dodawanie iloczynu; odnotowane w komentarzu).
- `src/server/lib/typer/engine.js` + `worker.js` (worker_thread):
  - `runPrediction(db, cfg)` → enumeracja 6 zagnieżdżonych pętli n1<…<n6 (leksykograficznie), score = `wA·Σ z̃(n_i) − wB·popularity(S)`; części per-liczba prekomputowane; kary liczone tanio inkrementalnie; utrzymywane top-4 (przy remisie wygrywa wcześniejsza kombinacja — naturalne przy `>`).
  - Wynik: `{forDrawNumber: MAX+1, numbers, alternatives: [3×{numbers, totalScore}], scores: {bias, popularity, total}, chi2: {stat, df, p}, biasReport: [{number, decayed, z}...], popularityReport: {winnerWeights, winnerPenalties, rejectedExample: {numbers: [1,2,3,4,5,6], popularity, rank?}}}`.
  - Zapis do `prediction` (`ON CONFLICT(for_draw_number) DO UPDATE` — nowszy model nadpisuje przed losowaniem); `commentary` uzupełni Task 16.
  - `scripts/predict.js` CLI + npm `"predict"`; wpięcie jako `hooks.predict` schedulera.
- Testy: determinizm — dwa przebiegi na tej samej bazie → `deepEqual` całych wyników; 1-2-3-4-5-6 ma karę `historicalWinner`? (tylko jeśli padła — nie padła; ma `run3·runPerExtra³`, `allBirthday`, `lowSum`) i jego popularity w top 0,01% wszystkich (test integracyjny z pełną enumeracją popularity — zbierać próg kwantyla strumieniowo albo policzyć rank zwycięzcy vs 1-2-3-4-5-6; timeout 120 s); syntetyczny bias 1,3× na 17 (jak Task 14) z `wA` podbitym → zwycięzca zawiera 17; profil zwycięzcy na realnych danych: suma w 140–220, ≤2 liczby ≤31 (sanity, szerokie widełki); czas enumeracji < 120 s (assert + log realnego czasu).

DoD: `npm test` zielony; `npm run predict` na dev-bazie zapisuje predykcję dla następnego losowania w rozsądnym czasie.

---

## Task 16: (Faza 5) Typer — komentarz deterministyczny + strona /typer

**Cel:** predykcja z pełnym pisemnym uzasadnieniem w tonie SPEC §8.4.

Zakres:

- `src/server/lib/typer/commentary.js` — `buildCommentary(prediction, statsCtx)` → markdown PL, deterministyczny, składany z faktów:
  1. Nagłówek: "Typ na losowanie nr X (dzień tyg., DD.MM.RRRR): a, b, c, d, e, f".
  2. Uczciwa rama: 1 : 13 983 816, "nie jest bardziej prawdopodobny — jest lepiej opłacalny, jeśli wygra".
  3. χ²: p-value i werdykt ("brak dowodów na bias — o wyborze zdecydował model popularności" / wariant z wykrytym biasem).
  4. Rationale popularności: ile liczb ≤31, brak/obecność linii i ciągów, suma i jej położenie względem strefy kuponów urodzinowych, wniosek o dzieleniu puli.
  5. Ciekawostka: największy current_gap w zestawie + jawne zastrzeżenie "bez znaczenia dla szans".
  6. Sekcja per liczba: częstość total, ostatnio (nr/data), z-score.
  7. "Czego uniknęliśmy": 1-2-3-4-5-6 z jego popularity score; przykład ominiętej historycznej szóstki.
- Zapis `commentary` w `prediction` (w `runPrediction` flow); `GET /api/typer` → `{current: {prediction, commentary}, history: [{forDrawNumber, numbers, createdAt, hits, prizeTier, resultNumbers?}], nullHypothesis: {...}}`.
- Strona `/typer` (`src/views/typer.js`): aktualny typ (6 kul, wyróżnione), pełne uzasadnienie (markdown → HTML: mini-renderer własny dla podzbioru md: nagłówki/bold/listy — bez zewnętrznej zależności, LUB render z danych strukturalnych; wybrać prostsze i bezpieczne — bez innerHTML z niezaufanych źródeł, treść jest własna), zestawy zapasowe, tabela per liczba, sekcja hipotezy zerowej ("model NIE pobije losowości w trafieniach — jego przewaga siedzi w EV|wygrana"), historia typów (placeholder do Task 17 na wykres). Zajawka na home → realne dane (`GET /api/typer` skrócone).
- Testy: snapshot komentarza na zamrożonej bazie testowej (dwa przebiegi → identyczny tekst); komentarz wariantu déjà vu / biasu; API `/api/typer`; renderer md (jeśli powstał).

DoD: `npm test` zielony; `/typer` pokazuje realną predykcję z komentarzem.

---

## Task 17: (Faza 6) "Sprawdzam!" — samorozliczenie Typera

**Cel:** trwający eksperyment naukowy zamiast wróżenia.

Zakres:

- `GET /api/typer/scorecard`: dla wszystkich rozliczonych predykcji: `{perPrediction: [{forDrawNumber, date, numbers, hits, prizeTier}], cumulative: [{k, cumHits, expected: k·36/49, sigmaBand: ±2·√(k·Var)}], distribution: {observed: {0..6}, expected: hypergeomPmf·k}, balance: {cost: k·betPrice, winnings, net}}`; wariancja pojedynczego kuponu Var = Σ (h−36/49)²·P(h) z dokładnego rozkładu hipergeometrycznego (`theory.js`).
- Strona `/typer` — sekcja "Sprawdzam!": wykres skumulowanych trafień vs oczekiwana z pasmem ±2σ (ECharts linia + band), rozkład 0/1/2/3+ trafień vs teoria (słupki), bilans hipotetyczny (3 zł/kupon), copy z hipotezą zerową i dotychczasowym werdyktem ("po k kuponach: w paśmie szumu — jak być powinno").
- Stan pusty (0 rozliczonych) — sensowna zajawka zamiast pustych wykresów.
- Testy: scorecard na seedowanych predykcjach+losowaniach (ręcznie policzone cumHits/expected/band); Var z rozkładu = wartość z kotwic (E=36/49; Var policzona i zamrożona w teście); rozkład expected sumuje się do k; bilans.

DoD: `npm test` zielony; sekcja działa (choćby w stanie pustym/z 1 predykcją).

---

## Task 18: (Faza 6) Ciekawostki dnia, SEO, README, final QA

**Cel:** wykończenie produktu.

Zakres:

- `src/server/lib/facts.js` — generator "ciekawostki dnia": deterministyczne reguły oceniane po każdym imporcie na ostatnim losowaniu, z priorytetem (pierwsza pasująca): déjà vu; nowy rekord sumy (max/min); suma w skrajnym percentylu (<5 / >95); ciąg ≥3 kolejnych; liczba wróciła po rekordowej absencji; liczba w serii ≥3 losowań; okrągła rocznica (nr losowania % 500 == 0); urodzinowość skrajna (0 lub 6 liczb ≤31); fallback: najciekawszy z-score. `GET /api/facts/latest` → `{fact: {type, text}}`; karta na home i w hero okolicy.
- SEO/meta: dynamiczny `document.title` + `meta description` per trasa (router hook); Open Graph (tytuł, opis, obrazek statyczny `public/og.png` — prosty SVG→PNG z kulami lub sam SVG jeśli wystarczy); favicon (kula Lotto SVG); `public/robots.txt`.
- Stopka finalna + strona "O projekcie" nie jest wymagana — wystarczy rozbudowana stopka (hobbystyczny agregator danych publicznych; 18+ "Hazard może uzależniać"; wyniki oficjalne wyłącznie na lotto.pl; kod źródłowy — link do repo).
- `README.md` pełne: czym jest projekt (rama uczciwości!), architektura (diagram tekstowy), setup dev, komendy npm, bootstrap danych (fixture/mbnet), scheduler, deploy (compose prod + Actions + sekrety), konfiguracja (`config/*.json`, env: `PORT`, `DB_PATH`, `LOTTO_API_KEY`, `SCHEDULER_ENABLED`), backlog (Lotto Plus, ntfy/HA, Ollama-felietonista, triple_stat).
- Final QA: pełne `npm test`, `npm run build`, `docker compose up` smoke, przegląd responsywności głównych widoków, `prefers-reduced-motion`, podstawowa dostępność (aria na blankiecie/pickerze).

DoD: wszystko zielone; README kompletne; produkt spójny.
