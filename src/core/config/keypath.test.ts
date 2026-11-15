import { describe, expect, it } from 'vitest';
import {
  coerceValue,
  displayValue,
  flatten,
  getAt,
  parseKeyPath,
  setAt,
  unsetAt,
} from './keypath.ts';

describe('parseKeyPath', () => {
  it('splits on dots', () => {
    expect(parseKeyPath('profiles.default.work')).toEqual(['profiles', 'default', 'work']);
  });

  it.each(['', 'a..b', '.a', '__proto__', 'a.constructor', 'prototype.x'])('rejects %j', (key) => {
    expect(parseKeyPath(key)).toBeUndefined();
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

  it('removes objects left empty', () => {
    expect(unsetAt({ ping: { model: 'x' }, v: 1 }, ['ping', 'model'])).toEqual({ v: 1 });
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

describe('coerceValue', () => {
  it('follows the type of the current value', () => {
    expect(coerceValue('a, b,,c', ['x'])).toEqual(['a', 'b', 'c']);
    expect(coerceValue('', [])).toEqual([]);
    expect(coerceValue('2', 1)).toBe(2);
    expect(coerceValue('two', 1)).toBe('two');
    expect(coerceValue('false', true)).toBe(false);
    expect(coerceValue('maybe', true)).toBe('maybe');
    expect(coerceValue('Europe/Istanbul', undefined)).toBe('Europe/Istanbul');
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
