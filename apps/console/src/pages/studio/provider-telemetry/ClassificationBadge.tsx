// ---------------------------------------------------------------------------
// Classification Badge
// ---------------------------------------------------------------------------

import { CLASSIFICATION_LABELS, CLASSIFICATION_STYLES } from './helpers.js';
import type { ProviderErrorClassification } from '../../../lib/studio-api';

interface ClassificationBadgeProps {
	classification?: ProviderErrorClassification;
}

export default function ClassificationBadge({ classification }: ClassificationBadgeProps) {
	if (!classification) return null;
	return (
		<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${CLASSIFICATION_STYLES[classification]}`}>
			{CLASSIFICATION_LABELS[classification]}
		</span>
	);
}
