// ---------------------------------------------------------------------------
// ProtectedRoute — Guards routes behind auth when VITE_AUTH_ENABLED=true
// ---------------------------------------------------------------------------

import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
	children: React.ReactNode;
}

function LoadingSpinner() {
	return (
		<div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
			<div
				className="w-8 h-8 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin"
				role="status"
				aria-label="Loading"
			/>
		</div>
	);
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
	const { isAuthenticated, isLoading } = useAuth();
	// Read at render time so test stubs (vi.stubEnv) take effect
	const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';

	if (isLoading) return <LoadingSpinner />;

	// Auth disabled (default) — show content without authentication
	if (!authEnabled) return <>{children}</>;

	// Auth enabled but not authenticated → redirect to login
	if (!isAuthenticated) return <Navigate to="/login" replace />;

	return <>{children}</>;
}
