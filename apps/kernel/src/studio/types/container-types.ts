// ---------------------------------------------------------------------------
// Oscorpex — Container Configuration Types
// ---------------------------------------------------------------------------

export interface VolumeMount {
	source: string;
	target: string;
	readonly?: boolean;
}

export interface ContainerConfig {
	image: string;
	name: string;
	volumes: VolumeMount[];
	env: Record<string, string>;
	networkMode: string;
	memoryLimit: string;
	cpuLimit: number;
}
