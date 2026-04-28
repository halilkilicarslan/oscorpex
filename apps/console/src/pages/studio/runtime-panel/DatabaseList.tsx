import { CheckCircle2, Container, HardDrive, Globe, Loader2, Play, Square } from 'lucide-react';
import { DB_META } from './helpers';
import type { RuntimeAnalysis, DatabaseType, DbProvisionMethod } from '../../lib/studio-api';

interface DatabaseListProps {
	analysis: RuntimeAnalysis;
	dbMethod: Record<string, DbProvisionMethod>;
	cloudUrls: Record<string, string>;
	actionLoading: string | null;
	onDbMethodChange: (dbType: DatabaseType, method: DbProvisionMethod) => void;
	onCloudUrlChange: (dbType: DatabaseType, url: string) => void;
	onProvisionDb: (dbType: DatabaseType) => void;
	onStopDb: (dbType: DatabaseType) => void;
}

export default function DatabaseList({
	analysis,
	dbMethod,
	cloudUrls,
	actionLoading,
	onDbMethodChange,
	onCloudUrlChange,
	onProvisionDb,
	onStopDb,
}: DatabaseListProps) {
	return (
		<div className="space-y-2">
			{analysis.databases.map((db) => {
				const meta = DB_META[db.type];
				const status = analysis.dbStatuses?.find((s) => s.type === db.type);
				const isRunning = status?.running;
				const method = dbMethod[db.type] || 'docker';

				return (
					<div key={db.type} className="bg-[#18181b] rounded-lg border border-[#27272a] p-3 space-y-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span>{meta.icon}</span>
								<span className="text-sm font-medium text-[#fafafa]">{meta.label}</span>
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272a] text-[#71717a]">
									:{db.port}
								</span>
							</div>
							{isRunning && (
								<span className="text-[10px] text-[#22c55e] flex items-center gap-1">
									<CheckCircle2 size={10} /> Running
								</span>
							)}
						</div>

						<div className="flex gap-1">
							{(['docker', 'local', 'cloud'] as DbProvisionMethod[]).map((m) => (
								<button
									key={m}
									onClick={() => onDbMethodChange(db.type, m)}
									className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 ${
										method === m
											? 'bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30'
											: 'bg-[#27272a] text-[#71717a] hover:text-[#a1a1aa]'
									}`}
								>
									{m === 'docker' && <Container size={9} />}
									{m === 'local' && <HardDrive size={9} />}
									{m === 'cloud' && <Globe size={9} />}
									{m === 'docker' ? 'Docker' : m === 'local' ? 'Local' : 'Cloud'}
								</button>
							))}
						</div>

						{method === 'cloud' && (
							<input
								type="text"
								placeholder={`${db.type}://user:pass@host:port/dbname`}
								value={cloudUrls[db.type] || ''}
								onChange={(e) => onCloudUrlChange(db.type, e.target.value)}
								className="w-full text-xs px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-[#fafafa] placeholder-[#52525b] font-mono"
							/>
						)}

						<div className="flex gap-1.5">
							{!isRunning ? (
								<button
									onClick={() => onProvisionDb(db.type)}
									disabled={actionLoading === `db-${db.type}`}
									className="text-[10px] px-2.5 py-1 rounded bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 flex items-center gap-1"
								>
									{actionLoading === `db-${db.type}` ? (
										<Loader2 size={10} className="animate-spin" />
									) : (
										<Play size={10} />
									)}
									Start
								</button>
							) : (
								<button
									onClick={() => onStopDb(db.type)}
									disabled={actionLoading === `db-stop-${db.type}`}
									className="text-[10px] px-2.5 py-1 rounded bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 flex items-center gap-1"
								>
									{actionLoading === `db-stop-${db.type}` ? (
										<Loader2 size={10} className="animate-spin" />
									) : (
										<Square size={10} />
									)}
									Stop
								</button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
