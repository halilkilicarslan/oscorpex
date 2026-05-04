import React from 'react';
import { STATUS_COLORS } from './constants.js';

export function StatusDot({ status }: { status: string }) {
	const color = STATUS_COLORS[status] ?? '#525252';
	return (
		<span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
			<span
				className="w-2 h-2 rounded-full"
				style={{
					backgroundColor: color,
					boxShadow: status === 'indexing' ? `0 0 0 2px ${color}40` : undefined,
					animation: status === 'indexing' ? 'pulse 1.5s infinite' : undefined,
				}}
			/>
			{status.charAt(0).toUpperCase() + status.slice(1)}
		</span>
	);
}

export function StatusBadge({ status }: { status: string }) {
	const color = STATUS_COLORS[status] ?? '#525252';
	return (
		<span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ color, backgroundColor: `${color}20` }}>
			{status.charAt(0).toUpperCase() + status.slice(1)}
		</span>
	);
}
