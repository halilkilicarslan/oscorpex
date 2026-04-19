# Oscorpex v6 Roadmap — Production Readiness

> Tarih: 2026-04-19 | Önceki: v5 (6 milestone tamamlandı, 633 backend + 433 frontend test)
> Durum: Backend 633/633, Frontend 433/433, typecheck 0 hata

---

## Genel Bakış

12 özellik, 6 milestone, tahmini ~14 hafta. Her milestone bağımsız deliverable üretir.

### Milestone Özeti

| # | Milestone | Hafta | Öncelik | Risk |
|---|-----------|-------|---------|------|
| M1 | Auth UI + Notifications | 2 | P0 | Düşük |
| M2 | Cost Intelligence + Auto Testing | 2 | P1 | Orta |
| M3 | Templates v2 + GitHub/GitLab v2 | 2 | P1 | Orta |
| M4 | pg-boss Durable Queue | 2 | P1 | Yüksek |
| M5 | CLI Tool + OpenTelemetry | 2 | P2 | Düşük |
| M6 | Scale Foundation (Redis + Marketplace + Collaboration) | 4 | P2 | Yüksek |

### Dependency Graph
```
M1 (Auth UI + Notif) ──┐
                        ├──→ M2 (Cost + Testing)
                        ├──→ M3 (Templates + GitHub)
                        │         └──→ M4 (pg-boss) ──→ M6 (Scale)
                        └──→ M5 (CLI + OTel) [bağımsız]
```

---

## M1 — Auth UI + Notifications (P0, Hafta 1-2)

### F2: Frontend Login/Register UI (~900 LOC)

**Hedef:** M6 auth backend'ini frontend'e bağla. Login, register, token yönetimi, protected routes.

**Dosyalar:**
- Yeni: `LoginPage.tsx`, `RegisterPage.tsx`, `AuthContext.tsx`, `ProtectedRoute.tsx`, `studio-api/auth.ts`
- Değişecek: `App.tsx` (route guard), `base.ts` (Bearer token), Sidebar (user info + logout)
- Test: ~25 yeni

**Bağımlılık:** M6 (v5) — backend hazır
**Risk:** Düşük

### F3: Notification System (~1100 LOC)

**Hedef:** In-app notification center + Slack webhook desteği. Plugin SDK hook'ları üzerine inşa.

**Dosyalar:**
- Yeni: `notification-repo.ts`, `notification-service.ts`, `notification-routes.ts`, `NotificationBell.tsx`, `NotificationCenter.tsx`, `plugins/slack-notifier.ts`
- Değişecek: `types.ts`, `event-bus.ts`, `init.sql`
- Test: ~20 yeni

**Bağımlılık:** M5 (Plugin SDK) + M3 (LISTEN/NOTIFY)
**Risk:** Orta

---

## M2 — Cost Intelligence + Auto Testing (P1, Hafta 3-4)

### F8: Cost Optimization Engine (~850 LOC)

**Hedef:** Historical token_usage data'dan öğrenen model router. Benzer task'larda cost/quality optimal model seçimi.

**Dosyalar:**
- Yeni: `cost-optimizer.ts`, `cost-routes.ts`, `CostOptimizer.tsx`
- Değişecek: `model-router.ts`, `analytics-repo.ts`
- Test: ~20 yeni

**Bağımlılık:** M4 (v5, Multi-Provider)
**Risk:** Orta

### F9: Automated Testing of Generated Code (~750 LOC)

**Hedef:** Task completion sonrası otomatik test execution + coverage tracking.

**Dosyalar:**
- Yeni: `test-runner.ts`, `test-results-repo.ts`, `TestCoverage.tsx`
- Değişecek: `task-engine.ts`, `types.ts`, `init.sql`
- Test: ~15 yeni

**Bağımlılık:** Mevcut `task-runners.ts` altyapısı
**Risk:** Orta

---

## M3 — Templates v2 + GitHub/GitLab v2 (P1, Hafta 5-6)

### F5: Project Templates v2 (~900 LOC)

**Hedef:** Custom template DB persistence, template gallery UI, wizard-based project creation.

**Dosyalar:**
- Yeni: `template-repo.ts`, `template-routes.ts`, `TemplateGallery.tsx`, `TemplateWizard.tsx`
- Değişecek: `project-templates.ts`, `StudioHomePage.tsx`, `init.sql`
- Test: ~15 yeni

**Risk:** Düşük

