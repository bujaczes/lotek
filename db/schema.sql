CREATE TABLE IF NOT EXISTS draw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_type TEXT NOT NULL DEFAULT 'lotto' CHECK (game_type IN ('lotto', 'lotto_plus')),
  draw_number INTEGER NOT NULL,
  drawn_at TEXT NOT NULL,
  n1 INTEGER NOT NULL CHECK (n1 BETWEEN 1 AND 49),
  n2 INTEGER NOT NULL CHECK (n2 BETWEEN 1 AND 49),
  n3 INTEGER NOT NULL CHECK (n3 BETWEEN 1 AND 49),
  n4 INTEGER NOT NULL CHECK (n4 BETWEEN 1 AND 49),
  n5 INTEGER NOT NULL CHECK (n5 BETWEEN 1 AND 49),
  n6 INTEGER NOT NULL CHECK (n6 BETWEEN 1 AND 49),
  mask INTEGER NOT NULL,
  sum_numbers INTEGER GENERATED ALWAYS AS (n1 + n2 + n3 + n4 + n5 + n6) STORED,
  source TEXT NOT NULL CHECK (source IN ('mbnet', 'openapi', 'lottopl', 'manual')),
  created_at INTEGER NOT NULL,
  CHECK (n1 < n2 AND n2 < n3 AND n3 < n4 AND n4 < n5 AND n5 < n6),
  UNIQUE (game_type, draw_number)
);

CREATE INDEX IF NOT EXISTS idx_draw_game_type_mask ON draw (game_type, mask);
CREATE INDEX IF NOT EXISTS idx_draw_game_type_drawn_at ON draw (game_type, drawn_at);

CREATE TABLE IF NOT EXISTS number_stat (
  game_type TEXT NOT NULL,
  number INTEGER NOT NULL,
  total_count INTEGER,
  count_last50 INTEGER,
  count_last100 INTEGER,
  count_last300 INTEGER,
  decayed_count REAL,
  z_score REAL,
  last_drawn_at TEXT,
  last_draw_number INTEGER,
  current_gap INTEGER,
  max_gap INTEGER,
  max_gap_ended_at TEXT,
  avg_gap REAL,
  longest_streak INTEGER,
  year_counts TEXT,
  PRIMARY KEY (game_type, number)
);

CREATE TABLE IF NOT EXISTS pair_stat (
  game_type TEXT NOT NULL,
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  cnt INTEGER,
  expected REAL,
  lift REAL,
  PRIMARY KEY (game_type, a, b)
);

CREATE TABLE IF NOT EXISTS prediction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  for_draw_number INTEGER NOT NULL UNIQUE,
  numbers TEXT NOT NULL,
  mask INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  bias_score REAL,
  popularity_score REAL,
  total_score REAL,
  alternatives TEXT,
  commentary TEXT,
  created_at INTEGER NOT NULL,
  result_draw_id INTEGER NULL REFERENCES draw (id),
  hits INTEGER NULL,
  prize_tier INTEGER NULL
);

CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  draws_added INTEGER,
  last_draw_number INTEGER,
  status TEXT CHECK (status IN ('ok', 'partial', 'failed')),
  message TEXT
);
