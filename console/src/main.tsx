import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';

const DashboardWrapper = lazy(() => import('./pages/DashboardWrapper'));
const ObservabilityPage = lazy(() => import('./pages/ObservabilityPage'));
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));
const TracesPage = lazy(() => import('./pages/TracesPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const StudioHomePage = lazy(() => import('./pages/studio/StudioHomePage'));
const ProjectPage = lazy(() => import('./pages/studio/ProjectPage'));
const ProvidersPage = lazy(() => import('./pages/studio/ProvidersPage'));
const TeamBuilderPage = lazy(() => import('./pages/studio/TeamBuilderPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin"
          role="status"
          aria-label="Loading"
        />
        <span className="text-sm text-[#525252]">Loading...</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardWrapper />} />
            <Route path="/dashboard" element={<ObservabilityPage />} />
            <Route path="/traces" element={<TracesPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/feedbacks" element={<PlaceholderPage title="Feedbacks" description="Manage user feedback" />} />
            <Route path="/alerts" element={<PlaceholderPage title="Alerts" description="Configure and manage alerts" />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/rag" element={<PlaceholderPage title="RAG" description="Retrieval Augmented Generation" />} />
            <Route path="/prompts" element={<PlaceholderPage title="Prompts" description="Prompt template management" />} />
            <Route path="/triggers" element={<PlaceholderPage title="Triggers" description="Event triggers and automation" />} />
            <Route path="/studio" element={<StudioHomePage />} />
            <Route path="/studio/teams" element={<TeamBuilderPage />} />
            <Route path="/studio/providers" element={<ProvidersPage />} />
            <Route path="/studio/:projectId" element={<ProjectPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
