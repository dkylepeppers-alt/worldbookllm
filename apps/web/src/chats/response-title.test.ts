import { describe, expect, it } from 'vitest';

import { deriveResponseTitle } from './response-title.js';

describe('deriveResponseTitle', () => {
  it('uses the first nonempty ATX heading and strips its markers', () => {
    expect(deriveResponseTitle('\n##   The Brass Coast ###\n\nBody')).toBe('The Brass Coast');
  });

  it('falls back to the first meaningful line with simple Markdown punctuation stripped', () => {
    expect(deriveResponseTitle('\n***A charted answer.***\n\nMore')).toBe('A charted answer.');
    expect(deriveResponseTitle('\n- **[Brass Coast](https://example.test)**')).toBe('Brass Coast');
  });

  it('does not strip a heading hash that is part of the title', () => {
    expect(deriveResponseTitle('# Notes in C#')).toBe('Notes in C#');
  });

  it('trims and caps titles at 300 characters', () => {
    expect(deriveResponseTitle(`# ${'A'.repeat(320)}   `)).toBe('A'.repeat(300));
  });

  it('uses a stable fallback when no meaningful line remains', () => {
    expect(deriveResponseTitle('\n  ***  \n---\n')).toBe('Assistant response');
  });
});
