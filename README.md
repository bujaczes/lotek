# LOTEK

Obserwatorium i agregator wyników **Dużego Lotka** (Lotto, 6 z 49). Gromadzi kompletną
historię losowań od 1957 roku, opowiada ją statystykami i wizualizacjami, i generuje jeden
deterministyczny „Typ” na następne losowanie — wraz z pisemnym uzasadnieniem i mechanizmem,
który sam się z niego rozlicza.

## Uczciwa rama (to jest sedno projektu)

LOTEK nie obiecuje wygranej i mówi to wprost — w UI, w komentarzu Typera i tutaj:

1. **Każde losowanie jest niezależne.** Żaden model nie podniesie P(6/6) powyżej
   1 / 13 983 816 w uczciwej maszynie. Aplikacja nigdy nie twierdzi inaczej. Statystyki
   opisowe zawsze pokazujemy obok teoretycznej wartości odniesienia (np. „≥1 para
   sąsiadujących liczb ≈ 49,5%”, „powtórka z poprzedniego losowania ≈ 56,4%”).
2. **Są dokładnie dwie rzeczy, które MOŻNA modelować uczciwie:**
   - **(A) fizyczny bias maszyny/kul** — test χ² (df=48) i estymacja bayesowska
     (Dirichlet-multinomial z wykładniczym wygaszaniem, półtrwanie 300 losowań). Prawie
     zawsze wynik brzmi „brak dowodów na bias” — i tak to opisujemy — ale infrastruktura
     czuwa, gdyby TS kiedyś wprowadził wadliwy zestaw kul.
   - **(B) wartość oczekiwana wygranej *pod warunkiem* trafienia** — pule II–IV stopnia
     dzieli się między graczy, a gracze wybierają liczby skrajnie niejednorodnie (daty
     urodzin, „szczęśliwe” 7/13, wzory na blankiecie). Kombinacje niepopularne mają
     wielokrotnie wyższe EV|win przy **identycznym** P(win). To jedyna przewaga potwierdzona
     w literaturze (Stern & Cover 1989, Clotfelter & Cook 1989, Simon 1999, Ziemba).
3. **Typer sam się rozlicza.** Moduł „Sprawdzam!” porównuje trafienia Typera z teoretyczną
   wartością oczekiwaną **0,7347 trafienia na kupon** (= 36/49). Hipoteza zerowa jest
   zapisana z góry: model NIE pobije losowości w liczbie trafień (i nie powinien — jego
   przewaga siedzi w EV|win, którego nie zmierzymy bez wygranej). To zamienia predykcję w
   trwający eksperyment, nie wróżenie.

## Co potrafi

- **Import pełnej historii** z pliku `dl.txt` (mbnet), z obsługą pułapek danych: powtórzone
  daty (nr 421 i 422 oba z 07.03.1965 — kluczem unikalności jest wyłącznie numer losowania),
  tygodnie bez losowania, walidacja ciągłości numeracji. Snapshot commitowany jako fixture,
  żeby projekt nie zależał od dostępności mbnet.
- **Automatyczne dopisywanie** nowych wyników po każdym losowaniu (łańcuch providerów).
- **Silnik statystyk** — materializowane `number_stat` (49 wierszy) i `pair_stat` (1176),
  pełny rebuild po każdym imporcie (przy tej skali to ułamek sekundy), API `/api/stats/*`
  z cache do następnego losowania.
- **Frontend**: `/` (hero ostatniego losowania + werdykt PREMIERA/DÉJÀ VU + countdown +
  **ciekawostka dnia** + Blankiet 7×7 + rankingi + zajawka Typera), `/statystyki`,
  `/liczba/:n` (kariera liczby), `/losowanie` + `/losowanie/:nr` (archiwum + szczegóły),
  `/typer` (predykcja + uzasadnienie + „Sprawdzam!”), `/wehikul` (bilans własnego zestawu
  od 1957).
- **Typer** — dwuskładnikowy model (bias + anty-popularność), pełna enumeracja wszystkich
  13 983 816 kombinacji w worker-thread, zero RNG, deterministyczny komentarz „dlaczego te
  liczby”.
- **Ciekawostka dnia** — deterministyczny generator (`src/server/lib/facts.js`): déjà vu,
  rekord sumy, suma w skrajnym percentylu, ciąg kolejnych liczb, powrót po rekordowej
  absencji, seria liczby, okrągły jubileusz, skrajna „urodzinowość”, a w ostateczności
  najciekawszy z-score.

