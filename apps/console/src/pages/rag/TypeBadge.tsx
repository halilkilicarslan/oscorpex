import React from 'react';
import { TYPE_CONFIG } from './constants.js';

export function TypeBadge({ type }: { type: string }) {
	const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.text;
	const { Icon, label, color, bg } = cfg;
	return (
		<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ color, backgroundColor: bg }}>
			<Icon className="w-3 h-3" />
			{label}
		</span>
	);
}
