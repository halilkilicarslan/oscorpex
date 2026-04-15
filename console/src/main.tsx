import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { PlannerChatProvider } from './contexts/PlannerChatContext';

const DashboardWrapper = lazy(() => import('./pages/DashboardWrapper'));
const ObservabilityPage = lazy(() => import('./pages/ObservabilityPage'));
const TracesPage = lazy(() => import('./pages/TracesPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const StudioHomePage = lazy(() => import('./pages/studio/StudioHomePage'));
const ProjectPage = lazy(() => import('./pages/studio/ProjectPage'));
const ProvidersPage = lazy(() => import('./pages/studio/ProvidersPage'));
const TeamBuilderPage = lazy(() => import('./pages/studio/TeamBuilderPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const PromptsPage = lazy(() => import('./pages/PromptsPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const FeedbacksPage = lazy(() => import('./pages/FeedbacksPage'));
const TriggersPage = lazy(() => import('./pages/TriggersPage'));
const RagPage = lazy(() => import('./pages/RagPage'));

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
      <PlannerChatProvider>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardWrapper />} />
            <Route path="/dashboard" element={<ObservabilityPage />} />
            <Route path="/traces" element={<TracesPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/feedbacks" element={<FeedbacksPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/rag" element={<RagPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/triggers" element={<TriggersPage />} />
            <Route path="/studio" element={<StudioHomePage />} />
            <Route path="/studio/teams" element={<TeamBuilderPage />} />
            <Route path="/studio/providers" element={<ProvidersPage />} />
            <Route path="/studio/:projectId" element={<ProjectPage />} />
          </Route>
        </Routes>
        </Suspense>
      </PlannerChatProvider>
    </BrowserRouter>
  </StrictMode>,
);
