// ---------------------------------------------------------------------------
// Builder Node (ReactFlow custom node)
// ---------------------------------------------------------------------------

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { roleLabel, type AgentConfig } from '../../../lib/studio-api';
import AgentAvatarImg from '../../../components/AgentAvatar';


export type BuilderNodeData = {
	preset: AgentConfig;
	color: string;
};

export default function BuilderNode({ data }: NodeProps<Node<BuilderNodeData>>) {
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
