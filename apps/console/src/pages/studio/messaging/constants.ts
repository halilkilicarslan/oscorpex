// ---------------------------------------------------------------------------
// Messaging Constants
// ---------------------------------------------------------------------------

import type { AgentMessageType } from '../../lib/studio-api';

export const PAGE_SIZE = 50;
export const MESSAGE_CENTER_WS_EVENTS = ['message:created'];

export const TYPE_CONFIG: Record<
  AgentMessageType,
  { label: string; bg: string; text: string; border: string }
> = {
  task_assignment: {
    label: 'Task',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
  },
  task_complete: {
    label: 'Completed',
    bg: 'bg-[#22c55e]/10',
    text: 'text-[#22c55e]',
    border: 'border-[#22c55e]/20',
  },
  review_request: {
    label: 'Review',
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/20',
  },
  bug_report: {
    label: 'Bug',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
  },
  feedback: {
    label: 'Feedback',
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    border: 'border-purple-500/20',
  },
  notification: {
    label: 'Notification',
    bg: 'bg-[#525252]/10',
    text: 'text-[#737373]',
    border: 'border-[#525252]/20',
  },
  standup: {
    label: 'Standup',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    border: 'border-cyan-500/20',
  },
  retrospective: {
    label: 'Retro',
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-400',
    border: 'border-indigo-500/20',
  },
  conflict: {
    label: 'Conflict',
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500/20',
  },
  help_request: {
    label: 'Help',
    bg: 'bg-pink-500/10',
    text: 'text-pink-400',
    border: 'border-pink-500/20',
  },
  pair_session: {
    label: 'Pair',
    bg: 'bg-teal-500/10',
    text: 'text-teal-400',
    border: 'border-teal-500/20',
  },
  handoff_doc: {
    label: 'Devir',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
  },
};

export const MESSAGE_TYPES: AgentMessageType[] = [
  'task_assignment',
  'task_complete',
  'review_request',
  'bug_report',
  'feedback',
  'notification',
  'standup',
  'retrospective',
  'conflict',
  'help_request',
  'pair_session',
  'handoff_doc',
];
