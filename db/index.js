import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { popcount } from '../src/server/lib/mask.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(MODULE_DIR, 'schema.sql');

export function openDatabase(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.function('bit_count', { deterministic: true }, popcount);
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}
