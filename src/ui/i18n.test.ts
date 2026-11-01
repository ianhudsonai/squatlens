import { describe, expect, it } from 'vitest';
import { fmt, LANG_STORAGE_KEY, loadLang, saveLang, STRINGS } from './i18n';

function memoryStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('i18n', () => {
  it('defaults to pt-BR and ignores unknown stored values', () => {
    expect(loadLang(memoryStorage())).toBe('pt-BR');
    expect(loadLang(memoryStorage({ [LANG_STORAGE_KEY]: 'fr' }))).toBe('pt-BR');
    expect(loadLang(null)).toBe('pt-BR');
  });

  it('round-trips the chosen language', () => {
    const st = memoryStorage();
    saveLang('en', st);
    expect(loadLang(st)).toBe('en');
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadLang(broken)).toBe('pt-BR');
    expect(() => saveLang('en', broken)).not.toThrow();
  });

  it('formats numbers with the language decimal separator', () => {
    expect(fmt(1.25, 1, STRINGS['pt-BR'])).toBe('1,3');
    expect(fmt(1.25, 1, STRINGS.en)).toBe('1.3');
    expect(fmt(-0.004, 0, STRINGS.en)).toBe('0');
    expect(fmt(-0.04, 1, STRINGS['pt-BR'])).toBe('0,0');
    expect(fmt(-2, 0, STRINGS.en)).toBe('-2');
  });

  it('both languages define the same keys', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS['pt-BR']).sort());
  });
});
