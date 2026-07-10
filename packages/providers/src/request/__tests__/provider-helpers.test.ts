import { describe, expect, it } from 'vitest';

import { ProviderError } from '../../types.js';
import {
  chatCompletionsUrl,
  compactObject,
  extraBoolean,
  extraString,
  requireApiKey,
} from '../provider-helpers.js';

describe('provider request helpers', () => {
  it('normalizes chat completion URLs without duplicating the suffix', () => {
    expect(chatCompletionsUrl('https://example.test/v1/')).toBe(
      'https://example.test/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://example.test/v1/chat/completions')).toBe(
      'https://example.test/v1/chat/completions',
    );
  });

  it('omits only undefined values', () => {
    expect(compactObject({ zero: 0, no: false, empty: '', absent: undefined })).toEqual({
      zero: 0,
      no: false,
      empty: '',
    });
  });

  it('reads trimmed string and boolean extras', () => {
    expect(extraString({ region: ' global ' }, 'region')).toBe('global');
    expect(extraString({ region: '   ' }, 'region')).toBeUndefined();
    expect(extraBoolean({ enabled: true }, 'enabled')).toBe(true);
    expect(extraBoolean({ enabled: 'true' }, 'enabled')).toBeUndefined();
  });

  it('returns an injected API key without altering it', () => {
    expect(requireApiKey('claude', ' secret ')).toBe(' secret ');
  });

  it('reports the provider when an API key is absent', () => {
    expect(() => requireApiKey('claude', undefined)).toThrow(
      new ProviderError('Anthropic Claude requires an API key.', 'claude'),
    );
  });
});
