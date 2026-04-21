# Kalan Konular — Detaylı Uygulama Planı

> Tarih: 2026-04-21
> Branch: `feat/v8-sprint1-sandbox-enforcement`
> Faz 1 tamamlandı. Bu plan Faz 2-3'ün eksik kısımlarını kapsar.
> Araştırma: 4 paralel ajan ile derinlemesine kod analizi yapıldı.

---

## A. Replanner Gerçek Patch Üretimi (Orijinal Plan Madde 9)

### Mevcut Durum
- `evaluateReplan()` çalışıyor, `pipeline-engine.ts:584` phase_end'de tetikleniyor
- `snapshotProjectState()` doğru planId ile `listPhases()` çağırıyor — **FIX YAPILMIŞ**
- `ReplanResult` tipinde `autoApplied`, `pendingApproval`, `status` alanları mevcut
- `plan:replanned` eventi `autoApplied` ve `pendingApproval` bilgisi taşıyor
- Approval/rejection workflow'u tam çalışıyor (`approveReplanEvent()`/`rejectReplanEvent()`)
- `shouldReplan()` rate limiting (10 dakikada 1) mevcut
- Patch'ler DB'ye JSONB olarak kaydediliyor

### Eksikler (Ajan Araştırma Sonucu)
1. **`generatePatches()` çok sığ** — sadece 2 senaryo aktif (review rejection + injection threshold). 5 trigger tipinden 3'ü (`repeated_review_failure`, `repeated_provider_failure`, `design_drift`) hiçbir yerden tetiklenmiyor.
2. **5 PatchAction'dan sadece 3'ü `applyPatch()` içinde handle ediliyor** — `modify_task` ve `reorder` default→false'a düşüyor.
3. **Event payload'ında `patchIds` ve `replanEventId` yok** — sadece `evaluateReplan` sonucu taşıyor, approve sonrası taşıyor ama ilk emit'te eksik.
4. **Pipeline pending patch'leri beklemiyor** — `pendingApproval > 0` olsa bile sonraki faz başlıyor. Fire-and-forget çağrı.
5. **Yaratılan task'larda replan referansı yok** — hangi task'ın replan'den geldiği izlenemiyor.
6. **`snapshotProjectState()` queue density ve phase drift hesaplamıyor** — ham sayılar var ama oran/threshold yok.

### Mini Task'lar

