import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../../errors.js';
import { fixture } from './__fixtures__/load.js';
import { convertHtml } from './html.js';

describe('convertHtml', () => {
  it('extracts the main article, drops boilerplate, and keeps tables as GFM', () => {
    const result = convertHtml(fixture('article.html'), 'sunken-court.html');
    expect(result.format).toBe('html');
    expect(result.mediaType).toBe('text/html');
    expect(result.entries[0]?.title).toBe('The Sunken Court');
    const markdown = result.entries[0]?.markdown ?? '';
    expect(markdown).toContain('Beneath the Glass Marsh');
    expect(markdown).toContain('| Office | Duty |');
    expect(markdown).toContain('Tidewarden');
    // Navigation and scripts are removed.
    expect(markdown).not.toContain('window.analytics');
    expect(markdown).not.toContain('/factions');
    expect(result.conversionNotes[0]).toMatch(/main article content/u);
  });

  it('wraps a bodyless fragment and strips scripts', () => {
    const result = convertHtml(fixture('fragment.html'), 'field-note.html');
    const markdown = result.entries[0]?.markdown ?? '';
    expect(result.entries[0]?.title).toBe('Field Note: Reed Wardens');
    expect(markdown).toContain('patrol the causeways at dusk');
    expect(markdown).not.toContain('should be stripped');
  });

  it('falls back to the full body when the main content cannot be isolated', () => {
    const result = convertHtml(fixture('image-plates.html'), 'plates.html');
    const markdown = result.entries[0]?.markdown ?? '';
    expect(result.entries[0]?.title).toBe('Marsh Atlas Plates');
    expect(markdown).toContain('Map of the Glass Marsh fenlands');
    expect(result.conversionNotes[0]).toMatch(/full page body/u);
  });

  it('rejects HTML with no readable content', () => {
    expect(() => convertHtml(Buffer.from('<html><body></body></html>'), 'blank.html')).toThrow(
      InvalidImportError,
    );
  });
});
