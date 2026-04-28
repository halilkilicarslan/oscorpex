// ---------------------------------------------------------------------------
// Pipeline Constants
// ---------------------------------------------------------------------------

import {
  Clock,
  AlertCircle,
  Loader2,
  Eye,
  RotateCw,
  ShieldAlert,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { Task } from '../../../lib/studio-api';

export const ROLE_COLORS: Record<string, string> = {
  pm: '#f59e0b',
  designer: '#f472b6',
  architect: '#3b82f6',
  frontend: '#ec4899',
  backend: '#22c55e',
  coder: '#06b6d4',
  qa: '#a855f7',
  reviewer: '#ef4444',
  devops: '#0ea5e9',
};

export const PIPELINE_STATUS_COLORS: Record<string, string> = {
  idle: '#525252',
  running: '#22c55e',
  paused: '#f59e0b',
  completed: '#3b82f6',
  failed: '#ef4444',
};

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

export const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Active',
  completed: 'Completed',
  failed: 'Failed',
};

export const TASK_STATUS_ICONS: Record<Task['status'], React.ReactNode> = {
  queued: <Clock size={11} className="text-[#525252]" />,
  assigned: <AlertCircle size={11} className="text-[#3b82f6]" />,
  running: <Loader2 size={11} className="text-[#f59e0b] animate-spin" />,
  review: <Eye size={11} className="text-[#a855f7]" />,
  revision: <RotateCw size={11} className="text-[#f97316]" />,
  waiting_approval: <ShieldAlert size={11} className="text-[#f59e0b]" />,
  done: <CheckCircle2 size={11} className="text-[#22c55e]" />,
  failed: <XCircle size={11} className="text-[#ef4444]" />,
};

export const COMPLEXITY_COLORS: Record<string, string> = {
  S: 'bg-[#22c55e]/10 text-[#22c55e]',
  M: 'bg-[#f59e0b]/10 text-[#f59e0b]',
  L: 'bg-[#ef4444]/10 text-[#ef4444]',
};

export const TASK_STATUS_BADGE: Record<string, string> = {
  done: 'bg-[#22c55e]/10 text-[#22c55e]',
  running: 'bg-[#f59e0b]/10 text-[#f59e0b]',
  failed: 'bg-[#ef4444]/10 text-[#ef4444]',
  review: 'bg-[#a855f7]/10 text-[#a855f7]',
  revision: 'bg-[#f97316]/10 text-[#f97316]',
  waiting_approval: 'bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/30',
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  assigned: 'Assigned',
  running: 'Running',
  review: 'Review',
  revision: 'Revision',
  waiting_approval: 'Awaiting Approval',
  done: 'Done',
  failed: 'Failed',
};

export const PIPELINE_WS_EVENTS = [
  'task:completed',
  'task:failed',
  'task:started',
  'phase:completed',
  'phase:started',
  'pipeline:completed',
];
