---
phase: 01-prep-inventory
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/01-prep-inventory/state-transitions.md
  - .planning/phases/01-prep-inventory/event-inventory.md
  - .planning/phases/01-prep-inventory/voltagent-dependency-map.md
autonomous: true
requirements:
  - INVT-01
  - INVT-02
  - INVT-06

must_haves:
  truths:
    - "Every TaskStatus state transition is documented with source file and function"
    - "All 50+ EventType values are catalogued with producer and consumer modules"
    - "Every VoltAgent import and usage is mapped with file location and purpose"
  artifacts:
    - path: ".planning/phases/01-prep-inventory/state-transitions.md"
      provides: "Complete TaskStatus and other state machine transition matrices"
      min_lines: 80
    - path: ".planning/phases/01-prep-inventory/event-inventory.md"
      provides: "Full EventType catalogue with payload shapes and producers/consumers"
      min_lines: 120
    - path: ".planning/phases/01-prep-inventory/voltagent-dependency-map.md"
      provides: "VoltAgent touchpoints inventory with extraction strategy"
      min_lines: 40
  key_links:
    - from: "state-transitions.md"
      to: "src/studio/task-engine.ts"
      via: "rg 'TaskStatus' transitions"
      pattern: "transition|status.*=|task\\.status"
    - from: "event-inventory.md"
      to: "src/studio/types.ts"
      via: "EventType union type"
      pattern: "EventType"
    - from: "voltagent-dependency-map.md"
      to: "src/index.ts"
      via: "VoltAgent, Memory, VoltAgentObservability imports"
      pattern: "@voltagent"
---

<objective>
Document all state machine transitions, event types with producers/consumers, and VoltAgent dependency touchpoints. This inventory is the baseline for all subsequent extraction work — without it, we risk breaking existing behavior during refactoring.

Purpose: Establish the preservation contract for the kernel extraction project. Every state transition, event emission, and VoltAgent dependency must be mapped before any code moves.

Output: Three inventory documents that serve as the "do not break" reference for phases 2-12.
</objective>

<execution_context>
@/Users/iamhk/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/iamhk/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@src/studio/types.ts
@src/studio/task-engine.ts
@src/studio/execution-engine.ts
@src/studio/pipeline-engine.ts
@src/studio/event-bus.ts
@src/index.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Document state transition matrices</name>
  <files>
    .planning/phases/01-prep-inventory/state-transitions.md
  </files>
  <action>
    Create a comprehensive state transition document by statically analyzing all state machines in the codebase. Use `rg` and file reads to extract every state transition.

    Must document these state machines:

    1. **TaskStatus transitions** (from task-engine.ts, execution-engine.ts, pipeline-engine.ts):
       - Every place a task status is set or changed (search for `task.status`, `status =`, `updateTask`, `status:` in emit calls)
       - Legal transitions: queued → assigned → running → (done | failed | review | waiting_approval | blocked)
       - Review loop: review → revision → running (cycle up to 3 times per task-engine)
       - Edge cases: "transient_failure" handling in execution-engine

    2. **PipelineStatus transitions** (from pipeline-engine.ts):
       - idle → running → (completed | failed | paused)
       - paused → running (resume)
       - degraded status handling

    3. **PhaseStatus transitions** (from pipeline-engine.ts, db repos):
       - pending → running → (completed | failed)

    4. **AgentProcessStatus transitions** (from agent-runtime):
       - idle → starting → running → (stopping → stopped | error)

    5. **ProjectStatus transitions** (from lifecycle-manager):
       - planning → approved → running → (completed | paused | failed | maintenance)

    For each state machine, document:
    - All legal transitions as a directed graph
    - Which function performs each transition (file:line)
    - Whether transition emits an event (which EventType)
    - Side effects of each transition (DB update, event emit, webhook, etc.)

    Format as markdown tables with columns: From | To | Trigger Function | File:Line | Event Emitted | Side Effects
  </action>
  <verify>
    <automated>grep -c "TaskStatus\|PipelineStatus\|PhaseStatus\|AgentProcessStatus\|ProjectStatus" .planning/phases/01-prep-inventory/state-transitions.md && test $(grep -c "TaskStatus\|PipelineStatus\|PhaseStatus\|AgentProcessStatus\|ProjectStatus" .planning/phases/01-prep-inventory/state-transitions.md) -gt 20</automated>
  </verify>
  <done>All 5 state machines documented with legal transitions, trigger functions, event emissions, and side effects</done>
</task>

