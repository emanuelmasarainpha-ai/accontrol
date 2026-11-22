// 0.20.0 — Planes: Gratis, Premium y Negocio (src/domain/plans.js y los candados del almacén).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorkspaceStore } from '../src/data/memoryWorkspaces.js';
import { createStore } from '../src/app/store.js';
import {
  canCreateWorkspaceKind, canUse, effectivePlan, FEATURE_PLAN, featureMessage, FREE_LIMITS, isPlanId, limitFor, limitMessage, PLAN_IDS, PLANS, ROUTE_FEATURE,
} from '../src/domain/plans.js';
import { ROUTES } from '../src/app/router.js';

const NOW = new Date('2026-11-21T12:00:00Z');
/** @param {any} r */
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };

describe('qué trae cada plan', () => {
  it('Gratis: nada de Premium ni de Negocio fuera de un espacio de Negocio', () => {
    for (const feature of /** @type {const} */ (['stats', 'netWorth', 'diagnosis', 'calculators', 'reports', 'foreignCurrency', 'businessSpaces'])) {
      assert.equal(canUse('free', feature, 'personal'), false, feature);
    }
  });
  it('Premium: todo lo personal, pero no los espacios de Negocio', () => {
    for (const feature of /** @type {const} */ (['stats', 'netWorth', 'diagnosis', 'calculators', 'reports', 'foreignCurrency'])) {
      assert.equal(canUse('premium', feature, 'personal'), true, feature);
    }
    assert.equal(canUse('premium', 'businessSpaces'), false);
  });
  it('Negocio: todo', () => {
    for (const feature of Object.keys(FEATURE_PLAN)) assert.equal(canUse('business', /** @type {any} */ (feature), 'personal'), true, feature);
  });
  it('dentro de un espacio de Negocio todo está abierto (lo paga su dueño), aunque tú tengas Gratis', () => {
    for (const kind of ['freelancer', 'entrepreneur', 'company']) {
      assert.equal(canUse('free', 'stats', kind), true, kind);
      assert.equal(canUse('free', 'reports', kind), true, kind);
      assert.equal(limitFor('free', 'goals', kind), null, kind);
    }
    assert.equal(canUse('free', 'businessSpaces', 'company'), false, 'pero crear uno sigue siendo de Negocio');
  });
  it('crear espacios: Personal siempre; los demás solo con Negocio', () => {
    for (const plan of PLAN_IDS) assert.equal(canCreateWorkspaceKind(plan, 'personal'), true, plan);
    for (const kind of ['freelancer', 'entrepreneur', 'company']) {
      assert.equal(canCreateWorkspaceKind('free', kind), false);
      assert.equal(canCreateWorkspaceKind('premium', kind), false);
      assert.equal(canCreateWorkspaceKind('business', kind), true);
    }
  });
  it('límites: solo en Gratis y solo en el espacio Personal', () => {
    assert.equal(limitFor('free', 'goals', 'personal'), FREE_LIMITS.goals);
    assert.equal(limitFor('free', 'debts', 'personal'), FREE_LIMITS.debts);
    assert.equal(limitFor('premium', 'goals', 'personal'), null);
    assert.equal(limitFor('business', 'debts', 'personal'), null);
  });
  it('la pantalla «Planes» tiene nombre, precio y lista de cada plan; las copias de seguridad están en Gratis', () => {
    for (const id of PLAN_IDS) {
      assert.ok(PLANS[id].label && PLANS[id].price && PLANS[id].includes.length >= 3, id);
    }
    assert.ok(PLANS.free.includes.some((line) => /copias de seguridad/i.test(line)), 'las copias nunca se cobran');
  });
  it('las pantallas con candado existen de verdad', () => {
    for (const route of Object.keys(ROUTE_FEATURE)) assert.ok(ROUTES.some((r) => r.id === route), route);
  });
  it('los avisos se leen bien', () => {
    assert.equal(featureMessage('stats'), 'Las estadísticas son del plan Premium.');
    assert.equal(featureMessage('businessSpaces'), 'Los espacios Freelancer, Emprendedor y Empresa son del plan Negocio.');
    assert.match(limitMessage('goals'), /hasta 2 metas activas/);
  });
});

