# LOTEK

Agregator wyników Lotto 6/49 (PL) — statystyki historyczne i deterministyczny "Typer".

## Setup (dev)

```bash
npm install
npm run dev
```

- API: http://localhost:3005 (health: `GET /api/health`)
- Front (Vite): http://localhost:5177 (proxy `/api` → API)

## Inne komendy

```bash
npm test          # testy (vitest run)
npm run test:watch
npm run build      # build frontu do dist/
npm start           # produkcyjny bootstrap (node server.js)
```

## Konfiguracja

- `PORT` — port API (domyślnie 3005)
- `DB_PATH` — ścieżka do pliku SQLite (domyślnie `db/lotek.db`)