#### A1. `generatePatches()` — 4 yeni senaryo ekle
- **Dosya**: `src/studio/adaptive-replanner.ts:212-263`
- **Detay**:
  - `phase_end` + `queuedTasks / totalTasks > 0.4` → `add_task` "Bottleneck triage" (tech-lead, riskLevel: low)
  - `repeated_provider_failure` → `defer_phase` (aktif fazda queued task'ları deferred yap, riskLevel: medium)
  - `phase_end` + `blockedTasks > 3` → `add_task` "Dependency resolution sweep" (riskLevel: low)
  - `design_drift` → `modify_task` (hedef task'ın complexity'sini güncelle, riskLevel: medium)
- **Değişiklik**: `snapshotProjectState()` return tipine `queueRatio`, `blockRatio` ekle (satır 165-205)
- **Çıktı**: ~40 satır

#### A2. `applyPatch()` — `modify_task` ve `reorder` handle et
- **Dosya**: `src/studio/adaptive-replanner.ts:269-308`
- **Detay**:
  - `modify_task`: `if (patch.targetId) await updateTask(patch.targetId, { complexity: patch.payload.complexity, assignedAgent: patch.payload.assignedAgent })`
  - `reorder`: `if (patch.targetId) await updateTask(patch.targetId, { dependsOn: patch.payload.dependsOn as string[] })`
- **Çıktı**: ~15 satır (2 yeni case)

#### A3. Event payload'a `replanEventId` + patch detayları ekle
- **Dosya**: `src/studio/adaptive-replanner.ts:345-354`
- **Detay**:
  - `evaluateReplan()` event payload'ına `replanEventId: result.id` ekle
  - `patchSummary: patches.map(p => ({ action: p.action, targetId: p.targetId, riskLevel: p.riskLevel }))` ekle
- **Çıktı**: ~8 satır

#### A4. Ek trigger'ları pipeline/execution-engine'e bağla
- **Dosya**: `src/studio/pipeline-engine.ts` ve `src/studio/execution-engine.ts`
- **Detay**:
  - `pipeline-engine.ts` — phase complete handler'ında: mevcut `phase_end` trigger'ını koru
  - `execution-engine.ts` — task failure handler'ında: aynı fazda 3+ failure → `evaluateReplan({ trigger: "repeated_review_failure", phaseId })`
  - `execution-engine.ts` veya `provider-state.ts` — provider degraded durumda: `evaluateReplan({ trigger: "repeated_provider_failure" })`
  - `task-injection.ts` — approved proposal count ≥ 5 (faz bazında) → `evaluateReplan({ trigger: "injection_threshold" })`
- **Çıktı**: ~25 satır (3-4 tetikleme noktası)

#### A5. Pipeline'da pending replan varken faz ilerlemesin
- **Dosya**: `src/studio/pipeline-engine.ts` — `advanceStage()` fonksiyonu (satır 759)
- **Detay**:
  - `advanceStage()` başında: `SELECT id FROM replan_events WHERE project_id = $1 AND status = 'pending' LIMIT 1`
  - Pending varsa: log + `pipeline:awaiting_replan_approval` event emit et, advance'i durdur
  - `approveReplanEvent()` sonrası: `pipelineEngine.advanceStage(projectId)` tetikle
- **Çıktı**: ~15 satır

#### A6. Replanner testleri güncelle
- **Dosya**: `src/studio/__tests__/phase3-modules.test.ts` (replanner bölümü)
- **Detay**:
  - Yeni senaryo: queue bottleneck → patch üretimi
  - Yeni senaryo: provider failure → defer_phase
  - `modify_task` ve `reorder` apply testleri
  - Pending replan → advance blocked testi
  - Event payload `replanEventId` içeriyor mu testi
- **Çıktı**: 8-10 yeni test

---

## B. Metrics Truth Katmanı (Orijinal Plan Madde 10)

### Mevcut Durum
- 10 aggregation query mevcut, 9'u gerçek veri döndürüyor
- `auto_approved` proposal sayımı yapılıyor (satır 160-162)
- Review rejection by role, verification failure rate, strategy success rates çalışıyor
- Replan trigger frequency sadece `trigger` bazında count yapıyor

### Eksikler (Ajan Araştırma Sonucu)
1. **`degradedProviderDuration` hardcoded `[]`** (satır 54) — `provider:degraded` event'leri var ama metrics'e hiç bağlanmamış
2. **Transient vs terminal failure ayrımı yok** — `task:failed` her iki durumu da kapsıyor, retry exhaustion ayrı sayılmıyor
3. **`auto_approved` sayımı misleading** — satır 169: `Number(row?.approved ?? 0) + Number((row as any)?.auto_approved ?? 0)` → human approved ve auto_approved birleşiyor
4. **Replan status breakdown yok** — sadece trigger frequency, applied/pending/rejected ayrımı yapılmıyor
5. **Frontend `AgenticPanel` degraded provider göstermiyor**

### Mini Task'lar

#### B1. `degradedProviderDuration` — events tablosundan hesapla
- **Dosya**: `src/studio/agentic-metrics.ts:54` (hardcoded `[]` yerine gerçek fonksiyon)
- **Detay**:
  ```sql
  SELECT payload->>'provider' AS provider,
         COUNT(*) AS incidents,
         SUM((payload->>'cooldownMs')::numeric) AS total_ms
  FROM events
  WHERE project_id = $1 AND type = 'provider:degraded'
  GROUP BY payload->>'provider'
  ```
- `getAgenticMetrics()` Promise.all'a ekle (satır 32-42 arası 10. element)
- **Çıktı**: ~20 satır

#### B2. Failure tipini ayır: transient vs terminal
- **Dosya**: `src/studio/types.ts` — `EventType` union'a `"task:transient_failure"` ekle
- **Dosya**: `src/studio/execution-engine.ts` — retry kararı verilen yerde (retry count < max):
  - Mevcut `task:failed` yerine `task:transient_failure` emit et
  - Sadece max retry aşıldığında veya non-retryable error'da `task:failed` (terminal) kalsın
- **Dosya**: `src/studio/agentic-metrics.ts` — yeni fonksiyon:
  ```ts
  async function getFailureClassification(projectId: string): Promise<{
    transientFailures: number;
    terminalFailures: number;
    retryExhausted: number;
  }>
  ```
- **Dosya**: `AgenticMetrics` interface'ine `failureClassification` ekle
- **Çıktı**: ~35 satır toplam (4 dosya)

#### B3. `auto_approved` — human vs system ayrımı
- **Dosya**: `src/studio/agentic-metrics.ts:155-173`
- **Detay**:
  - Satır 169: `autoApproved` sadece `auto_approved` count'u dönsün
  - Yeni field: `humanApproved: Number(row?.approved ?? 0)`
  - `AgenticMetrics.injectedTaskVolume` tipini güncelle: `{ total, humanApproved, autoApproved, pending, rejected }`
- **Çıktı**: ~10 satır

#### B4. Replan status breakdown ekle
- **Dosya**: `src/studio/agentic-metrics.ts:194-211`
- **Detay**: `getReplanTriggerFrequency()` içine status bazlı breakdown:
  ```sql
  SELECT trigger, status, COUNT(*) AS cnt
  FROM replan_events WHERE project_id = $1
  GROUP BY trigger, status
  ```
- `ReplanTriggerFrequency` tipine `byStatus: Record<string, number>` ekle
- **Çıktı**: ~15 satır

#### B5. Metrics testlerini güncelle
- **Dosya**: `src/studio/__tests__/agentic-metrics.test.ts`
- **Detay**:
  - `degradedProviderDuration` gerçek veri döndürme testi (events mock)
  - `auto_approved` ≠ `humanApproved` ayrım testi
  - `failureClassification` transient/terminal doğruluk testi
  - Replan status breakdown testi
- **Çıktı**: 5-7 yeni test

---

## C. Session / Memory Hizalama (Orijinal Plan Madde 11)

### Mevcut Durum (Ajan Doğrulaması)
- `initSession()` → `execution-engine.ts:616` ✅ production'da çağrılıyor
- `completeSession()` → `execution-engine.ts:1043` ✅ episode kaydı yapılıyor
- `failSession()` → `execution-engine.ts:1137` ✅ failure episode kaydı yapılıyor
- `triggerLearningExtraction()` → completeSession/failSession'dan ≥5 episode eşiğiyle ✅
- `selectStrategy()` → `getLearningPatterns()` cross-project learning ile %20 discount ✅
- `loadBehavioralContext()` → `formatBehavioralPrompt()` → prompt suffix ✅
- İlk observation (`strategy_selected`) `addObservation()` ile kaydediliyor ✅

### Eksikler (Ajan Doğrulaması)
1. **`recordStep()` import edilmiş ama execution-engine'de hiç çağrılmıyor** (satır 47'de import, 0 kullanım)
2. **`stepsCompleted` hep 0** — çünkü `addObservation()` dışında step artmıyor
3. **Observation-action loop yok** — sadece son episode summary kaydediliyor, ara adımlar kayboluyor
4. **Session observations dizisi (JSONB) sadece 1 entry içeriyor** (ilk strategy_selected)

