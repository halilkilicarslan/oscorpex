import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';

const DashboardWrapper = lazy(() => import('./pages/DashboardWrapper'));
const ObservabilityPage = lazy(() => import('./pages/ObservabilityPage'));
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));
const StudioHomePage = lazy(() => import('./pages/studio/StudioHomePage'));
const ProjectPage = lazy(() => import('./pages/studio/ProjectPage'));

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
            <Route path="/traces" element={<PlaceholderPage title="Traces" description="View and analyze execution traces" />} />
            <Route path="/logs" element={<PlaceholderPage title="Logs" description="View agent execution logs" />} />
            <Route path="/feedbacks" element={<PlaceholderPage title="Feedbacks" description="Manage user feedback" />} />
            <Route path="/alerts" element={<PlaceholderPage title="Alerts" description="Configure and manage alerts" />} />
            <Route path="/memory" element={<PlaceholderPage title="Memory" description="Agent memory management" />} />
            <Route path="/rag" element={<PlaceholderPage title="RAG" description="Retrieval Augmented Generation" />} />
            <Route path="/prompts" element={<PlaceholderPage title="Prompts" description="Prompt template management" />} />
            <Route path="/triggers" element={<PlaceholderPage title="Triggers" description="Event triggers and automation" />} />
            <Route path="/studio" element={<StudioHomePage />} />
            <Route path="/studio/:projectId" element={<ProjectPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