describe('el plan que vale según la nube', () => {
  it('sin fila, con algo raro o vencido: Gratis', () => {
    assert.equal(effectivePlan(null, NOW), 'free');
    assert.equal(effectivePlan({ plan: 'oro', expiresAt: null }, NOW), 'free');
    assert.equal(effectivePlan({ plan: 'premium', expiresAt: '2026-11-20T00:00:00Z' }, NOW), 'free');
    assert.equal(effectivePlan({ plan: 'premium', expiresAt: 'mañana' }, NOW), 'free');
  });
  it('vigente o sin fecha de fin: el que dice', () => {
    assert.equal(effectivePlan({ plan: 'premium', expiresAt: '2026-12-21T00:00:00Z' }, NOW), 'premium');
    assert.equal(effectivePlan({ plan: 'business', expiresAt: null }, NOW), 'business');
    assert.ok(isPlanId('business') && !isPlanId('toString'));
  });
});

describe('el almacén respeta el plan', () => {
  /** @param {import('../src/domain/plans.js').PlanId} plan */
  async function setup(plan) {
    let current = plan;
    const store = createStore(createMemoryWorkspaceStore(), () => new Date(2026, 10, 21, 10, 0), { plan: () => current });
    await store.init();
    must(await store.createWorkspace({ kind: 'personal', name: 'Mío' }));
    return { store, setPlan: (/** @type {any} */ p) => { current = p; } };
  }
  const goal = (/** @type {string} */ name) => ({ name, description: '', targetText: '1000', targetDate: '2027-12-31' });
  const debt = (/** @type {string} */ name) => ({
    name, note: '', totalText: '1000', rateText: '0', rateBasis: 'annual', frequency: 'monthly', collateralKind: 'personal', collateralType: 'prestamo-personal',
    firstDueDate: '2026-12-01', firstDueTime: '09:00', finalDueDate: '2027-05-01', finalDueTime: '09:00',
  });

  it('Gratis no crea espacios de Negocio; con Negocio sí', async () => {
    const { store, setPlan } = await setup('free');
    const refused = await store.createWorkspace({ kind: 'entrepreneur', name: 'Colmado' });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.errors.kind, /plan Negocio/);
    setPlan('business');
    must(await store.createWorkspace({ kind: 'entrepreneur', name: 'Colmado' }));
  });

  it('Gratis: la tercera meta activa no; al cumplir una, sí; editar las que tienes, siempre', async () => {
    const { store, setPlan } = await setup('free');
    const first = must(await store.saveGoal(goal('Viaje'))).goal;
    must(await store.saveGoal(goal('Carro')));
    const third = await store.saveGoal(goal('Casa'));
    assert.equal(third.ok, false);
    if (!third.ok) assert.match(third.errors.form, /hasta 2 metas activas/);
    must(await store.saveGoal({ ...goal('Viaje a Punta Cana') }, first.id));
    must(await store.saveMovement({ type: 'income', amountText: '5000', date: '2026-11-21', time: '09:00', description: 'Sueldo', categoryId: 'cat-inc-salario', classification: 'fixed' }));
    must(await store.saveContribution(first.id, { kind: 'deposit', amountText: '1000', date: '2026-11-21', time: '10:00', note: '' }));
    must(await store.saveGoal(goal('Casa')));
    setPlan('premium');
    must(await store.saveGoal(goal('Moto')));
    assert.equal(store.getState().data.goals.length, 4);
  });

  it('Gratis: la tercera deuda sin pagar no; una pagada no cuenta', async () => {
    const { store } = await setup('free');
    const a = must(await store.saveDebt(debt('Tarjeta'))).debt;
    must(await store.saveDebt(debt('Préstamo')));
    assert.equal((await store.saveDebt(debt('Celular'))).ok, false);
    must(await store.saveDebtPayment(a.id, { kind: 'extra', amountText: '1000', date: '2026-11-21', time: '11:00', note: '' }));
    must(await store.saveDebt(debt('Celular')));
  });

  it('Gratis: sin patrimonio ni pagos en otra moneda; Premium sí', async () => {
    const { store, setPlan } = await setup('free');
    const asset = { name: 'Mi carro', category: 'vehicles', subtype: 'car', description: '', valueText: '500,000', acquiredDate: '2026-03-10' };
    const usd = { type: 'expense', amountText: '15', date: '2026-11-21', time: '09:00', description: 'Netflix', classification: 'variable', categoryId: 'cat-exp-otros', currency: 'USD', rateText: '60.50' };
    const refusedAsset = await store.saveAsset(asset);
    assert.equal(refusedAsset.ok, false);
    if (!refusedAsset.ok) assert.match(refusedAsset.errors.form, /plan Premium/);
    assert.equal((await store.saveMovement(usd)).ok, false);
    must(await store.saveMovement({ ...usd, currency: 'DOP', rateText: '' }));
    setPlan('premium');
    must(await store.saveAsset(asset));
    must(await store.saveMovement(usd));
  });

  it('sin cuentas (modo local, pruebas) no hay candados', async () => {
    const store = createStore(createMemoryWorkspaceStore(), () => new Date(2026, 10, 21, 10, 0));
    await store.init();
    must(await store.createWorkspace({ kind: 'company', name: 'ABC' }));
  });
});