### F12: GitHub/GitLab Integration v2 (~1100 LOC)

**Hedef:** Auto PR on phase/pipeline completion, CI status tracking (webhook), GitLab API desteği.

**Dosyalar:**
- Yeni: `gitlab-integration.ts`, `ci-tracker.ts`, `webhook-receiver-routes.ts`, `ci-repo.ts`, `CIStatusPanel.tsx`
- Değişecek: `github-integration.ts`, `pipeline-engine.ts`, `types.ts`, `init.sql`
- Test: ~20 yeni

**Bağımlılık:** Mevcut @octokit/rest
**Risk:** Orta

---

## M4 — pg-boss Durable Queue (P1, Hafta 7-8)

### F1: pg-boss Worker Queue (~800 LOC)

**Hedef:** In-memory Semaphore → pg-boss. Crash-safe task dispatch, process restart recovery.

**Dosyalar:**
- Yeni: `job-queue.ts`, `db/job-repo.ts`
- Değişecek: `execution-engine.ts` (Semaphore kaldır), `task-engine.ts` (notifyCompleted refactor), `pipeline-engine.ts`
- Test: ~35 yeni

**Bağımlılık:** M3 (v5, LISTEN/NOTIFY)
**Risk:** Yüksek — execution engine core değişiyor

---

## M5 — CLI Tool + OpenTelemetry (P2, Hafta 9-10)

### F4: CLI Tool (~750 LOC)

**Hedef:** `oscorpex init/start/deploy/status` CLI komutları. Ayrı npm paketi.

**Dosyalar:**
- Yeni: `cli/` dizini (index, init, start, deploy, status, package.json)
- Bağımlılık: commander
- Test: ~15 yeni

**Risk:** Düşük

### F7: OpenTelemetry Integration (~400 LOC)

**Hedef:** Distributed tracing — task execution spans, CLI adapter child spans, DB instrumentation.

**Dosyalar:**
- Yeni: `telemetry.ts`, `middleware/tracing-middleware.ts`
- Değişecek: `execution-engine.ts`, `cli-adapter.ts`, `pg.ts`
- Bağımlılık: @opentelemetry/*
- Test: ~12 yeni

**Risk:** Orta

---

## M6 — Scale Foundation (P2, Hafta 11-14)

### F10: Horizontal Scaling (~1200 LOC)

**Hedef:** Redis pub/sub, multi-instance WS, shared state, distributed Semaphore.

**Dosyalar:**
- Yeni: `redis-client.ts`, `shared-state.ts`, `ws-cluster.ts`
- Değişecek: `event-bus.ts`, `pipeline-engine.ts`, `ws-manager.ts`, `execution-engine.ts`, `provider-state.ts`, docker-compose
- Bağımlılık: ioredis
- Test: ~25 yeni

**Risk:** Yüksek

### F6: Agent Marketplace (~1200 LOC)

**Hedef:** Community agent config + team template sharing, import/export, rating.

**Dosyalar:**
- Yeni: `marketplace-repo.ts`, `marketplace-routes.ts`, `AgentMarketplace.tsx`, `MarketplaceDetail.tsx`
- Test: ~18 yeni

**Risk:** Orta

### F11: Workspace Collaboration (~700 LOC)

**Hedef:** Multi-user real-time project view, presence indicators, live updates.

**Dosyalar:**
- Yeni: `collaboration.ts`, `PresenceIndicator.tsx`, `useCollaboration.ts`
- Test: ~15 yeni

**Risk:** Yüksek

---

## Toplam Tahminler

| Metrik | Değer |
|--------|-------|
| Toplam yeni LOC | ~10,600 |
| Toplam yeni dosya | ~45 |
| Toplam yeni test | ~235 |
| Yeni bağımlılıklar | pg-boss, ioredis, @opentelemetry/*, commander |

## Başarı Metrikleri

| Metrik | v5 Sonu | v6 M3 Sonu | v6 Tamamı |
|--------|---------|------------|-----------|
| Auth UI | Yok | Tam Login/Register/RBAC | + Collaboration |
| Task durability | In-memory | In-memory | pg-boss crash-safe |
| CI/CD | Temel PR | Auto PR + CI tracking | + GitLab |
| Notification | Yok | In-app + Slack | + Email |
| Scale | Tek instance | Tek instance | Redis multi-instance |
| Backend test | 633 | ~720 | ~870 |
| Frontend test | 433 | ~490 | ~560 |
