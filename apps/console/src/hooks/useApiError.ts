// ---------------------------------------------------------------------------
// API Error UX — Error State Hook (P1 F5)
// Standardizes error handling for async operations in React components.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import { StudioApiError, getErrorMessage } from '../lib/studio-api/base.js';

export interface ApiErrorState {
  error: Error | StudioApiError | null;
  message: string;
  isError: boolean;
  status: number | null;
}

export interface UseApiErrorReturn extends ApiErrorState {
  setError: (err: unknown) => void;
  clearError: () => void;
  handleAsync: <T>(promise: Promise<T>) => Promise<T | undefined>;
}

export function useApiError(): UseApiErrorReturn {
  const [error, setErrorState] = useState<Error | StudioApiError | null>(null);

  const setError = useCallback((err: unknown) => {
    if (err instanceof Error) {
      setErrorState(err);
    } else {
      setErrorState(new Error(String(err || 'Unknown error')));
    }
  }, []);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  const handleAsync = useCallback(
    async <T,>(promise: Promise<T>): Promise<T | undefined> => {
      try {
        clearError();
        const result = await promise;
        return result;
      } catch (err) {
        setError(err);
        return undefined;
      }
    },
    [clearError, setError],
  );

  const isApiError = error instanceof StudioApiError;

  return {
    error,
    message: getErrorMessage(error),
    isError: error !== null,
    status: isApiError ? error.status : null,
    setError,
    clearError,
    handleAsync,
  };
}
