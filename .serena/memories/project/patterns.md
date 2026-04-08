# Patterns & Gotchas

## AI SDK v6
- tool() uses inputSchema NOT parameters
- streamText uses stopWhen: stepCountIs(N) NOT maxSteps
- Provider factory: getAIModel() from ai-provider-factory.ts

## Hono
- Routes at /api/studio
- CRITICAL: Static routes (/team/org, /messages/broadcast) BEFORE dynamic routes (/team/:agentId, /messages/:messageId)

## pnpm
- Always pnpm add (never npm install)

## better-sqlite3
- Synchronous API, getDb() lazy init
- Additive migrations via PRAGMA table_info + ALTER TABLE
- Additive seed: check existing roles, only insert missing presets
- CREATE TABLE IF NOT EXISTS for new tables (idempotent)

## Project Teams
- project_agents table for project scope
- copyAgentsToProject() sets professional hierarchy: devs→Architect, others→PM
- 9 agents, 5 templates, pipeline 0-6

## Agent Colors
PM=#f59e0b, Designer=#f472b6, Architect=#3b82f6, Frontend=#ec4899,
Backend=#22c55e, Coder=#06b6d4, QA=#a855f7, Reviewer=#ef4444, DevOps=#0ea5e9

## Agent Messaging
- agent_messages table with threading (parent_message_id)
- notifyNextInPipeline auto-routes to next pipeline stage
- broadcastToTeam sends to all except sender

## Pipeline Engine
- pipeline_runs table persists state (survives restart via hydration)
- Stage gate: all tasks done before next stage starts
- taskEngine.onTaskCompleted hook drives auto-advance
- Parallel stages: same pipelineOrder agents run simultaneously

## Agent Runtime
- agent-runtime.ts for local CLI (claude-code, codex, aider)
- container-manager.ts for Docker (fallback)
- Ring buffer: 500 lines output per agent
- SSE streaming via ReadableStream + push listeners

## User Preferences
- Always respond in Turkish
- Use pnpm, never npm
- Don't push unless explicitly asked
- Dark theme: bg-[#0a0a0a], cards #111111, borders #262626, accent #22c55e
