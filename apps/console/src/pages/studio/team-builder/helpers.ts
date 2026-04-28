// ---------------------------------------------------------------------------
// Team Builder Helpers
// ---------------------------------------------------------------------------

export function autoLayout(
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
