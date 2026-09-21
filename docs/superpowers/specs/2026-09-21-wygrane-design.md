# Wygrane — liczba wygranych i kwoty dla 6/5/4/3

Data: 2026-09-21 · Zakres: tylko Lotto (bez Lotto Plus)

## Cel

Przy każdym losowaniu pokazać, ile było wygranych za 6, 5, 4 i 3 trafienia i ile wyniosła jedna
wygrana; w statystykach dodać rekordy wygranych i przebieg kwoty za trójkę w czasie.

## Źródło danych

Oficjalne LOTTO OpenAPI, ten sam klucz co dla wyników (`LOTTO_API_KEY`, nagłówek `secret`):

`GET https://developers.lotto.pl/api/open/v1/lotteries/draw-prizes/Lotto/{drawSystemId}`

Sprawdzone 2026-09-21 na prawdziwych zapytaniach:

- Odpowiedź to tablica elementów `{drawSystemId, drawDate, gameType, prizesEmpty, prizes}` — obok
  `Lotto` przychodzą też `LottoPlus` i `SuperSzansa` (ta z `drawSystemId: null`). Bierzemy tylko
  element z `gameType === 'Lotto'`.
- `prizes` to obiekt z kluczami `"1"`–`"4"` = stopnie I–IV = 6, 5, 4, 3 trafienia
  (zgodnie z `prize_tier` w CONVENTIONS.md), każdy `{prize: liczba wygranych, prizeValue: kwota jednej wygranej}`.
  Przykład, losowanie 7407 (19.09.2026): I 1 × 44 794 855,00; II 107 × 8 874,00; III 6 221 × 200,70; IV 110 146 × 35,00.
- Szóstka bez zwycięzcy: `{prize: 0, prizeValue: 0}`.
- Dane są od losowania **5048 (25.08.2011)**; wcześniejsze mają `prizesEmpty: true` i pusty `prizes`.
- Spec deklaruje 404 „Nie znaleziono wygranych”. API bywa chwilowo 403 (widziane 2026-09-19 i 09-21).

Prawdziwa odpowiedź dla 7407 trafia do `data/fixtures/openapi-prizes-response.json` (fixture testów).

## Baza

### Przeniesienie wolumenu (naprawa pułapki)

Dziś wolumen `lotek-db` jest montowany na `/app/db`, gdzie obraz kładzie też `schema.sql` i `index.js` —
na produkcji działają więc ich kopie z wolumenu z 23.07 i zmiana schematu nie dociera. Zmiana:

- `docker-compose.prod.yml`: `lotek-db:/app/data`, `DB_PATH=/app/data/lotek.db`.
- `Dockerfile`: `ENV DB_PATH=/app/data/lotek.db`.
- `docker-compose.yml` (lokalny docker): `./db:/app/data`.
- Nazwa wolumenu bez zmian → kontener `db-backup` dalej czyta `/mnt/lotek/lotek.db`. Stare `schema.sql`/`index.js`
  zostają w wolumenie jako nieszkodliwe śmieci.

### Tabela `draw_prize` (w `db/schema.sql`)

Jeden wiersz na losowanie:

```sql
CREATE TABLE IF NOT EXISTS draw_prize (
  game_type TEXT NOT NULL DEFAULT 'lotto',
  draw_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'empty')),
  -- liczba wygranych i kwota jednej wygranej w groszach; NULL gdy status = 'empty'
  winners_6 INTEGER, amount_6 INTEGER,
  winners_5 INTEGER, amount_5 INTEGER,
  winners_4 INTEGER, amount_4 INTEGER,
  winners_3 INTEGER, amount_3 INTEGER,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (game_type, draw_number)
);
```

`status = 'empty'` = API odpowiedziało, ale nie ma danych (`prizesEmpty`, pusty `prizes` albo 404).

## Pobieranie

### Provider `src/server/providers/openapi-prizes.js`

`fetchPrizes(drawNumber, {fetchFn, apiKey})` → `{status: 'ok', tiers: {6: {winners, amount}, …}}` albo
`{status: 'empty'}`. Walidacja każdego pola jak w `lotto-response.js`: element `Lotto` z pasującym
`drawSystemId`, klucze 1–4, liczby całkowite ≥ 0 dla `prize`, skończone ≥ 0 dla `prizeValue`; kwota
zamieniana na grosze (`Math.round(value * 100)`). Wszystkie stopnie z zerową liczbą wygranych → `empty`
(to raczej jeszcze nieogłoszone wyniki niż prawdziwe dane). Niepoprawny kształt → `PrizesShapeError` z konkretnym opisem.
HTTP 404 → `empty`; inne nie-2xx → wyjątek z kodem. Bez klucza → wyjątek (jak `openapi.js`).

