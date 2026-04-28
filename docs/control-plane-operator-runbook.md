# Control Plane Operator Runbooks

## Approval Runbook

### Pending Approval Nasıl Çözülür
1. **Kontrol**: Approval'ın ne istediğini anla (title, description, kind)
2. **Risk değerlendirmesi**: `high_risk_task` ise ekstra dikkat
3. **Karar ver**: 
   - **Approve**: Onayla ve otomatik devam et
   - **Reject**: Reddet ve neden belirt
   - **Escalate**: Üst operatöre yönlendir (`expires_in < 60m` ise acil)
4. **SLA takibi**: Age badge'ini izle, 24 saat içinde çözülmezse auto-expire

### Escalated Approval Nasıl Ele Alınır
1. **Hedef kontrolü**: `escalation_target`'ı kontrol et
2. **Önceliklendir**: Escalated approval'lar queue'nun en üstünde
3. **Çözüm veya red**: Senior operator karar verir
4. **Audit**: Tüm escalation'lar audit_events'a yazılır

## Incident Runbook

### Degraded Provider
1. **Acknowledge**: Incident'i ack'le
2. **Provider durumu**: `/provider-ops` panelinden consecutive failures kontrol et
3. **Aksiyon**:
   - Geçici: `reset-cooldown` yap
   - Kalıcı: `provider-disable` yap, fallback'e geç
4. **Resolve**: Sorun çözülünce resolve et

### Repeated Timeout
1. **Acknowledge** ve task'ı incele
2. **Retry**: `retry-task` ile tekrar dene
3. **Complexity**: Task complexity'si çok mu yüksek? (`S→M` veya `M→L`)
4. **Resolve**: Başarılı olursa resolve

### Approval Blocked
1. **Approval queue**: Kaç pending approval var?
2. **SLA kontrol**: `expires_in < 60m` olan var mı?
3. **Bulk action**: Gerekirse toplu approve/reject
4. **Root cause**: Neden bu kadar approval birikti?

### Queue Pressure
1. **Queue health**: `/queue-health` endpoint'ini kontrol et
2. **Pause**: Gerekirse `pause-queue` yap
3. **Capacity**: Concurrent task limit'ini kontrol et (`adaptive-concurrency`)
4. **Resume**: Düzelince `resume-queue`

## Provider Ops Runbook

### Provider Disable Ne Zaman
- Consecutive failures ≥ 3
- Cooldown sürekli tekrar ediyor
- Maliyet aşırı yüksek (fallback-heavy)

### Cooldown Reset Ne Zaman
- Geçici network hatası sonrası
- Provider manuel test edildi ve sağlıklı
- Incident resolved olarak işaretlendikten sonra

### Fallback-Heavy Durumda Ne Yapılır
1. Primary provider'ı kontrol et
2. Fallback chain'i incele (`fallback-decision`)
3. Gerekirse secondary provider'ı primary yap
4. Maliyet rollup'ını kontrol et (`/cost/providers`)

## Route Listesi

| Endpoint | Method | Açıklama |
|---|---|---|
| `/api/studio/summary` | GET | Dashboard özeti |
| `/api/studio/approvals` | GET | Approval listesi (SLA'lı) |
| `/api/studio/approvals/:id/approve` | POST | Onayla |
| `/api/studio/approvals/:id/reject` | POST | Reddet |
| `/api/studio/approvals/:id/escalate` | POST | Yükselt |
| `/api/studio/incidents` | GET | Incident listesi |
| `/api/studio/incidents/:id/ack` | POST | Acknowledge |
| `/api/studio/incidents/:id/resolve` | POST | Resolve |
| `/api/studio/incidents/:id/reopen` | POST | Reopen |
| `/api/studio/incidents/:id/assign` | POST | Ata |
| `/api/studio/incidents/:id/note` | POST | Not ekle |
| `/api/studio/actions` | POST | Operator aksiyonu |
| `/api/studio/actions/pause-queue` | POST | Queue durdur |
| `/api/studio/actions/resume-queue` | POST | Queue devam et |
| `/api/studio/actions/reset-cooldown` | POST | Cooldown sıfırla |
| `/api/studio/provider-ops` | GET | Provider operasyonları |
| `/api/studio/queue-health` | GET | Queue sağlığı |
| `/api/studio/policy/summary` | GET | Global policy özeti |
| `/api/studio/policy/projects/:id` | GET | Proje policy detayı |
