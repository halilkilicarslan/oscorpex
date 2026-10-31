// Tenant workspaces are untrusted: a repo can carry hooks (.git/hooks, core.hooksPath) and a core.fsmonitor command
// that git would run as the kernel user. Every kernel git call neutralises both (and disables commit signing, which would run a repo-chosen gpg program) through GIT_CONFIG_* env entries,
// which git applies at command scope (above repo config) without changing the argument list.

const SAFE_GIT_CONFIG: [string, string][] = [
	["core.hooksPath", "/dev/null"],
	["core.fsmonitor", "false"],
	["commit.gpgSign", "false"],
];

/** Returns `env` with the hardening config applied; any GIT_CONFIG_* entries it already carried are dropped. */
export function gitSafeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(env)) {
		if (!/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) out[key] = value;
	}
	out.GIT_CONFIG_COUNT = String(SAFE_GIT_CONFIG.length);
	SAFE_GIT_CONFIG.forEach(([key, value], i) => {
		out[`GIT_CONFIG_KEY_${i}`] = key;
		out[`GIT_CONFIG_VALUE_${i}`] = value;
	});
	return out;
}
