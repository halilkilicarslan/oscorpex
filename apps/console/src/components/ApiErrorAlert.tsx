// ---------------------------------------------------------------------------
// API Error UX — Standard Alert Component (P1 F5)
// Displays StudioApiError and generic Errors in a consistent, actionable way.
// ---------------------------------------------------------------------------

import { useCallback } from 'react';
import { StudioApiError, getErrorMessage } from '../lib/studio-api/base.js';

interface ApiErrorAlertProps {
  error: Error | StudioApiError | null | undefined;
  onRetry?: () => void;
  className?: string;
}

const STATUS_LABELS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable',
  429: 'Too Many Requests',
  500: 'Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export default function ApiErrorAlert({ error, onRetry, className = '' }: ApiErrorAlertProps) {
  if (!error) return null;

  const isApiError = error instanceof StudioApiError;
  const status = isApiError ? error.status : undefined;
  const statusLabel = status ? (STATUS_LABELS[status] ?? `HTTP ${status}`) : 'Error';
  const message = getErrorMessage(error);

  const handleRetry = useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-900/40 bg-red-950/30 p-4 text-sm text-red-200 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-900/50 text-xs font-bold text-red-300">
          {status ?? '!'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-red-100">{statusLabel}</p>
          <p className="mt-1 break-words text-red-200/80">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-red-900/40 px-3 py-1.5 text-xs font-medium text-red-100 transition hover:bg-red-900/60"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