### Mini Task'lar

#### C1. CLI execution lifecycle'ına `recordStep()` çağrıları ekle
- **Dosya**: `src/studio/execution-engine.ts`
- **Detay** — 4 çağrı noktası:
  1. **CLI spawn öncesi** (~satır 770): `recordStep(sessionId, { step: 1, type: "action", summary: "CLI execution started: ${adapter.name}" })`
  2. **CLI output alındıktan sonra** (~satır 830): `recordStep(sessionId, { step: 2, type: "observation", summary: "Output: ${output.rawOutput?.slice(0, 200) ?? 'empty'}" })`
  3. **Verification gate sonrası** (~satır 870): `recordStep(sessionId, { step: 3, type: "evaluation", summary: "Verification: ${verifyResult.passed ? 'passed' : 'failed'}" })`
  4. **Test gate sonrası** (~satır 900): `recordStep(sessionId, { step: 4, type: "evaluation", summary: "Test gate: ${testResult.passed ? 'passed' : testResult.reason}" })`
- Her çağrı `try/catch` içinde, non-blocking (session recording task execution'ı durdurmamalı)
- **Çıktı**: ~25 satır

#### C2. `addObservation()` — `stepsCompleted` increment
- **Dosya**: `src/studio/db/session-repo.ts` — `addObservation()` fonksiyonu
- **Detay**: Mevcut JSONB append'e ek olarak:
  ```sql
  UPDATE agent_sessions
  SET observations = observations || $2::jsonb,
      steps_completed = steps_completed + 1
  WHERE id = $1
  ```
- **Kontrol**: Mevcut implementasyonu oku, zaten varsa skip
- **Çıktı**: ~5 satır (SQL güncelleme)

#### C3. Session/memory testlerini güncelle
- **Dosya**: `src/studio/__tests__/agent-runtime.test.ts`
- **Detay**:
  - Test: `recordStep()` çağrısı sonrası `addObservation()` tetikleniyor mu
  - Test: `stepsCompleted` > 0 completeSession sonrası
  - Test: completeSession episode'unda `stepsCompleted` doğru sayıyı yansıtıyor mu
- **Çıktı**: 3-4 yeni test

---

## D. Execution Isolation Tamamlama (Orijinal Plan Madde 15)

### Mevcut Durum (Ajan Doğrulaması — Önemli Bulgular)
- **`isolated-workspace.ts` GERÇEK çalışıyor** — file-copy to tmpdir, write-back enforcement, path safety validation, cleanup ✅
- **`container-manager.ts` GERÇEK Docker API** — Dockerode ile container create/exec/stop, volume mount, env vars, memory/CPU limits ✅
- **`container-pool.ts` GERÇEK pool yönetimi** — health checks (15s), port management (9900+), dynamic scaling (max 8), CapDrop ALL + minimal CapAdd ✅
- **CLI execution isolated workspace CWD kullanıyor** — `execution-engine.ts:776` → `repoPath: runtimeRepoPath`, `cli-runtime.ts:247` → `cwd: repoPath` ✅
- **Write-back enforcement GERÇEK** — `execution-engine.ts:839-846` → sadece declared files sync ✅
- **Tool governance KISMEN provider-agnostic** — `--tools` flag Claude'a geçiyor, Codex restricted tool'ları reddediyor (hata fırlatıyor)

### Eksikler (Ajan Doğrulaması)
1. **Container manager execution-engine ana path'inde kullanılmıyor** — sadece route'lardan erişilebilir, task execution hep `isolated-workspace` (file-copy) kullanıyor
2. **Network policy tanımlı ama ENFORCE EDİLMİYOR** — `SandboxPolicy.networkPolicy` field var ama hiçbir yerde iptables/firewall kuralı uygulanmıyor
3. **İki isolation sistemi birbirinden habersiz** — `isolated-workspace` ve `container-pool/manager` bağlantısız
4. **Sandbox tool governance sadece WARNING** — soft mode'da log basıyor, hard mode'da bile CLI provider'ın flag'ine güveniyor (host-side enforcement yok)
5. **Container env passing eksik** — `/tmp/.agent-env` signal file workaround'u var, exec'e env geçmiyor

### Mini Task'lar

#### D1. `ExecutionWorkspace` unified contract tanımla
- **Dosya**: yeni `src/studio/execution-workspace.ts`
- **Detay**:
  ```ts
  export interface ExecutionWorkspace {
    readonly type: "local" | "isolated" | "container";
    readonly repoPath: string;
    readonly isolated: boolean;
    writeBack(files: string[]): Promise<string[]>;
    cleanup(): Promise<void>;
  }

  export async function resolveWorkspace(
    sourceRepoPath: string | undefined,
    taskId: string,
    policy?: SandboxPolicy,
    containerAvailable?: boolean,
  ): Promise<ExecutionWorkspace>
  ```
- Karar mantığı:
  - `policy.isolationLevel === "container"` + `containerAvailable` → container-pool'dan acquire
  - `policy.isolationLevel !== "none"` → `prepareIsolatedWorkspace()` (file-copy)
  - default → local (source repo direct)
- Container path: pool'dan container acquire → `docker cp` workspace into container → execute → `docker cp` back
- **Çıktı**: ~70 satır

#### D2. Execution-engine'de `resolveWorkspace()` kullan
- **Dosya**: `src/studio/execution-engine.ts`
- **Detay**:
  - Satır ~672-680: mevcut `prepareIsolatedWorkspace()` çağrısını `resolveWorkspace()` ile değiştir
  - Satır ~1600-1610: review workspace için de aynı contract
  - `workspace.type` bazında CLI adapter'a ek env geçilebilir (container ID vb.)
- **Çıktı**: ~20 satır değişiklik

#### D3. Sandbox tool enforcement — hard mode'da pre-execution gate
- **Dosya**: `src/studio/execution-engine.ts` (~satır 770, CLI spawn öncesi)
- **Detay**:
  - Hard enforcement mode'da: `enforceToolCheck()` sonucunu CLI spawn'dan ÖNCE kontrol et
  - Eğer denied tool varsa ve mode hard ise: task'ı `SandboxViolationError` ile fail et (CLI'ye hiç gönderme)
  - Bu, provider'ın `--tools` flag'ini honor edip etmemesinden bağımsız çalışır
  - Mevcut post-execution check (`enforcePathChecks`/`enforceOutputSizeCheck`) korunacak
