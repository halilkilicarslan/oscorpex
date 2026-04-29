import { Zap, BadgeDollarSign, ShieldCheck, ShieldAlert } from 'lucide-react';

export function FastestBadge() {
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-[#22c55e]/20 bg-[#22c55e]/10 px-2 py-0.5 text-[10px] text-[#22c55e]">
			<Zap size={10} />
			Fastest
		</span>
	);
}

export function CheapestBadge() {
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-[#3b82f6]/20 bg-[#3b82f6]/10 px-2 py-0.5 text-[10px] text-[#3b82f6]">
			<BadgeDollarSign size={10} />
			Cheapest
		</span>
	);
}

export function MostReliableBadge() {
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-[#22c55e]/20 bg-[#22c55e]/10 px-2 py-0.5 text-[10px] text-[#22c55e]">
			<ShieldCheck size={10} />
			Reliable
		</span>
	);
}

export function NoisyBadge() {
	return (
		<span className="inline-flex items-center gap-1 rounded-full border border-[#f59e0b]/20 bg-[#f59e0b]/10 px-2 py-0.5 text-[10px] text-[#f59e0b]">
			<ShieldAlert size={10} />
			Noisy
		</span>
	);
}