## Architektura

Konwencja domowa (Panoramix / Hankometr / Paczkoza): **Node + Express + SQLite + Vite,
jeden kontener**. To świadoma rewizja oryginalnego planu z czatu (Symfony/FrankenPHP +
FastAPI + Redis + MariaDB) — patrz `docs/SPEC.md` (spec merytoryczny) i `docs/PLAN.md`
(obowiązująca adaptacja stacku).

```
                       ┌───────────────────────────────────────────────┐
   Przeglądarka        │  Node 22 + Express 5  (jeden proces)           │
   Vite SPA (vanilla   │  ├─ createApp(db)  — routing + /api/* JSON     │
   JS, History API,    │  ├─ static dist/   (tylko NODE_ENV=production) │
   ECharts, ręczny CSS)│  ├─ Scheduler (croner, in-process)            │
   ◄──────/api────────►│  │    wt/czw/sob 22:05 Europe/Warsaw           │
                       │  │    → fetch → evaluate → predict             │
                       │  └─ Typer: enumeracja C(49,6) w worker_threads │
                       └───────────────┬───────────────────────────────┘
                                       │ better-sqlite3 (synchronous)
                                 ┌─────▼──────────────────────────────┐
                                 │  SQLite  db/lotek.db  (WAL)         │
                                 │  draw · number_stat · pair_stat ·   │
                                 │  prediction · import_log            │
                                 └─────────────────────────────────────┘
Źródła zewnętrzne:  mbnet dl.txt (bootstrap + rekoncyliacja)
                    · lotto.pl (fallback live)  · LOTTO OpenAPI (gdy jest klucz)
```

Konwencje kodu (pełna lista w `docs/CONVENTIONS.md`):

- ESM (`"type": "module"`), Node ≥ 22.
- App factory `createApp(db)` w `src/server/app.js`, bootstrap w `server.js`.
- Route handlery `src/server/*.js` (fabryki `xxxHandler(db)`); **czysta logika bez Expressa
  i I/O** w `src/server/lib/*.js` (to tam żyją `facts.js`, `theory.js`, `rebuild-stats.js`,
  cały `typer/`…).
- **Bitmaska 49-bitowa** (`mask = Σ 2^(n−1)`, mieści się w JS Number < 2^53): powtórka
  kombinacji O(1), `bit_count(a & b)` = liczba wspólnych liczb. Helpery w
  `src/server/lib/mask.js`.
- Klucz unikalności losowania: wyłącznie `(game_type, draw_number)` — daty MOGĄ się
  powtarzać, numeracja musi być ciągła 1..MAX.
- Cache: prosty in-process memoize (`src/server/lib/cache.js`); `rebuildStats` woła
  `invalidateCache()` po każdym imporcie — to jedyny punkt inwalidacji, przez który
  przechodzą wszystkie odpowiedzi `/api/*` (w tym ciekawostka dnia).
- Frontend: vanilla JS, router na History API (`src/router.js`), meta/SEO per trasa
  (`src/meta.js`), ręczny CSS z tokenami (`src/styles/main.css`, bez Tailwinda), ECharts
  z importów modułowych.

## Setup (dev)

```bash
npm install
npm run dev
```

- API: http://localhost:3005 (health: `GET /api/health` → `{ ok, draws }`)
- Front (Vite): http://localhost:5177 (proxy `/api` → :3005)

`npm run dev` uruchamia równolegle Vite i `node --watch server.js`. Scheduler jest w devie
domyślnie włączony — wyłącz go `SCHEDULER_ENABLED=0`, jeśli nie chcesz zadań cron w tle
(patrz niżej).

## Komendy npm

| Komenda | Opis |
|---|---|
| `npm run dev` | Vite + serwer API w trybie watch (dev). |
| `npm run build` | Build frontu do `dist/` (kopiuje też `public/` — favicon, og.svg, robots.txt). |
| `npm start` | Produkcyjny bootstrap `node server.js` (serwuje `dist/` + API + scheduler). |
| `npm test` | Pełne testy (`vitest run`). |
| `npm run test:watch` | Testy w trybie watch. |
| `npm run import:history` | Import historii z `dl.txt`/fixture (`--file <ścieżka>`, `--db <ścieżka>`). |
| `npm run stats:rebuild` | Pełna rematerializacja `number_stat`/`pair_stat` + inwalidacja cache. |
| `npm run fetch:latest` | Dopisanie nowych losowań przez łańcuch providerów. |
| `npm run predict` | Enumeracja Typera i zapis predykcji dla następnego numeru losowania. |

