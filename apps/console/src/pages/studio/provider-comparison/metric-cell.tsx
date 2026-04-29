export default function MetricCell({
	value,
	unit,
	highlight,
	warn,
}: {
	value: string;
	unit?: string;
	highlight?: boolean;
	warn?: boolean;
}) {
	return (
		<div className="text-right">
			<span
				className={`text-[13px] font-medium ${
					highlight ? 'text-[#22c55e]' : warn ? 'text-[#ef4444]' : 'text-[#fafafa]'
				}`}
			>
				{value}
			</span>
			{unit && <span className="ml-1 text-[10px] text-[#525252]">{unit}</span>}
		</div>
	);
}
