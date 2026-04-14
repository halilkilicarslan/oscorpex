import { useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2 } from 'lucide-react';
import {
  fetchPresetAgents,
  fetchTeamTemplates,
  roleLabel,
  type AgentConfig,
  type TeamTemplate,
  type DependencyType,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

// ---------------------------------------------------------------------------
// Color & dependency config (mirrors backend seedDefaultDependencies)
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
  devops: '#0ea5e9',
  // legacy
  pm: '#f59e0b', designer: '#f472b6', architect: '#3b82f6',
  frontend: '#ec4899', backend: '#22c55e', coder: '#06b6d4',
  qa: '#a855f7', reviewer: '#ef4444',
};

const EDGE_STYLES: Record<DependencyType, { stroke: string; strokeDasharray?: string; animated?: boolean }> = {
  hierarchy: { stroke: '#525252', strokeDasharray: '5 5' },
  workflow: { stroke: '#3b82f6' },
  review: { stroke: '#a855f7', strokeDasharray: '8 4', animated: true },
  gate: { stroke: '#f59e0b' },
};

const EDGE_LABELS: Record<DependencyType, string> = {
  hierarchy: 'Reports To',
  workflow: 'Workflow',
  review: 'Review',
  gate: 'Gate',
};

/** Standard dependency template — same as backend seedDefaultDependencies */


// ---------------------------------------------------------------------------
// Custom Node
// ---------------------------------------------------------------------------

type PreviewNodeData = {
  name: string;
  role: string;
  avatar: string;
  color: string;
};

function PreviewAgentNode({ data }: NodeProps<Node<PreviewNodeData>>) {
  return (
    <div
      className="flex flex-col items-center p-2.5 rounded-xl bg-[#111111] border-2 w-[110px]"
      style={{ borderColor: data.color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#525252] !w-1.5 !h-1.5 !border-[#111111]" />
      <AgentAvatarImg avatar={data.avatar} name={data.name} size="sm" className="mb-1" />
      <span className="text-[10px] font-semibold text-[#fafafa] text-center leading-tight truncate w-full">
        {data.name}
      </span>
      <span
        className="text-[8px] font-medium px-1.5 py-0.5 rounded mt-0.5 truncate max-w-full text-center"
        style={{ backgroundColor: data.color + '20', color: data.color }}
      >
        {roleLabel(data.role)}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-[#525252] !w-1.5 !h-1.5 !border-[#111111]" />
    </div>
  );
}

const nodeTypes = { agent: PreviewAgentNode };

// ---------------------------------------------------------------------------
// DAG auto-layout (same algorithm as TeamBuilder)
// ---------------------------------------------------------------------------

function autoLayout(
  roles: string[],
  deps: { from: string; to: string; type: DependencyType }[],
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

  const NODE_W = 140;
  const NODE_H = 130;
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
// View mode toggle
// ---------------------------------------------------------------------------

type ViewMode = 'all' | 'workflow' | 'hierarchy';

const VIEW_FILTERS: Record<ViewMode, DependencyType[]> = {
  all: ['workflow', 'review', 'gate', 'hierarchy'],
  workflow: ['workflow', 'review', 'gate'],
  hierarchy: ['hierarchy'],
};

// ---------------------------------------------------------------------------
// Preview Graph Component (for a single template)
// ---------------------------------------------------------------------------

function TemplateGraph({
  template,
  presets,
  viewMode,
}: {
  template: TeamTemplate;
  presets: AgentConfig[];
  viewMode: ViewMode;
}) {
  const allDeps = template.dependencies;
  const visibleTypes = VIEW_FILTERS[viewMode];
  const filteredDeps = useMemo(
    () => allDeps.filter((d) => visibleTypes.includes(d.type)),
    [allDeps, visibleTypes],
  );

  const { nodes, edges } = useMemo(() => {
    const positions = autoLayout(template.roles, filteredDeps);
    const presetMap = new Map(presets.map((p) => [p.role, p]));

    const ns: Node[] = template.roles.map((role) => {
      const preset = presetMap.get(role);
      const color = COLOR_MAP[role] ?? '#525252';
      return {
        id: role,
        type: 'agent',
        position: positions[role] ?? { x: 0, y: 0 },
        data: {
          name: preset?.name ?? role,
          role,
          avatar: preset?.avatar ?? '',
          color,
        },
      };
    });

    const es: Edge[] = filteredDeps.map((dep, idx) => {
      const style = EDGE_STYLES[dep.type];
      return {
        id: `${dep.from}-${dep.to}-${dep.type}-${idx}`,
        source: dep.from,
        target: dep.to,
        type: 'smoothstep',
        label: EDGE_LABELS[dep.type],
        style: { stroke: style.stroke, strokeDasharray: style.strokeDasharray, strokeWidth: 1.5 },
        animated: style.animated ?? false,
        labelStyle: { fill: style.stroke, fontSize: 9, fontWeight: 600 },
        labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.9 },
        labelBgPadding: [3, 1] as [number, number],
      };
    });

    return { nodes: ns, edges: es };
  }, [template.roles, filteredDeps, presets]);

  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          className="bg-[#0a0a0a]"
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background color="#1a1a1a" gap={20} />
          <Controls
            showInteractive={false}
            className="!bg-[#111111] !border-[#262626] !shadow-none [&>button]:!bg-[#111111] [&>button]:!border-[#262626] [&>button]:!fill-[#a3a3a3] [&>button:hover]:!bg-[#1f1f1f]"
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function TeamTemplatePreview() {
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [presets, setPresets] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  useEffect(() => {
    Promise.all([fetchTeamTemplates(), fetchPresetAgents()])
      .then(([t, p]) => {
        setTemplates(t);
        setPresets(p);
        if (t.length > 0) setSelectedId(t[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selected = templates.find((t) => t.id === selectedId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: template selector + view mode */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="flex items-center gap-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={[
                'px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors border',
                selectedId === t.id
                  ? 'bg-[#1f1f1f] text-[#fafafa] border-[#333]'
                  : 'text-[#525252] border-transparent hover:text-[#a3a3a3] hover:bg-[#111111]',
              ].join(' ')}
            >
              {t.name}
              <span className="ml-1.5 text-[9px] text-[#525252]">({t.roles.length})</span>
            </button>
          ))}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center bg-[#0a0a0a] border border-[#262626] rounded-lg p-0.5">
          {([
            { key: 'all', label: 'All' },
            { key: 'workflow', label: 'Workflow' },
            { key: 'hierarchy', label: 'Hierarchy' },
          ] as { key: ViewMode; label: string }[]).map((v) => (
            <button
              key={v.key}
              onClick={() => setViewMode(v.key)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                viewMode === v.key
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Template info */}
      {selected && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1f1f1f]">
          <p className="text-[11px] text-[#737373] flex-1">{selected.description}</p>
          {/* Legend */}
          <div className="flex items-center gap-3 shrink-0">
            {(['workflow', 'review', 'gate', 'hierarchy'] as DependencyType[])
              .filter((type) => VIEW_FILTERS[viewMode].includes(type))
              .map((type) => (
                <div key={type} className="flex items-center gap-1">
                  <span
                    className="w-3 h-0.5 rounded-full inline-block"
                    style={{ backgroundColor: EDGE_STYLES[type].stroke }}
                  />
                  <span className="text-[9px] text-[#525252]">{EDGE_LABELS[type]}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Graph */}
      <div className="flex-1 min-h-[400px]">
        {selected && (
          <TemplateGraph
            key={`${selected.id}-${viewMode}`}
            template={selected}
            presets={presets}
            viewMode={viewMode}
          />
        )}
      </div>
    </div>
  );
}
