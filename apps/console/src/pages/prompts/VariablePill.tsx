export function VariablePill({ name }: { name: string }) {
	return (
		<span className="inline-flex items-center px-2 py-0.5 rounded bg-[#22c55e]/10 border border-[#22c55e]/20 text-[10px] text-[#22c55e] font-mono">
			{`{{${name}}}`}
		</span>
	);
}
