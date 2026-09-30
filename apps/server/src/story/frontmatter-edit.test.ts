import { describe, expect, it } from 'vitest';

import { setFrontmatterField } from './frontmatter-edit.js';

describe('setFrontmatterField', () => {
  it('replaces an existing field and keeps every other line', () => {
    const before = '---\ntitle: Harbor\nseries: old\nthemes:\n  - tide\n---\n\n# Harbor\n';
    expect(setFrontmatterField(before, 'series', 'tides')).toBe(
      '---\ntitle: Harbor\nseries: tides\nthemes:\n  - tide\n---\n\n# Harbor\n',
    );
  });

  it('adds a missing field after the title', () => {
    expect(
      setFrontmatterField('---\ntitle: Harbor\ngenre: fiction\n---\nBody', 'series', 'tides'),
    ).toBe('---\ntitle: Harbor\nseries: tides\ngenre: fiction\n---\nBody');
  });

  it('adds frontmatter to a file without any', () => {
    expect(setFrontmatterField('# Harbor\n', 'series', 'tides')).toBe(
      '---\nseries: tides\n---\n\n# Harbor\n',
    );
  });

  it('does not match a key that only starts with the name', () => {
    expect(setFrontmatterField('---\nseries-title: X\n---\n', 'series', 'tides')).toBe(
      '---\nseries-title: X\nseries: tides\n---\n',
    );
  });
});
