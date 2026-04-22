// ---------------------------------------------------------------------------
// EdgeInfoPanel — React Flow üzerinde seçili edge'in detaylarını gösterir
// TeamBuilderPage ve TeamGraphView tarafından paylaşılan panel
// ---------------------------------------------------------------------------

import { EDGE_STYLES, EDGE_LABELS, EDGE_DESCRIPTIONS } from './team-graph-shared';

export interface EdgeInfo {
  type: string;
  fromLabel?: string;
  toLabel?: string;
}

export interface EdgeInfoPanelProps {
  edge: EdgeInfo;
  onClose: () => void;
  /** Panelin konumu — varsayılan sağ üst. */
  className?: string;
}

export default function EdgeInfoPanel({
  edge,
  onClose,
  className = 'absolute top-3 right-3 w-64 z-10',
}: EdgeInfoPanelProps) {
  const color = EDGE_STYLES[edge.type]?.stroke ?? '#525252';
  return (
    <div className={`bg-[#111] border border-[#262626] rounded-xl shadow-lg p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: color }} />
          <span className="text-[11px] font-semibold" style={{ color }}>
            {EDGE_LABELS[edge.type] ?? edge.type}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[#525252] hover:text-[#fafafa] text-[14px] leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <p className="text-[11px] text-[#a3a3a3] leading-relaxed mb-2">
        {EDGE_DESCRIPTIONS[edge.type] ?? '—'}
      </p>
      {(edge.fromLabel || edge.toLabel) && (
        <div className="flex items-center gap-1.5 text-[10px] text-[#737373] pt-2 border-t border-[#262626]">
          <span className="font-medium text-[#d4d4d8] truncate">{edge.fromLabel ?? '?'}</span>
          <span>→</span>
          <span className="font-medium text-[#d4d4d8] truncate">{edge.toLabel ?? '?'}</span>
        </div>
      )}
    </div>
  );
}
