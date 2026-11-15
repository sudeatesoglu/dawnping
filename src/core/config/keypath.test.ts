import { describe, expect, it } from 'vitest';
import {
  coerceValue,
  displayValue,
  flatten,
  getAt,
  parseKeyPath,
  setAt,
  splitList,
  unsetAt,
} from './keypath.ts';

describe('parseKeyPath', () => {
  it('splits on dots', () => {
    expect(parseKeyPath('profiles.default.work')).toEqual(['profiles', 'default', 'work']);
  });

  it.each(['', 'a..b', '.a', '__proto__', 'profiles.__proto__.x'])('rejects %j', (key) => {
    expect(parseKeyPath(key)).toBeUndefined();
  });

  it('allows names that are only dangerous as assignments, like constructor', () => {
    expect(parseKeyPath('profiles.constructor.work')).toEqual(['profiles', 'constructor', 'work']);
  });
});

describe('getAt / setAt / unsetAt', () => {
  const root = { a: { b: 1, list: [1, 2] }, c: 'x' };

  it('reads nested values and own keys only', () => {
    expect(getAt(root, ['a', 'b'])).toBe(1);
    expect(getAt(root, ['a', 'missing'])).toBeUndefined();
    expect(getAt(root, ['a', 'list', '0'])).toBeUndefined();
    expect(getAt(root, ['a', 'toString'])).toBeUndefined();
  });

  it('sets values without mutating the input', () => {
    const updated = setAt(root, ['a', 'b'], 2);
    expect(updated).toEqual({ a: { b: 2, list: [1, 2] }, c: 'x' });
    expect(root.a.b).toBe(1);
    expect(setAt(root, ['new', 'deep'], true)).toMatchObject({ new: { deep: true } });
    expect(setAt(root, ['c', 'x'], 1)).toMatchObject({ c: { x: 1 } });
  });

  it('removes values without mutating the input', () => {
    expect(unsetAt(root, ['a', 'b'])).toEqual({ a: { list: [1, 2] }, c: 'x' });
    expect(root.a.b).toBe(1);
    expect(unsetAt(root, ['c'])).toEqual({ a: root.a });
  });

  it('keeps objects left empty unless asked to prune them', () => {
    const root = { ping: { model: 'x' }, v: 1 };
    expect(unsetAt(root, ['ping', 'model'])).toEqual({ ping: {}, v: 1 });
    expect(unsetAt(root, ['ping', 'model'], { pruneEmpty: true })).toEqual({ v: 1 });
  });

  it('reports a missing value when removing', () => {
    expect(unsetAt(root, ['nope'])).toBeUndefined();
    expect(unsetAt(root, ['a', 'nope'])).toBeUndefined();
    expect(unsetAt(root, ['c', 'x'])).toBeUndefined();
  });

  it('rejects an empty path when setting', () => {
    expect(() => setAt(root, [], 1)).toThrow('Empty key path');
  });
});

describe('splitList', () => {
  it('trims, drops empty items and duplicates', () => {
    expect(splitList(' fri, fri ,,sat')).toEqual(['fri', 'sat']);
    expect(splitList('')).toEqual([]);
  });
});

describe('coerceValue', () => {
  it('follows the kind of the setting', () => {
    expect(coerceValue('a, b,,c', 'list')).toEqual(['a', 'b', 'c']);
    expect(coerceValue('2', 'number')).toBe(2);
    expect(coerceValue('two', 'number')).toBe('two');
    expect(coerceValue(' ', 'number')).toBe(' ');
    expect(coerceValue('false', 'boolean')).toBe(false);
    expect(coerceValue('maybe', 'boolean')).toBe('maybe');
    expect(coerceValue('Europe/Istanbul', 'text')).toBe('Europe/Istanbul');
    expect(coerceValue('x', undefined)).toBe('x');
  });
});

describe('displayValue and flatten', () => {
  it('shows string lists comma-separated and others as JSON', () => {
    expect(displayValue(['mon', 'tue'])).toBe('mon,tue');
    expect(displayValue([])).toBe('(none)');
    expect(displayValue([1, 2])).toBe('[1,2]');
    expect(displayValue(1)).toBe('1');
    expect(displayValue('x')).toBe('x');
  });

  it('lists leaves with their paths, keeping empty objects', () => {
    expect(flatten({ a: { b: 1 }, c: [], d: {} })).toEqual([
      [['a', 'b'], 1],
      [['c'], []],
      [['d'], {}],
    ]);
  });
});
