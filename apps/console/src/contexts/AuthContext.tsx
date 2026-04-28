// ---------------------------------------------------------------------------
// AuthContext — JWT auth state management
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
	fetchCurrentUser,
	login as loginApi,
	register as registerApi,
	type AuthUser,
	type RegisterData,
} from '../lib/studio-api/auth';

const TOKEN_KEY = 'oscorpex_token';

interface AuthContextValue {
	user: AuthUser | null;
	token: string | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	login: (email: string, password: string) => Promise<void>;
	register: (data: RegisterData) => Promise<void>;
	logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [token, setToken] = useState<string | null>(() => {
		try {
			return localStorage.getItem(TOKEN_KEY);
		} catch {
			return null;
		}
	});
	const [isLoading, setIsLoading] = useState(true);

	// On mount: validate stored token or detect auth-disabled mode
	useEffect(() => {
		if (token) {
			fetchCurrentUser(token)
				.then((data) => {
					// Backend running in auth-disabled mode
					if ((data as any).authDisabled) {
						setUser({ id: 'anonymous', email: '', displayName: 'Anonymous', tenantId: '', role: 'viewer' } as AuthUser);
					} else {
						setUser(data);
					}
				})
				.catch(() => {
					try {
						localStorage.removeItem(TOKEN_KEY);
					} catch {
						// ignore
					}
					setToken(null);
				})
				.finally(() => setIsLoading(false));
		} else {
			// Even without a token, try /me to detect auth-disabled mode
			fetchCurrentUser('')
				.then((data) => {
					if ((data as any).authDisabled) {
						setUser({ id: 'anonymous', email: '', displayName: 'Anonymous', tenantId: '', role: 'viewer' } as AuthUser);
					}
				})
				.catch(() => {
					// Auth enabled and no valid token — remain logged out
				})
				.finally(() => setIsLoading(false));
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const persistToken = (t: string) => {
		try {
			localStorage.setItem(TOKEN_KEY, t);
		} catch {
			// ignore
		}
	};

	const clearToken = () => {
		try {
			localStorage.removeItem(TOKEN_KEY);
		} catch {
			// ignore
		}
	};

	const loginFn = useCallback(async (email: string, password: string) => {
		const res = await loginApi(email, password);
		persistToken(res.token);
		setToken(res.token);
		setUser(res.user);
	}, []);

	const registerFn = useCallback(async (data: RegisterData) => {
		const res = await registerApi(data);
		persistToken(res.token);
		setToken(res.token);
		setUser(res.user);
	}, []);

	const logout = useCallback(() => {
		clearToken();
		setToken(null);
		setUser(null);
	}, []);

	return (
		<AuthContext.Provider
			value={{
				user,
				token,
				isAuthenticated: !!user,
				isLoading,
				login: loginFn,
				register: registerFn,
				logout,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}