- **Çıktı**: ~15 satır

#### D4. Network policy — container mode'da enforcement
- **Dosya**: `src/studio/container-pool.ts` veya `container-manager.ts`
- **Detay**:
  - Container create config'ine `NetworkMode` bazlı kısıtlama:
    - `networkPolicy === "none"` → `NetworkMode: "none"` (container network yok)
    - `networkPolicy === "restricted"` → bridge + sadece belirli host'lara erişim (Docker network policy)
    - `networkPolicy === "full"` → `NetworkMode: "bridge"` (mevcut default)
  - Bu sadece container mode'da geçerli; file-copy isolation'da network kısıtlaması yapılamaz (host process)
- **Çıktı**: ~20 satır

#### D5. Isolation testlerini genişlet
- **Dosya**: `src/studio/__tests__/isolated-workspace.test.ts` (mevcut + yeni testler)
- **Detay**:
  - `resolveWorkspace()` karar mantığı testi: `isolationLevel` → workspace type mapping
  - Container unavailable fallback testi: container mode istenmiş ama Docker yok → isolated fallback
  - `ExecutionWorkspace` contract uyumu testi: her tip writeBack/cleanup implement ediyor mu
  - Sandbox pre-execution gate testi: hard mode + denied tool → task fail (CLI spawn yok)
  - Network policy → container NetworkMode mapping testi
