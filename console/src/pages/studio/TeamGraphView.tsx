// ---------------------------------------------------------------------------
// TeamGraphView — TeamBuilderPage stili React Flow takım bağımlılık grafiği
// PipelineDashboard ve OrgChart tarafından paylaşılan bileşen
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, ChevronUp } from 'lucide-react';
import AgentAvatarImg from '../../components/AgentAvatar';
import {
  fetchProjectAgents,
  fetchProjectDependencies,
  roleLabel,
  type ProjectAgent,
  type AgentDependency,
} from '../../lib/studio-api';
import { TEAM_COLOR_MAP, EDGE_STYLES, EDGE_LABELS } from './team-graph-shared';
import EdgeInfoPanel from './EdgeInfoPanel';

// ---- Auto-layout (Kahn's dalgaları) ----------------------------------------

function teamAutoLayout(
  agents: ProjectAgent[],
  deps: AgentDependency[],
): Record<string, { x: number; y: number }> {
  const idSet = new Set(agents.map((a) => a.id));
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const id of idSet) {
    predecessors.set(id, new Set());
    successors.set(id, new Set());
  }
  for (const dep of deps) {
    if (dep.type === 'hierarchy' || dep.type === 'notification' || dep.type === 'mentoring') continue;
    if (!idSet.has(dep.fromAgentId) || !idSet.has(dep.toAgentId)) continue;
    predecessors.get(dep.toAgentId)!.add(dep.fromAgentId);
    successors.get(dep.fromAgentId)!.add(dep.toAgentId);
  }
  const inDegree = new Map<string, number>();
  for (const [id, preds] of predecessors) inDegree.set(id, preds.size);

  const waves: string[][] = [];
  const remaining = new Set(idSet);
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

// ---- Node rendering --------------------------------------------------------

function TeamGraphNode({ data }: NodeProps<Node<{ agent: ProjectAgent; color: string }>>) {
  const { agent, color } = data;
  return (
    <div
      className="flex flex-col items-center p-3 rounded-xl bg-[#111111] border-2 transition-colors w-[120px]"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#525252] !w-2 !h-2 !border-[#111111]" />
      <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="md" className="mb-1" />
      <span className="text-[11px] font-semibold text-[#fafafa] text-center leading-tight truncate w-full">
        {agent.name}
      </span>
      <span
        className="text-[9px] font-medium px-1.5 py-0.5 rounded mt-1 truncate max-w-full text-center"
        style={{ backgroundColor: color + '20', color }}
      >
        {roleLabel(agent.role)}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-[#525252] !w-2 !h-2 !border-[#111111]" />
    </div>
  );
}

const teamNodeTypes = { agent: TeamGraphNode };

// ---- Ana bileşen -----------------------------------------------------------

export interface TeamGraphViewProps {
  projectId: string;
  /** Collapsible başlık ve toggle göster. Varsayılan: true */
  collapsible?: boolean;
  /** Collapsible true iken başlangıç açık mı? Varsayılan: true */
  initiallyOpen?: boolean;
  /** Canvas yüksekliği (px). fill=true ise kapsayıcı yüksekliği kullanılır. */
  height?: number;
  /** Kapsayıcının tüm yüksekliğini doldur (OrgChart için). */
  fill?: boolean;
}

export default function TeamGraphView({
  projectId,
  collapsible = true,
  initiallyOpen = true,
  height,
  fill = false,
}: TeamGraphViewProps) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [deps, setDeps] = useState<AgentDependency[]>([]);
  const [collapsed, setCollapsed] = useState(!initiallyOpen);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedEdge, setSelectedEdge] = useState<{
    type: string;
    fromAgent?: ProjectAgent;
    toAgent?: ProjectAgent;
  } | null>(null);

  useEffect(() => {
    fetchProjectAgents(projectId).then(setAgents).catch(() => {});
    fetchProjectDependencies(projectId).then(setDeps).catch(() => {});
  }, [projectId]);

  // Agent/deps verisi değiştiğinde node/edge listelerini yeniden hesapla.
  // Kullanıcının sürükleyerek konumlandırdığı node'ları koru.
  useEffect(() => {
    if (agents.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const positions = teamAutoLayout(agents, deps);
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      return agents.map((agent) => {
        const color = TEAM_COLOR_MAP[agent.role] ?? '#525252';
        return {
          id: agent.id,
          type: 'agent',
          position: prevPos.get(agent.id) ?? positions[agent.id] ?? { x: 0, y: 0 },
          data: { agent, color },
        } as Node;
      });
    });
    setEdges(
      deps.map((dep, idx) => {
        const style = EDGE_STYLES[dep.type] ?? EDGE_STYLES.workflow;
        return {
          id: `${dep.fromAgentId}-${dep.toAgentId}-${dep.type}-${idx}`,
          source: dep.fromAgentId,
          target: dep.toAgentId,
          type: 'smoothstep',
          label: EDGE_LABELS[dep.type] ?? dep.type,
          style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray, strokeWidth: 2 },
          animated: style.animated ?? false,
          data: { type: dep.type },
          labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
        } as Edge;
      }),
    );
  }, [agents, deps, setNodes, setEdges]);

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  if (agents.length === 0) return null;

  const canvas = (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={(_, edge) => {
          const type = (edge.data as { type?: string } | undefined)?.type ?? 'workflow';
          setSelectedEdge({
            type,
            fromAgent: agentMap.get(edge.source),
            toAgent: agentMap.get(edge.target),
          });
        }}
        onPaneClick={() => setSelectedEdge(null)}
        nodeTypes={teamNodeTypes}
        fitView
        panOnDrag
        zoomOnScroll={false}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1a1a" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-[#111] !border-[#262626] !rounded-lg [&>button]:!bg-[#111] [&>button]:!border-[#262626] [&>button]:!text-[#737373] [&>button:hover]:!bg-[#1a1a1a]"
        />
      </ReactFlow>
      {selectedEdge && (
        <EdgeInfoPanel
          edge={{
            type: selectedEdge.type,
            fromLabel: selectedEdge.fromAgent?.name ?? selectedEdge.fromAgent?.role,
            toLabel: selectedEdge.toAgent?.name ?? selectedEdge.toAgent?.role,
          }}
          onClose={() => setSelectedEdge(null)}
        />
      )}
    </div>
  );

  const computedHeight = height ?? Math.min(agents.length * 80 + 80, 400);

  if (!collapsible) {
    return (
      <div
        className="border border-[#262626] rounded-xl overflow-hidden bg-[#0a0a0a]"
        style={fill ? { height: '100%' } : { height: computedHeight }}
      >
        {canvas}
      </div>
    );
  }

  return (
    <div className="border border-[#262626] rounded-xl overflow-hidden bg-[#0a0a0a]">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-between w-full px-4 py-2.5 text-[12px] font-semibold text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
      >
        <span>Takım Yapısı ({agents.length} ajan)</span>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {!collapsed && <div style={{ height: computedHeight }}>{canvas}</div>}
    </div>
  );
}