## Bootstrap danych

Baza `db/lotek.db` jest gitignorowana — trzeba ją zbudować lokalnie. Najprościej z
commitowanego snapshotu:

```bash
npm run import:history -- --file data/fixtures/dl_snapshot.txt.gz
npm run predict          # opcjonalnie: pierwsza predykcja Typera
```

`import:history` bez `--file` pobiera świeży `http://www.mbnet.com.pl/dl.txt`. Import jest
idempotentny (upsert po `(game_type, draw_number)`), waliduje ciągłość numeracji i na końcu
sam odbudowuje statystyki.

### Realia łańcucha pobierania (caveat z Fazy 4 / Task 12)

Łańcuch providerów to `[openapi?, lottopl, mbnet]` (`src/server/providers/index.js`):
pierwszy niezgłaszający wyjątku wygrywa. **Stan faktyczny w tym środowisku, bez klucza
OpenAPI:**

- **`lottopl`** (nieoficjalny endpoint lotto.pl) jest bezwarunkowo blokowany przez
  **Cloudflare** (`403`, `cf-mitigated: challenge`) dla każdego klienta niebędącego
  przeglądarką — także `curl` i Node `fetch`. Działa tylko z kontekstu prawdziwej karty
  Chrome.
- **`mbnet`** (`dl.txt`) potrafi **spóźniać się o kilka dni** za realnymi losowaniami — ten
  mirror bywa aktualizowany z opóźnieniem.

Skutek: cron `fetch:latest` bez klucza OpenAPI może zwracać `added: 0` przez kilka dni po
losowaniu. To nie jest defekt kodu (łańcuch, fallback i logowanie zachowują się zgodnie ze
specyfikacją) — ale nie budujcie alertów na „fetch zwrócił 0” jako sygnale zdrowia. Z
działającym `LOTTO_API_KEY` pierwszym źródłem jest oficjalne LOTTO OpenAPI i problem znika.

### Rekoncyliacja

Cotygodniowy job (niedziela 08:00) pobiera pełny `dl.txt`, diffuje z bazą i raportuje
rozjazdy do `import_log` — **tylko raportuje**, nigdy automatycznie nie nadpisuje (żeby
transient-glitch mbnet nie skasował legalnie pozyskanego wiersza). Losowania nowsze niż
mbnet (bo mbnet zwykle lagi) nie są traktowane jako rozbieżność.

## Scheduler

In-process (croner), strefa **Europe/Warsaw** jawnie (przez DST). Wszystkie dni/godziny w
`config/schedule.json`, nic nie jest zaszyte w kodzie.

```
22:05 wt/czw/sob → fetch cycle:
   fetchLatest → (jeśli added>0) evaluatePredictions → predict hook (Typer)
   brak nowego wyniku → retry co 10 min, max 12 prób (~do 00:05), potem import_log 'failed'
niedziela 08:00 → reconcile (pełny diff historii, tylko raport)
codziennie 12:00 → watchdog (brak losowania >24 h po terminie → import_log 'failed')
```

Gwarancje: pojedyncze uruchomienie na raz (flaga `cycleRunning` obejmuje całą pętlę
retry), idempotencja importu (unikalny indeks + `contiguousPrefix`).

## Konfiguracja

### Pliki `config/*.json`

- **`config/schedule.json`** — `timeZone`, `drawDays` (`[2,4,6]` = wt/czw/sob), `drawHour`,
  `fetchMinute`, `retryIntervalMinutes`, `maxRetryAttempts`, `reconcileDayOfWeek`,
  `reconcileHour`, `watchdogHour`, `watchdogStaleHours`. Czytany fail-loud przez
  `src/server/lib/config.js`.
- **`config/prizes.json`** — stawki nagród kluczowane **liczbą trafień** (poprawka względem
  numeracji stopni w SPEC): `{"6":2000000,"5":6000,"4":200,"3":24,"betPrice":3.0}`. Etykieta
  „szacunek edukacyjny”. Używane przez Wehikuł i „Sprawdzam!”.
