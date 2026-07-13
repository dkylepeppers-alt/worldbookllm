import '@fontsource-variable/archivo/wght.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import './styles.css';

import { ApiProvider } from './api/ApiContext.js';
import { createApiClient, type ApiClient } from './api/client.js';
import { AppShell } from './layout/AppShell.js';
import { NotebookListPage } from './notebooks/NotebookListPage.js';
import { NotebookWorkspace, ReaderEmpty } from './notebooks/NotebookWorkspace.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { ReaderRoute } from './sources/ReaderRoute.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<NotebookListPage />} />
        <Route path="notebooks/:notebookId" element={<NotebookWorkspace />}>
          <Route index element={<ReaderEmpty />} />
          <Route path="sources/:sourceId" element={<ReaderRoute />} />
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

interface AppProps {
  client?: ApiClient;
}

export function App({ client = createApiClient() }: AppProps) {
  return (
    <ApiProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ApiProvider>
  );
}
