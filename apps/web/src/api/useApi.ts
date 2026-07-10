import { useContext } from 'react';

import { ApiContext } from './api-context.js';
import type { ApiClient } from './client.js';

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === null) throw new Error('useApi must be used inside ApiProvider');
  return client;
}
