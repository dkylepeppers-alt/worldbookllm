import { startStubProvider } from './stub-provider/stub-provider.js';

// Boots the OpenAI-compatible stub once for the whole run. Worker processes
// inherit the runner's environment, so the dynamic URL travels via env.
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stub = await startStubProvider();
  process.env.E2E_STUB_URL = stub.url;
  return async () => {
    await stub.close();
  };
}
