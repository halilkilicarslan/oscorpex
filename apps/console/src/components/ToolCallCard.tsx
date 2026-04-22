import { useState } from 'react';
import { Wrench, ChevronDown, ChevronRight, Check, X, Loader2 } from 'lucide-react';
import type { ToolCall } from '../types';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

function StatusIndicator({ toolCall }: { toolCall: ToolCall }) {
  if (toolCall.status === 'calling') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[#f59e0b]">
        <Loader2 size={12} className="animate-spin" />
        Calling...
      </span>
    );
  }

  if (toolCall.status === 'done') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[#22c55e]">
        <Check size={12} />
        Done
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-[#ef4444]">
      <X size={12} />
      {toolCall.errorText ?? 'Error'}
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mt-2">
      <p className="text-[10px] text-[#525252] mb-1 font-medium uppercase tracking-wide">
        {label}
      </p>
      <pre className="bg-[#0a0a0a] text-[#a3a3a3] text-[11px] p-2.5 rounded-md overflow-x-auto border border-[#1a1a1a] leading-relaxed">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}

export default function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[#111111] border border-[#262626] rounded-lg overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#141414] transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown size={14} className="text-[#525252] shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-[#525252] shrink-0" />
        )}
        <Wrench size={14} className="text-[#3b82f6] shrink-0" />
        <span className="font-medium text-[#e5e5e5] truncate flex-1 text-[12px]">
          {toolCall.toolName}
        </span>
        <StatusIndicator toolCall={toolCall} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-[#1a1a1a]">
          <JsonBlock label="Input" value={toolCall.input} />
          {toolCall.output !== undefined && (
            <JsonBlock label="Output" value={toolCall.output} />
          )}
          {toolCall.status === 'error' && toolCall.errorText && toolCall.output === undefined && (
            <div className="mt-2">
              <p className="text-[10px] text-[#525252] mb-1 font-medium uppercase tracking-wide">
                Error
              </p>
              <p className="text-xs text-[#ef4444] bg-[#0a0a0a] p-2.5 rounded-md border border-[#1a1a1a]">
                {toolCall.errorText}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
