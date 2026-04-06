# AI Dev Studio - Phase 1 Technical Design

## Overview

Phase 1 MVP: PM Agent ile proje planlama, 1 Coder Agent Docker container'da Claude Code ile çalışıyor, terminal'den canlı izleme.

---

## 1. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER (React)                       │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Project  │  │  Agent   │  │ Terminal │  │   Task     │  │
│  │ Chat     │  │  Team    │  │  View    │  │   Board    │  │
│  │ (PM)     │  │  Panel   │  │ (xterm)  │  │            │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │              │             │               │         │
│       └──────────────┴─────────────┴───────────────┘         │
│                          │  WebSocket + REST                 │
└──────────────────────────┼───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│                    ORCHESTRATOR SERVICE                       │
│                          │                                   │
│  ┌───────────┐  ┌───────┴──────┐  ┌──────────────────────┐  │
│  │ PM Agent  │  │ Task Engine  │  │ Container Manager    │  │
│  │ (VoltAgent│  │              │  │ (Docker API)         │  │
│  │  Agent)   │  │ - Scheduler  │  │                      │  │
│  │           │  │ - Dependency │  │ - Create/Stop        │  │
│  │ - Plan    │  │ - Events     │  │ - Exec commands      │  │
│  │ - Chat    │  │ - Status     │  │ - Stream output      │  │
│  └───────────┘  └──────────────┘  └──────────┬───────────┘  │
│                                               │              │
│  ┌────────────┐  ┌────────────┐  ┌───────────┴───────────┐  │
│  │ Project DB │  │ Event Bus  │  │ Git Manager           │  │
│  │ (SQLite)   │  │ (EventEmit)│  │ (simple-git)          │  │
│  └────────────┘  └────────────┘  └───────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
   ┌──────────┴──────────┐  ┌──────────┴──────────┐
   │  Coder Container 1  │  │  Coder Container 2  │
   │                     │  │  (Phase 2)           │
   │  - Node.js runtime  │  │                      │
   │  - Claude Code CLI  │  │                      │
   │  - Git client       │  │                      │
   │  - Project files    │  │                      │
   │    (volume mount)   │  │                      │
   └─────────────────────┘  └──────────────────────┘
```

---

## 2. Data Models

### 2.1 Project (Workspace)

```typescript
interface Project {
  id: string;                    // uuid
  name: string;                  // "E-Commerce App"
  description: string;           // User's initial request
  status: 'planning' | 'approved' | 'running' | 'paused' | 'completed' | 'failed';
  techStack: string[];           // ["Next.js", "Prisma", "PostgreSQL"]
  repoPath: string;              // "/workspaces/ecommerce-app/repo"
  createdAt: Date;
  updatedAt: Date;
}
```

### 2.2 Project Plan

```typescript
interface ProjectPlan {
  id: string;
  projectId: string;
  version: number;               // Plan can be revised
  status: 'draft' | 'approved' | 'rejected';
  phases: Phase[];
  createdAt: Date;
}

interface Phase {
  id: string;
  name: string;                  // "Foundation"
  order: number;                 // 1, 2, 3...
  status: 'pending' | 'running' | 'completed' | 'failed';
  tasks: Task[];
  dependsOn: string[];           // Phase IDs
}

interface Task {
  id: string;
  phaseId: string;
  title: string;                 // "Create user auth API"
  description: string;           // Detailed instructions
  assignedAgent: string;         // Agent ID
  status: 'queued' | 'assigned' | 'running' | 'review' | 'done' | 'failed';
  complexity: 'S' | 'M' | 'L';
  dependsOn: string[];           // Task IDs
  branch: string;                // "feat/auth-api"
  output?: TaskOutput;
  retryCount: number;
  startedAt?: Date;
  completedAt?: Date;
}

interface TaskOutput {
  filesCreated: string[];
  filesModified: string[];
  testResults?: { passed: number; failed: number; total: number };
  logs: string[];
}
```

### 2.3 Agent Configuration

```typescript
interface AgentConfig {
  id: string;
  name: string;                  // "Kerem"
  role: AgentRole;               // "pm" | "coder" | "architect" | ...
  avatar: string;                // Emoji or image URL
  personality: string;           // "Organized, detail-oriented"
  model: string;                 // "claude-sonnet-4-6"
  cliTool: 'claude-code' | 'codex' | 'aider' | 'none';
  skills: string[];              // ["Node.js", "React", "PostgreSQL"]
  systemPrompt: string;          // Custom instructions
  isPreset: boolean;             // true for built-in agents
}

