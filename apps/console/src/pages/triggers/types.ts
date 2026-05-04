// ---------------------------------------------------------------------------
// Triggers — shared types, constants, and helpers
// ---------------------------------------------------------------------------

export type TriggerType = 'webhook' | 'schedule' | 'event' | 'condition';
export type ActionType = 'run_agent' | 'send_webhook' | 'execute_pipeline' | 'notify';
export type LogStatus = 'success' | 'failed' | 'skipped';

export interface TriggerConfig {
	// webhook
	url?: string;
	method?: string;
	headers?: string;
	// schedule
	cron?: string;
	timezone?: string;
	// event
	event_type?: string;
	filter?: string;
	// condition
	metric?: string;
	operator?: string;
	threshold?: string;
	check_interval?: string;
}

export interface TriggerAction {
	type: ActionType;
	params: Record<string, string>;
}

export interface Trigger {
	id: string;
	name: string;
	description: string;
	type: TriggerType;
	config: TriggerConfig;
	action: TriggerAction;
	enabled: boolean;
	last_fired_at: string | null;
	fire_count: number;
	created_at: string;
	updated_at: string;
}

export interface TriggerLog {
	id: string;
	trigger_id: string;
	status: LogStatus;
	input: unknown;
	output: unknown;
	duration_ms: number | null;
	fired_at: string;
}

export interface TriggerStats {
	total: number;
	active: number;
	totalFires: number;
	recentFires24h: number;
	byType: { webhook: number; schedule: number; event: number; condition: number };
}

