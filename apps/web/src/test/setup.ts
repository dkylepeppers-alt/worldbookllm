import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Drafts persist in localStorage; each test starts without any.
  localStorage.clear();
});