type AgentRole = 'pm' | 'architect' | 'frontend' | 'backend' | 'qa' | 'reviewer' | 'devops' | 'coder';
```

### 2.4 Agent Runtime State

```typescript
interface AgentRuntime {
  agentId: string;
  projectId: string;
  containerId?: string;          // Docker container ID
  status: 'idle' | 'working' | 'waiting' | 'error';
  currentTaskId?: string;
  terminalBuffer: string[];      // Last N lines of terminal output
  branch: string;
  startedAt?: Date;
}
```

### 2.5 Events

```typescript
interface StudioEvent {
  id: string;
  projectId: string;
  type: EventType;
  agentId?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

type EventType =
  | 'task:assigned'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:retry'
  | 'agent:started'
  | 'agent:stopped'
  | 'agent:output'          // Terminal output line
  | 'agent:error'
  | 'phase:started'
  | 'phase:completed'
  | 'plan:created'
  | 'plan:approved'
  | 'escalation:user'       // Needs user input
  | 'git:commit'
  | 'git:pr-created';
```

---

## 3. Backend API Design

### 3.1 Project APIs

```
POST   /api/studio/projects                    # Create project
GET    /api/studio/projects                    # List projects
GET    /api/studio/projects/:id                # Get project detail
PATCH  /api/studio/projects/:id                # Update project
DELETE /api/studio/projects/:id                # Delete project
```

### 3.2 PM Chat API (SSE)

```
POST   /api/studio/projects/:id/chat           # Send message to PM Agent
       Body: { message: string }
       Response: SSE stream (same format as existing /agents/:id/stream)

GET    /api/studio/projects/:id/chat/history    # Get chat history
```

### 3.3 Plan APIs

```
GET    /api/studio/projects/:id/plan            # Get current plan
POST   /api/studio/projects/:id/plan/approve    # Approve plan
POST   /api/studio/projects/:id/plan/reject     # Reject with feedback
       Body: { feedback: string }
```

### 3.4 Task APIs

```
GET    /api/studio/projects/:id/tasks           # List all tasks
GET    /api/studio/projects/:id/tasks/:taskId   # Task detail
PATCH  /api/studio/projects/:id/tasks/:taskId   # Update task (reassign, etc.)
POST   /api/studio/projects/:id/tasks/:taskId/retry  # Retry failed task
```

### 3.5 Agent APIs

```
GET    /api/studio/agents                       # List agent configs
POST   /api/studio/agents                       # Create custom agent
PUT    /api/studio/agents/:id                   # Update agent config
DELETE /api/studio/agents/:id                   # Delete custom agent
GET    /api/studio/agents/presets               # List preset agents
```

### 3.6 Container/Terminal APIs (WebSocket)

```
WS     /api/studio/projects/:id/agents/:agentId/terminal
       # Bidirectional WebSocket:
       # Server → Client: terminal output (stdout/stderr)
       # Client → Server: user input (commands)

GET    /api/studio/projects/:id/agents/:agentId/status
       # Agent runtime status
```

### 3.7 Event Stream (SSE)

```
GET    /api/studio/projects/:id/events
       # SSE stream of all project events
       # Used by: Flow graph, Kanban, Timeline - real-time updates
```

### 3.8 Files API

```
GET    /api/studio/projects/:id/files           # File tree
GET    /api/studio/projects/:id/files/*path     # File content
GET    /api/studio/projects/:id/git/log         # Git commit log
GET    /api/studio/projects/:id/git/diff/:ref   # Git diff
```

---

## 4. Backend Services

### 4.1 PM Agent Service (`src/studio/pm-agent.ts`)

VoltAgent Agent olarak implement edilir, özel tool'ları var:

```typescript
const pmTools = [
  createProjectPlanTool,     // Proje planı oluştur (output: ProjectPlan JSON)
  updateProjectPlanTool,     // Planı güncelle
  assignTaskTool,            // Task'ı bir agenta ata
  getProjectStatusTool,      // Proje durumunu sorgula
  askUserTool,               // Kullanıcıya soru sor (chat'e yansır)
];

const pmAgent = new Agent({
  name: "pm-kerem",
  instructions: `You are Kerem, a senior Project Manager for an AI Dev Studio.
Your role:
1. Understand user's project requirements through conversation
2. Ask clarifying questions about tech stack, features, scope
3. Create a structured project plan with phases and tasks
4. Assign tasks to appropriate team members
5. Monitor progress and handle escalations

When creating a plan, output it using the createProjectPlan tool.
Break work into small, focused tasks that can be done independently.
Identify dependencies between tasks accurately.
...`,
  model: "claude-sonnet-4-6",
  tools: pmTools,
  memory: studioMemory,
});
```

### 4.2 Task Engine (`src/studio/task-engine.ts`)

```typescript
class TaskEngine {
  // Task lifecycle management
  async startPhase(projectId: string, phaseId: string): void
  async assignTask(taskId: string, agentId: string): void
  async startTask(taskId: string): void
  async completeTask(taskId: string, output: TaskOutput): void
  async failTask(taskId: string, error: string): void
  async retryTask(taskId: string): void

  // Dependency resolution
  getReadyTasks(phaseId: string): Task[]          // Tasks with all deps met
  checkPhaseComplete(phaseId: string): boolean
  getNextPhase(projectId: string): Phase | null

  // Event emission
  private emit(event: StudioEvent): void
}
```

### 4.3 Container Manager (`src/studio/container-manager.ts`)

```typescript
class ContainerManager {
  // Docker API kullanarak container yönetimi
  async createContainer(config: ContainerConfig): string   // Returns containerId
  async startContainer(containerId: string): void
  async stopContainer(containerId: string): void
  async removeContainer(containerId: string): void
  async execCommand(containerId: string, command: string): ExecResult

  // Terminal streaming
  streamOutput(containerId: string): ReadableStream<string>
  sendInput(containerId: string, input: string): void

  // Container config
  getContainerConfig(agent: AgentConfig, project: Project): ContainerConfig
}

interface ContainerConfig {
  image: string;                // "ai-dev-studio/coder:latest"
  name: string;                 // "studio-{projectId}-{agentId}"
  volumes: VolumeMount[];       // Project repo mount
  env: Record<string, string>;  // ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
  networkMode: string;          // Isolated network
  memoryLimit: string;          // "2g"
  cpuLimit: number;             // 2
}
```

### 4.4 Git Manager (`src/studio/git-manager.ts`)

```typescript
class GitManager {
  async initRepo(projectPath: string): void
  async createBranch(projectPath: string, branchName: string): void
  async checkout(projectPath: string, branch: string): void
  async commit(projectPath: string, message: string): void
  async merge(projectPath: string, source: string, target: string): MergeResult
  async getLog(projectPath: string, limit?: number): GitLogEntry[]
  async getDiff(projectPath: string, ref?: string): string
  async getFileTree(projectPath: string): FileTreeNode[]
  async getFileContent(projectPath: string, filePath: string): string
}
```

### 4.5 Event Bus (`src/studio/event-bus.ts`)

```typescript
class EventBus {
  // Simple EventEmitter-based pub/sub
  emit(event: StudioEvent): void
  on(type: EventType, handler: (event: StudioEvent) => void): void
  onProject(projectId: string, handler: (event: StudioEvent) => void): void

  // SSE streaming for UI
  createSSEStream(projectId: string): ReadableStream
}
```

---

## 5. Coder Agent Docker Image

### 5.1 Dockerfile (`docker/coder-agent/Dockerfile`)

```dockerfile
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install common dev tools
RUN npm install -g typescript tsx pnpm

# Create workspace directory
RUN mkdir -p /workspace && chown node:node /workspace

USER node
WORKDIR /workspace

# Entry point: keep container running, accept commands via exec
CMD ["tail", "-f", "/dev/null"]
```

### 5.2 How Coder Agent Executes Tasks

```
1. Container Manager creates container with project volume mounted
2. Task Engine assigns task to Coder Agent
3. Orchestrator sends command to container:

   claude --dangerously-skip-permissions \
     --message "Implement user authentication API.
       Follow the coding standards in docs/CODING_STANDARDS.md.
       API contract is defined in docs/API_CONTRACT.md.
       Create files in src/routes/auth.ts and src/services/auth.service.ts.
       Write unit tests in src/__tests__/auth.test.ts."

4. Terminal output streams to UI via WebSocket
5. When Claude Code finishes:
   - Git commit changes
   - Run tests
   - Report results to Task Engine
6. Task Engine marks task done or failed
```

---

## 6. Frontend Components (New)

### 6.1 Page Structure

```
/studio                          → StudioHomePage (project list)
/studio/:projectId               → ProjectPage (main workspace)
/studio/:projectId/chat          → PM Chat (tab)
/studio/:projectId/team          → Team View (tab)
/studio/:projectId/board         → Kanban Board (tab)
/studio/:projectId/terminal/:id  → Agent Terminal (tab)
/studio/:projectId/files         → File Explorer (tab)
/studio/agents                   → Agent Management
/studio/agents/new               → Agent Builder
```

### 6.2 Key Components

```
StudioHomePage
├── ProjectCard (per project)
│   ├── Status badge
│   ├── Progress bar
│   ├── Active agents count
│   └── Actions (Open, Pause, Delete)
└── CreateProjectButton

ProjectPage
├── ProjectHeader (name, status, progress)
├── TabBar (Chat | Team | Board | Files)
├── ChatTab
│   ├── PMChat (SSE streaming, same pattern as ChatPanel)
│   ├── PlanPreview (rendered plan with approve/reject)
│   └── QuickActions bar
├── TeamTab
│   ├── AgentGrid
│   │   └── AgentCard (avatar, name, status, mini-terminal)
│   ├── AgentDetailPanel (full terminal + file view)
│   └── SplitView (2 terminals side by side)
├── BoardTab
│   ├── KanbanColumn (Queued | Running | Review | Done | Failed)
│   │   └── TaskCard (title, agent avatar, duration, branch)
│   └── FilterBar (by agent, by phase)
├── FilesTab
│   ├── FileTree (git repo)
│   ├── FileViewer (syntax highlighted)
│   └── DiffViewer (for PRs)
└── EventFeed (bottom bar, scrolling activity log)

AgentBuilderPage
├── AvatarPicker
├── RoleSelector
├── ModelSelector
├── CLIToolSelector
├── SkillTagInput
├── SystemPromptEditor
└── SaveButton
```

### 6.3 Terminal Component (xterm.js)

```
npm install xterm @xterm/addon-fit @xterm/addon-web-links
```

```typescript
// AgentTerminal.tsx
// - Connects to WebSocket: /api/studio/projects/:id/agents/:agentId/terminal
// - Renders xterm.js terminal
// - Bidirectional: shows output + accepts user input
// - Auto-scroll, search, copy support
// - Status bar: agent name, current task, running time
```

---

## 7. Docs System Integration

### 7.1 Auto-generated docs/ structure

When PM approves a plan, Architect phase creates:

```
project/
├── docs/
│   ├── PROJECT.md              # PM Agent generates from chat
│   ├── ARCHITECTURE.md         # Architect Agent generates
│   ├── CODING_STANDARDS.md     # Architect Agent + user preferences
│   ├── API_CONTRACT.md         # Architect Agent generates
│   ├── DATABASE_SCHEMA.md      # Architect Agent generates
│   ├── CHANGELOG.md            # Auto-updated by Git Manager
│   └── DECISIONS.md            # Logged by all agents
```

### 7.2 Agent docs reading

Before each task, the orchestrator injects relevant docs into agent context:

```typescript
function buildAgentContext(task: Task, project: Project): string {
  const docs = [];

  // Always include
  docs.push(readFile(`${project.repoPath}/docs/CODING_STANDARDS.md`));

  // Role-specific
  if (task.assignedAgent.role === 'backend') {
    docs.push(readFile(`${project.repoPath}/docs/API_CONTRACT.md`));
    docs.push(readFile(`${project.repoPath}/docs/DATABASE_SCHEMA.md`));
  }
  if (task.assignedAgent.role === 'frontend') {
    docs.push(readFile(`${project.repoPath}/docs/COMPONENT_GUIDE.md`));
    docs.push(readFile(`${project.repoPath}/docs/API_CONTRACT.md`));
  }

  return docs.join('\n---\n');
}
```

---

## 8. File Structure (New Code)

```
src/
├── index.ts                     # Existing VoltAgent entry
├── studio/                      # NEW: AI Dev Studio module
│   ├── index.ts                 # Studio server setup & routes
│   ├── pm-agent.ts              # PM Agent with planning tools
│   ├── pm-tools.ts              # PM-specific tool definitions
│   ├── task-engine.ts           # Task lifecycle & scheduling
│   ├── container-manager.ts     # Docker container operations
│   ├── git-manager.ts           # Git operations
│   ├── event-bus.ts             # Event pub/sub system
│   ├── docs-manager.ts          # Docs reading/updating
│   ├── types.ts                 # All TypeScript interfaces
│   └── db.ts                    # SQLite schema & queries

console/src/
├── pages/
│   ├── studio/                  # NEW: Studio pages
│   │   ├── StudioHomePage.tsx   # Project list
│   │   ├── ProjectPage.tsx      # Main project workspace
│   │   ├── AgentBuilderPage.tsx # Create/edit agents
│   │   └── AgentListPage.tsx    # Agent management
│   └── ...existing pages
├── components/
│   ├── studio/                  # NEW: Studio components
│   │   ├── PMChat.tsx           # PM Agent chat interface
│   │   ├── PlanPreview.tsx      # Visual plan display
│   │   ├── AgentCard.tsx        # Agent status card
│   │   ├── AgentGrid.tsx        # Team view grid
│   │   ├── AgentTerminal.tsx    # xterm.js terminal
│   │   ├── TaskCard.tsx         # Kanban task card
│   │   ├── KanbanBoard.tsx      # Kanban columns
│   │   ├── FileExplorer.tsx     # File tree + viewer
│   │   ├── EventFeed.tsx        # Activity log
│   │   └── QuickActions.tsx     # Quick action buttons
│   └── ...existing components
└── lib/
    ├── studio-api.ts            # NEW: Studio API client
    └── ...existing lib
```

---

## 9. Implementation Order (Phase 1)

### Step 1: Foundation (Week 1)
- [ ] `src/studio/types.ts` - Data models
- [ ] `src/studio/db.ts` - SQLite schema (projects, plans, tasks, agents, events)
- [ ] `src/studio/event-bus.ts` - Event system
- [ ] `src/studio/index.ts` - Hono routes setup

### Step 2: PM Agent (Week 1-2)
- [ ] `src/studio/pm-tools.ts` - Plan creation/update tools
- [ ] `src/studio/pm-agent.ts` - PM Agent with VoltAgent
- [ ] PM chat SSE endpoint
- [ ] Plan approval flow

### Step 3: Task Engine (Week 2)
- [ ] `src/studio/task-engine.ts` - Full task lifecycle
- [ ] Dependency resolution
- [ ] Phase progression logic
- [ ] Event emission

### Step 4: Container Manager (Week 2-3)
- [ ] `src/studio/container-manager.ts` - Docker operations
- [ ] `docker/coder-agent/Dockerfile` - Coder image
- [ ] WebSocket terminal streaming
- [ ] Command execution

### Step 5: Git Manager (Week 3)
- [ ] `src/studio/git-manager.ts` - Git operations
- [ ] Branch per agent
- [ ] Auto-commit on task complete
- [ ] File tree API

### Step 6: Frontend - Studio Home (Week 3)
- [ ] `StudioHomePage.tsx` - Project list
- [ ] Create project flow
- [ ] Navigation & routing

### Step 7: Frontend - PM Chat (Week 3-4)
- [ ] `PMChat.tsx` - Chat with PM Agent
- [ ] `PlanPreview.tsx` - Visual plan display
- [ ] Plan approve/reject UI

### Step 8: Frontend - Team & Terminal (Week 4)
- [ ] `AgentTerminal.tsx` - xterm.js integration
- [ ] `AgentCard.tsx` + `AgentGrid.tsx` - Team view
- [ ] WebSocket terminal connection

### Step 9: Frontend - Board & Files (Week 4)
- [ ] `KanbanBoard.tsx` + `TaskCard.tsx`
- [ ] `FileExplorer.tsx` - File tree + viewer
- [ ] `EventFeed.tsx` - Activity log

### Step 10: Integration & Polish (Week 5)
- [ ] End-to-end flow testing
- [ ] Docs system integration
- [ ] Error handling & retry logic
- [ ] Agent preset templates

---

## 10. Key Dependencies (New)

### Backend
```
dockerode          # Docker API client for Node.js
simple-git         # Git operations
better-sqlite3     # SQLite database (or continue LibSQL)
ws                 # WebSocket server for terminal
hono               # Already using via @voltagent/server-hono
```

### Frontend
```
xterm              # Terminal emulator
@xterm/addon-fit   # Terminal auto-resize
@xterm/addon-web-links  # Clickable links in terminal
@xyflow/react      # Flow graph (Phase 2, but can prep)
monaco-editor      # Code editor (Phase 2)
```
