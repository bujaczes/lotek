import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile, loadPrizes } from '../src/server/lib/config.js';

describe('loadPrizes() — reads config/prizes.json per CONVENTIONS', () => {
  it('returns the exact prize table keyed by hit count, plus betPrice', () => {
    const prizes = loadPrizes();
    expect(prizes).toEqual({ 6: 2000000, 5: 6000, 4: 200, 3: 24, betPrice: 3.0 });
  });
});

describe('loadConfigFile(path) — fail-loud config reader', () => {
  let dir;

  it('throws a clear error when the file does not exist', () => {
    expect(() => loadConfigFile('/definitely/not/a/real/path/prizes.json')).toThrow(/not found|ENOENT/i);
  });

  it('throws a clear error when the file is not valid JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'lotek-config-test-'));
    const badPath = join(dir, 'bad.json');
    writeFileSync(badPath, '{ not valid json ]');
    try {
      expect(() => loadConfigFile(badPath)).toThrow(/JSON/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses well-formed JSON correctly', () => {
    dir = mkdtempSync(join(tmpdir(), 'lotek-config-test-'));
    const goodPath = join(dir, 'good.json');
    writeFileSync(goodPath, JSON.stringify({ a: 1, b: 'two' }));
    try {
      expect(loadConfigFile(goodPath)).toEqual({ a: 1, b: 'two' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
