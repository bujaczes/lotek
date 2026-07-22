import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTyperConfig, validateTyperConfig } from '../src/server/lib/typer/config.js';

describe('loadTyperConfig() — reads config/typer.json with validation', () => {
  it('returns the committed config with all required fields', () => {
    const cfg = loadTyperConfig();
    expect(cfg.modelVersion).toBe('1.0.0');
    expect(cfg.halfLifeDraws).toBe(300);
    expect(cfg.priorStrengthDraws).toBe(780);
    expect(cfg.chi2Alpha).toBe(0.05);
    expect(cfg.weights).toEqual({ wA: 1.0, wB: 1.0 });
    // popularity is a Task-15 stub but must be present and be an object so config loads now.
    expect(typeof cfg.popularity).toBe('object');
    expect(cfg.popularity).not.toBeNull();
  });
});

describe('validateTyperConfig() — fail loud on malformed config', () => {
  const base = () => ({
    modelVersion: '1.0.0',
    halfLifeDraws: 300,
    priorStrengthDraws: 780,
    chi2Alpha: 0.05,
    weights: { wA: 1.0, wB: 1.0 },
    popularity: {},
  });

  it('accepts a well-formed config and returns it', () => {
    const cfg = base();
    expect(validateTyperConfig(cfg)).toEqual(cfg);
  });

  it('throws when a top-level key is missing', () => {
    const cfg = base();
    delete cfg.halfLifeDraws;
    expect(() => validateTyperConfig(cfg)).toThrow(/halfLifeDraws/);
  });

  it('throws when weights is missing wA or wB', () => {
    const cfg = base();
    cfg.weights = { wA: 1.0 };
    expect(() => validateTyperConfig(cfg)).toThrow(/wB/);
  });

  it('throws when halfLifeDraws is not a positive number', () => {
    const cfg = base();
    cfg.halfLifeDraws = 0;
    expect(() => validateTyperConfig(cfg)).toThrow(/halfLifeDraws/);
  });

  it('throws when priorStrengthDraws is negative', () => {
    const cfg = base();
    cfg.priorStrengthDraws = -1;
    expect(() => validateTyperConfig(cfg)).toThrow(/priorStrengthDraws/);
  });

  it('throws when chi2Alpha is outside (0,1)', () => {
    const cfg = base();
    cfg.chi2Alpha = 1.5;
    expect(() => validateTyperConfig(cfg)).toThrow(/chi2Alpha/);
  });

  it('throws when popularity is missing', () => {
    const cfg = base();
    delete cfg.popularity;
    expect(() => validateTyperConfig(cfg)).toThrow(/popularity/);
  });

  it('loadTyperConfig throws a clear error for a malformed file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lotek-typer-cfg-'));
    const badPath = join(dir, 'typer.json');
    writeFileSync(badPath, JSON.stringify({ modelVersion: '1.0.0' }));
    try {
      expect(() => loadTyperConfig(badPath)).toThrow(/halfLifeDraws/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
