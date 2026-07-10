import { createContext } from 'react';

import type { ApiClient } from './client.js';

export const ApiContext = createContext<ApiClient | null>(null);
