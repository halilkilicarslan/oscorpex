// ---------------------------------------------------------------------------
// Project Settings Routes — Policy Profile
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { requirePermission } from "../auth/rbac.js";
import { getProjectSetting, setProjectSettings } from "../db.js";
import {
	type ProviderPolicyProfile,
	VALID_PROFILES,
	normalizeProviderPolicyProfile,
} from "../provider-policy-profiles.js";

export const projectSettingsRoutes = new Hono();

// ---- Policy Profile --------------------------------------------------------

projectSettingsRoutes.get("/projects/:id/policy-profile", async (c) => {
	const projectId = c.req.param("id");
	const value = await getProjectSetting(projectId, "model_routing", "provider_policy_profile");
	const profile = value ? normalizeProviderPolicyProfile(value) : null;
	return c.json({ profile });
});

projectSettingsRoutes.put("/projects/:id/policy-profile", requirePermission("projects:update"), async (c) => {
	const projectId = c.req.param("id");
	const body = (await c.req.json()) as { profile?: string };
	const profile = normalizeProviderPolicyProfile(body.profile);
	if (!VALID_PROFILES.includes(profile as ProviderPolicyProfile)) {
		return c.json({ error: `Invalid profile: ${body.profile}` }, 400);
	}
	await setProjectSettings(projectId, "model_routing", { provider_policy_profile: profile });
	return c.json({ profile });
});