- **`config/typer.json`** — `modelVersion`, `halfLifeDraws`, `priorStrengthDraws`,
  `chi2Alpha`, wagi `wA`/`wB` i pełen zestaw parametrów modelu popularności (bonusy
  urodzinowe, mnożniki „szczęśliwych” liczb, kary wzorcowe).

### Zmienne środowiskowe

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3005` (kontener: `80`) | Port API. |
| `DB_PATH` | `db/lotek.db` | Ścieżka pliku SQLite. |
| `LOTTO_API_KEY` | — | Klucz LOTTO OpenAPI (nagłówek `secret`). Bez niego provider `openapi` sam się wyłącza i łańcuch to `[lottopl, mbnet]`. |
| `SCHEDULER_ENABLED` | włączony | Ustaw `0`, by wymusić wyłączenie schedulera (np. jednorazowy `node server.js`). Scheduler NIGDY nie startuje pod `NODE_ENV=test`. |

## Deploy

Produkcyjnie: dwa pliki compose złożone razem.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

- `docker-compose.yml` — baza: build z `Dockerfile` (dwustopniowy `node:22-alpine`, toolchain
  do kompilacji `better-sqlite3` tylko na czas `npm ci`, potem `apk del`), `ports 3005:80`,
  bind-mount `./db`.
- `docker-compose.prod.yml` — `container_name: lotek-app`, `ports: !override []` (za reverse
  proxy), named volume `lotek-db`, sieci `lotek` + external `web`.
- `NODE_ENV=production` włącza serwowanie `dist/` przez `express.static` i SPA-fallback na
  `index.html`.

### CI/CD (GitHub Actions)

- **`test.yml`** (push na `master` + każdy PR): `npm ci` → `npm test` → `npm run build`.
- **`deploy.yml`** (`workflow_run` po sukcesie Test na `master`): SSH na hosta →
  `git pull origin master` → `docker compose … up --build -d` → `docker image prune -f`.

Sekrety repo (Settings → Secrets): `SSH_HOST`, `SSH_USER`, `SSH_KEY`. Docelowy `LOTTO_API_KEY`
dodaje się jako `environment:` w compose prod, gdy klucz zaistnieje (kod już go czyta z env).

## Testy — kotwice matematyczne

Testy (Vitest + supertest, baza `:memory:`, zero sieci w unitach — wstrzykiwany `fetchFn`)
asertują na stałych, nie na własnej implementacji: `C(49,6)=13 983 816`; P(≥1 para
sąsiadujących) ≈ 0,4952; P(≥1 wspólna z poprzednim) ≈ 0,5640; `E[trafienia]=36/49`; rozkład
hipergeometryczny trafień; średnia suma = 150; determinizm Typera (2× ten sam input →
identyczny wynik); `1-2-3-4-5-6` w top 0,01% popularności. Ciekawostka dnia ma dedykowane
testy każdej reguły i porządku priorytetów (`tests/facts.test.js`).

## Backlog

- **Lotto Plus** — schemat gotowy (`game_type` w każdej tabeli), brakuje importu z
  `dl_plus.txt` i przełącznika gry w UI.
- **Powiadomienia** — webhook do **ntfy** / **Home Assistant** po każdym losowaniu i przy
  alertach schedulera (`import_log` `failed`).
- **Ollama-felietonista** — opcjonalny generator dłuższego, „ludzkiego” felietonu obok
  deterministycznego komentarza Typera (poza MVP, bo łamie wymóg „bez losowości” w rdzeniu).
- **`triple_stat`** — materializacja trójek (dziś liczone on-the-fly), gdyby endpoint par/
  trójek stał się wąskim gardłem.
- **Rasteryzacja OG** — `public/og.svg` jest self-contained, ale część scraperów społeczno-
  ściowych woli PNG/JPG; drop-in byłby wyrenderowany `og.png`.

## Dokumenty

- `docs/SPEC.md` — oryginalny spec merytoryczny (sekcje 1, 3–6, 8, 10, 11 wiążące).
- `docs/PLAN.md` — obowiązująca adaptacja stacku na konwencję domową.
- `docs/CONVENTIONS.md` — twarde konwencje i kotwice matematyczne, wiążące dla każdego zadania.

---

Projekt hobbystyczny do analizy publicznych danych o losowaniach. Gra 18+, hazard może
uzależniać. **Wyniki oficjalne wyłącznie na [lotto.pl](https://www.lotto.pl).**
