import { useState, useEffect, Fragment } from 'react';
import { Loader2, GitBranch, ArrowRight } from 'lucide-react';
import {
  fetchOrgStructure,
  type OrgNode,
  type PipelineAgent,
  roleLabel,
} from '../../lib/studio-api';
import AgentAvatarImg from '../../components/AgentAvatar';

// ---------------------------------------------------------------------------
// Hierarchy tree node
// ---------------------------------------------------------------------------

function OrgTreeNode({ node, level = 0 }: { node: OrgNode; level?: number }) {
  return (
    <div className="flex flex-col items-center">
      {/* Agent card */}
      <div
        className="flex flex-col items-center p-3 rounded-xl bg-[#111111] border-2 transition-colors hover:bg-[#1a1a1a] cursor-default w-[110px]"
        style={{ borderColor: node.color }}
      >
        <AgentAvatarImg avatar={node.avatar} name={node.name} size="lg" className="mb-1" />
        <span className="text-[13px] font-semibold text-[#fafafa] text-center leading-tight truncate w-full text-center">
          {node.name}
        </span>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded mt-1 truncate max-w-full text-center"
          style={{ backgroundColor: node.color + '20', color: node.color }}
        >
          {roleLabel(node.role)}
        </span>
      </div>

      {/* Children branch */}
      {node.children.length > 0 && (
        <>
          {/* Vertical connector from parent card */}
          <div className="w-px h-6 bg-[#333]" />

          <div className="relative flex items-start gap-6">
            {/* Horizontal bar across all children */}
            {node.children.length > 1 && (
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 h-px bg-[#333]"
                style={{ width: `calc(100% - 80px)` }}
              />
            )}

            {node.children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="w-px h-6 bg-[#333]" />
                <OrgTreeNode node={child} level={level + 1} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline view
// ---------------------------------------------------------------------------

function PipelineView({ pipeline }: { pipeline: PipelineAgent[] }) {
  const groups = new Map<number, PipelineAgent[]>();
  for (const agent of pipeline) {
    const existing = groups.get(agent.pipelineOrder) ?? [];
    existing.push(agent);
    groups.set(agent.pipelineOrder, existing);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0] - b[0]);

  if (sortedGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <GitBranch size={32} className="text-[#333] mb-3" />
        <p className="text-[13px] text-[#525252]">No pipeline data available.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-4">
      {sortedGroups.map(([order, agents], idx) => (
        <Fragment key={order}>
          {idx > 0 && (
            <div className="flex items-center text-[#444] shrink-0">
              <ArrowRight size={20} />
            </div>
          )}
          <div className="flex flex-col gap-2 shrink-0">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111111] border-2"
                style={{ borderColor: agent.color }}
              >
                <AgentAvatarImg avatar={agent.avatar} name={agent.name} size="sm" />
                <div className="min-w-0">
                  <span className="text-[12px] font-semibold text-[#fafafa] block truncate">
                    {agent.name}
                  </span>
                  <span className="text-[10px] block truncate" style={{ color: agent.color }}>
                    {roleLabel(agent.role)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface OrgChartProps {
  projectId: string;
  initialView?: 'hierarchy' | 'pipeline';
}

export default function OrgChart({ projectId, initialView = 'hierarchy' }: OrgChartProps) {
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [pipeline, setPipeline] = useState<PipelineAgent[]>([]);
  const [view, setView] = useState<'hierarchy' | 'pipeline'>(initialView);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchOrgStructure(projectId)
      .then((data) => {
        setTree(data.tree);
        setPipeline(data.pipeline);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Sync view when parent changes initialView prop
  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <GitBranch size={32} className="text-[#333] mb-3" />
        <p className="text-[13px] text-[#525252]">Failed to load org structure.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Internal view toggle */}
      <div className="flex items-center gap-2 px-6 pt-4 pb-2 border-b border-[#1a1a1a]">
        <div className="flex items-center bg-[#0a0a0a] border border-[#262626] rounded-lg p-0.5">
          <button
            onClick={() => setView('hierarchy')}
            className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
              view === 'hierarchy'
                ? 'bg-[#1f1f1f] text-[#fafafa]'
                : 'text-[#525252] hover:text-[#a3a3a3]'
            }`}
          >
            Hierarchy
          </button>
          <button
            onClick={() => setView('pipeline')}
            className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
              view === 'pipeline'
                ? 'bg-[#1f1f1f] text-[#fafafa]'
                : 'text-[#525252] hover:text-[#a3a3a3]'
            }`}
          >
            Pipeline
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 overflow-auto p-6">
        {view === 'hierarchy' ? (
          tree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <GitBranch size={32} className="text-[#333] mb-3" />
              <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Hierarchy Data</h3>
              <p className="text-[12px] text-[#525252]">
                Assign hierarchy roles to see the org chart.
              </p>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="flex flex-col gap-6 items-center">
                {tree.map((root) => (
                  <OrgTreeNode key={root.id} node={root} />
                ))}
              </div>
            </div>
          )
        ) : (
          <PipelineView pipeline={pipeline} />
        )}
      </div>
    </div>
  );
}