- **Çıktı**: 6-8 yeni test

---

## Uygulama Sıralaması

| Sprint | Kapsam | Mini Task | Dosya Sayısı | Bağımlılık |
|--------|--------|-----------|-------------|------------|
| **S1** | C1-C3 (Session recordStep) | 3 task | 3 dosya | Yok — en izole |
| **S2** | B1-B5 (Metrics truth) | 5 task | 4 dosya | Yok |
| **S3** | A1-A6 (Replanner patches) | 6 task | 4 dosya | Yok |
| **S4** | D1-D5 (Container isolation) | 5 task | 5 dosya | Yok — en geniş scope |

> **Toplam**: 19 mini task, 4 sprint.
> Sprint'ler birbirinden bağımsız, paralel yürütülebilir.
> Önerilen başlangıç: S1 (3 task, ~30 satır, en düşük risk).

## Sprint İç Sıralaması

### S1 (Session)
```
C2 (stepsCompleted increment) → C1 (recordStep çağrıları) → C3 (testler)
```

### S2 (Metrics)
```
B3 (auto_approved fix) → B1 (degradedProvider) → B2 (failure classification) → B4 (replan breakdown) → B5 (testler)
```

### S3 (Replanner)
```
A2 (applyPatch cases) → A1 (generatePatches) → A3 (event payload) → A4 (trigger bağlama) → A5 (pipeline pause) → A6 (testler)
```

### S4 (Isolation)
```
D1 (contract tanımla) → D2 (execution-engine entegrasyonu) → D3 (tool pre-gate) → D4 (network policy) → D5 (testler)
```

## Doğrulama Kriterleri

1. **Session**: `recordStep()` en az 3 kez çağrılmalı (start, output, verify). `stepsCompleted > 0`. Episode summary step count yansıtmalı.
2. **Metrics**: `degradedProviderDuration` gerçek veri döndürmeli. `humanApproved` ≠ `autoApproved`. `failureClassification.transientFailures` + `terminalFailures` = total failures. Replan `byStatus` dolmuş olmalı.
3. **Replanner**: `phase_end` + yüksek queue density → bottleneck patch. `modify_task`/`reorder` apply edilmeli. Event `replanEventId` taşımalı. Pending replan → `advanceStage` blocked. 3+ failure → `repeated_review_failure` trigger.
4. **Isolation**: `resolveWorkspace()` enforcement mode + Docker availability'ye göre doğru tip seçmeli. Hard mode + denied tool → task fail (CLI spawn yok). Container mode → `NetworkMode` policy'den türetilmeli.
5. **E2E**: `e2e-pipeline.test.ts` tüm yeni path'lerle güncellenip yeşile dönmeli.