describe('el plan de la sesión (app/plan.js) y la nube (cloudStore.getPlan)', async () => {
  const { currentPlan, onPlanChange, refreshPlan, setPlan, startPlan } = await import('../src/app/plan.js');
  const { createCloudStore } = await import('../src/data/cloudStore.js');
  const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
  const UID = '6f1c2b6e-3a4d-4c5e-9f00-1a2b3c4d5e6f';

  it('sin nada guardado en el dispositivo empieza en Gratis; con lo guardado, ese plan (respetando la fecha de fin)', () => {
    const storage = memory();
    startPlan(storage, UID, NOW);
    assert.equal(currentPlan(), 'free');
    storage.setItem(`accontrol.plan.v1:${UID}`, JSON.stringify({ plan: 'premium', source: 'web', expiresAt: '2026-12-01T00:00:00Z' }));
    startPlan(storage, UID, NOW);
    assert.equal(currentPlan(), 'premium');
    startPlan(storage, UID, new Date('2026-12-02T00:00:00Z'));
    assert.equal(currentPlan(), 'free', 'vencido también sin internet');
  });

  it('la nube manda: guarda lo que dice y avisa del cambio; sin conexión se queda con lo que había', async () => {
    const storage = memory();
    setPlan('free', null);
    let changes = 0;
    const stop = onPlanChange(() => { changes += 1; });
    assert.equal(await refreshPlan({ getPlan: async () => ({ ok: true, row: { plan: 'business', source: 'beta', expiresAt: null } }) }, storage, UID, NOW), true);
    assert.equal(currentPlan(), 'business');
    assert.equal(changes, 1);
    assert.match(storage.getItem(`accontrol.plan.v1:${UID}`) ?? '', /"business"/);
    assert.equal(await refreshPlan({ getPlan: async () => ({ ok: false }) }, storage, UID, NOW), false);
    assert.equal(await refreshPlan({ getPlan: async () => { throw new Error('sin red'); } }, storage, UID, NOW), false);
    assert.equal(currentPlan(), 'business');
    stop();
    setPlan('business', null);
  });

  it('cloudStore.getPlan pide SOLO tu fila y entiende «sin fila»', async () => {
    const calls = [];
    let body = [{ plan: 'premium', source: 'manual', expires_at: '2027-01-01T00:00:00+00:00' }];
    const cloud = createCloudStore({
      url: 'https://p.supabase.co', publishableKey: 'k', getAccessToken: async () => 't', getUserId: () => UID,
      fetch: /** @type {any} */ (async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => JSON.stringify(body) }; }),
    });
    assert.deepEqual(await cloud.getPlan(), { ok: true, row: { plan: 'premium', source: 'manual', expiresAt: '2027-01-01T00:00:00+00:00' } });
    assert.match(calls[0], /\/rest\/v1\/account_plans\?select=plan%2Csource%2Cexpires_at&user_id=eq\.6f1c2b6e/);
    body = [];
    assert.deepEqual(await cloud.getPlan(), { ok: true, row: null });
  });
});
