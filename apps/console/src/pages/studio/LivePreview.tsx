import {
	Braces,
	ExternalLink,
	Globe,
	Loader2,
	Maximize2,
	Minimize2,
	Monitor,
	RotateCcw,
	Server,
	Settings2,
	Smartphone,
	Tablet,
	Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type AppStatus,
	detectApiOnlyPreview,
	fetchAppStatus,
	fetchTasks,
	stopApp,
	switchPreviewService,
} from "../../lib/studio-api";
import ApiExplorer from "./ApiExplorer";
import RuntimePanel from "./RuntimePanel";

type DeviceSize = "mobile" | "tablet" | "desktop";
type ViewMode = "preview" | "api";

type TerminalEntry = {
	type: "cmd" | "output" | "error" | "info";
	text: string;
};

const DEVICE_SIZES: Record<DeviceSize, { width: string; label: string; icon: React.ReactNode }> = {
	mobile: { width: "375px", label: "Mobile", icon: <Smartphone size={14} /> },
	tablet: { width: "768px", label: "Tablet", icon: <Tablet size={14} /> },
	desktop: { width: "100%", label: "Desktop", icon: <Monitor size={14} /> },
};

export default function LivePreview({
	projectId,
	appStatus,
	onStatusChange,
}: {
	projectId: string;
	appStatus: AppStatus;
	onStatusChange: (status: AppStatus) => void;
}) {
	const [loading, setLoading] = useState(false);
	const [cliDemoLogs, setCliDemoLogs] = useState<string[]>([]);
	const [device, setDevice] = useState<DeviceSize>("desktop");
	const [fullscreen, setFullscreen] = useState(false);
	const [iframeKey, setIframeKey] = useState(0);
	const [selectedService, setSelectedService] = useState<string | null>(null);
	const [showRuntime, setShowRuntime] = useState(false);
	const [viewMode, setViewMode] = useState<ViewMode>("preview");
	const [isApiOnly, setIsApiOnly] = useState(false);
	const apiDetectedOnce = useRef(false);

	// Interactive terminal state
	const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([]);
	const [currentCmd, setCurrentCmd] = useState("");
	const [executing, setExecuting] = useState(false);
	const [terminalInfoLoaded, setTerminalInfoLoaded] = useState(false);
	const [repoExists, setRepoExists] = useState(false);
	const [repoCwd, setRepoCwd] = useState<string>("");
	const terminalRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Fetch CLI demo logs when app is not running (CLI projects)
	useEffect(() => {
		if (appStatus.running) return;
		fetchTasks(projectId)
			.then((tasks) => {
				const runAppTask = tasks.find(
					(t: any) => t.taskType === "run-app" && t.status === "done" && t.output?.logs?.length,
				);
				if (runAppTask?.output?.logs) {
					setCliDemoLogs(runAppTask.output.logs);
				}
			})
			.catch(() => {});
	}, [projectId, appStatus.running]);

	// Fetch terminal info (repo path existence) once
	useEffect(() => {
		if (terminalInfoLoaded) return;
		fetch(`/api/studio/projects/${projectId}/terminal/info`)
			.then((r) => r.json())
			.then((data: { cwd?: string; exists?: boolean }) => {
				setRepoExists(Boolean(data.exists));
				setRepoCwd(data.cwd ?? "");
				setTerminalInfoLoaded(true);
			})
			.catch(() => {
				setTerminalInfoLoaded(true);
			});
	}, [projectId, terminalInfoLoaded]);

	// Load CLI demo logs as initial terminal history (only once, when history is empty)
	useEffect(() => {
		if (cliDemoLogs.length === 0 || terminalHistory.length > 0) return;
		setTerminalHistory(
			cliDemoLogs.map(
				(line): TerminalEntry => ({
					type: line.startsWith("$ ")
						? "cmd"
						: line.startsWith("ERROR")
							? "error"
							: line.startsWith("[cli-demo]")
								? "info"
								: "output",
					text: line,
				}),
			),
		);
	}, [cliDemoLogs, terminalHistory.length]);

	// Auto-scroll terminal to bottom on new entries
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
		}
	}, [terminalHistory, executing]);

	const executeCommand = async () => {
		if (!currentCmd.trim() || executing) return;
		const cmd = currentCmd.trim();
		setCurrentCmd("");
		setTerminalHistory((h) => [...h, { type: "cmd", text: `$ ${cmd}` }]);
		setExecuting(true);

		try {
			const res = await fetch(`/api/studio/projects/${projectId}/terminal/exec`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ command: cmd }),
			});
			const data: { output?: string; exitCode?: number } = await res.json();
			if (data.output) {
				setTerminalHistory((h) => [
					...h,
					{
						type: data.exitCode === 0 ? "output" : "error",
						text: data.output!,
					},
				]);
			}
		} catch (err) {
			setTerminalHistory((h) => [...h, { type: "error", text: `Network error: ${err}` }]);
		}

		setExecuting(false);
		inputRef.current?.focus();
	};

	// Determine preview URL
	const services = appStatus.services || [];
	const activeService = selectedService
		? services.find((s) => s.name === selectedService)
		: services.find((s) => s.isPreview) || services[0];
	const directUrl = activeService?.url || appStatus.previewUrl || appStatus.frontendUrl || appStatus.backendUrl;
	// Direct URL for iframe — proxy can't handle ES module imports in inline scripts
	const previewUrl = directUrl || null;
	// Proxy URL for API-only detection (avoids CORS on cross-origin fetch)
	const canProbeProxy = Boolean(directUrl);

	// API-only detection: proxy root'u kontrol et (sadece ilk seferde viewMode ayarla)
	useEffect(() => {
		if (!canProbeProxy || !appStatus.running) return;
		detectApiOnlyPreview(projectId)
			.then((apiOnly) => {
				setIsApiOnly(apiOnly);
				if (apiOnly && !apiDetectedOnce.current) {
					setIsApiOnly(true);
					apiDetectedOnce.current = true;
					setViewMode("api");
				}
			})
			.catch((err) => console.error("[LivePreview] API-only detection failed:", err));
	}, [canProbeProxy, appStatus.running, projectId]);

	const handleSwitchService = async (serviceName: string) => {
		setSelectedService(serviceName);
		// Backend proxy hedefini değiştir
		await switchPreviewService(projectId, serviceName).catch((err) =>
			console.error("[LivePreview] Switch service failed:", err),
		);
		// API-only state'i resetle — yeni service'te tekrar algılansın
		apiDetectedOnce.current = false;
		setIsApiOnly(false);
		setViewMode("preview");
		setIframeKey((k) => k + 1);
		// Kısa gecikme sonrası yeni hedefi kontrol et
		setTimeout(() => {
			detectApiOnlyPreview(projectId)
				.then((apiOnly) => {
					if (apiOnly) {
						setIsApiOnly(true);
						setViewMode("api");
					}
					apiDetectedOnce.current = true;
				})
				.catch((err) => console.error("[LivePreview] API-only re-detection failed:", err));
		}, 500);
	};

	const handleStop = async () => {
		setLoading(true);
		try {
			await stopApp(projectId);
			const status = await fetchAppStatus(projectId);
			onStatusChange(status);
		} catch {
			/* ignore */
		}
		setLoading(false);
	};

	// Interactive terminal section renderer
	const renderTerminal = () => (
		<div className="flex flex-col h-full bg-[#0a0a0a]">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-2 border-b border-[#262626] bg-[#111111] shrink-0">
				<div className="flex items-center gap-2">
					<Terminal size={12} className="text-[#22c55e]" />
					<span className="text-[12px] text-[#e5e5e5] font-medium">Terminal</span>
					{repoCwd && (
						<span className="text-[10px] text-[#525252] font-mono truncate max-w-[240px]" title={repoCwd}>
							{repoCwd}
						</span>
					)}
					{executing && (
						<span className="flex items-center gap-1 text-[10px] text-[#f59e0b]">
							<Loader2 size={10} className="animate-spin" />
							running…
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={() => {
						setTerminalHistory([]);
						setCliDemoLogs([]);
					}}
					className="text-[10px] text-[#525252] hover:text-[#a3a3a3] px-2 py-1 rounded hover:bg-[#1a1a1a] transition-colors"
				>
					Clear
				</button>
			</div>

			{/* Terminal output */}
			<div
				ref={terminalRef}
				className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed cursor-text"
				onClick={() => inputRef.current?.focus()}
			>
				{terminalHistory.length === 0 && !executing && (
					<div className="text-[#333] text-[12px]">
						{repoExists
							? "Type a command below to get started."
							: "Project repository directory not found. Run the pipeline first."}
					</div>
				)}
				{terminalHistory.map((entry, i) => (
					<div
						key={i}
						className={`whitespace-pre-wrap break-all ${
							entry.type === "cmd"
								? "text-[#22c55e] font-semibold mt-2"
								: entry.type === "error"
									? "text-[#ef4444]"
									: entry.type === "info"
										? "text-[#525252] text-[11px]"
										: "text-[#d4d4d4]"
						}`}
					>
						{entry.text}
					</div>
				))}
				{executing && <div className="text-[#525252] animate-pulse mt-1 text-[12px]">Running…</div>}
			</div>

			{/* Command input */}
			<div className="flex items-center gap-2 px-4 py-3 border-t border-[#262626] bg-[#111111] shrink-0">
				<span className="text-[#22c55e] font-mono text-[13px] select-none">$</span>
				<input
					ref={inputRef}
					type="text"
					value={currentCmd}
					onChange={(e) => setCurrentCmd(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") executeCommand();
					}}
					placeholder={repoExists ? "Type a command and press Enter…" : "Repository not ready"}
					disabled={executing || !repoExists}
					className="flex-1 bg-transparent text-[#d4d4d4] font-mono text-[13px] outline-none placeholder-[#333] disabled:opacity-40"
				/>
			</div>
		</div>
	);

	// Show terminal when:
	// 1. App is not running and there are CLI demo logs, OR
	// 2. App is not running, no preview URL, and repo exists (user can still use terminal), OR
	// 3. Terminal has history from user commands (even after demo logs cleared)
	const shouldShowTerminal =
		!appStatus.running &&
		!previewUrl &&
		(cliDemoLogs.length > 0 || terminalHistory.length > 0 || (terminalInfoLoaded && repoExists));

	if (shouldShowTerminal) {
		return renderTerminal();
	}

	// App not running and no repo available — show RuntimePanel
	if (!appStatus.running || !previewUrl) {
		return <RuntimePanel projectId={projectId} onAppStarted={(status) => onStatusChange(status)} />;
	}

	// App running — show full toolbar + content
	return (
		<div className={`flex flex-col h-full ${fullscreen ? "fixed inset-0 z-50 bg-[#0a0a0a]" : ""}`}>
			{/* Toolbar */}
			<div className="flex items-center justify-between px-4 py-2 border-b border-[#262626] bg-[#111111] shrink-0">
				<div className="flex items-center gap-1">
					{/* View mode toggle */}
					<div className="flex items-center bg-[#0a0a0a] rounded-lg p-0.5 mr-2">
						<button
							type="button"
							onClick={() => setViewMode("preview")}
							className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${
								viewMode === "preview" ? "bg-[#1a1a1a] text-[#e5e5e5]" : "text-[#525252] hover:text-[#a3a3a3]"
							}`}
						>
							<Globe size={12} />
							Preview
						</button>
						<button
							type="button"
							onClick={() => setViewMode("api")}
							className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${
								viewMode === "api" ? "bg-[#3b82f6]/10 text-[#3b82f6]" : "text-[#525252] hover:text-[#a3a3a3]"
							}`}
						>
							<Braces size={12} />
							API Explorer
						</button>
					</div>

					{/* Device size — only for preview mode */}
					{viewMode === "preview" &&
						(Object.entries(DEVICE_SIZES) as [DeviceSize, typeof DEVICE_SIZES.mobile][]).map(([key, val]) => (
							<button
								key={key}
								type="button"
								onClick={() => setDevice(key)}
								className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
									device === key
										? "bg-[#22c55e]/10 text-[#22c55e]"
										: "text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a]"
								}`}
							>
								{val.icon}
								{val.label}
							</button>
						))}
				</div>

				<div className="flex items-center gap-2 text-[11px] text-[#525252]">
					{/* Service badges */}
					<div className="flex items-center gap-1">
						{services.map((s) => (
							<button
								key={s.name}
								type="button"
								onClick={() => handleSwitchService(s.name)}
								className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
									s.name === activeService?.name
										? "bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20"
										: "bg-[#1a1a1a] text-[#71717a] hover:text-[#a3a3a3] hover:bg-[#262626]"
								}`}
								title={s.url}
							>
								<span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
								<Server size={9} />
								<span>{s.name}</span>
								<span className="text-[#525252]">{s.url.replace("http://localhost:", ":")}</span>
							</button>
						))}
					</div>
					{isApiOnly && viewMode === "preview" && (
						<span className="text-[10px] text-[#f59e0b] px-1.5 py-0.5 rounded bg-[#f59e0b]/10">API-only</span>
					)}
				</div>

				<div className="flex items-center gap-1">
					{viewMode === "preview" && (
						<button
							type="button"
							onClick={() => setIframeKey((k) => k + 1)}
							className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
							title="Yenile"
						>
							<RotateCcw size={14} />
						</button>
					)}
					<a
						href={directUrl || "#"}
						target="_blank"
						rel="noreferrer"
						className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
						title="Yeni sekmede ac"
					>
						<ExternalLink size={14} />
					</a>
					<button
						type="button"
						onClick={() => setFullscreen((f) => !f)}
						className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
						title={fullscreen ? "Kucult" : "Tam ekran"}
					>
						{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
					</button>
					<button
						type="button"
						onClick={() => setShowRuntime((r) => !r)}
						className={`p-1.5 rounded-lg transition-colors ${
							showRuntime ? "text-[#3b82f6] bg-[#3b82f6]/10" : "text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a]"
						}`}
						title="Runtime Ayarlari"
					>
						<Settings2 size={14} />
					</button>
					<button
						type="button"
						onClick={handleStop}
						disabled={loading}
						className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-50"
					>
						{loading ? <Loader2 size={12} className="animate-spin" /> : null}
						Durdur
					</button>
				</div>
			</div>

			{/* Content area */}
			<div className="flex-1 flex overflow-hidden">
				{/* Runtime side panel */}
				{showRuntime && (
					<div className="w-[340px] shrink-0 border-r border-[#262626] bg-[#0a0a0a] overflow-auto">
						<RuntimePanel projectId={projectId} onAppStarted={onStatusChange} />
					</div>
				)}

				{/* Main content: Preview or API Explorer */}
				{viewMode === "api" ? (
					<ApiExplorer projectId={projectId} />
				) : (
					<div className="flex-1 flex items-start justify-center overflow-auto bg-[#0a0a0a] p-4">
						<div
							className="h-full bg-white rounded-lg overflow-hidden shadow-2xl transition-all duration-300"
							style={{ width: DEVICE_SIZES[device].width, maxWidth: "100%" }}
						>
							<iframe
								key={iframeKey}
								src={previewUrl}
								className="w-full h-full border-0"
								title="Live Preview"
								sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
