import { describe, expect, it } from 'vitest';
import { plural } from './text';

describe('plural', () => {
  it('never says "1 facts"', () => {
    expect(plural(1, 'fact')).toBe('1 fact');
    expect(plural(0, 'fact')).toBe('0 facts');
    expect(plural(3, 'fact')).toBe('3 facts');
    expect(plural(1200, 'post')).toBe('1,200 posts');
    expect(plural(2, 'more post')).toBe('2 more posts');
  });
});
