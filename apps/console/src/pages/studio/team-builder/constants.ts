// ---------------------------------------------------------------------------
// Team Builder Constants
// ---------------------------------------------------------------------------

import type { DependencyType } from '../../../lib/studio-api';

export const COLOR_MAP: Record<string, string> = {
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

export const EDGE_STYLES: Record<DependencyType, { stroke: string; strokeDasharray?: string; animated?: boolean }> = {
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

export const EDGE_LABELS: Record<DependencyType, string> = {
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

export const EDGE_DESCRIPTIONS: Record<DependencyType, string> = {
	hierarchy: 'Raporlama hiyerarşisi. Bloklayıcı değildir, sadece organizasyonel yapı.',
	workflow: 'Kaynak ajan hedef ajanı besler; hedef, kaynak tamamlanmadan çalışamaz.',
	review: 'Hedef ajan, kaynak ajanın çıktısını inceler. Reddedilirse kaynak yeniden çalışır.',
	gate: 'Onay kapısı — hedef, kaynaktan gelen onay olmadan ilerleyemez.',
	escalation: 'Kaynak belirli sayıda başarısız olursa hedef ajana yükseltme yapılır.',
	pair: "İki ajan aynı task üzerinde aynı wave'de paralel çalışır.",
	conditional: 'Çalışma zamanı koşulu sağlanırsa aktif olur (örn: security-sensitive dosya).',
	fallback: 'Kaynak başarısız olursa hedef ajan alternatif olarak devreye girer.',
	notification: 'Bilgilendirme amaçlı, non-blocking mesaj.',
	handoff: 'Formal iş devri — dokümantasyon gerektirir.',
	approval: "Tek task için onay kapısı; tüm phase'i bloklayabilir.",
	mentoring: 'Danışmanlık / feedback ilişkisi, bloklayıcı değildir.',
};
