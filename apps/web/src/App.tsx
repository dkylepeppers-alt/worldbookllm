import '@fontsource-variable/archivo/wght.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';

import './styles.css';

import { AgentChatRoute } from './agent/AgentChatPage.js';
import { AgentPage } from './agent/AgentPage.js';
import { AgentsPage } from './agents/AgentsPage.js';
import { ApiProvider } from './api/ApiContext.js';
import { createApiClient, type ApiClient } from './api/client.js';
import { BiblePage } from './books/BiblePage.js';
import { BookFilePage } from './books/BookFilePage.js';
import { BookLayout } from './books/BookLayout.js';
import { BookLibraryPage } from './books/BookLibraryPage.js';
import { HealthPage } from './books/HealthPage.js';
import { ProjectPage } from './books/ProjectPage.js';
import { WritePage } from './books/WritePage.js';
import { AppShell } from './layout/AppShell.js';
import { NotebookListPage } from './notebooks/NotebookListPage.js';
import { NotebookWorkspace, ReaderEmpty } from './notebooks/NotebookWorkspace.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PresetSchemaPage } from './pages/PresetSchemaPage.js';
import { PresetsPage } from './presets/PresetsPage.js';
import { PwaStatusBanner } from './pwa/PwaStatusBanner.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { SkillsPage } from './skills/SkillsPage.js';
import { ReaderRoute } from './sources/ReaderRoute.js';

function KeyedReaderRoute() {
  const { sourceId } = useParams();
  return <ReaderRoute key={sourceId} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<NotebookListPage />} />
        <Route path="notebooks/:notebookId" element={<NotebookWorkspace />}>
          <Route index element={<ReaderEmpty />} />
          <Route path="sources/:sourceId" element={<KeyedReaderRoute />} />
        </Route>
        <Route path="books" element={<BookLibraryPage />} />
        <Route path="books/:slug" element={<BookLayout />}>
          <Route index element={<Navigate to="write" replace />} />
          <Route path="write" element={<WritePage />} />
          <Route path="bible" element={<BiblePage />} />
          <Route path="agent" element={<AgentPage />} />
          <Route path="agent/:chatId" element={<AgentChatRoute />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="project" element={<ProjectPage />} />
          <Route path="files/*" element={<BookFilePage />} />
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="presets" element={<PresetsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="preset-schema" element={<PresetSchemaPage />} />
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
        <PwaStatusBanner />
      </BrowserRouter>
    </ApiProvider>
  );
}
