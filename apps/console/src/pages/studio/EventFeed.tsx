import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, AlertCircle, Zap } from 'lucide-react';
import { useStudioWebSocket } from '../../hooks/useStudioWebSocket';
import { httpGet } from '../../lib/studio-api/base.js';
import type { StudioEvent } from './event-feed/types.js';
import { ConnectionBadge, EventRow } from './event-feed/index.js';

const MAX_EVENTS = 200;

export default function EventFeed({ projectId }: { projectId: string }) {
	const [events, setEvents] = useState<StudioEvent[]>([]);
	const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [transport, setTransport] = useState<'ws' | 'sse'>('ws');

	const scrollRef = useRef<HTMLDivElement>(null);
	const mountedRef = useRef(true);
	const transportRef = useRef<'ws' | 'sse'>('ws');

	const esRef = useRef<EventSource | null>(null);
	const sseReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const { connectionState, lastEvent } = useStudioWebSocket(projectId);

	useEffect(() => {
		if (connectionState === 'connected') {
			transportRef.current = 'ws';
			setTransport('ws');
			closeSse();
		} else if (connectionState === 'error') {
			transportRef.current = 'sse';
			setTransport('sse');
			if (!esRef.current) connectSse();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [connectionState]);

	useEffect(() => {
		if (!lastEvent || !mountedRef.current) return;
		if (lastEvent.type === 'agent:output') return;
		appendEvents([lastEvent as unknown as StudioEvent], true);
	}, [lastEvent]); // eslint-disable-line react-hooks/exhaustive-deps

	const scrollToBottom = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, []);

	const appendEvents = useCallback((incoming: StudioEvent[], markNew = false) => {
		setEvents((prev) => {
			const existingIds = new Set(prev.map((e) => e.id));
			const fresh = incoming.filter((e) => !existingIds.has(e.id));
			if (fresh.length === 0) return prev;
			const merged = [...prev, ...fresh];
			return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
		});

		if (markNew) {
			const ids = new Set(incoming.map((e) => e.id));
			setNewEventIds((prev) => new Set([...prev, ...ids]));
			setTimeout(() => {
				setNewEventIds((prev) => {
					const next = new Set(prev);
					ids.forEach((id) => next.delete(id));
					return next;
				});
			}, 1500);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;

		httpGet<StudioEvent[]>(`/api/studio/projects/${projectId}/events/recent?limit=30`)
			.then((data) => {
				if (cancelled) return;
				appendEvents(data, false);
			})
			.catch((err: Error) => {
				if (cancelled) return;
				setError(err.message);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [projectId, appendEvents]);

	const closeSse = useCallback(() => {
		esRef.current?.close();
		esRef.current = null;
		if (sseReconnectRef.current) {
			clearTimeout(sseReconnectRef.current);
			sseReconnectRef.current = null;
		}
	}, []);

	const connectSse = useCallback(() => {
		if (!mountedRef.current) return;

		const es = new EventSource(`/api/studio/projects/${projectId}/events`);
		esRef.current = es;

		es.onmessage = (e: MessageEvent<string>) => {
			if (!mountedRef.current) return;
			try {
				const event = JSON.parse(e.data) as StudioEvent;
				appendEvents([event], true);
				requestAnimationFrame(scrollToBottom);
			} catch {
				// Geçersiz JSON — yoksay
			}
		};

		es.onerror = () => {
			if (!mountedRef.current) return;
			es.close();
			esRef.current = null;
			sseReconnectRef.current = setTimeout(() => {
				if (mountedRef.current && transportRef.current === 'sse') connectSse();
			}, 3000);
		};
	}, [projectId, appendEvents, scrollToBottom]);

	useEffect(() => {
		if (!loading) requestAnimationFrame(scrollToBottom);
	}, [loading, scrollToBottom]);

	useEffect(() => {
		requestAnimationFrame(scrollToBottom);
	}, [events.length, scrollToBottom]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			closeSse();
		};
	}, [closeSse]);

	return (
		<div className="flex flex-col h-full bg-[#0a0a0a]">
			{/* Toolbar */}
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-[#262626] bg-[#0d0d0d] shrink-0">
				<div className="flex items-center gap-2">
					<span className="text-[11px] font-semibold text-[#737373] uppercase tracking-widest">
						Event Stream
					</span>
					<span className="text-[10px] text-[#525252]">({events.length})</span>
				</div>

				<div className="flex items-center gap-1.5">
					<ConnectionBadge state={connectionState} transport={transport} />
				</div>
			</div>

			{/* Body */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto">
				{loading && (
					<div className="flex items-center justify-center py-12">
						<Loader2 size={18} className="text-[#525252] animate-spin" />
					</div>
				)}

				{!loading && error && (
					<div className="flex items-center justify-center py-12">
						<div className="text-center">
							<AlertCircle size={20} className="text-[#ef4444] mx-auto mb-2" />
							<p className="text-[12px] text-[#ef4444]">Failed to load events</p>
							<p className="text-[11px] text-[#525252] mt-1">{error}</p>
						</div>
					</div>
				)}

				{!loading && !error && events.length === 0 && (
					<div className="flex flex-col items-center justify-center py-12 text-center px-6">
						<Zap size={22} className="text-[#262626] mb-3" />
						<p className="text-[12px] text-[#525252]">No events yet</p>
						<p className="text-[11px] text-[#383838] mt-1">
							Events will appear here as the project progresses
						</p>
					</div>
				)}

				{!loading && events.length > 0 && (
					<div>
						{events.map((event) => (
							<EventRow key={event.id} event={event} isNew={newEventIds.has(event.id)} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