<task type="auto">
  <name>Task 2: Catalogue event types with producers and consumers</name>
  <files>
    .planning/phases/01-prep-inventory/event-inventory.md
  </files>
  <action>
    Create a comprehensive event inventory document by searching for all event emissions and subscriptions.

    Step 1: Extract all EventType values from src/studio/types.ts (there are 50+ types).

    Step 2: For each event type, find:
    - **Producers**: Search `eventBus.emit(` and `eventBus.emitTransient(` calls. Extract which event types are emitted, from which file:line, and what payload shape is used.
    - **Consumers**: Search `eventBus.on(`, `eventBus.onProject(`, and `pgListener` subscriptions. Document which modules subscribe to which events and what they do with the data.
    - **DB persistence**: Check if the event is stored in the `events` table (via insertEvent in event-bus.ts).

    Step 3: For the StudioEvent interface itself, document:
    - Current schema: {id, projectId, type, agentId?, taskId?, payload, timestamp}
    - Missing fields compared to master plan's BaseEvent: correlationId, causationId, stageId, provider
    - Payload shapes: Document the known payload patterns (what keys are commonly used)

    Step 4: Group events by domain:
    - Task events (task:*)
    - Agent events (agent:*)
    - Pipeline events (pipeline:*)
    - Phase/Plan events (phase:*, plan:*)
    - Budget events (budget:*)
    - Lifecycle events (lifecycle:*, ceremony:*, sprint:*)
    - Governance events (policy:*, verification:*)
    - Git events (git:*)
    - Provider events (provider:*)

    Format as markdown tables. For each event: Type | Producer File:Line | Consumer Modules | Payload Shape | DB Persisted
  </action>
  <verify>
    <automated>grep -c "^|" .planning/phases/01-prep-inventory/event-inventory.md | xargs -I{} sh -c 'test {} -gt 50 && echo "PASS: {} event rows" || echo "FAIL: only {} rows"'</automated>
  </verify>
  <done>All 50+ EventType values catalogued with producers, consumers, payload shapes, and DB persistence status. Gap analysis against BaseEvent requirements documented.</done>
</task>

<task type="auto">
  <name>Task 3: Map VoltAgent dependency touchpoints</name>
  <files>
    .planning/phases/01-prep-inventory/voltagent-dependency-map.md
  </files>
  <action>
    Create a comprehensive VoltAgent dependency map by analyzing all imports and usages.

    Step 1: Find all VoltAgent imports using `rg "from.*@voltagent" src/` and `rg "from.*voltagent" src/`.

    Step 2: For each import, document:
    - File path
    - What's imported (Agent, Memory, VoltAgent, VoltOpsClient, createTool, createWorkflowChain, etc.)
    - How it's used (boot, agent definition, tool definition, memory bridge, etc.)
    - Whether it's in the critical execution path or optional/decorative

    Step 3: Categorize touchpoints:

    **Critical path** (system won't boot without):
    - `src/index.ts`: VoltAgent boot, Memory, Observability, HonoServer, VoltOpsClient
    - Any agent definition files used during task execution

    **Bridge/path** (system works but loses feature):
    - `src/studio/memory-bridge.ts`: Writes to VoltAgent memory tables
    - Tool definitions that use `createTool` from @voltagent/core

    **Removable/optional**:
    - Agent definitions (assistant, researcher, code-assistant, translator, summarizer) — these are sample agents, not the execution engine
    - Workflow definitions (expenseApprovalWorkflow)

    Step 4: For each touchpoint, propose extraction strategy:
    - Keep as-is (works independently)
    - Wrap behind interface (needs abstraction layer)
    - Replace with @oscorpex equivalent (needs new implementation)
    - Remove entirely (dead code or sample)

    Also document VoltAgent memory table names (voltagent_memory_*) and schema used.
  </action>
  <verify>
    <automated>grep -c "@voltagent" .planning/phases/01-prep-inventory/voltagent-dependency-map.md && test $(grep -c "@voltagent" .planning/phases/01-prep-inventory/voltagent-dependency-map.md) -ge 10</automated>
  </verify>
  <done>All 16 VoltAgent import sites mapped with usage categorization and extraction strategy. Critical vs optional dependencies clearly separated.</done>
</task>

</tasks>

<verification>
1. All three inventory documents exist in .planning/phases/01-prep-inventory/
2. state-transitions.md covers all 5 state machines
3. event-inventory.md lists all 50+ EventType values
4. voltagent-dependency-map.md categorizes all 16 import sites
5. Documents reference actual source files with line numbers
</verification>

<success_criteria>
- TaskStatus, PipelineStatus, PhaseStatus, AgentProcessStatus, ProjectStatus transitions fully documented
- Every EventType has at least its producer module identified
- Every VoltAgent import categorized as critical/bridge/removable with extraction strategy
- Gaps against BaseEvent requirements identified (missing correlationId, causationId fields)
</success_criteria>

<output>
After completion, create `.planning/phases/01-prep-inventory/01-SUMMARY.md`
</output>