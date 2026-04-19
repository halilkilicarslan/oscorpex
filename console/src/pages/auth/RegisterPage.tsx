// ---------------------------------------------------------------------------
// RegisterPage — Dark theme registration form
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function RegisterPage() {
	const { isAuthenticated, isLoading, register } = useAuth();
	const navigate = useNavigate();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [displayName, setDisplayName] = useState('');
	const [tenantName, setTenantName] = useState('');
	const [error, setError] = useState('');
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		if (!isLoading && isAuthenticated) {
			navigate('/studio', { replace: true });
		}
	}, [isAuthenticated, isLoading, navigate]);

	if (isLoading) {
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

	if (isAuthenticated) {
		return <Navigate to="/studio" replace />;
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');

		if (password.length < 8) {
			setError('Password must be at least 8 characters');
			return;
		}

		setSubmitting(true);
		try {
			await register({
				email,
				password,
				displayName: displayName || undefined,
				tenantName: tenantName || undefined,
			});
			navigate('/studio', { replace: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Registration failed');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4">
			<div className="w-full max-w-sm">
				{/* Logo */}
				<div className="flex justify-center mb-8">
					<div className="flex items-center gap-2.5">
						<div className="w-9 h-9 rounded-xl bg-[#111111] border border-[#262626] flex items-center justify-center overflow-hidden">
							<img src="/logo-icon.svg" alt="Oscorpex" className="w-5 h-5 object-contain brightness-0 invert" />
						</div>
						<img src="/app-logo.svg" alt="Oscorpex" className="h-5 w-auto brightness-0 invert select-none" />
					</div>
				</div>

				{/* Card */}
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-7">
					<h1 className="text-lg font-semibold text-[#fafafa] mb-1">Create your account</h1>
					<p className="text-sm text-[#737373] mb-6">Start building with your AI Scrum team</p>

					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<label htmlFor="email" className="text-xs font-medium text-[#a3a3a3]">
								Email <span className="text-red-400">*</span>
							</label>
							<input
								id="email"
								type="email"
								autoComplete="email"
								required
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="you@example.com"
								className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/30 transition-colors"
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<label htmlFor="password" className="text-xs font-medium text-[#a3a3a3]">
								Password <span className="text-red-400">*</span>
							</label>
							<input
								id="password"
								type="password"
								autoComplete="new-password"
								required
								minLength={8}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Min. 8 characters"
								className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/30 transition-colors"
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<label htmlFor="displayName" className="text-xs font-medium text-[#a3a3a3]">
								Display Name
							</label>
							<input
								id="displayName"
								type="text"
								autoComplete="name"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								placeholder="Jane Doe"
								className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/30 transition-colors"
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<label htmlFor="tenantName" className="text-xs font-medium text-[#a3a3a3]">
								Workspace Name
							</label>
							<input
								id="tenantName"
								type="text"
								autoComplete="organization"
								value={tenantName}
								onChange={(e) => setTenantName(e.target.value)}
								placeholder="Acme Corp"
								className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-sm text-[#fafafa] placeholder-[#525252] outline-none focus:border-[#22c55e]/60 focus:ring-1 focus:ring-[#22c55e]/30 transition-colors"
							/>
						</div>

						{error && (
							<div
								role="alert"
								className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400"
							>
								{error}
							</div>
						)}

						<button
							type="submit"
							disabled={submitting}
							className="w-full mt-1 bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold py-2 rounded-lg transition-colors"
						>
							{submitting ? 'Creating account…' : 'Create Account'}
						</button>
					</form>

					<p className="mt-5 text-center text-xs text-[#737373]">
						Already have an account?{' '}
						<Link to="/login" className="text-[#22c55e] hover:underline font-medium">
							Sign in
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}
