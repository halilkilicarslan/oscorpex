# Integrations Map

Generated on 2026-04-12 from direct repository inspection and local command runs.

## AI Providers and Model Routing

The backend supports multiple AI provider integrations through `src/studio/ai-provider-factory.ts`:

- OpenAI
- Anthropic
- Google
- Ollama
- Custom OpenAI-compatible endpoints

The provider configuration is stored in the database, with support for:

- default provider selection
- fallback order
- model-level cost estimation

## Claude CLI Integration

The most important execution integration is the Claude CLI runtime in `src/studio/cli-runtime.ts`.

It:

- resolves the `claude` binary from common install locations
- streams JSON events from subprocess execution
- emits terminal output through the studio event pipeline
- tracks token usage and cost

This is the real execution path for task work, not just a demo integration.

## VoltAgent / VoltOps

The application still depends heavily on VoltAgent:

- `@voltagent/core` agents and workflows are initialized in `src/index.ts`
- LibSQL adapters are used for memory and observability
- VoltOps keys are supported through environment variables

This means Oscorpex is both a custom studio product and a VoltAgent-hosted application.

## Databases and Infrastructure

- PostgreSQL + pgvector via Docker Compose
- LibSQL local files under `.voltagent/`
- Docker socket mounted into backend for container management
- Optional SonarQube service
- Optional coder-agent pool containers

## External Notifications

Webhook support exists in the studio subsystem:

- generic webhooks
- Slack
- Discord

Supported events include:

- task completed / failed
- approval required / approved / rejected
- pipeline completed
- execution errors
- budget warnings

## Developer Environment Dependencies

A functional local environment depends on:

- Node.js
- pnpm
- Docker
- PostgreSQL container
- Claude CLI for task execution
- optional AI provider API keys

## Integration Risks

- Backend has privileged Docker access through `/var/run/docker.sock`
- Agent network comments claim isolation, but `internal: false` means outbound access is still possible
- Hybrid storage increases debugging and backup complexity
- Provider support exists in code, but execution still has a strong Claude CLI dependency

