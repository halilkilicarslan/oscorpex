# Meeting Comparison

Source meeting note:

- `/Users/iamhk/Downloads/ai_dev_system_meeting_summary.md`

Compared against repository state on 2026-04-12.

## Executive Summary

The current system is strongly aligned with the April 9, 2026 meeting direction.

It already behaves like:

- a web control plane
- a CLI-driven execution platform
- an AI orchestration workspace rather than an AI IDE

The biggest gaps are not product vision gaps. They are implementation-shape gaps:

- policy/security layer is only partial
- PR-based workflow is incomplete
- remote sandbox runner is not realized
- token optimization architecture exists in fragments rather than as explicit platform services
- the current implementation is broader than the meeting MVP, but less cleanly modular

## Comparison Matrix

### 1. Purpose and Positioning

Meeting target:

- web-based AI software delivery workspace
- CLI in background
- orchestration platform, not IDE

Current system:

- `src/studio/routes.ts` exposes a large web control plane for projects, planning, tasks, events, costs, preview, runtime, providers, webhooks, and team management
- task execution is CLI-driven through `executeWithCLI()` in [execution-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/execution-engine.ts:399)

Status:

- `Aligned`

### 2. Control Plane

Meeting target:

- Project / Team Management
- Requirement Management
- Agent Orchestrator
- Approval System
- Audit & Logs

Current system:

- project import and creation: [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:253), [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:1000)
- team templates and seeded role sets: [db.ts](/Users/iamhk/development/personal/oscorpex/src/studio/db.ts:652), [db.ts](/Users/iamhk/development/personal/oscorpex/src/studio/db.ts:907)
- planning and approval: [pm-agent.ts](/Users/iamhk/development/personal/oscorpex/src/studio/pm-agent.ts:134), [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:528)
- audit/log/event streams: [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:1889)
- costs and analytics: [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:2346), [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:2384)

Status:

- `Aligned`

### 3. Runner Layer

Meeting target:

- Local Runner
- Remote Sandbox Runner
- CLI Adapter (Claude / Codex)

Current system:

- local process runner plus Docker fallback are present: [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:1466)
- container manager supports Docker agent runtimes: [container-manager.ts](/Users/iamhk/development/personal/oscorpex/src/studio/container-manager.ts:32)
- container pool exists for pre-warmed runner containers: [container-pool.ts](/Users/iamhk/development/personal/oscorpex/src/studio/container-pool.ts:1)
- actual task execution path is Claude CLI only at the moment: [execution-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/execution-engine.ts:399)

Assessment:

- local runner exists
- Docker sandbox-like execution exists
- CLI adapter exists for Claude
- Codex adapter is not implemented in the current execution path
- remote sandbox runner as a separate distributed execution layer is not present

Status:

- `Partially aligned`

### 4. Agent Model

Meeting target:

- Product Analyst
- Architect
- Planner
- Backend Engineer
- Frontend Engineer
- QA Engineer
- Security Reviewer
- DevOps Engineer
- Code Reviewer
- Documentation Agent

Current system:

- current role model is Scrum/team-oriented rather than the exact meeting list:
  - `product-owner`
  - `scrum-master`
  - `tech-lead`
  - `business-analyst`
  - `design-lead`
  - `frontend-dev`
  - `backend-dev`
  - `frontend-qa`
  - `backend-qa`
  - `frontend-reviewer`
  - `backend-reviewer`
  - `devops`
  - see [db.ts](/Users/iamhk/development/personal/oscorpex/src/studio/db.ts:652)

Assessment:

- product analyst is effectively split across `product-owner` and `business-analyst`
- architect maps to `tech-lead`
- planner maps to `product-owner` plus PM planner logic
- QA is split into frontend/backend QA
- code reviewer is split into frontend/backend reviewer
- security reviewer exists only as part of backend reviewer responsibilities, not as a dedicated agent
- documentation is handled by docs generation features and some role prompts, not by a dedicated documentation agent

Status:

- `Aligned in concept, different in role taxonomy`

### 5. Workflow

Meeting target:

1. Requirement
2. Agent breakdown
3. Task creation
4. Runner execution
5. Code generation/change
6. Test and validation
7. PR creation

Current system:

- requirements and planning flow exist in the PM planner: [pm-agent.ts](/Users/iamhk/development/personal/oscorpex/src/studio/pm-agent.ts:139)
- plan approval gates exist: [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:528)
- task orchestration exists through task/pipeline/execution engines
- test and run-app task types exist: [pm-agent.ts](/Users/iamhk/development/personal/oscorpex/src/studio/pm-agent.ts:155), [execution-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/execution-engine.ts:703)
- git branches, merges and commits exist: [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:1834)

Assessment:

- workflow is more advanced than the meeting note in planning, approval, retries, review loop, and app preview
- PR creation is still the missing last mile
- there is an event type for `git:pr-created`, but I did not find a real PR creation integration in the execution or route layer

Status:

- `Mostly aligned, PR step incomplete`

### 6. Token Optimization Strategy

