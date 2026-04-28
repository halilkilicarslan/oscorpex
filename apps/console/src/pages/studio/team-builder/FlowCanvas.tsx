// ---------------------------------------------------------------------------
// Flow Canvas (ReactFlow)
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback } from 'react';
import {
	ReactFlow,
	Background,
	Controls,
	MiniMap,
	addEdge,
	useNodesState,
	useEdgesState,
	useReactFlow,
	type Node,
	type Edge,
	type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import type { AgentConfig, DependencyType } from '../../../lib/studio-api';
import BuilderNode, { type BuilderNodeData } from './BuilderNode.js';
import RolePalette from './RolePalette.js';
import EdgeTypePicker from './EdgeTypePicker.js';
import EdgeInfoPanel from '../EdgeInfoPanel';
import { COLOR_MAP, EDGE_STYLES, EDGE_LABELS } from './constants.js';
import { autoLayout } from './helpers.js';

const nodeTypes = { agent: BuilderNode };

interface FlowCanvasProps {
	presets: AgentConfig[];
	initialRoles: string[];
	initialDeps: { from: string; to: string; type: string }[];
	onSave: (roles: string[], deps: { from: string; to: string; type: string }[]) => void;
	saving: boolean;
	onAgentClick?: (agent: AgentConfig) => void;
}

export default function FlowCanvas({ presets, initialRoles, initialDeps, onSave, saving, onAgentClick }: FlowCanvasProps) {
	const presetMap = useMemo(() => new Map(presets.map((p) => [p.role, p])), [presets]);

	const { initNodes, initEdges } = useMemo(() => {
		const positions = autoLayout(initialRoles, initialDeps);
		const ns: Node[] = initialRoles.map((role) => {
			const preset = presetMap.get(role);
			const color = COLOR_MAP[role] ?? '#525252';
			return {
				id: role,
				type: 'agent',
				position: positions[role] ?? { x: 0, y: 0 },
				data: { preset: preset ?? { id: '', name: role, role, avatar: '', personality: '', model: '', cliTool: '', skills: [], systemPrompt: '', isPreset: true }, color },
			};
		});
		const es: Edge[] = initialDeps.map((dep, idx) => {
			const style = EDGE_STYLES[dep.type as DependencyType] ?? EDGE_STYLES.workflow;
			return {
				id: `${dep.from}-${dep.to}-${dep.type}-${idx}`,
				source: dep.from,
				target: dep.to,
				type: 'smoothstep',
				label: EDGE_LABELS[dep.type as DependencyType] ?? dep.type,
				style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray, strokeWidth: 2 },
				animated: style.animated ?? false,
				data: { type: dep.type },
				labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 600 },
				labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.9 },
				labelBgPadding: [4, 2] as [number, number],
			};
		});
		return { initNodes: ns, initEdges: es };
	}, [initialRoles, initialDeps, presetMap]);

	const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);
	const [paletteCollapsed, setPaletteCollapsed] = useState(false);
	const [pendingConnection, setPendingConnection] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
	const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<{ type: string; fromLabel?: string; toLabel?: string } | null>(null);
	const { screenToFlowPosition } = useReactFlow();

	const placedRoles = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

	const onConnect: OnConnect = useCallback((params) => {
		if (!params.source || !params.target) return;
		setPendingConnection({
			source: params.source,
			target: params.target,
			x: window.innerWidth / 2 - 70,
			y: window.innerHeight / 2 - 50,
		});
	}, []);

	const handleEdgeTypeSelect = useCallback((type: DependencyType) => {
		if (!pendingConnection) return;
		const { source, target } = pendingConnection;
		const style = EDGE_STYLES[type];
		setEdges((eds) =>
			addEdge({
				id: `${source}-${target}-${type}`,
				source,
				target,
				label: EDGE_LABELS[type],
				style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray, strokeWidth: 2 },
				animated: style.animated ?? false,
				data: { type },
				labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 600 },
				labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.9 },
				labelBgPadding: [4, 2] as [number, number],
			}, eds),
		);
		setPendingConnection(null);
	}, [pendingConnection, setEdges]);

	const onDragOver = useCallback((event: React.DragEvent) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
	}, []);

	const onDrop = useCallback((event: React.DragEvent) => {
		event.preventDefault();
		const role = event.dataTransfer.getData('application/team-builder-role');
		if (!role || placedRoles.has(role)) return;
		const preset = presetMap.get(role);
		if (!preset) return;
		const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		const color = COLOR_MAP[role] ?? '#525252';
		setNodes((nds) => [...nds, { id: role, type: 'agent', position, data: { preset, color } }]);
	}, [placedRoles, presetMap, screenToFlowPosition, setNodes]);

	const handleSaveClick = useCallback(() => {
		const roles = nodes.map((n) => n.id);
		const deps = edges.map((e) => ({
			from: e.source,
			to: e.target,
			type: (e.data?.type as string) ?? 'workflow',
		}));
		onSave(roles, deps);
	}, [nodes, edges, onSave]);

	const handleReset = useCallback(() => {
		setNodes(initNodes);
		setEdges(initEdges);
	}, [initNodes, initEdges, setNodes, setEdges]);

	return (
		<div className="flex flex-1 h-full overflow-hidden">
			<RolePalette
				presets={presets}
				placedRoles={placedRoles}
				collapsed={paletteCollapsed}
				onToggle={() => setPaletteCollapsed((p) => !p)}
				onAgentClick={onAgentClick}
			/>
			<div className="flex-1 relative">
				<div className="absolute top-3 right-3 z-10 flex items-center gap-2">
					<button
						onClick={handleReset}
						className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#a3a3a3] bg-[#111111] border border-[#262626] rounded-lg hover:bg-[#1a1a1a] transition-all"
					>
						<RotateCcw size={12} /> Reset
					</button>
					<button
						onClick={handleSaveClick}
						disabled={saving || nodes.length === 0}
						className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#0a0a0a] bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-40 transition-all"
					>
						{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
						Save Team
					</button>
				</div>

				<ReactFlow
					nodes={nodes}
					edges={edges}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					onDragOver={onDragOver}
					onDrop={onDrop}
					onNodeClick={(_, node) => {
						const data = node.data as BuilderNodeData | undefined;
						if (data?.preset && onAgentClick) onAgentClick(data.preset);
					}}
					onEdgeClick={(_, edge) => {
						const type = (edge.data as { type?: string } | undefined)?.type ?? 'workflow';
						const fromPreset = (nodes.find((n) => n.id === edge.source)?.data as BuilderNodeData | undefined)?.preset;
						const toPreset = (nodes.find((n) => n.id === edge.target)?.data as BuilderNodeData | undefined)?.preset;
						setSelectedEdgeInfo({
							type,
							fromLabel: fromPreset?.name ?? fromPreset?.role ?? edge.source,
							toLabel: toPreset?.name ?? toPreset?.role ?? edge.target,
						});
					}}
					onPaneClick={() => setSelectedEdgeInfo(null)}
					nodeTypes={nodeTypes}
					fitView
					className="bg-[#0a0a0a]"
					defaultEdgeOptions={{ type: 'smoothstep' }}
					connectionLineStyle={{ stroke: '#525252', strokeWidth: 2 }}
				>
					<Background color="#1a1a1a" gap={20} />
					<Controls className="!bg-[#111111] !border-[#262626] !shadow-none [&>button]:!bg-[#111111] [&>button]:!border-[#262626] [&>button]:!fill-[#a3a3a3] [&>button:hover]:!bg-[#1f1f1f]" />
					<MiniMap
						className="!bg-[#111111] !border-[#262626]"
						nodeColor={(node) => (node.data as BuilderNodeData)?.color ?? '#525252'}
						maskColor="rgba(0,0,0,0.7)"
					/>
				</ReactFlow>

				{pendingConnection && (
					<EdgeTypePicker
						position={{ x: pendingConnection.x, y: pendingConnection.y }}
						onSelect={handleEdgeTypeSelect}
						onCancel={() => setPendingConnection(null)}
					/>
				)}

				{selectedEdgeInfo && (
					<EdgeInfoPanel edge={selectedEdgeInfo} onClose={() => setSelectedEdgeInfo(null)} />
				)}
			</div>
		</div>
	);
}
