// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export default function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
	return (
		<div>
			<span className="text-[10px] font-semibold text-[#525252] uppercase tracking-wide mb-1.5 block">
				{title}
			</span>
			{children}
		</div>
	);
}
