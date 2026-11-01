# Production kernel image. Build context = repo root, filtered by the allow-list in ./.dockerignore.
# base (pinned node + corepack) -> manifests / deps -> build -> deploy (prod-only node_modules); claude-cli (pinned CLI) and runtime derive from base and carry no build tools.

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS base
RUN corepack enable

# Only the manifests a frozen install needs, so source edits never invalidate the dependency layer.
FROM base AS manifests
WORKDIR /ctx
COPY . .
RUN mkdir /manifests \
	&& find . -type f \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml \) -not -path './docker/*' \
		| tar -cf - -T - | tar -xf - -C /manifests

FROM base AS deps
ENV PNPM_HOME=/pnpm \
	npm_config_store_dir=/pnpm/store \
	CI=true
WORKDIR /repo
COPY --from=manifests /manifests ./
RUN --mount=type=cache,id=oscorpex-pnpm-store,target=/pnpm/store \
	pnpm install --frozen-lockfile --filter "@oscorpex/kernel..."

FROM deps AS build
COPY . .
RUN pnpm --filter "@oscorpex/kernel..." build

FROM build AS deploy
# Package READMEs and other docs are dead weight at runtime (and carry example tokens that trip secret scanners);
# licence texts stay. Third-party test directories go too. The deployed pnpm-workspace.yaml is
# dropped (unreadable 0600 file that would break `pnpm` in /app).
RUN --mount=type=cache,id=oscorpex-pnpm-store,target=/pnpm/store \
	pnpm --filter @oscorpex/kernel deploy --prod /out \
	&& find /out/node_modules -type f \( -iname '*.md' -o -iname '*.markdown' \) \
		! -iname 'LICENSE*' ! -iname 'NOTICE*' ! -iname 'COPYING*' -delete \
	&& find /out/node_modules/.pnpm -mindepth 3 -maxdepth 4 -type d \( -name test -o -name tests -o -name __tests__ \) \
		-path '*/node_modules/*/*' -prune -exec rm -rf {} + \
	&& rm -f /out/pnpm-workspace.yaml \
	&& chmod 0644 /out/pnpm-lock.yaml

FROM base AS claude-cli
ENV CI=true
WORKDIR /opt/claude-cli
COPY docker/claude-cli/package.json docker/claude-cli/pnpm-lock.yaml docker/claude-cli/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod \
	&& node_modules/.bin/claude --version

FROM base AS runtime
# pnpm is pre-seeded (integrity-checked, pinned by the root package.json packageManager) into a root-owned corepack home so `pnpm` works offline as uid 1001.
# pnpm 12 fetches its native binary on first run, so it is run once here to cache that too.
RUN --mount=type=bind,source=package.json,target=/tmp/root-package.json \
	mkdir -m 0755 /etc/claude-code \
	&& COREPACK_HOME=/opt/corepack corepack prepare "$(node -p 'require("/tmp/root-package.json").packageManager')" --activate \
	&& cd /tmp && COREPACK_HOME=/opt/corepack pnpm --version \
	&& chmod -R go-w /opt/corepack \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates tini \
	&& rm -rf /var/lib/apt/lists/* \
	&& groupadd --gid 1001 oscorpex \
	&& useradd --uid 1001 --gid 1001 --home-dir /home/oscorpex --create-home --shell /usr/sbin/nologin oscorpex
# COPY lands everything root:root; the assertion below fails the build if anything is group/world-writable.
COPY --from=deploy /out /app
COPY --from=claude-cli /opt/claude-cli /opt/claude-cli
COPY --chown=0:0 --chmod=0644 docker/claude-cli/managed-settings.json /etc/claude-code/managed-settings.json
RUN install -d -o 1001 -g 1001 -m 0700 /app/.oscorpex /app/.voltagent /home/oscorpex/.claude \
	&& chown 1001:1001 /home/oscorpex && chmod 0700 /home/oscorpex \
	&& find / -xdev -perm /6000 -exec chmod a-s {} + \
	&& bad="$(find /app /opt/claude-cli /opt/corepack /etc/claude-code \( ! -user 0 -o -perm /022 \) ! -type l \
		! -path '/app/.oscorpex' ! -path '/app/.voltagent')" \
	&& test -z "$bad" || { echo "not root-owned or group/world-writable:" "$bad" >&2; exit 1; }
ENV NODE_ENV=production \
	HOME=/home/oscorpex \
	CLAUDE_CLI_PATH=/opt/claude-cli/node_modules/.bin/claude \
	PATH=/opt/claude-cli/node_modules/.bin:$PATH \
	CLAUDE_CONFIG_DIR=/home/oscorpex/.claude \
	DISABLE_AUTOUPDATER=1 \
	COREPACK_HOME=/opt/corepack \
	COREPACK_DEFAULT_TO_LATEST=0 \
	COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
EXPOSE 3141 3142
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3141)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
USER 1001:1001
ENTRYPOINT ["tini", "-g", "--"]
CMD ["node", "dist/index.js"]