export interface TriggerFormValues {
	name: string;
	description: string;
	type: TriggerType;
	// webhook
	wh_url: string;
	wh_method: string;
	wh_headers: string;
	// schedule
	sc_cron: string;
	sc_timezone: string;
	// event
	ev_type: string;
	ev_filter: string;
	// condition
	co_metric: string;
	co_operator: string;
	co_threshold: string;
	co_check_interval: string;
	// action
	ac_type: ActionType;
	ac_agent_name: string;
	ac_webhook_url: string;
	ac_pipeline: string;
	ac_message: string;
	enabled: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { Globe, Clock, Zap, Activity, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import React from 'react';

export const API_BASE = '/api/observability';

export const TYPE_META: Record<TriggerType, { label: string; badge: string; dot: string; icon: React.ReactNode }> = {
	webhook:   { label: 'Webhook',   badge: 'text-[#3b82f6] bg-[#172554] border border-[#1d4ed8]', dot: 'bg-[#3b82f6]', icon: React.createElement(Globe, { className: 'w-3.5 h-3.5' }) },
	schedule:  { label: 'Schedule',  badge: 'text-[#f59e0b] bg-[#451a03] border border-[#b45309]', dot: 'bg-[#f59e0b]', icon: React.createElement(Clock, { className: 'w-3.5 h-3.5' }) },
	event:     { label: 'Event',     badge: 'text-[#a855f7] bg-[#2e1065] border border-[#7c3aed]', dot: 'bg-[#a855f7]', icon: React.createElement(Zap, { className: 'w-3.5 h-3.5' }) },
	condition: { label: 'Condition', badge: 'text-[#22c55e] bg-[#052e16] border border-[#16a34a]', dot: 'bg-[#22c55e]', icon: React.createElement(Activity, { className: 'w-3.5 h-3.5' }) },
};

export const LOG_STATUS_META: Record<LogStatus, { label: string; badge: string; icon: React.ReactNode }> = {
	success: { label: 'Success', badge: 'text-[#22c55e] bg-[#052e16] border border-[#16a34a]', icon: React.createElement(CheckCircle2, { className: 'w-3 h-3' }) },
	failed:  { label: 'Failed',  badge: 'text-[#ef4444] bg-[#450a0a] border border-[#b91c1c]', icon: React.createElement(XCircle, { className: 'w-3 h-3' }) },
	skipped: { label: 'Skipped', badge: 'text-[#525252] bg-[#1c1c1c] border border-[#3f3f46]',  icon: React.createElement(MinusCircle, { className: 'w-3 h-3' }) },
};

export const ACTION_LABELS: Record<ActionType, string> = {
	run_agent:        'Run Agent',
	send_webhook:     'Send Webhook',
	execute_pipeline: 'Execute Pipeline',
	notify:           'Notify',
};

export const EVENT_TYPES = [
	'task:completed',
	'task:failed',
	'task:started',
	'pipeline:started',
	'pipeline:completed',
	'pipeline:failed',
	'agent:error',
	'agent:response',
];

export const EMPTY_FORM: TriggerFormValues = {
	name: '', description: '', type: 'webhook',
	wh_url: '', wh_method: 'POST', wh_headers: '',
	sc_cron: '0 * * * *', sc_timezone: 'UTC',
	ev_type: 'task:completed', ev_filter: '',
	co_metric: 'error_rate', co_operator: '>', co_threshold: '10', co_check_interval: '5',
	ac_type: 'run_agent', ac_agent_name: '', ac_webhook_url: '', ac_pipeline: '', ac_message: '',
	enabled: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function fmtTime(ts: string): string {
	try {
		return new Date(ts).toLocaleString([], {
			month: 'short', day: '2-digit',
			hour: '2-digit', minute: '2-digit', second: '2-digit',
		});
	} catch {
		return ts;
	}
}

export function timeAgo(ts: string): string {
	const diff = Date.now() - new Date(ts).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

export function cronHuman(cron: string): string {
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return cron;
	const [min, hr, dom, , dow] = parts;
	if (min === '*' && hr === '*') return 'Every minute';
	if (dom === '*' && dow === '*') {
		if (min !== '*' && hr !== '*') return `Daily at ${hr}:${min.padStart(2, '0')}`;
		if (min !== '*') return `Every hour at :${min.padStart(2, '0')}`;
	}
	return cron;
}

export function configSummary(type: TriggerType, config: TriggerConfig): string {
	switch (type) {
		case 'webhook':   return config.url ? `${config.method ?? 'POST'} ${config.url}` : 'No URL configured';
		case 'schedule':  return config.cron ? `${config.cron} — ${cronHuman(config.cron)}` : 'No schedule configured';
		case 'event':     return config.event_type ? `Listening for: ${config.event_type}` : 'No event type set';
		case 'condition': {
			const { metric, operator, threshold } = config;
			if (metric && operator && threshold) return `${metric} ${operator} ${threshold}`;
			return 'No condition configured';
		}
		default: return '';
	}
}

export function actionSummary(action: TriggerAction): string {
	const label = ACTION_LABELS[action.type] ?? action.type;
	if (action.type === 'run_agent' && action.params?.agent_name) return `${label}: ${action.params.agent_name}`;
	if (action.type === 'send_webhook' && action.params?.url) return `${label}: ${action.params.url}`;
	if (action.type === 'execute_pipeline' && action.params?.pipeline) return `${label}: ${action.params.pipeline}`;
	return label;
}

export function formToPayload(form: TriggerFormValues) {
	const config: TriggerConfig = {};
	switch (form.type) {
		case 'webhook':
			config.url = form.wh_url;
			config.method = form.wh_method;
			config.headers = form.wh_headers;
			break;
		case 'schedule':
			config.cron = form.sc_cron;
			config.timezone = form.sc_timezone;
			break;
		case 'event':
			config.event_type = form.ev_type;
			config.filter = form.ev_filter;
			break;
		case 'condition':
			config.metric = form.co_metric;
			config.operator = form.co_operator;
			config.threshold = form.co_threshold;
			config.check_interval = form.co_check_interval;
			break;
	}

	const params: Record<string, string> = {};
	switch (form.ac_type) {
		case 'run_agent':        params.agent_name = form.ac_agent_name; break;
		case 'send_webhook':     params.url = form.ac_webhook_url; break;
		case 'execute_pipeline': params.pipeline = form.ac_pipeline; break;
		case 'notify':           params.message = form.ac_message; break;
	}

	return {
		name: form.name.trim(),
		description: form.description.trim(),
		type: form.type,
		config,
		action: { type: form.ac_type, params },
		enabled: form.enabled,
	};
}

export function triggerToForm(t: Trigger): TriggerFormValues {
	const c = t.config ?? {};
	const a = t.action ?? { type: 'run_agent', params: {} };
	const p = a.params ?? {};
	return {
		name: t.name, description: t.description, type: t.type as TriggerType,
		wh_url: c.url ?? '', wh_method: c.method ?? 'POST', wh_headers: c.headers ?? '',
		sc_cron: c.cron ?? '0 * * * *', sc_timezone: c.timezone ?? 'UTC',
		ev_type: c.event_type ?? 'task:completed', ev_filter: c.filter ?? '',
		co_metric: c.metric ?? 'error_rate', co_operator: c.operator ?? '>',
		co_threshold: c.threshold ?? '10', co_check_interval: c.check_interval ?? '5',
		ac_type: (a.type ?? 'run_agent') as ActionType,
		ac_agent_name: p.agent_name ?? '', ac_webhook_url: p.url ?? '',
		ac_pipeline: p.pipeline ?? '', ac_message: p.message ?? '',
		enabled: t.enabled,
	};
}
