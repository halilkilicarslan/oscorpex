import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import { PlannerChatProvider } from './contexts/PlannerChatContext';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';

const DashboardWrapper = lazy(() => import('./pages/DashboardWrapper'));
const ObservabilityPage = lazy(() => import('./pages/ObservabilityPage'));
const TracesPage = lazy(() => import('./pages/TracesPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const StudioHomePage = lazy(() => import('./pages/studio/StudioHomePage'));
const ProjectPage = lazy(() => import('./pages/studio/ProjectPage'));
const ProvidersPage = lazy(() => import('./pages/studio/ProvidersPage'));
const TeamBuilderPage = lazy(() => import('./pages/studio/TeamBuilderPage'));
const CLIUsageMonitorPage = lazy(() => import('./pages/studio/CLIUsageMonitorPage'));
const ProviderTelemetryPage = lazy(() => import('./pages/studio/ProviderTelemetryPage'));
const ProviderComparisonPage = lazy(() => import('./pages/studio/ProviderComparisonPage'));
const AdminSettingsPage = lazy(() => import('./pages/studio/AdminSettingsPage'));
const PlatformDashboard = lazy(() => import('./pages/studio/PlatformDashboard'));
const InsightDashboard = lazy(() => import('./pages/studio/InsightDashboard'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const PromptsPage = lazy(() => import('./pages/PromptsPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const FeedbacksPage = lazy(() => import('./pages/FeedbacksPage'));
const TriggersPage = lazy(() => import('./pages/TriggersPage'));
const RagPage = lazy(() => import('./pages/RagPage'));
const ControlPlanePage = lazy(() => import('./pages/studio/ControlPlanePage'));
const QualityGatesDashboardPage = lazy(() => import('./pages/studio/QualityGatesDashboardPage'));
const ApprovalQueuePage = lazy(() => import('./pages/studio/ApprovalQueuePage'));
const ReleaseDecisionPanelPage = lazy(() => import('./pages/studio/ReleaseDecisionPanelPage'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));

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
      <AuthProvider>
        <PlannerChatProvider>
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              {/* Auth pages — no layout */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Main app — with layout */}
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
                <Route
                  path="/studio"
                  element={
                    <ProtectedRoute>
                      <StudioHomePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/dashboard"
                  element={
                    <ProtectedRoute>
                      <PlatformDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/insights"
                  element={
                    <ProtectedRoute>
                      <InsightDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/teams"
                  element={
                    <ProtectedRoute>
                      <TeamBuilderPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/providers"
                  element={
                    <ProtectedRoute>
                      <ProvidersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/cli-monitor"
                  element={
                    <ProtectedRoute>
                      <CLIUsageMonitorPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/telemetry"
                  element={
                    <ProtectedRoute>
                      <ProviderTelemetryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/providers/compare"
                  element={
                    <ProtectedRoute>
                      <ProviderComparisonPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/admin"
                  element={
                    <ProtectedRoute>
                      <AdminSettingsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/control-plane"
                  element={
                    <ProtectedRoute>
                      <ControlPlanePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/approvals"
                  element={
                    <ProtectedRoute>
                      <ApprovalQueuePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/releases/:goalId"
                  element={
                    <ProtectedRoute>
                      <ReleaseDecisionPanelPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/quality-gates/:goalId"
                  element={
                    <ProtectedRoute>
                      <QualityGatesDashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/studio/:projectId"
                  element={
                    <ProtectedRoute>
                      <ProjectPage />
                    </ProtectedRoute>
                  }
                />
              </Route>
            </Routes>
          </Suspense>
        </PlannerChatProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
