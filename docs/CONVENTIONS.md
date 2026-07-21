# LOTEK — konwencje i ograniczenia globalne

Wiążące dla każdego zadania. Wzorzec domowy = Panoramix/Hankometr (Node, jeden kontener).

## Stack

- **Node ≥ 22**, ESM (`"type": "module"`). Host dev: Node 23. Docker: `node:22-alpine`.
- **Express 5** — app factory `createApp(db)` w `src/server/app.js`; bootstrap w `server.js` (root). Route handlery: `src/server/*.js`, jeden plik na obszar, eksport fabryki `xxxHandler(db)`. Czysta logika (bez Expressa i bez I/O): `src/server/lib/*.js`.
- **better-sqlite3**, plik `db/lotek.db` (env `DB_PATH`). `openDatabase(path)` w `db/index.js`: WAL, `synchronous=NORMAL`, `foreign_keys=ON`, idempotentny `db/schema.sql` (`CREATE TABLE IF NOT EXISTS`), rejestracja funkcji SQL `bit_count` (deterministic). Timestampy INTEGER (epoch ms), daty TEXT ISO `YYYY-MM-DD`, JSON jako TEXT.
- **Frontend**: Vite + vanilla JS SPA (router na History API), ręczny CSS z tokenami (BEZ Tailwinda), ECharts z npm (importy modułowe z `echarts/core`). Fonty z Google Fonts CDN.
- **Testy**: Vitest + supertest. Baza testowa: `openDatabase(':memory:')` per test albo plik w `/tmp` kasowany przed testem. Zero sieci w testach jednostkowych (wstrzykiwany `fetchFn`); wyjątek: testy integracyjne na commitowanym fixture `data/fixtures/dl_snapshot.txt.gz`.
- **Porty**: API dev **3005**, Vite dev **5177** (proxy `/api` → 3005), kontener nasłuchuje na **80**.
- **Docker**: dwustopniowy `node:22-alpine` (build frontu → runtime; toolchain `python3 make g++` tylko na czas kompilacji better-sqlite3, potem `apk del`). Compose: base (`ports 3005:80`, bind-mount `./db:/app/db`) + `docker-compose.prod.yml` (`container_name: lotek-app`, `ports: !override []`, named volume `lotek-db`, sieci `lotek` + external `web`).
- **CI**: GitHub Actions — `test.yml` (push master + PR: npm ci, npm test, npm run build), `deploy.yml` (workflow_run po sukcesie Test na master, SSH → `cd /home/dev/www/rockingchair/lotek && git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d`).

## Reguły domenowe (niezmienne)

- **Bitmaska**: `mask = Σ 2^(n−1)` dla n ∈ zestawie; 49 bitów < 2^53, więc mieści się bezpiecznie w JS Number i SQLite INTEGER. Helpery w `src/server/lib/mask.js`: `maskFromNumbers(nums)`, `numbersFromMask(mask)`, `popcount(mask)` (pętla po 32-bitowych połówkach; bez BigInt na gorącej ścieżce).
- **Klucz unikalności losowania**: wyłącznie `(game_type, draw_number)`. Daty MOGĄ się powtarzać (np. losowania 421 i 422 oba z 07.03.1965). Numeracja losowań musi być ciągła 1..MAX.
- **Geometria blankietu 7×7** (jedna definicja w `src/server/lib/blanket.js`, reużywana przez front i Typera): liczba n → `row = floor((n−1)/7)`, `col = (n−1) % 7` (1–7 w pierwszym wierszu, 8–14 w drugim itd.).
- **Determinizm Typera**: zero `Math.random()`, zero zależności od zegara w scoringu; wszystkie parametry z `config/typer.json`; remisy rozstrzyga porządek leksykograficzny (enumeracja idzie leksykograficznie, przy remisie wygrywa wcześniejszy). Te same dane wejściowe → bit-identyczny wynik.
- **Uczciwa rama**: żaden tekst w UI ani komentarz Typera nie twierdzi, że jakikolwiek zestaw ma wyższe P(6/6) niż 1/13 983 816. Statystyki opisowe zawsze z teoretyczną wartością odniesienia obok, gdy istnieje.
- **Stopnie wygranych** (poprawka względem SPEC §6.14, który miesza numerację): I stopień = 6 trafień, II = 5, III = 4, IV = 3 trafienia (24 zł stała). Konfiguracja stawek kluczowana LICZBĄ TRAFIEŃ w `config/prizes.json`: `{"6": 2000000, "5": 6000, "4": 200, "3": 24, "betPrice": 3.0}` — etykieta "szacunek edukacyjny".
- **Strefa czasowa**: harmonogram losowań wt/czw/sob ~22:00 **Europe/Warsaw** (jawnie, przez DST). Dni/godziny w configu, nie zaszyte w kodzie.

## Kotwice matematyczne (asercje w testach)

- C(49,6) = 13 983 816
- P(≥1 para sąsiadujących liczb) = 1 − C(44,6)/C(49,6) ≈ 0,4952
- P(≥1 wspólna z poprzednim losowaniem) = 1 − C(43,6)/C(49,6) ≈ 0,5638
- E[trafienia kuponu] = 36/49 ≈ 0,7347; rozkład trafień hipergeometryczny (N=49, K=6, n=6):
  P(3) = 246 820/13 983 816, P(4) = 13 545/13 983 816, P(5) = 258/13 983 816, P(6) = 1/13 983 816
- Oczekiwana liczba par w N losowaniach: E[para] = N·6·5/(49·48) = N·5/392
- Średnia suma losowania = 150 (zakres 21–279)
- Fakt kontrolny: losowanie nr 7380 z 18.07.2026 = {5, 6, 12, 38, 41, 43}

## Styl

- Identyfikatory/kod po angielsku; całe copy UI po polsku (konkretne i czynne: "Sprawdź swój zestaw").
- Komentarze w kodzie rzadkie — tylko nieoczywiste ograniczenia.
- Design tokens (SPEC §7): tło `#FCFCFA`, atrament `#191A2E`, akcent `#FFC400`, gorący `#E4372E`, sukces `#0E9F6E`, linie `#E7E5DE`; skala heatmapy `#FFF3C4 → #FFC400 → #E4372E`. Fonty: Bricolage Grotesque (display), Instrument Sans (tekst), JetBrains Mono (dane, tabular-nums). Bez dark mode.
- Commity po angielsku, prefix fazy (np. `faza-1: dl.txt parser`).
