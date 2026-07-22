import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFile } from '../config.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/server/lib/typer -> up four levels to the project root, then into config/.
const DEFAULT_PATH = join(MODULE_DIR, '..', '..', '..', '..', 'config', 'typer.json');

function requirePositiveNumber(cfg, key) {
  const v = cfg[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`config/typer.json: "${key}" must be a positive finite number (got ${v})`);
  }
}

function requireFiniteNumber(obj, path, key) {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`config/typer.json: "${path}.${key}" must be a finite number (got ${v})`);
  }
}

// Multipliers that model "how popular is this number/pattern" must be >= 1 for a
// penalty (popular = bad = pushes score down) and >= 0 for a weight component. We only
// enforce finiteness + sign here; the exact calibration values are the model's choice.
const POPULARITY_NUMBER_KEYS = ['base', 'birthdayBonus', 'dayMonthBonus', 'highDiscount'];
const PENALTY_KEYS = [
  'run3',
  'runPerExtra',
  'line4plus',
  'allBirthday',
  'lowSum',
  'lowSumThreshold',
  'historicalWinner',
  'allHigh',
];

function validatePopularity(popularity) {
  if (popularity === null || typeof popularity !== 'object') {
    throw new Error('config/typer.json: "popularity" must be an object');
  }
  for (const key of POPULARITY_NUMBER_KEYS) {
    requireFiniteNumber(popularity, 'popularity', key);
  }
  if (popularity.luckyMultipliers === null || typeof popularity.luckyMultipliers !== 'object') {
    throw new Error('config/typer.json: "popularity.luckyMultipliers" must be an object keyed by number');
  }
  for (const [numKey, mult] of Object.entries(popularity.luckyMultipliers)) {
    const n = Number(numKey);
    if (!Number.isInteger(n) || n < 1 || n > 49) {
      throw new Error(`config/typer.json: "popularity.luckyMultipliers" key must be a number 1-49 (got "${numKey}")`);
    }
    if (typeof mult !== 'number' || !Number.isFinite(mult) || mult <= 0) {
      throw new Error(`config/typer.json: "popularity.luckyMultipliers.${numKey}" must be a positive finite number (got ${mult})`);
    }
  }
  const penalties = popularity.penalties;
  if (penalties === null || typeof penalties !== 'object') {
    throw new Error('config/typer.json: "popularity.penalties" must be an object');
  }
  for (const key of PENALTY_KEYS) {
    requireFiniteNumber(penalties, 'popularity.penalties', key);
  }
}

/**
 * Validates a parsed Typer config object, failing loud on anything the statistical core
 * relies on being present and sane. `popularity` is a Task-15 stub: it must exist and be
 * an object, but its contents are not constrained here. Returns the config on success.
 */
export function validateTyperConfig(cfg) {
  if (cfg === null || typeof cfg !== 'object') {
    throw new Error('config/typer.json: expected a JSON object');
  }
  if (typeof cfg.modelVersion !== 'string' || cfg.modelVersion.length === 0) {
    throw new Error('config/typer.json: "modelVersion" must be a non-empty string');
  }
  requirePositiveNumber(cfg, 'halfLifeDraws');

  // prior may legitimately be 0 (no prior); only reject negative / non-numeric.
  const prior = cfg.priorStrengthDraws;
  if (typeof prior !== 'number' || !Number.isFinite(prior) || prior < 0) {
    throw new Error(`config/typer.json: "priorStrengthDraws" must be a non-negative finite number (got ${prior})`);
  }

  const alpha = cfg.chi2Alpha;
  if (typeof alpha !== 'number' || !(alpha > 0 && alpha < 1)) {
    throw new Error(`config/typer.json: "chi2Alpha" must be a number in (0, 1) (got ${alpha})`);
  }

  if (cfg.weights === null || typeof cfg.weights !== 'object') {
    throw new Error('config/typer.json: "weights" must be an object with wA and wB');
  }
  for (const w of ['wA', 'wB']) {
    const v = cfg.weights[w];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`config/typer.json: "weights.${w}" must be a finite number (got ${v})`);
    }
  }

  validatePopularity(cfg.popularity);

  return cfg;
}

/**
 * Loads and validates config/typer.json — the single source of Typer parameters
 * (Determinizm Typera: wszystkie parametry z config/typer.json). Fails loud on a
 * missing/malformed file or any invalid field. `path` overridable for tests.
 */
export function loadTyperConfig(path = DEFAULT_PATH) {
  return validateTyperConfig(loadConfigFile(path));
}
