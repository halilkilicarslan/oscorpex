// ---------------------------------------------------------------------------
// Oscorpex — Policy Middleware (Faz 3.3)
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono';
import { getProjectCostSummary, getProjectSettingsMap } from '../db.js';

/**
 * budgetGuard — Execution başlamadan önce proje bütçesini kontrol eder.
 * Bütçe aşılmışsa 403 döner; bütçe tanımlı değilse veya check başarısızsa geçişe izin verir.
 */
export function budgetGuard(): MiddlewareHandler {
  return async (c, next) => {
    const projectId = c.req.param('id');
    if (!projectId) return next();

    try {
      const settings = await getProjectSettingsMap(projectId);
      const budgetSettings = settings['budget'];

      if (!budgetSettings || budgetSettings['enabled'] !== 'true') return next();

      const maxCost = budgetSettings['maxCostUsd'] ? parseFloat(budgetSettings['maxCostUsd']) : null;
      if (!maxCost || isNaN(maxCost) || maxCost <= 0) return next();

      const costSummary = await getProjectCostSummary(projectId);

      if (costSummary.totalCostUsd >= maxCost) {
        return c.json(
          {
            error: 'Budget limit exceeded',
            message: `Project budget exceeded: $${costSummary.totalCostUsd.toFixed(4)} / $${maxCost.toFixed(2)} USD`,
            currentCost: costSummary.totalCostUsd,
            maxCost,
          },
          403,
        );
      }
    } catch (err) {
      // Budget check failure should not block requests
      console.warn('[policy-middleware] Budget check failed (non-blocking):', err);
    }

    return next();
  };
}

/**
 * capabilityGuard — Yetenek erişimini API katmanında kayıt altına alır (informatif, bloklamaz).
 * Gerçek enforcement CLI execution katmanında resolveAllowedTools() ile yapılır.
 */
export function capabilityGuard(): MiddlewareHandler {
  return async (c, next) => {
    const projectId = c.req.param('id');
    if (projectId) {
      c.set('projectId', projectId);
    }
    return next();
  };
}
