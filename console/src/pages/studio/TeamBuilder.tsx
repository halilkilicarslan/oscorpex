import { useState, useEffect, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import {
  fetchProjectAgents,
  fetchDependencies,
  saveDependencies,
  roleLabel,
  type ProjectAgent,
  type AgentDependency,
  type DependencyType,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

// ---------------------------------------------------------------------------
// Edge stil sabitleri
// ---------------------------------------------------------------------------

const EDGE_STYLES: Record<DependencyType, { stroke: string; strokeDasharray?: string; animated?: boolean }> = {
  hierarchy: { stroke: '#525252', strokeDasharray: '5 5' },
  workflow:  { stroke: '#3b82f6' },
  review:   { stroke: '#a855f7', strokeDasharray: '8 4', animated: true },
  gate:     { stroke: '#f59e0b' },
};

const EDGE_LABELS: Record<DependencyType, string> = {
  hierarchy: 'Reports To',
  workflow:  'Workflow',
  review:    'Review',
  gate:      'Gate',
};

// ---------------------------------------------------------------------------
// Custom Agent Node
// ---------------------------------------------------------------------------

type AgentNodeData = {
  agent: ProjectAgent;
  selected?: boolean;
};

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { agent } = data;
  return (
    <div
      className={[
        'flex flex-col items-center p-3 rounded-xl bg-[#111111] border-2 transition-colors w-[120px]',
        'hover:bg-[#1a1a1a] cursor-grab active:cursor-grabbing',
      ].join(' ')}
      style={{ borderColor: agent.color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#525252] !w-2 !h-2 !border-[#111111]" />
      <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="md" className="mb-1" />
      <span className="text-[11px] font-semibold text-[#fafafa] text-center leading-tight truncate w-full">
        {agent.name}
      </span>
      <span
        className="text-[9px] font-medium px-1.5 py-0.5 rounded mt-1 truncate max-w-full text-center"
        style={{ backgroundColor: agent.color + '20', color: agent.color }}
      >
        {roleLabel(agent.role)}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-[#525252] !w-2 !h-2 !border-[#111111]" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

// ---------------------------------------------------------------------------
// Edge Type Picker Modal
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
  const types: DependencyType[] = ['workflow', 'review', 'gate', 'hierarchy'];
  return (
    <>
      {/* Backdrop */}
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
            <span
              className="w-3 h-0.5 rounded-full"
              style={{ backgroundColor: EDGE_STYLES[type].stroke }}
            />
            {EDGE_LABELS[type]}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Agent Palette (sidebar)
// ---------------------------------------------------------------------------

function AgentPalette({
  agents,
  collapsed,
  onToggle,
}: {
  agents: ProjectAgent[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const onDragStart = (event: React.DragEvent, agentId: string) => {
    event.dataTransfer.setData('application/team-builder', agentId);
    event.dataTransfer.effectAllowed = 'move';
  };

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-8 bg-[#0a0a0a] border-r border-[#1f1f1f] hover:bg-[#111111] transition-colors"
        title="Agent palette'i aç"
      >
        <ChevronRight size={14} className="text-[#525252]" />
      </button>
    );
  }

  return (
    <div className="w-[180px] shrink-0 bg-[#0a0a0a] border-r border-[#1f1f1f] flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f1f1f]">
        <span className="text-[11px] font-semibold text-[#a3a3a3] uppercase">Agents</span>
        <button onClick={onToggle} className="text-[#525252] hover:text-[#a3a3a3]">
          <ChevronLeft size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {agents.map((agent) => (
          <div
            key={agent.id}
            draggable
            onDragStart={(e) => onDragStart(e, agent.id)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#111111] border border-[#1f1f1f] cursor-grab active:cursor-grabbing hover:border-[#333] transition-colors"
          >
            <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="xs" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-medium text-[#e5e5e5] block truncate">
                {agent.name}
              </span>
              <span className="text-[9px] block truncate" style={{ color: agent.color }}>
                {roleLabel(agent.role)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties Panel
// ---------------------------------------------------------------------------

function PropertiesPanel({
  selectedAgent,
  selectedEdge,
  edges,
  agents,
  onDeleteEdge,
}: {
  selectedAgent: ProjectAgent | null;
  selectedEdge: Edge | null;
  edges: Edge[];
  agents: ProjectAgent[];
  onDeleteEdge: (edgeId: string) => void;
}) {
  if (selectedEdge) {
    const depType = (selectedEdge.data?.type as DependencyType) ?? 'workflow';
    const from = agents.find((a) => a.id === selectedEdge.source);
    const to = agents.find((a) => a.id === selectedEdge.target);
    return (
      <div className="w-[200px] shrink-0 bg-[#0a0a0a] border-l border-[#1f1f1f] p-3">
        <h4 className="text-[11px] font-semibold text-[#a3a3a3] uppercase mb-3">Edge</h4>
        <div className="space-y-2 text-[10px]">
          <div>
            <span className="text-[#525252]">Type:</span>
            <span className="text-[#e5e5e5] ml-1 font-medium">{EDGE_LABELS[depType]}</span>
          </div>
          <div>
            <span className="text-[#525252]">From:</span>
            <span className="text-[#e5e5e5] ml-1">{from?.name ?? selectedEdge.source}</span>
          </div>
          <div>
            <span className="text-[#525252]">To:</span>
            <span className="text-[#e5e5e5] ml-1">{to?.name ?? selectedEdge.target}</span>
          </div>
          <button
            onClick={() => onDeleteEdge(selectedEdge.id)}
            className="flex items-center gap-1 mt-3 px-2 py-1 text-[10px] text-[#ef4444] border border-[#ef4444]/20 rounded hover:bg-[#ef4444]/10 transition-colors"
          >
            <Trash2 size={10} /> Remove
          </button>
        </div>
      </div>
    );
  }

  if (selectedAgent) {
    return (
      <div className="w-[200px] shrink-0 bg-[#0a0a0a] border-l border-[#1f1f1f] p-3">
        <h4 className="text-[11px] font-semibold text-[#a3a3a3] uppercase mb-3">Agent</h4>
        <div className="flex flex-col items-center mb-3">
          <AgentAvatarImg avatar={selectedAgent.avatar} name={selectedAgent.name} size="lg" />
          <span className="text-[12px] font-semibold text-[#fafafa] mt-1">{selectedAgent.name}</span>
          <span className="text-[10px]" style={{ color: selectedAgent.color }}>{roleLabel(selectedAgent.role)}</span>
        </div>
        <div className="space-y-1.5 text-[10px]">
          <div>
            <span className="text-[#525252]">Model:</span>
            <span className="text-[#a3a3a3] ml-1">{selectedAgent.model || 'Default'}</span>
          </div>
          <div>
            <span className="text-[#525252]">CLI Tool:</span>
            <span className="text-[#a3a3a3] ml-1">{selectedAgent.cliTool}</span>
          </div>
          {selectedAgent.skills.length > 0 && (
            <div>
              <span className="text-[#525252]">Skills:</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedAgent.skills.map((s) => (
                  <span key={s} className="px-1 py-0.5 bg-[#1f1f1f] text-[#737373] rounded text-[9px]">{s}</span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2">
            <span className="text-[#525252]">Connections:</span>
            <span className="text-[#a3a3a3] ml-1">
              {edges.filter((e) => e.source === selectedAgent.id || e.target === selectedAgent.id).length}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[200px] shrink-0 bg-[#0a0a0a] border-l border-[#1f1f1f] p-3 flex items-center justify-center">
      <p className="text-[10px] text-[#525252] text-center">
        Click a node or edge to see details
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Flow Canvas
// ---------------------------------------------------------------------------

function FlowCanvas({
  agents,
  initialNodes,
  initialEdges,
  onSave,
  saving,
}: {
  agents: ProjectAgent[];
  initialNodes: Node[];
  initialEdges: Edge[];
  onSave: (edges: Edge[]) => void;
  saving: boolean;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedAgent, setSelectedAgent] = useState<ProjectAgent | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Agents already on canvas
  const placedAgentIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  // Unplaced agents for palette
  const paletteAgents = useMemo(
    () => agents.filter((a) => !placedAgentIds.has(a.id)),
    [agents, placedAgentIds],
  );

  // Connection handler — show edge type picker
  const onConnect: OnConnect = useCallback(
    (params) => {
      if (!params.source || !params.target) return;
      // Show picker at approximate midpoint (use fixed position for simplicity)
      setPendingConnection({
        source: params.source,
        target: params.target,
        x: window.innerWidth / 2 - 70,
        y: window.innerHeight / 2 - 50,
      });
    },
    [],
  );

  const handleEdgeTypeSelect = useCallback(
    (type: DependencyType) => {
      if (!pendingConnection) return;
      const { source, target } = pendingConnection;
      const edgeId = `${source}-${target}-${type}`;
      const style = EDGE_STYLES[type];
      setEdges((eds) =>
        addEdge(
          {
            id: edgeId,
            source,
            target,
            label: EDGE_LABELS[type],
            style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray, strokeWidth: 2 },
            animated: style.animated ?? false,
            data: { type },
            labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 600 },
            labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.9 },
            labelBgPadding: [4, 2] as [number, number],
          },
          eds,
        ),
      );
      setPendingConnection(null);
    },
    [pendingConnection, setEdges],
  );

  // Drag and drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const agentId = event.dataTransfer.getData('application/team-builder');
      if (!agentId) return;
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;
      // Already on canvas?
      if (placedAgentIds.has(agentId)) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newNode: Node = {
        id: agent.id,
        type: 'agent',
        position,
        data: { agent },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [agents, placedAgentIds, screenToFlowPosition, setNodes],
  );

  // Node click → select agent
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const agent = agents.find((a) => a.id === node.id);
      setSelectedAgent(agent ?? null);
      setSelectedEdge(null);
    },
    [agents],
  );

  // Edge click → select edge
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      setSelectedEdge(edge);
      setSelectedAgent(null);
    },
    [],
  );

  // Click on pane → deselect
  const onPaneClick = useCallback(() => {
    setSelectedAgent(null);
    setSelectedEdge(null);
  }, []);

  // Delete edge
  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdge(null);
    },
    [setEdges],
  );

  // Reset — reload from initial
  const handleReset = useCallback(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedAgent(null);
    setSelectedEdge(null);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const hasChanges = useMemo(() => {
    const currentEdgeSet = new Set(edges.map((e) => `${e.source}-${e.target}-${e.data?.type}`));
    const initialEdgeSet = new Set(initialEdges.map((e) => `${e.source}-${e.target}-${e.data?.type}`));
    return currentEdgeSet.size !== initialEdgeSet.size ||
      [...currentEdgeSet].some((e) => !initialEdgeSet.has(e));
  }, [edges, initialEdges]);

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <AgentPalette
        agents={paletteAgents}
        collapsed={paletteCollapsed}
        onToggle={() => setPaletteCollapsed((p) => !p)}
      />

      <div className="flex-1 relative">
        {/* Toolbar */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#a3a3a3] bg-[#111111] border border-[#262626] rounded-lg hover:bg-[#1a1a1a] disabled:opacity-30 transition-all"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={() => onSave(edges)}
            disabled={saving || !hasChanges}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#0a0a0a] bg-[#22c55e] rounded-lg hover:bg-[#16a34a] disabled:opacity-40 transition-all"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
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
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
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
            nodeColor={(node) => {
              const agent = (node.data as AgentNodeData)?.agent;
              return agent?.color ?? '#525252';
            }}
            maskColor="rgba(0,0,0,0.7)"
          />
        </ReactFlow>

        {/* Edge type picker */}
        {pendingConnection && (
          <EdgeTypePicker
            position={{ x: pendingConnection.x, y: pendingConnection.y }}
            onSelect={handleEdgeTypeSelect}
            onCancel={() => setPendingConnection(null)}
          />
        )}
      </div>

      <PropertiesPanel
        selectedAgent={selectedAgent}
        selectedEdge={selectedEdge}
        edges={edges}
        agents={agents}
        onDeleteEdge={handleDeleteEdge}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helper — auto-position agents in a hierarchical layout
// ---------------------------------------------------------------------------

function autoLayout(agents: ProjectAgent[], deps: AgentDependency[]): Record<string, { x: number; y: number }> {
  // Build wave groups (same logic as pipeline engine DAG)
  const agentIds = new Set(agents.map((a) => a.id));
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const id of agentIds) {
    predecessors.set(id, new Set());
    successors.set(id, new Set());
  }

  for (const dep of deps) {
    if (dep.type === 'hierarchy') continue;
    if (!agentIds.has(dep.fromAgentId) || !agentIds.has(dep.toAgentId)) continue;
    predecessors.get(dep.toAgentId)!.add(dep.fromAgentId);
    successors.get(dep.fromAgentId)!.add(dep.toAgentId);
  }

  // Kahn's algorithm for wave grouping
  const inDegree = new Map<string, number>();
  for (const [id, preds] of predecessors) inDegree.set(id, preds.size);

  const waves: string[][] = [];
  const remaining = new Set(agentIds);

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) wave.push(id);
    }
    if (wave.length === 0) {
      waves.push([...remaining]);
      break;
    }
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      for (const succId of successors.get(id) ?? []) {
        inDegree.set(succId, (inDegree.get(succId) ?? 1) - 1);
      }
    }
  }

  // Position: each wave is a row, agents spread horizontally
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
// Main TeamBuilder wrapper — loads data, converts to React Flow format
// ---------------------------------------------------------------------------

export default function TeamBuilder({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [deps, setDeps] = useState<AgentDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProjectAgents(projectId), fetchDependencies(projectId)])
      .then(([a, d]) => { setAgents(a); setDeps(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  // Convert DB data → React Flow nodes & edges
  const { initialNodes, initialEdges } = useMemo(() => {
    const positions = autoLayout(agents, deps);

    const nodes: Node[] = agents.map((agent) => ({
      id: agent.id,
      type: 'agent',
      position: positions[agent.id] ?? { x: 0, y: 0 },
      data: { agent },
    }));

    const edges: Edge[] = deps.map((dep) => {
      const style = EDGE_STYLES[dep.type];
      return {
        id: dep.id,
        source: dep.fromAgentId,
        target: dep.toAgentId,
        type: 'smoothstep',
        label: EDGE_LABELS[dep.type],
        style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray, strokeWidth: 2 },
        animated: style.animated ?? false,
        data: { type: dep.type },
        labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
      };
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [agents, deps]);

  // Save handler — extract edges → dependencies, PUT to API
  const handleSave = useCallback(
    async (currentEdges: Edge[]) => {
      setSaving(true);
      try {
        const newDeps = currentEdges.map((e) => ({
          fromAgentId: e.source,
          toAgentId: e.target,
          type: (e.data?.type as DependencyType) ?? 'workflow',
        }));
        const saved = await saveDependencies(projectId, newDeps);
        setDeps(saved);
      } catch (err) {
        console.error('[TeamBuilder] Save failed:', err);
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <p className="text-[13px] text-[#525252]">No agents in this project. Add agents first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[#1f1f1f] bg-[#0a0a0a]">
        <span className="text-[10px] text-[#525252] uppercase font-semibold">Edges:</span>
        {(['workflow', 'review', 'gate', 'hierarchy'] as DependencyType[]).map((type) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="w-4 h-0.5 rounded-full inline-block"
              style={{
                backgroundColor: EDGE_STYLES[type].stroke,
                ...(EDGE_STYLES[type].strokeDasharray ? { opacity: 0.7 } : {}),
              }}
            />
            <span className="text-[10px] text-[#737373]">{EDGE_LABELS[type]}</span>
          </div>
        ))}
      </div>

      <ReactFlowProvider>
        <FlowCanvas
          agents={agents}
          initialNodes={initialNodes}
          initialEdges={initialEdges}
          onSave={handleSave}
          saving={saving}
        />
      </ReactFlowProvider>
    </div>
  );
}
