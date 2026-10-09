import '@fontsource-variable/source-serif-4/opsz.css';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

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
import { BranchesPage } from './books/BranchesPage.js';
import { HealthPage } from './books/HealthPage.js';
import { PlayPage } from './books/PlayPage.js';
import { ProjectPage } from './books/ProjectPage.js';
import { ReaderPage } from './books/ReaderPage.js';
import { SeriesPage } from './books/SeriesPage.js';
import { WritePage } from './books/WritePage.js';
import { AppShell } from './layout/AppShell.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PwaStatusBanner } from './pwa/PwaStatusBanner.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { SkillsPage } from './skills/SkillsPage.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/books" replace />} />
        <Route path="books" element={<BookLibraryPage />} />
        <Route path="series/:id" element={<SeriesPage />} />
        <Route path="books/:slug" element={<BookLayout />}>
          <Route index element={<Navigate to="write" replace />} />
          <Route path="write" element={<WritePage />} />
          <Route path="write/branches" element={<BranchesPage />} />
          <Route path="write/play" element={<PlayPage />} />
          <Route path="bible" element={<BiblePage />} />
          <Route path="agent" element={<AgentPage />} />
          <Route path="agent/:chatId" element={<AgentChatRoute />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="project" element={<ProjectPage />} />
          <Route path="read" element={<ReaderPage />} />
          <Route path="files/*" element={<BookFilePage />} />
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="agents" element={<AgentsPage />} />
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
