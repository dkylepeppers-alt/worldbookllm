import { type PropsWithChildren } from 'react';

import type { ApiClient } from './client.js';
import { ApiContext } from './api-context.js';

interface ApiProviderProps extends PropsWithChildren {
  client: ApiClient;
}

export function ApiProvider({ children, client }: ApiProviderProps) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