Meeting target:

- layered context
- prompt caching
- retrieval-based context selection
- session compaction
- structured output
- model routing
- delta retry

Current system:

- layered prompt construction exists informally:
  - project context
  - code context
  - completed task summaries
  - previous error
  - see [execution-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/execution-engine.ts:600)
- retrieval-based context selection exists through RAG:
  - [execution-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/execution-engine.ts:626)
  - [context-builder.ts](/Users/iamhk/development/personal/oscorpex/src/studio/context-builder.ts:112)
- model routing and fallback exist:
  - [ai-provider-factory.ts](/Users/iamhk/development/personal/oscorpex/src/studio/ai-provider-factory.ts:65)
  - [ai-provider-factory.ts](/Users/iamhk/development/personal/oscorpex/src/studio/ai-provider-factory.ts:148)
- CLI usage captures cache token counters, but there is no explicit prompt-caching orchestration service:
  - [cli-runtime.ts](/Users/iamhk/development/personal/oscorpex/src/studio/cli-runtime.ts:34)
  - [cli-runtime.ts](/Users/iamhk/development/personal/oscorpex/src/studio/cli-runtime.ts:60)

Assessment:

- retrieval and context layering: yes
- model router: yes
- structured outputs: partially, especially in planning
- prompt pack registry: no explicit subsystem
- session compactor: not found
- delta retry: not found as a first-class mechanism

Status:

- `Partially aligned`

### 7. Cost Optimization Layers

Meeting target:

- Task Classifier
- Context Compiler
- Retrieval Service
- Prompt Pack Registry
- Model Router
- Budget Guard
- Session Compactor
- Cost Analytics

Current system:

- retrieval service: effectively present through RAG and vector search
- model router and fallback: present in [ai-provider-factory.ts](/Users/iamhk/development/personal/oscorpex/src/studio/ai-provider-factory.ts:148)
- budget guard: present in [task-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/task-engine.ts:87)
- cost analytics: present in [db.ts](/Users/iamhk/development/personal/oscorpex/src/studio/db.ts:1715) and [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:2384)

Assessment:

- the functionality exists in pieces
- the architecture from the meeting is not materialized as clean platform modules
- task classifier, prompt pack registry, session compactor are still missing as named subsystems

Status:

- `Partially aligned`

### 8. Security / Policy Layer

Meeting target:

- runner isolation
- secret access control
- command allow/deny
- mandatory approvals
- PR-based workflow

Current system:

- container isolation exists with resource caps and reduced capabilities:
  - [docker-compose.yml](/Users/iamhk/development/personal/oscorpex/docker-compose.yml:87)
  - [container-pool.ts](/Users/iamhk/development/personal/oscorpex/src/studio/container-pool.ts:244)
- mandatory approvals exist for risky tasks:
  - [task-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/task-engine.ts:25)
  - [task-engine.ts](/Users/iamhk/development/personal/oscorpex/src/studio/task-engine.ts:150)
- capabilities CRUD exists for file-scope restrictions:
  - [routes.ts](/Users/iamhk/development/personal/oscorpex/src/studio/routes.ts:2887)

Assessment:

- security/policy exists mostly as infrastructure hardening and task approval
- secret management is weakly controlled:
  - provider keys are stored in DB and read raw by backend
  - API keys are passed into runtime environments
- command allow/deny is not enforced as a dedicated policy layer
- capabilities appear modeled in DB/API, but I did not find execution-side enforcement in `execution-engine.ts`, `cli-runtime.ts`, or `container-pool.ts`
- PR-based workflow is still incomplete

Status:

- `Partially aligned`

### 9. MVP Scope

Meeting MVP:

- project creation
- repo connection
- basic agents
- local runner
- patch generation
- PR creation
- approval UI
- cost tracking

Current system:

- project creation: yes
- repo import/connection: yes
- seeded agents and templates: yes
- local runner: yes
- approval system/UI: yes
- cost tracking: yes
- patch/file/code change execution: yes, though more file-write oriented than a pure patch-approval UX
- PR creation: not implemented end-to-end

Assessment:

The current product already exceeds the original MVP in several directions:

- runtime analyzer
- DB provisioner
- live preview
- API explorer
- webhooks
- RAG indexing/search
- richer team topology

Status:

- `MVP mostly surpassed, except PR workflow`

## Bottom Line

If I compress this to one sentence:

The product already matches the meeting's strategic thesis, but it has evolved into a larger and more ambitious system than the original MVP while still missing a clean policy layer and a real PR-based execution boundary.

## Recommended Next Moves

1. Decide whether the product should remain CLI-first or become true runner-agnostic.
2. Implement PR creation as a first-class workflow or remove PR-centric language from architecture docs.
3. Turn policy from metadata into enforcement:
   - agent capabilities
   - command restrictions
   - secret scoping
4. Refactor token optimization into explicit modules if cost control is a core differentiator.
5. Normalize the agent taxonomy:
   - meeting vocabulary
   - product vocabulary
   - code vocabulary
   should stop drifting.

