// 0.20.11 — La pantalla con candado tiene flecha para volver a su sección (Patrimonio → Finanzas…).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lockedScreen } from '../src/views/plans.js';
import { routeById } from '../src/app/router.js';
import { ROUTE_FEATURE } from '../src/domain/plans.js';

describe('pantalla con candado: volver', () => {
  it('Patrimonio bloqueado lleva «← Finanzas» que vuelve a #/finanzas', () => {
    const out = String(lockedScreen('netWorth', 'Patrimonio', routeById('finanzas')).html);
    assert.match(out, /<a class="back-link" href="#\/finanzas" data-locked-back>/);
    assert.match(out, />Finanzas<\/a>/);
  });
  it('sin sección de arriba no hay flecha (por ejemplo, Estadísticas, que está en el menú)', () => {
    assert.doesNotMatch(String(lockedScreen('stats', 'Estadísticas').html), /data-locked-back/);
  });
  it('toda pantalla que se puede bloquear y cuelga de otra tiene a dónde volver', () => {
    for (const routeId of Object.keys(ROUTE_FEATURE)) {
      const route = routeById(routeId);
      assert.equal(route.id, routeId, `la ruta ${routeId} existe`);
      if (route.parent) assert.ok(routeById(route.parent).label, `${routeId} → ${route.parent}`);
    }
    const app = readFileSync(new URL('../src/app/app.js', import.meta.url), 'utf8');
    assert.match(app, /lockedScreen\(lockedFeature, route\.label, route\.parent \? routeById\(route\.parent\)/);
  });
});
