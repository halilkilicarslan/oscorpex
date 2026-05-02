// ---------------------------------------------------------------------------
// useAsyncAction — Async operation wrapper with loading + error state
// Replaces the repeated deleting/saving/loading boolean + error pattern.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';

export interface UseAsyncActionResult {
	isLoading: boolean;
	error: string | null;
	execute: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
	clearError: () => void;
}

export function useAsyncAction(): UseAsyncActionResult {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const execute = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
		setIsLoading(true);
		setError(null);
		try {
			const result = await fn();
			return result;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg);
			return undefined;
		} finally {
			setIsLoading(false);
		}
	}, []);

	return { isLoading, error, execute, clearError };
}
