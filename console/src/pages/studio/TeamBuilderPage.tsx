import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
  type OnConnect,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Loader2,
  Save,
  RotateCcw,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Plus,
  ArrowLeft,
  Pencil,
  Sparkles,
} from 'lucide-react';
import {
  fetchPresetAgents,
  fetchCustomTeams,
  fetchTeamTemplates,
  createCustomTeam,
  updateCustomTeam,
  deleteCustomTeam,
  roleLabel,
  type AgentConfig,
  type CustomTeamTemplate,
  type DependencyType,
  type TeamTemplate,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';
import PresetAgentSheet from './PresetAgentSheet';
import EdgeInfoPanel from './EdgeInfoPanel';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_MAP: Record<string, string> = {
  'product-owner': '#f59e0b',
  'scrum-master': '#06b6d4',
  'tech-lead': '#3b82f6',
  'business-analyst': '#8b5cf6',
  'design-lead': '#f472b6',
  'frontend-dev': '#ec4899',
  'backend-dev': '#22c55e',
  'frontend-qa': '#a855f7',
  'backend-qa': '#a855f7',
  'frontend-reviewer': '#ef4444',
  'backend-reviewer': '#ef4444',
  'security-reviewer': '#dc2626',
  'docs-writer': '#14b8a6',
  devops: '#0ea5e9',
};

const EDGE_STYLES: Record<DependencyType, { stroke: string; strokeDasharray?: string; animated?: boolean }> = {
  hierarchy: { stroke: '#525252', strokeDasharray: '5 5' },
  workflow: { stroke: '#3b82f6' },
  review: { stroke: '#a855f7', strokeDasharray: '8 4', animated: true },
  gate: { stroke: '#f59e0b' },
  escalation: { stroke: '#ef4444', strokeDasharray: '4 2' },
  pair: { stroke: '#22c55e', strokeDasharray: '2 2' },
  conditional: { stroke: '#f97316', strokeDasharray: '6 3' },
  fallback: { stroke: '#6b7280', strokeDasharray: '8 4' },
  notification: { stroke: '#06b6d4', strokeDasharray: '3 3' },
  handoff: { stroke: '#8b5cf6' },
  approval: { stroke: '#f59e0b', strokeDasharray: '4 4', animated: true },
  mentoring: { stroke: '#14b8a6', strokeDasharray: '6 2' },
};

const EDGE_LABELS: Record<DependencyType, string> = {
  hierarchy: 'Reports To',
  workflow: 'Workflow',
  review: 'Review',
  gate: 'Gate',
  escalation: 'Escalation',
  pair: 'Pair',
  conditional: 'Conditional',
  fallback: 'Fallback',
  notification: 'Notification',
  handoff: 'Handoff',
  approval: 'Approval',
  mentoring: 'Mentoring',
};

// ---------------------------------------------------------------------------
// Custom Node — role-based (not project agent)
// ---------------------------------------------------------------------------

type BuilderNodeData = {
  preset: AgentConfig;
  color: string;
};

function BuilderNode({ data }: NodeProps<Node<BuilderNodeData>>) {
  const { preset, color } = data;
  return (
    <div
      className="flex flex-col items-center p-3 rounded-xl bg-[#111111] border-2 transition-colors w-[120px] hover:bg-[#1a1a1a] cursor-grab active:cursor-grabbing"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#525252] !w-2 !h-2 !border-[#111111]" />
      <AgentAvatarImg avatar={preset.avatar} name={preset.name} size="md" className="mb-1" />
      <span className="text-[11px] font-semibold text-[#fafafa] text-center leading-tight truncate w-full">
        {preset.name}
      </span>
      <span
        className="text-[9px] font-medium px-1.5 py-0.5 rounded mt-1 truncate max-w-full text-center"
        style={{ backgroundColor: color + '20', color }}
      >
        {roleLabel(preset.role)}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-[#525252] !w-2 !h-2 !border-[#111111]" />
    </div>
  );
}

const nodeTypes = { agent: BuilderNode };

// ---------------------------------------------------------------------------
// Edge Type Picker
// ---------------------------------------------------------------------------

function EdgeTypePicker({
  position,
  onSelect,
  onCancel,
}: {
  position: { x: number; y: number };
  onSelect: (type: DependencyType) => void;
  onCancel: () => void;
}) {
  const types: DependencyType[] = ['workflow', 'review', 'gate', 'hierarchy', 'escalation', 'pair', 'conditional', 'fallback', 'notification', 'handoff', 'approval', 'mentoring'];
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onCancel} />
      <div
        className="fixed z-50 bg-[#111111] border border-[#333] rounded-lg shadow-xl p-1 min-w-[140px]"
        style={{ left: position.x, top: position.y }}
      >
        {types.map((type) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-[#e5e5e5] hover:bg-[#1f1f1f] rounded transition-colors"
          >
            <span className="w-3 h-0.5 rounded-full" style={{ backgroundColor: EDGE_STYLES[type].stroke }} />
            {EDGE_LABELS[type]}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Role Palette (sidebar — drag roles onto canvas)
// ---------------------------------------------------------------------------

function RolePalette({
  presets,
  placedRoles,
  collapsed,
  onToggle,
  onAgentClick,
}: {
  presets: AgentConfig[];
  placedRoles: Set<string>;
  collapsed: boolean;
  onToggle: () => void;
  onAgentClick?: (agent: AgentConfig) => void;
}) {
  const available = presets.filter((p) => !placedRoles.has(p.role));

  const onDragStart = (event: React.DragEvent, role: string) => {
    event.dataTransfer.setData('application/team-builder-role', role);
    event.dataTransfer.effectAllowed = 'move';
  };

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-8 bg-[#0a0a0a] border-r border-[#1f1f1f] hover:bg-[#111111] transition-colors"
      >
        <ChevronRight size={14} className="text-[#525252]" />
      </button>
    );
  }

  return (
    <div className="w-[180px] shrink-0 bg-[#0a0a0a] border-r border-[#1f1f1f] flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f1f1f]">
        <span className="text-[11px] font-semibold text-[#a3a3a3] uppercase">Roles</span>
        <button onClick={onToggle} className="text-[#525252] hover:text-[#a3a3a3]">
          <ChevronLeft size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {available.length === 0 && (
          <p className="text-[10px] text-[#525252] text-center py-4">All roles placed</p>
        )}
        {available.map((preset) => {
          const color = COLOR_MAP[preset.role] ?? '#525252';
          return (
            <div
              key={preset.role}
              draggable
              onDragStart={(e) => onDragStart(e, preset.role)}
              onClick={() => onAgentClick?.(preset)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#111111] border border-[#1f1f1f] cursor-grab active:cursor-grabbing hover:border-[#333] transition-colors"
            >
              <AgentAvatarImg avatar={preset.avatar} name={preset.name} size="xs" />
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-medium text-[#e5e5e5] block truncate">{preset.name}</span>
                <span className="text-[9px] block truncate" style={{ color }}>{roleLabel(preset.role)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-layout (Kahn's algorithm)
// ---------------------------------------------------------------------------

function autoLayout(
  roles: string[],
  deps: { from: string; to: string; type: string }[],
): Record<string, { x: number; y: number }> {
  const roleSet = new Set(roles);
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const r of roleSet) {
    predecessors.set(r, new Set());
    successors.set(r, new Set());
  }
  for (const dep of deps) {
    if (dep.type === 'hierarchy') continue;
    if (!roleSet.has(dep.from) || !roleSet.has(dep.to)) continue;
    predecessors.get(dep.to)!.add(dep.from);
    successors.get(dep.from)!.add(dep.to);
  }
  const inDegree = new Map<string, number>();
  for (const [id, preds] of predecessors) inDegree.set(id, preds.size);

  const waves: string[][] = [];
  const remaining = new Set(roleSet);
  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) wave.push(id);
    }
    if (wave.length === 0) { waves.push([...remaining]); break; }
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      for (const succId of successors.get(id) ?? []) {
        inDegree.set(succId, (inDegree.get(succId) ?? 1) - 1);
      }
    }
  }

  const NODE_W = 160;
  const NODE_H = 140;
  const positions: Record<string, { x: number; y: number }> = {};
  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const wave = waves[waveIdx];
    const totalWidth = wave.length * NODE_W;
    const startX = -totalWidth / 2 + NODE_W / 2;
    for (let i = 0; i < wave.length; i++) {
      positions[wave[i]] = { x: startX + i * NODE_W, y: waveIdx * NODE_H };
    }
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Flow Canvas
// ---------------------------------------------------------------------------

function FlowCanvas({
  presets,
  initialRoles,
  initialDeps,
  onSave,
  saving,
  onAgentClick,
}: {
  presets: AgentConfig[];
  initialRoles: string[];
  initialDeps: { from: string; to: string; type: string }[];
  onSave: (roles: string[], deps: { from: string; to: string; type: string }[]) => void;
  saving: boolean;
  onAgentClick?: (agent: AgentConfig) => void;
}) {
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

// ---------------------------------------------------------------------------
// Team List Sidebar
// ---------------------------------------------------------------------------

function TeamList({
  presetTeams,
  teams,
  selectedId,
  selectedPresetId,
  onSelect,
  onSelectPreset,
  onNew,
  onDelete,
}: {
  presetTeams: TeamTemplate[];
  teams: CustomTeamTemplate[];
  selectedId: string | null;
  selectedPresetId: string | null;
  onSelect: (id: string) => void;
  onSelectPreset: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="w-[220px] shrink-0 bg-[#0a0a0a] border-r border-[#1f1f1f] flex flex-col">
      {/* Preset Teams */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-[#1f1f1f]">
        <Sparkles size={11} className="text-[#a78bfa]" />
        <span className="text-[11px] font-semibold text-[#a3a3a3] uppercase">Preset Teams</span>
      </div>
      <div className="overflow-y-auto p-2 space-y-1 max-h-[40%]">
        {presetTeams.length === 0 && (
          <p className="text-[10px] text-[#525252] text-center py-4">No preset teams.</p>
        )}
        {presetTeams.map((t) => (
          <div
            key={t.id}
            onClick={() => onSelectPreset(t.id)}
            className={[
              'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
              selectedPresetId === t.id
                ? 'bg-[#1a1626] border border-[#a78bfa]/40'
                : 'hover:bg-[#111111] border border-transparent',
            ].join(' ')}
            title={t.description}
          >
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-medium text-[#e5e5e5] block truncate">{t.name}</span>
              <span className="text-[9px] text-[#525252]">{t.roles.length} roles</span>
            </div>
          </div>
        ))}
      </div>

      {/* My Teams */}
      <div className="flex items-center justify-between px-3 py-2.5 border-t border-b border-[#1f1f1f]">
        <span className="text-[11px] font-semibold text-[#a3a3a3] uppercase">My Teams</span>
        <button
          onClick={onNew}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[#22c55e] bg-[#22c55e]/10 rounded hover:bg-[#22c55e]/20 transition-colors"
        >
          <Plus size={11} /> New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {teams.length === 0 && (
          <p className="text-[10px] text-[#525252] text-center py-8">
            No custom teams yet. Click a preset above or "New" to create one.
          </p>
        )}
        {teams.map((t) => (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={[
              'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors group',
              selectedId === t.id
                ? 'bg-[#1f1f1f] border border-[#333]'
                : 'hover:bg-[#111111] border border-transparent',
            ].join(' ')}
          >
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-medium text-[#e5e5e5] block truncate">{t.name}</span>
              <span className="text-[9px] text-[#525252]">{t.roles.length} roles</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
              className="opacity-0 group-hover:opacity-100 p-1 text-[#525252] hover:text-[#ef4444] transition-all"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Name/Description Modal
// ---------------------------------------------------------------------------

function TeamNameModal({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; description: string };
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#111111] border border-[#262626] rounded-xl p-5 w-[380px] shadow-2xl">
        <h3 className="text-[14px] font-semibold text-[#fafafa] mb-4">
          {initial ? 'Edit Team' : 'New Team'}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[#737373] block mb-1">Team Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom Team"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[12px] text-[#e5e5e5] placeholder:text-[#525252] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>
          <div>
            <label className="text-[11px] text-[#737373] block mb-1">Description</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Brief description of the team"
              className="w-full px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[12px] text-[#e5e5e5] placeholder:text-[#525252] focus:outline-none focus:border-[#22c55e]/50"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-[#a3a3a3] hover:text-[#fafafa] transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onSave(name.trim(), desc.trim())}
            disabled={!name.trim()}
            className="px-3 py-1.5 text-[11px] font-medium text-[#0a0a0a] bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-40 transition-all"
          >
            {initial ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TeamBuilderPage() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState<AgentConfig[]>([]);
  const [presetTeams, setPresetTeams] = useState<TeamTemplate[]>([]);
  const [teams, setTeams] = useState<CustomTeamTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showNameModal, setShowNameModal] = useState<'new' | 'edit' | null>(null);

  // Pending canvas state (roles + deps) while naming
  const [pendingCanvas, setPendingCanvas] = useState<{ roles: string[]; deps: { from: string; to: string; type: string }[] } | null>(null);

  // Right-side sheet: selected preset agent
  const [sheetAgent, setSheetAgent] = useState<AgentConfig | null>(null);

  useEffect(() => {
    Promise.all([fetchPresetAgents(), fetchCustomTeams(), fetchTeamTemplates()])
      .then(([p, t, pt]) => {
        setPresets(p);
        setTeams(t);
        setPresetTeams(pt);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selected = teams.find((t) => t.id === selectedId);
  const selectedPreset = presetTeams.find((t) => t.id === selectedPresetId);

  const handleNew = useCallback(() => {
    setSelectedId(null);
    setSelectedPresetId(null);
  }, []);

  const handleSelectCustom = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedPresetId(null);
  }, []);

  const handleSelectPreset = useCallback((id: string) => {
    setSelectedPresetId(id);
    setSelectedId(null);
  }, []);

  const handleSave = useCallback((roles: string[], deps: { from: string; to: string; type: string }[]) => {
    if (roles.length === 0) return;
    setPendingCanvas({ roles, deps });
    setShowNameModal(selected ? 'edit' : 'new');
  }, [selected]);

  const handleNameSave = useCallback(async (name: string, description: string) => {
    if (!pendingCanvas) return;
    setSaving(true);
    try {
      if (selected && showNameModal === 'edit') {
        const updated = await updateCustomTeam(selected.id, {
          name,
          description,
          roles: pendingCanvas.roles,
          dependencies: pendingCanvas.deps,
        });
        setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelectedId(updated.id);
      } else {
        const created = await createCustomTeam({
          name,
          description,
          roles: pendingCanvas.roles,
          dependencies: pendingCanvas.deps,
        });
        setTeams((prev) => [created, ...prev]);
        setSelectedId(created.id);
        setSelectedPresetId(null);
      }
    } catch (err) {
      console.error('Failed to save team:', err);
    } finally {
      setSaving(false);
      setShowNameModal(null);
      setPendingCanvas(null);
    }
  }, [selected, showNameModal, pendingCanvas]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this custom team?')) return;
    try {
      await deleteCustomTeam(id);
      setTeams((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      console.error('Failed to delete team:', err);
    }
  }, [selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/studio')} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-[15px] font-semibold text-[#fafafa]">Team Builder</h1>
            <p className="text-[11px] text-[#525252]">Create reusable team configurations for your projects</p>
          </div>
        </div>
        {selected && (
          <button
            onClick={() => { setPendingCanvas({ roles: selected.roles, deps: selected.dependencies }); setShowNameModal('edit'); }}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#a3a3a3] bg-[#111111] border border-[#262626] rounded-lg hover:bg-[#1a1a1a] transition-all"
          >
            <Pencil size={11} /> Rename
          </button>
        )}
        {selectedPreset && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-[#a78bfa] bg-[#a78bfa]/10 border border-[#a78bfa]/30 rounded-lg">
            <Sparkles size={10} /> Preset template — click Save to create a custom copy
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-6 py-2 border-b border-[#1f1f1f] bg-[#0a0a0a]">
        <span className="text-[10px] text-[#525252] uppercase font-semibold">Edges:</span>
        {(['workflow', 'review', 'gate', 'hierarchy', 'escalation', 'pair', 'conditional', 'fallback', 'notification', 'handoff', 'approval', 'mentoring'] as DependencyType[]).map((type) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 rounded-full inline-block" style={{ backgroundColor: EDGE_STYLES[type].stroke }} />
            <span className="text-[10px] text-[#737373]">{EDGE_LABELS[type]}</span>
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <TeamList
          presetTeams={presetTeams}
          teams={teams}
          selectedId={selectedId}
          selectedPresetId={selectedPresetId}
          onSelect={handleSelectCustom}
          onSelectPreset={handleSelectPreset}
          onNew={handleNew}
          onDelete={handleDelete}
        />

        <ReactFlowProvider key={selectedId ?? selectedPresetId ?? '__new__'}>
          <FlowCanvas
            presets={presets}
            initialRoles={selected?.roles ?? selectedPreset?.roles ?? []}
            initialDeps={selected?.dependencies ?? selectedPreset?.dependencies ?? []}
            onSave={handleSave}
            saving={saving}
            onAgentClick={setSheetAgent}
          />
        </ReactFlowProvider>
      </div>

      {/* Name modal */}
      {showNameModal && (
        <TeamNameModal
          initial={showNameModal === 'edit' && selected ? { name: selected.name, description: selected.description } : undefined}
          onSave={handleNameSave}
          onCancel={() => { setShowNameModal(null); setPendingCanvas(null); }}
        />
      )}

      {/* Agent detail sheet (preset properties) */}
      {sheetAgent && (
        <PresetAgentSheet
          agent={sheetAgent}
          color={COLOR_MAP[sheetAgent.role] ?? '#525252'}
          onClose={() => setSheetAgent(null)}
        />
      )}
    </div>
  );
}