### `syncPrizes(db, options)` — `src/server/lib/prizes-sync.js`

1. Wybiera losowania do pobrania, **od najnowszego**: `draw_number >= 5048` i brak wiersza w `draw_prize`,
   albo wiersz `empty` dla losowania z ostatnich 7 dni (mogło jeszcze nie być ogłoszone).
2. Pobiera je po kolei z odstępem `throttleMs` (domyślnie 1000 ms).
3. Zapisuje każdy wynik od razu (upsert), więc przerwana partia nie traci postępu.
4. Błąd HTTP / timeout → przerywa partię (nie zasypujemy API) i zwraca `{stopped: true, error}`.
   Niepoprawna odpowiedź dla jednego losowania → log i pominięcie (bez wiersza, więc wróci przy następnej partii).
5. Czyści cache odpowiedzi (`invalidateCache()`) po pierwszym nowym wierszu `ok`, potem co 50 i na końcu partii —
   ostatnie losowanie pokazuje wygrane od razu, a nie dopiero po godzinnym dociąganiu historii.
6. Zwraca `{checked, ok, empty, skipped, stopped}`. Bez `LOTTO_API_KEY` nic nie pobiera i zwraca `{disabled: true}`
   (lokalny dev bez klucza nie spamuje logów).

Opcje wstrzykiwane w testach: `fetchPrizesFn`, `sleep`, `now`, `throttleMs`, `limit` (domyślnie bez limitu).

### Kiedy się uruchamia (`scheduler.js` + `server.js`)

Wspólna blokada partii (flaga jak `cycleRunning`) — nigdy dwie partie naraz; partia wyzwolona w trakcie innej
jest pomijana z logiem (`{busy: true}`).

Każde wyzwolenie uruchamia `runPrizeSync`: partia, a jeśli partia się przerwała (`stopped`), była pominięta (`busy`)
albo najnowsze losowanie wciąż ma status `pending` — ponowienie co `prizeFollowUpIntervalMinutes` (30) do
`prizeFollowUpAttempts` (6) razy. `disabled` kończy od razu. Wyzwolenia:

- **Start serwera** (gdy scheduler włączony). Pierwszy start po deployu dociąga całą historię
  (~2 360 losowań, ok. 40–60 min), zaczynając od najnowszych; pojedynczy 403 nie zatrzymuje jej na dni.
- **Po udanym cyklu pobrania wyników** (`added > 0`).
- **Codziennie o `prizeSyncHour` (12:00)**: osobny cron `lotek-prizes` jako siatka bezpieczeństwa.

Nowe klucze w `config/schedule.json`: `prizeSyncHour`, `prizeFollowUpIntervalMinutes`, `prizeFollowUpAttempts`,
`prizeThrottleMs`.

## API

### `prizes` w `/api/draws/latest` i `/api/draws/:nr`

```json
"prizes": {
  "status": "ok",
  "tiers": [
    { "hits": 6, "winners": 1, "amount": 44794855.0 },
    { "hits": 5, "winners": 107, "amount": 8874.0 },
    { "hits": 4, "winners": 6221, "amount": 200.7 },
    { "hits": 3, "winners": 110146, "amount": 35.0 }
  ]
}
```

- `ok` — jest wiersz `ok`; kwoty w złotych.
- `pending` — losowanie ≥ 5048 bez wiersza `ok`, a nie spełnia warunku `unavailable`.
- `unavailable` — losowanie < 5048, albo wiersz `empty` dla losowania starszego niż 7 dni.

`draws:latest` jest cache'owane; świeże wygrane pojawiają się dzięki `invalidateCache()` w `syncPrizes`.

### `GET /api/stats/prizes` (cache `stats:prizes`)

```json
{
  "coverage": { "fromDrawNumber": 5048, "fromDate": "2011-08-25", "draws": 2360 },
  "records": {
    "topJackpot":  { "value": 0, "draws": [{ "drawNumber": 0, "date": "", "numbers": [], "winners": 0, "amount": 0 }] },
    "mostSixes":   { "value": 0, "draws": [] },
    "maxFive":     { "value": 0, "draws": [] },
    "maxFour":     { "value": 0, "draws": [] },
    "mostThrees":  { "value": 0, "draws": [] }
  },
  "threeAmount": [{ "drawNumber": 5048, "date": "2011-08-25", "amount": 20.0 }]
}
```

