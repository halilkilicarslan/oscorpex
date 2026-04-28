// ---------------------------------------------------------------------------
// Provider Card
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Zap, Star, Eye, EyeOff, ToggleLeft, ToggleRight, Edit2, Trash2 } from 'lucide-react';
import type { AIProvider } from '../../../lib/studio-api';
import { TypeBadge, TestIndicator, type TestState } from './helpers.js';

interface ProviderCardProps {
	provider: AIProvider;
	onEdit: () => void;
	onDelete: () => void;
	onSetDefault: () => void;
	onToggleActive: () => void;
	onTest: () => void;
	testState: TestState;
	testMessage?: string;
}

export default function ProviderCard({
	provider,
	onEdit,
	onDelete,
	onSetDefault,
	onToggleActive,
	onTest,
	testState,
	testMessage,
}: ProviderCardProps) {
	const [showKey, setShowKey] = useState(false);

	return (
		<div
			className={`bg-[#111111] border rounded-xl p-5 transition-colors group ${
				provider.isDefault ? 'border-[#22c55e]/40' : 'border-[#262626] hover:border-[#333]'
			}`}
		>
			<div className="flex items-start justify-between mb-3">
				<div className="flex items-center gap-2.5">
					<div className="w-9 h-9 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0">
						<Zap size={18} className="text-[#22c55e]" />
					</div>
					<div>
						<div className="flex items-center gap-1.5 flex-wrap">
							<h3 className="text-[14px] font-semibold text-[#fafafa]">{provider.name}</h3>
							{provider.isDefault && (
								<span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30">
									<Star size={8} />
									DEFAULT
								</span>
							)}
							{!provider.isActive && (
								<span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20">
									INACTIVE
								</span>
							)}
						</div>
						<div className="flex items-center gap-1.5 mt-0.5">
							<TypeBadge type={provider.type} />
							{provider.model && <span className="text-[10px] text-[#525252]">{provider.model}</span>}
						</div>
					</div>
				</div>
				<button
					onClick={onToggleActive}
					className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
					title={provider.isActive ? 'Deactivate' : 'Activate'}
				>
					{provider.isActive ? (
						<ToggleRight size={22} className="text-[#22c55e]" />
					) : (
						<ToggleLeft size={22} />
					)}
				</button>
			</div>

			{provider.apiKey && (
				<div className="flex items-center gap-2 mb-3">
					<span className="text-[11px] text-[#525252] font-mono flex-1 truncate">
						{showKey ? provider.apiKey : provider.apiKey}
					</span>
					<button
						onClick={() => setShowKey((v) => !v)}
						className="text-[#525252] hover:text-[#a3a3a3] transition-colors shrink-0"
						title={showKey ? 'Hide key' : 'Show key'}
					>
						{showKey ? <EyeOff size={13} /> : <Eye size={13} />}
					</button>
				</div>
			)}

			{provider.baseUrl && <p className="text-[11px] text-[#525252] mb-3 truncate">{provider.baseUrl}</p>}

			<div className="flex items-center justify-between pt-3 border-t border-[#1f1f1f]">
				<TestIndicator state={testState} message={testMessage} />
				<div className="flex items-center gap-1 ml-auto">
					<button
						onClick={onTest}
						disabled={testState === 'testing'}
						className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#a3a3a3] hover:text-[#fafafa] hover:bg-[#1f1f1f] transition-colors disabled:opacity-50"
						title="Test connection"
					>
						<Zap size={11} />
						Test
					</button>
					{!provider.isDefault && (
						<button
							onClick={onSetDefault}
							className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#a3a3a3] hover:text-[#22c55e] hover:bg-[#1f1f1f] transition-colors"
							title="Set as default"
						>
							<Star size={11} />
							Default
						</button>
					)}
					<button
						onClick={onEdit}
						className="p-1.5 rounded text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
						title="Edit"
					>
						<Edit2 size={13} />
					</button>
					<button
						onClick={onDelete}
						disabled={provider.isDefault}
						className="p-1.5 rounded text-[#525252] hover:text-[#ef4444] hover:bg-[#1f1f1f] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
						title={provider.isDefault ? 'Cannot delete the default provider' : 'Delete'}
					>
						<Trash2 size={13} />
					</button>
				</div>
			</div>
		</div>
	);
}
