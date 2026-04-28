import { useState, useEffect, useCallback } from 'react';
import { Server, Database, Key, Loader2 } from 'lucide-react';
import {
	analyzeRuntime,
	saveEnvVars,
	provisionDb,
	stopDb,
	installDeps,
	startApp,
	fetchAppStatus,
	type RuntimeAnalysis,
	type DatabaseType,
	type DbProvisionMethod,
	type AppStatus,
} from '../../lib/studio-api';
import {
	Section,
	StatusItem,
	ServiceList,
	DatabaseList,
	EnvVarList,
} from './runtime-panel';

export default function RuntimePanel({
	projectId,
	onAppStarted,
}: {
	projectId: string;
	onAppStarted?: (status: AppStatus) => void;
}) {
	const [analysis, setAnalysis] = useState<RuntimeAnalysis | null>(null);
	const [loading, setLoading] = useState(true);
	const [envValues, setEnvValues] = useState<Record<string, string>>({});
	const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
		services: true,
		databases: true,
		env: true,
	});
	const [dbMethod, setDbMethod] = useState<Record<string, DbProvisionMethod>>({});
	const [cloudUrls, setCloudUrls] = useState<Record<string, string>>({});
	const [messages, setMessages] = useState<{ type: 'success' | 'error' | 'info'; text: string }[]>([]);

	const addMessage = (type: 'success' | 'error' | 'info', text: string) => {
		setMessages((prev) => [...prev.slice(-4), { type, text }]);
		if (type !== 'error') setTimeout(() => setMessages((prev) => prev.slice(1)), 5000);
	};

	const load = useCallback(async () => {
		try {
			setLoading(true);
			const data = await analyzeRuntime(projectId);
			setAnalysis(data);
			const defaults: Record<string, string> = {};
			for (const v of data.envVars) {
				if (v.defaultValue) defaults[v.key] = v.defaultValue;
			}
			setEnvValues((prev) => ({ ...defaults, ...prev }));
			const methods: Record<string, DbProvisionMethod> = {};
			for (const db of data.databases) {
				methods[db.type] = 'docker';
			}
			setDbMethod((prev) => ({ ...methods, ...prev }));
		} catch {
			addMessage('error', 'Analiz baslatilamadi');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		load();
	}, [load]);

	const toggleSection = (key: string) => {
		setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
	};

	const handleSaveEnv = async () => {
		setActionLoading('env');
		try {
			const filled = Object.fromEntries(
				Object.entries(envValues).filter(([, v]) => v.trim().length > 0),
			);
			await saveEnvVars(projectId, filled);
			addMessage('success', '.env dosyasi guncellendi');
			await load();
		} catch {
			addMessage('error', '.env kaydedilemedi');
		}
		setActionLoading(null);
	};

	const handleInstallDeps = async (serviceName?: string) => {
		setActionLoading(serviceName ? `install-${serviceName}` : 'install-all');
		try {
			const result = await installDeps(projectId, serviceName);
			const failed = result.results.filter((r) => !r.success);
			if (failed.length > 0) {
				addMessage('error', `Kurulum basarisiz: ${failed.map((f) => f.name).join(', ')}`);
			} else {
				addMessage('success', 'Bagimliliklar kuruldu');
			}
			await load();
		} catch {
			addMessage('error', 'Kurulum hatasi');
		}
		setActionLoading(null);
	};

	const handleProvisionDb = async (dbType: DatabaseType) => {
		const method = dbMethod[dbType] || 'docker';
		setActionLoading(`db-${dbType}`);
		try {
			const result = await provisionDb(
				projectId,
				dbType,
				method,
				method === 'cloud' ? cloudUrls[dbType] : undefined,
			);
			if (result.ok) {
				addMessage('success', `${dbType} baslatildi`);
				await load();
			}
		} catch (err: any) {
			addMessage('error', err?.message || `${dbType} baslatilamadi`);
		}
		setActionLoading(null);
	};

	const handleStopDb = async (dbType: DatabaseType) => {
		setActionLoading(`db-stop-${dbType}`);
		try {
			await stopDb(projectId, dbType);
			addMessage('info', `${dbType} durduruldu`);
			await load();
		} catch {
			addMessage('error', `${dbType} durdurulamadi`);
		}
		setActionLoading(null);
	};

	const handleStartApp = async () => {
		setActionLoading('start-app');
		try {
			const result = await startApp(projectId);
			const status = await fetchAppStatus(projectId);
			addMessage('success', `${result.services?.length || 0} servis baslatildi`);
			onAppStarted?.(status);
		} catch (err: any) {
			addMessage('error', err?.message || 'Uygulama baslatilamadi');
		}
		setActionLoading(null);
	};

	if (loading && !analysis) {
		return (
			<div className="flex items-center justify-center h-full gap-2 text-[#a1a1aa]">
				<Loader2 size={18} className="animate-spin" /> Proje analiz ediliyor...
			</div>
		);
	}

	if (!analysis) return null;

	return (
		<div className="h-full overflow-auto p-4 space-y-4">
			{messages.length > 0 && (
				<div className="space-y-1">
					{messages.map((m, i) => (
						<div
							key={i}
							className={`text-xs px-3 py-1.5 rounded ${
								m.type === 'success'
									? 'bg-[#22c55e]/10 text-[#22c55e]'
									: m.type === 'error'
										? 'bg-[#ef4444]/10 text-[#ef4444]'
										: 'bg-[#3b82f6]/10 text-[#3b82f6]'
							}`}
						>
							{m.text}
						</div>
					))}
				</div>
			)}

			<Section
				title="Servisler"
				icon={<Server size={15} />}
				expanded={expandedSections.services}
				onToggle={() => toggleSection('services')}
				badge={analysis.services.length > 0 ? String(analysis.services.length) : undefined}
			>
				<ServiceList
					analysis={analysis}
					actionLoading={actionLoading}
					onInstallDeps={handleInstallDeps}
					onStartApp={handleStartApp}
				/>
			</Section>

			{analysis.databases.length > 0 && (
				<Section
					title="Databases"
					icon={<Database size={15} />}
					expanded={expandedSections.databases}
					onToggle={() => toggleSection('databases')}
					badge={String(analysis.databases.length)}
				>
					<DatabaseList
						analysis={analysis}
						dbMethod={dbMethod}
						cloudUrls={cloudUrls}
						actionLoading={actionLoading}
						onDbMethodChange={(dbType, method) =>
							setDbMethod((prev) => ({ ...prev, [dbType]: method }))
						}
						onCloudUrlChange={(dbType, url) =>
							setCloudUrls((prev) => ({ ...prev, [dbType]: url }))
						}
						onProvisionDb={handleProvisionDb}
						onStopDb={handleStopDb}
					/>
				</Section>
			)}

			<Section
				title="Ortam Degiskenleri"
				icon={<Key size={15} />}
				expanded={expandedSections.env}
				onToggle={() => toggleSection('env')}
				badge={analysis.envVars.length > 0 ? String(analysis.envVars.length) : undefined}
				status={
					analysis.allEnvVarsSet
						? 'ok'
						: analysis.envVars.some((v) => v.required)
							? 'warning'
							: undefined
				}
			>
				<EnvVarList
					envVars={analysis.envVars}
					envValues={envValues}
					showSensitive={showSensitive}
					actionLoading={actionLoading}
					onEnvValueChange={(key, value) =>
						setEnvValues((prev) => ({ ...prev, [key]: value }))
					}
					onToggleSensitive={(key) =>
						setShowSensitive((prev) => ({ ...prev, [key]: !prev[key] }))
					}
					onSaveEnv={handleSaveEnv}
				/>
			</Section>

			<div className="bg-[#18181b] rounded-lg border border-[#27272a] p-3">
				<div className="text-[10px] text-[#71717a] uppercase tracking-wide mb-2">Status Summary</div>
				<div className="grid grid-cols-2 gap-2 text-xs">
					<StatusItem
						label="Bagimliliklar"
						ok={analysis.allDepsInstalled}
						text={analysis.allDepsInstalled ? 'Kurulu' : 'Eksik'}
					/>
					<StatusItem
						label="Env Var"
						ok={analysis.allEnvVarsSet}
						text={analysis.allEnvVarsSet ? 'Tamam' : 'Eksik'}
					/>
					<StatusItem
						label="Veritabani"
						ok={analysis.dbReady || analysis.databases.length === 0}
						text={
							analysis.databases.length === 0
								? 'Gerekmiyor'
								: analysis.dbReady
									? 'Hazir'
									: 'Bekliyor'
						}
					/>
					<StatusItem
						label="Config"
						ok={analysis.hasStudioConfig}
						text={
							analysis.hasStudioConfig
								? '.studio.json'
								: analysis.hasDockerCompose
									? 'Docker'
									: 'Auto-detect'
						}
					/>
				</div>
			</div>
		</div>
	);
}
