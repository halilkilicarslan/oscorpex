// ---------------------------------------------------------------------------
// Edge Type Picker
// ---------------------------------------------------------------------------

import { EDGE_STYLES, EDGE_LABELS } from './constants.js';
import type { DependencyType } from '../../../lib/studio-api';

interface EdgeTypePickerProps {
	position: { x: number; y: number };
	onSelect: (type: DependencyType) => void;
	onCancel: () => void;
}

export default function EdgeTypePicker({ position, onSelect, onCancel }: EdgeTypePickerProps) {
	const types: DependencyType[] = [
		'workflow', 'review', 'gate', 'hierarchy', 'escalation', 'pair',
		'conditional', 'fallback', 'notification', 'handoff', 'approval', 'mentoring',
	];
	return (
		<>
			<div className="fixed inset-0 z-40" onClick={onCancel} />
			<div
				className="fixed z-50 bg-[#111111] border border-[#333] rounded-lg shadow-xl p-1 min-w-[140px]"
				style={{ left: position.x, top: position.y }}
			>
				{types.map((type) => (
					<button
						key={type}
						onClick={() => onSelect(type)}
						className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-[#e5e5e5] hover:bg-[#1f1f1f] rounded transition-colors"
					>
						<span className="w-3 h-0.5 rounded-full" style={{ backgroundColor: EDGE_STYLES[type].stroke }} />
						{EDGE_LABELS[type]}
					</button>
				))}
			</div>
		</>
	);
}
