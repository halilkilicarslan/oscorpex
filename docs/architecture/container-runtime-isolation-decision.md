# Container Runtime Isolation — Architecture Decision Record

ADR Number: 001
Date: 2026-05-14
Status: Accepted
Deciders: Platform Team

---

## Context

Oscorpex executes user-defined code inside containers as part of the pipeline preview and app-runner subsystems. The kernel must launch, monitor, and tear down these containers safely. The key question is: which container runtime strategy provides the best balance of isolation, security, operational simplicity, and CI compatibility?

The current implementation in `apps/kernel/src/studio/app-runner/` and `runtime-analyzer/` spawns containers via shell commands. The container pool was disabled because production Docker pool images are not available. We need a concrete decision before re-enabling container execution.

---

## Options Considered

### Option 1: Direct Docker Socket Mount (`/var/run/docker.sock`)

The kernel container mounts the host Docker socket and issues `docker run` commands directly.

Advantages:
- Zero additional infrastructure — works immediately
- No performance overhead
- Simple to implement and debug

Disadvantages:
- Critical security risk: mounting the Docker socket grants root-equivalent access to the host
- Any container escape or RCE in the kernel gives full host compromise
- Violates principle of least privilege
- Incompatible with read-only root filesystem hardening
- Kubernetes PSS (Pod Security Standards) restricted profile blocks socket mounts

Verdict: Rejected. Unacceptable security posture for production.

---

### Option 2: Docker-in-Docker (DinD) Sidecar

A separate DinD container runs as a sidecar (sharing a pod in Kubernetes, or sharing a Docker network in Compose). The kernel communicates with the DinD daemon via `DOCKER_HOST=tcp://dind:2376` (TLS-authenticated).

Advantages:
- Strong isolation: kernel container has no access to the host Docker daemon
- DinD daemon's containers are nested — a container escape reaches only the DinD level
- TLS mutual authentication between kernel and DinD daemon
- Compatible with CI environments (GitHub Actions `services:`, GitLab `services:`)
- Standard pattern used by GitLab CI, Drone CI, and many platforms
- No privileged kernel process — only the DinD sidecar runs privileged

Disadvantages:
- DinD requires the sidecar to run in privileged mode (or with `--cap-add SYS_ADMIN` + seccomp profile)
- Nested overlay filesystem has a performance penalty (~5-15% on I/O-heavy workloads)
- Image pull inside DinD does not benefit from host image cache — cold starts are slower
- DinD sidecar needs its own resource limits and health checks

Verdict: Recommended for current stage. Best balance of isolation and operational simplicity.

---

### Option 3: Rootless Docker / Podman

Run Docker or Podman in rootless mode — the daemon and containers run as a non-root user.

Advantages:
- No privileged processes required
- Container escapes land in a non-root user namespace
- Podman is daemonless — no persistent process to manage
- Aligns with Kubernetes user namespace support (alpha in 1.25, beta in 1.30)

Disadvantages:
- Rootless Docker requires kernel user namespace support — not universally available
- `newuidmap`/`newgidmap` must be installed and configured on the host
- Overlay filesystem may not be available without `fuse-overlayfs` fallback
- Podman compatibility with Docker API is high but not 100% — some edge cases in SDK usage
- Debugging rootless setups is significantly harder
- Not supported on all managed Kubernetes distributions (EKS Fargate, Cloud Run)

Verdict: Viable long-term target. Not recommended until user namespace support stabilizes across target environments.

---

### Option 4: Kata Containers / gVisor

Hardware-virtualized containers (Kata) or syscall interception sandboxes (gVisor/runsc).

Advantages:
- Strongest isolation: each container runs in a lightweight VM (Kata) or has all syscalls intercepted (gVisor)
- Container escapes are dramatically harder — must break out of VM or syscall filter
- gVisor compatible with standard OCI runtime interface

Disadvantages:
- Kata requires nested virtualization or bare-metal hosts — not available on most cloud VMs
- gVisor has incomplete syscall coverage — many programs fail under runsc
- Significant performance overhead (Kata: ~10-30% on CPU-bound, gVisor: ~2-5x on syscall-heavy)
- Operational complexity is high — specialized knowledge required
- Not compatible with standard managed Kubernetes node pools

Verdict: Not recommended at current scale. Revisit if security requirements escalate significantly.

---

## Decision

Use DinD sidecar approach (Option 2).

### Implementation Plan

1. Add DinD service to `docker-compose.yml`:

```yaml
dind:
  image: docker:27-dind
  privileged: true
  environment:
    DOCKER_TLS_CERTDIR: /certs
  volumes:
    - dind-certs-ca:/certs/ca
    - dind-certs-client:/certs/client
  networks:
    - oscorpex-internal
```

2. Configure kernel to use DinD via environment:

```
DOCKER_HOST=tcp://dind:2376
DOCKER_TLS_VERIFY=1
DOCKER_CERT_PATH=/certs/client
```

3. Kernel connects to DinD daemon using Docker SDK with TLS verification. Never falls back to insecure connection.

4. Resource limits for spawned containers (enforced by DinD daemon):

```
--cpus=1.0
--memory=512m
--pids-limit=100
--network=none (for untrusted code)
```

5. Container images: pinned to SHA256 digests in `app-runner/types.ts`. No `latest` tag usage.

6. Cleanup: `docker rm -f <container>` called on task completion AND on kernel shutdown hook. Orphaned containers cleaned up by a watchdog that runs every 5 minutes.

### Kubernetes Deployment

In Kubernetes, deploy DinD as a sidecar container in the kernel pod:

```yaml
containers:
  - name: kernel
    image: oscorpex/kernel:...
    env:
      - name: DOCKER_HOST
        value: tcp://localhost:2376
      - name: DOCKER_TLS_VERIFY
        value: "1"
      - name: DOCKER_CERT_PATH
        value: /certs/client
    volumeMounts:
      - name: dind-certs-client
        mountPath: /certs/client
        readOnly: true

  - name: dind
    image: docker:27-dind
    securityContext:
      privileged: true
    env:
      - name: DOCKER_TLS_CERTDIR
        value: /certs
    volumeMounts:
      - name: dind-certs-ca
        mountPath: /certs/ca
      - name: dind-certs-client
        mountPath: /certs/client

volumes:
  - name: dind-certs-ca
    emptyDir: {}
  - name: dind-certs-client
    emptyDir: {}
```

### Security Mitigations for DinD

| Risk | Mitigation |
|------|-----------|
| DinD sidecar is privileged | Isolated pod — no other workloads share the node label in sensitive deployments |
| Container image tampering | All images pinned to SHA256 digest |
| Resource exhaustion | CPU/memory/pids limits on every spawned container |
| Network exfiltration | Untrusted containers use `--network=none` |
| Container lingering | Watchdog cleanup every 5 minutes + shutdown hook |
| Secrets leaking via env | Spawned containers never receive kernel env vars |

---

## Consequences

Positive:
- Clear isolation boundary between kernel and user code
- Production-deployable without host-level changes
- CI-compatible (GitHub Actions DinD service, GitLab services)
- Auditable — all container operations go through a single DOCKER_HOST endpoint

Negative:
- DinD sidecar adds resource overhead (~128MB idle)
- Image pull latency inside DinD (mitigated by pre-pulling base images in init)
- Privileged DinD sidecar is a constraint — some hardened clusters may not allow it

---

## Review Schedule

This decision should be revisited when:
- Rootless Docker user namespace support is stable across all target cloud providers
- Container execution volume exceeds 1000 runs/day (performance profiling needed)
- A security audit explicitly flags the DinD privileged sidecar as unacceptable
