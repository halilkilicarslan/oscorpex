# MCP Bridge Read-Only Plan

## Goal

Define a minimal, read-only MCP bridge that allows external AI tools to query Oscorpex project state without any mutation capability. All invocations must pass through `evaluateToolPolicy()` and workspace-resolver.

## Non-Goals

- Write operations (file create/modify/delete)
- Shell execution
- Git mutations (commit, push, reset)
- Network egress beyond explicit allowlist
- Credential access
- Database mutations
- Container operations
- Full MCP protocol compliance (this is a skeleton)

## Allowed Tools

| Tool | Description | Risk Level |
|------|------------|-----------|
| `repo.readFile` | Read file inside workspace | read |
| `repo.listFiles` | List directory inside workspace | read |
| `repo.search` | Search file contents | read |
| `git.status` | Git status | read |
| `git.diff` | Git diff | read |
| `git.log` | Git log | read |
| `project.getTaskState` | Get task status | read |
| `project.getPipelineState` | Get pipeline state | read |
| `docs.search` | Search documentation | read |

## Denied Tools

| Tool | Reason |
|------|--------|
| `file.write` | Write mutation |
| `file.delete` | Destructive mutation |
| `shell.run` | RCE vector |
| `git.commit` | Repository mutation |
| `git.push` | Remote mutation |
| `git.reset` | Destructive mutation |
| `network.fetch` | SSRF/exfiltration vector |
| `container.run` | Container escape vector |
| `db.mutate` | Data integrity risk |
| `credential.read` | Secret exfiltration |
| `deploy.run` | Production impact |

## Policy Enforcement

Every MCP tool invocation MUST:
1. Call `evaluateToolPolicy()` with `source: "llm"` or `source: "provider"`
2. Validate all file paths via `assertInsideWorkspace()`
3. Validate git refs for shell metacharacters
4. Record audit event via `eventBus.emit()`
5. Apply rate limiting per tenant/project

```typescript
async function invokeMcpTool(input: McpToolInvocation): Promise<McpToolResult> {
    // 1. Policy check
    const policyResult = enforceToolPolicy({
        request: {
            actorId: input.actorId,
            tenantId: input.tenantId,
            projectId: input.projectId,
            source: input.source,
            tool: input.toolName,
            action: "invoke",
            riskLevel: "read",
        },
    });

    // 2. Workspace check (for file/repo tools)
    if (input.toolName.startsWith("repo.") || input.toolName.startsWith("file.")) {
        assertInsideWorkspace(
            { tenantId: input.tenantId, projectId: input.projectId },
            extractPath(input.args),
        );
    }

    // 3. Execute read-only tool
    const handler = TOOL_REGISTRY[input.toolName];
    if (!handler) return { ok: false, error: { code: "UNKNOWN_TOOL", message: `Tool not found: ${input.toolName}` } };

    // 4. Audit
    eventBus.emitTransient({
        type: "mcp:tool_invoked",
        projectId: input.projectId,
        payload: { tool: input.toolName, source: input.source, actorId: input.actorId },
    });

    return handler(input);
}
```

## Workspace Enforcement

- All file paths resolved via `resolveWorkspacePath()`
- Symlink traversal blocked via `realpathSync()`
- `../` traversal rejected
- Absolute paths outside workspace rejected
- Tenant A cannot access Tenant B workspace

## Audit Model

Every MCP invocation produces:
```typescript
{
    type: "mcp:tool_invoked",
    projectId: string,
    payload: {
        tool: string,
        source: "user" | "llm" | "provider",
        actorId: string,
        policyDecision: "allow" | "deny",
        duration_ms: number,
        result_size_bytes: number,
    }
}
```

Denied invocations produce:
```typescript
{
    type: "mcp:tool_denied",
    projectId: string,
    payload: {
        tool: string,
        source: string,
        reason: string,
        code: string,
    }
}
```

## Integration Points

| Integration Point | Purpose |
|-------------------|---------|
| `evaluateToolPolicy()` | Policy gate for every invocation |
| `workspace-resolver` | File/repo path validation |
| `env-sanitizer` | No server secrets in tool context |
| `rate-limiter` | Per-tenant/project throttling |
| `eventBus` | Audit trail |
| `checkpoint-service` | Checkpoint before any future write tools |

## P4 Implementation Plan

### Phase 4a — Skeleton Package (Week 1)
1. Create `packages/mcp-bridge/` with types and registry
2. Implement `McpBridge.listTools()` returning read-only tools
3. Implement `McpBridge.invoke()` with policy + workspace enforcement
4. Add 8 read-only tool handlers
5. Tests: tool registry, policy denial, workspace check

### Phase 4b — Integration (Week 2)
6. Create kernel routes for MCP invocation (`POST /mcp/invoke`)
7. Wire into agent-runtime as optional tool provider
8. Add MCP tool audit logging
9. Add rate limiting per MCP endpoint
10. Integration tests with mock LLM client

### Phase 4c — Selective Write Tools (Week 3, after checkpoint stabilization)
11. Add `file.write` with mandatory checkpoint + approval
12. Add `git.commit` with mandatory checkpoint
13. All write tools require `riskLevel: "write"` policy check
14. All write tools create checkpoint before mutation
15. Dry-run support for write tools

### Dependencies
- Requires: checkpoint-service (P3-1) ✓
- Requires: tool-policy enforcement (P2-1) ✓
- Requires: workspace-resolver (P1-3) ✓
- Requires: env-sanitizer (P1-2) ✓
- Requires: rate-limiter (P1-5) ✓

### Estimated effort
- 3 weeks for single developer
- Phase 4a can start immediately after P3 completion
