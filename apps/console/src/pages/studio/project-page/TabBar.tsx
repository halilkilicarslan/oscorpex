import type React from 'react';
import type { Tab } from './helpers';

interface TabBarProps {
	tabs: { id: Tab; label: string; icon: React.ReactNode }[];
	activeTab: Tab;
	totalUnread: number;
	onTabChange: (tab: Tab) => void;
}

export default function TabBar({ tabs, activeTab, totalUnread, onTabChange }: TabBarProps) {
	return (
		<div className="flex items-center gap-1 px-6 py-2 border-b border-[#262626] bg-[#0a0a0a] overflow-x-auto scrollbar-none">
			{tabs.map((tab) => (
				<button
					key={tab.id}
				onClick={() => onTabChange(tab.id)}
					className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors shrink-0 ${
						activeTab === tab.id
							? 'bg-[#1f1f1f] text-[#22c55e]'
							: 'text-[#737373] hover:text-[#a3a3a3] hover:bg-[#141414]'
					}`}
				>
					{tab.icon}
					{tab.label}
					{tab.id === 'messages' && totalUnread > 0 && (
						<span className="ml-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#22c55e] text-[#0a0a0a] leading-none">
							{totalUnread > 99 ? '99+' : totalUnread}
						</span>
					)}
				</button>
			))}
		</div>
	);
}
