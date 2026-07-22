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

  if (cfg.popularity === null || typeof cfg.popularity !== 'object') {
    throw new Error('config/typer.json: "popularity" must be an object (Task-15 stub, may be {})');
  }

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
