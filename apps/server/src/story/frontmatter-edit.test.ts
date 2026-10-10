import { describe, expect, it } from 'vitest';

import { removeSeriesLinks, setFrontmatterField } from './frontmatter-edit.js';

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

  it('replaces a value wrapped onto indented lines, and adds after one', () => {
    const before = '---\ntitle: A long title\n  that wraps\nthemes:\n  - tide\n---\nBody';
    expect(setFrontmatterField(before, 'title', '"Short"')).toBe(
      '---\ntitle: "Short"\nthemes:\n  - tide\n---\nBody',
    );
    expect(setFrontmatterField(before, 'ifid', 'X')).toBe(
      '---\ntitle: A long title\n  that wraps\nifid: X\nthemes:\n  - tide\n---\nBody',
    );
    expect(setFrontmatterField('---\nthemes:\n- tide\ngenre: x\n---\n', 'themes', 'none')).toBe(
      '---\nthemes: none\ngenre: x\n---\n',
    );
  });
});

describe('removeSeriesLinks', () => {
  it('leaves a file with no series metadata exactly as written', () => {
    const story =
      '---\ntitle: Harbor # the working title\nstarted: 2026-01-05\nnote: "yes"\n---\nBody\n';
    expect(removeSeriesLinks(story)).toBe(story);
    expect(removeSeriesLinks(story, 'other')).toBe(story);
  });

  it('does not wrap long values when it rewrites', () => {
    const title =
      'A title long enough that a YAML dump would wrap it onto a second line if allowed to';
    const out = removeSeriesLinks(`---\ntitle: ${title}\nseries: tides\n---\nBody\n`);
    expect(out).toContain(`title: ${title}\n`);
    expect(out).not.toContain('series');
  });
});