- Kształt rekordów jak w `/api/stats/records` (`value` + remisy w `draws`).
- `topJackpot` = najwyższa kwota jednej wygranej za szóstkę (tylko losowania z ≥ 1 zwycięzcą);
  `mostSixes` = najwięcej zwycięzców szóstki; `maxFive`/`maxFour` = najwyższa kwota jednej wygranej;
  `mostThrees` = najwięcej wygranych trójek.
- `threeAmount` = pierwsze losowanie z danymi, każde losowanie, w którym kwota za trójkę zmieniła się
  względem poprzedniego, i ostatnie losowanie (żeby schodek sięgał dziś).
- Brak jakichkolwiek wierszy `ok` → `coverage: null`, `records: null`, `threeAmount: []` (sekcja pokazuje komunikat).

## Interfejs

### Komponent `src/components/prizes.js` — `createPrizesCard(prizes)`

Karta z nagłówkiem „Wygrane” i czterema wierszami: „6 trafień · 1 wygrana · 44 794 855,00 zł”
(`formatInt`, `pluralPl` wygrana/wygrane/wygranych, `formatPln`). Szóstka z 0 zwycięzców: „brak — kumulacja”.
Stany: `pending` → „Wygrane pojawią się, gdy Totalizator je ogłosi.”; `unavailable` → „Totalizator udostępnia
wygrane od 25.08.2011.”; brak pola `prizes` → karta się nie renderuje.

- Strona główna (`hero.js`): pod werdyktem, przed odliczaniem.
- Strona losowania (`draw-detail.js`): pod werdyktem, przed blokiem sumy.

### Statystyki — sekcja 08 „Wygrane od 2011” (`src/components/stats/prizes-section.js`)

- Nowy slot w `views/stats.js` z własnym ładowaniem i błędem; `getPrizesStats` w `api.js`.
- Nagłówek strony: „Siedem sposobów…” → „Osiem sposobów…” (i komentarze o siedmiu sekcjach).
- Pięć kart w stylu `records-section.js` (link do losowania + kule): rekordowa wygrana za szóstkę,
  najwięcej szóstek w jednym losowaniu, najwyższa kwota za piątkę, najwyższa kwota za czwórkę,
  najwięcej trójek w jednym losowaniu.
- Schodkowy wykres kwoty za trójkę (ECharts, `step: 'end'`, ładowany jak inne wykresy) + `tableView`
  z listą zmian. Opis pod wykresem ustalany po zobaczeniu prawdziwych danych.

## Testy (Vitest, bez sieci)

- Provider: fixture 7407 → poprawne stopnie i grosze; `prizesEmpty` → `empty`; 404 → `empty`; 403 → wyjątek;
  brak elementu `Lotto`, zły `drawSystemId`, ujemne/niecałkowite wartości → wyjątek; brak klucza → wyjątek.
- `syncPrizes`: kolejność od najnowszego, próg 5048, ponowne sprawdzanie `empty` tylko do 7 dni, przerwanie na
  błędzie HTTP z zachowaniem zapisanego postępu, pominięcie złej odpowiedzi, `invalidateCache` tylko przy nowych `ok`,
  odstęp przez wstrzyknięty `sleep`.
- Scheduler: cron `lotek-prizes`, blokada przed równoległą partią, ponowienia po cyklu wyników.
- API (supertest): trzy stany `prizes` w `latest` i `:nr`; `/api/stats/prizes` — rekordy z remisami, schodki,
  pusta baza.
- Komponenty (jsdom): karta w trzech stanach i z kumulacją; sekcja statystyk z danymi i bez.

## Wdrożenie i weryfikacja

Push na master (bramka testów → deploy). Po deployu:

1. `docker inspect` — wolumen na `/app/data`; liczba losowań i ostatnie losowanie takie jak przed deployem.
2. Kontener `db-backup` dalej widzi `/mnt/lotek/lotek.db`.
3. `/api/draws/7407` ma `prizes.status = 'ok'` z kwotami jak wyżej.
4. Postęp dociągania historii (`SELECT status, COUNT(*) FROM draw_prize GROUP BY status`) aż do ~2 360.
5. Sekcja „Wygrane od 2011” na żywej stronie; potem dopisanie opisu wykresu trójki.
6. Aktualizacja skilla `daimon` (ścieżka `/app/data`, nowy cron).

## Poza zakresem

Lotto Plus, kumulacja następnego losowania (`/info/game-jackpot`), przeliczanie trafień Typera na złotówki.
