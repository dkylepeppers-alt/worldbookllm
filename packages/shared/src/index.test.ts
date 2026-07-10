import { describe, expect, it } from 'vitest';

import { APP_NAME } from './index.js';

describe('shared barrel', () => {
  it('exports the app name', () => {
    expect(APP_NAME).toBe('worldbookllm');
  });
});
