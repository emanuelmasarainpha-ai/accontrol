import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROUTES } from '../src/app/router.js';
import { tourToOffer } from '../src/app/tourController.js';
import { createTourMemory, LOCAL_ACCOUNT, parseTourRecord, TOUR_KEY_PREFIX } from '../src/app/tourMemory.js';
import { hasTour, selectorsFor, stepsFor, TOURS } from '../src/app/tourSteps.js';
import { resultsEnabled } from '../src/domain/business.js';
import { clientsEnabled } from '../src/domain/clients.js';
import { healthEnabled } from '../src/domain/company.js';
import { departmentsEnabled } from '../src/domain/departments.js';
import { diagnosisEnabled } from '../src/domain/diagnosis.js';
import { inventoryEnabled } from '../src/domain/inventory.js';
import { invoicesEnabled } from '../src/domain/invoices.js';
import { KIND_INFO, WORKSPACE_KINDS } from '../src/domain/workspaces.js';
import { placeCard, spotRect } from '../src/ui/tour.js';
import { tourPanel } from '../src/views/settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

/**
 * Palabras de lo que en cada tipo todavía es «próximamente» (KIND_INFO.soon): ningún paso de ese tipo puede usarlas.
 * (En Freelancer las facturas son «próximamente»; en Emprendedor y Empresa, las internas sí existen.)
 */
const SOON_WORDS = {
  personal: /\bIA\b|inteligen/i,
  freelancer: /env[ií]o autom[aá]tico|notificaci/i,
  entrepreneur: /\bIA\b|inteligen/i,
  company: /emplead|\broles?\b|invitaci|sucursal/i,
};

/** Un espacio recién creado: sin clientes, productos, facturas ni departamentos. */
const EMPTY_DATA = { clients: [], products: [], suppliers: [], stockEntries: [], invoices: [], departments: [] };

/** ¿Esa pantalla está disponible en un espacio NUEVO de ese tipo? */
const ROUTE_AVAILABLE = {
  diagnostico: (kind) => diagnosisEnabled(kind),
  clientes: (kind) => clientsEnabled(kind, EMPTY_DATA),
  resultados: (kind) => resultsEnabled(kind),
  salud: (kind) => healthEnabled(kind),
  inventario: (kind) => inventoryEnabled(kind, EMPTY_DATA),
  facturas: (kind) => invoicesEnabled(kind, EMPTY_DATA),
  departamentos: (kind) => departmentsEnabled(kind, EMPTY_DATA),
};
const routeAvailable = (route, kind) => (ROUTE_AVAILABLE[route] ? ROUTE_AVAILABLE[route](kind) : true);

/** Pantalla → archivo que la dibuja (como en app.js). */
const VIEW_FILES = {
  inicio: 'src/views/home.js', finanzas: 'src/views/finances.js', metas: 'src/views/goals.js', estadisticas: 'src/views/stats.js',
  ajustes: 'src/views/settings.js', logros: 'src/views/achievements.js', deudas: 'src/views/debts.js', patrimonio: 'src/views/networth.js',
  calculadoras: 'src/views/calculators.js', diagnostico: 'src/views/diagnosis.js', clientes: 'src/views/clients.js',
  resultados: 'src/views/results.js', salud: 'src/views/health.js', inventario: 'src/views/inventory.js', facturas: 'src/views/invoices.js',
  departamentos: 'src/views/departments.js',
};

/** Paneles que una pantalla toma de otros archivos (Ajustes dibuja los datos de la organización y los espacios). */
const VIEW_PARTS = { ajustes: ['src/views/organization.js', 'src/views/workspaces.js', 'src/views/account.js'] };

/** Marcas que solo se dibujan en algunos tipos de espacio. */
const CONDITIONAL_MARKS = { 'stats-diagnosis': (kind) => diagnosisEnabled(kind) };

/** @param {string} source */
const marksIn = (source) => new Set([...source.matchAll(/data-tour="([a-z0-9-]+)"/g)].map((m) => m[1]));
const CHROME_MARKS = marksIn(read('index.html'));

const kindsWithTour = Object.keys(TOURS);
const allSteps = kindsWithTour.flatMap((kind) => stepsFor(kind).map((step) => ({ kind, step })));

describe('recorrido guiado: cada tipo tiene el suyo', () => {
  it('los cuatro tipos de espacio (Personal, Freelancer, Emprendedor, Empresa) tienen su recorrido', () => {
    for (const kind of WORKSPACE_KINDS) {
      assert.ok(hasTour(kind), `${kind} sin recorrido`);
      assert.ok(stepsFor(kind).length >= 8, `${kind}: solo ${stepsFor(kind).length} pasos`);
    }
  });

  it('cada recorrido explica las pantallas propias de su tipo (y no las de otro)', () => {
    const routesOf = (kind) => new Set(stepsFor(kind).flatMap((s) => [s.route, ...s.target.map((t) => ('subtab' in t ? t.subtab : 'menu' in t ? t.menu : null))]));
    assert.ok(routesOf('freelancer').has('clientes'));
    assert.ok(routesOf('freelancer').has('facturas'), 'freelancer sin facturas (0.14.5)');
    for (const route of ['resultados', 'inventario', 'facturas']) assert.ok(routesOf('entrepreneur').has(route), `emprendedor sin ${route}`);
    for (const route of ['resultados', 'salud', 'departamentos', 'inventario', 'facturas']) assert.ok(routesOf('company').has(route), `empresa sin ${route}`);
    for (const route of ['clientes', 'resultados', 'salud', 'inventario', 'facturas', 'departamentos']) assert.ok(!routesOf('personal').has(route), `personal con ${route}`);
    for (const route of ['resultados', 'salud', 'inventario', 'departamentos']) assert.ok(!routesOf('freelancer').has(route), `freelancer con ${route}`);
    assert.ok(!routesOf('company').has('diagnostico') && !stepsFor('company').some((s) => s.id === 'diagnosis'), 'empresa no tiene Diagnóstico (tiene Salud)');
  });

  it('solo hay recorridos de tipos de espacio que existen; un tipo desconocido no tiene', () => {
    for (const kind of kindsWithTour) assert.ok(WORKSPACE_KINDS.includes(kind), kind);
    assert.deepEqual(stepsFor(null), []);
    assert.deepEqual(stepsFor(undefined), []);
    assert.equal(hasTour('otro'), false);
  });

  it('cada paso tiene id único, título y una explicación corta', () => {
    for (const kind of kindsWithTour) {
      const ids = stepsFor(kind).map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length, `ids repetidos en ${kind}`);
    }
    for (const { kind, step } of allSteps) {
      assert.ok(step.title.trim().length > 0, `${kind}/${step.id}: sin título`);
      assert.ok(step.text.trim().length > 0, `${kind}/${step.id}: sin texto`);
      assert.ok(step.text.length <= 220, `${kind}/${step.id}: texto de ${step.text.length} caracteres`);
      assert.ok(step.target.length > 0, `${kind}/${step.id}: sin elemento`);
    }
  });
});

describe('recorrido guiado: cada paso apunta a algo que existe', () => {
  const routeIds = new Set(ROUTES.map((r) => r.id));
  const menuIds = new Set(ROUTES.filter((r) => !r.hidden).map((r) => r.id));

  it('la pantalla de cada paso existe y está disponible en un espacio nuevo de ese tipo', () => {
    for (const { kind, step } of allSteps) {
      const screen = step.route.split('/')[0];
      assert.ok(routeIds.has(screen), `${kind}/${step.id}: no existe la pantalla ${step.route}`);
      assert.ok(routeAvailable(screen, kind), `${kind}/${step.id}: ${step.route} no está en los espacios ${kind}`);
    }
  });

  it('cada elemento existe en el código: enlace del menú, pestaña de Finanzas o data-tour en la pantalla del paso', () => {
    const finances = read('src/ui/components.js');
    for (const { kind, step } of allSteps) {
      for (const target of step.target) {
        const where = `${kind}/${step.id}`;
        if ('menu' in target) {
          assert.ok(menuIds.has(target.menu), `${where}: «${target.menu}» no está en el menú`);
          assert.ok(routeAvailable(target.menu, kind), `${where}: ${target.menu} no está en los espacios ${kind}`);
        } else if ('subtab' in target) {
          assert.equal(step.route, 'finanzas', `${where}: una pestaña de Finanzas se señala desde Finanzas`);
          assert.match(finances, new RegExp(`tab\\('${target.subtab}'`), `${where}: no hay pestaña «${target.subtab}»`);
          assert.ok(routeAvailable(target.subtab, kind), `${where}: la pestaña ${target.subtab} no está en los espacios ${kind}`);
        } else {
          const screen = step.route.split('/')[0];
          const files = [VIEW_FILES[screen], ...(VIEW_PARTS[screen] ?? [])];
          assert.ok(files[0], `${where}: falta saber qué archivo dibuja ${step.route}`);
          const found = CHROME_MARKS.has(target.mark) || files.some((file) => marksIn(read(file)).has(target.mark));
          assert.ok(found, `${where}: no hay data-tour="${target.mark}" en ${files.join(', ')} ni en index.html`);
          if (CONDITIONAL_MARKS[target.mark]) assert.ok(CONDITIONAL_MARKS[target.mark](kind), `${where}: «${target.mark}» no se dibuja en los espacios ${kind}`);
        }
      }
    }
  });

  it('lo que está en el marco de la app (index.html) existe en la computadora Y en el celular', () => {
    const page = read('index.html');
    const start = page.indexOf('<aside class="sidebar"');
    const end = page.indexOf('</aside>', start);
    assert.ok(start > 0 && end > start, 'no se encontró la barra lateral');
    const desktop = page.slice(start, end);
    const mobile = page.slice(0, start) + page.slice(end);
    for (const { kind, step } of allSteps) {
      for (const target of step.target) {
        const where = `${kind}/${step.id}`;
        if ('mark' in target && CHROME_MARKS.has(target.mark)) {
          assert.ok(marksIn(desktop).has(target.mark), `${where}: «${target.mark}» falta en la barra lateral (computadora)`);
          assert.ok(marksIn(mobile).has(target.mark), `${where}: «${target.mark}» falta fuera de la barra lateral (celular)`);
        }
        // Ajustes no va en las pestañas: su enlace está escrito en index.html, en los dos lugares.
        if ('menu' in target && target.menu === 'ajustes') {
          assert.match(desktop, /data-route="ajustes"/, `${where}: Ajustes en la barra lateral`);
          assert.match(mobile, /data-route="ajustes"/, `${where}: Ajustes en la barra de arriba del celular`);
        }
      }
    }
  });

  it('los selectores salen bien armados', () => {
    assert.deepEqual(selectorsFor([{ menu: 'finanzas' }, { subtab: 'deudas' }, { mark: 'home-available' }]), [
      'a[data-route="finanzas"]',
      '.subtabs a[href="#/deudas"]',
      '[data-tour="home-available"]',
    ]);
    assert.deepEqual(selectorsFor([{ mark: 'a"b' }]), ['[data-tour="a\\"b"]']);
  });
});

describe('recorrido guiado: solo funciones que existen hoy (y no es IA)', () => {
  it('todo lo que KIND_INFO dice que incluye el tipo está explicado en algún paso', () => {
    for (const kind of kindsWithTour) {
      const covered = new Set(stepsFor(kind).flatMap((s) => s.covers));
      for (const feature of KIND_INFO[kind].included) assert.ok(covered.has(feature), `${kind}: falta explicar «${feature}»`);
    }
  });

  it('ningún paso dice explicar algo que no esté en KIND_INFO.included', () => {
    for (const { kind, step } of allSteps) {
      for (const feature of step.covers) assert.ok(KIND_INFO[kind].included.includes(feature), `${kind}/${step.id}: «${feature}» no está incluido`);
    }
  });

  it('no se señala la pantalla «IA Financiera» (todavía no hay IA) ni nada de lo «próximamente»', () => {
    for (const { kind, step } of allSteps) {
      assert.notEqual(step.route, 'ia', `${kind}/${step.id}`);
      for (const target of step.target) assert.ok(!('menu' in target && target.menu === 'ia'), `${kind}/${step.id}`);
      const words = `${step.title} ${step.text}`.toLocaleLowerCase('es');
      for (const soon of KIND_INFO[kind].soon) assert.ok(!words.includes(soon.toLocaleLowerCase('es')), `${kind}/${step.id} menciona «${soon}»`);
      assert.doesNotMatch(words, /próximamente|pronto|llegará/, `${kind}/${step.id}`);
      assert.doesNotMatch(`${step.title} ${step.text}`, SOON_WORDS[kind], `${kind}/${step.id}: habla de algo que en ${kind} es «próximamente»`);
    }
  });

  it('ningún texto lo llama IA ni «inteligente»', () => {
    for (const { kind, step } of allSteps) {
      assert.doesNotMatch(`${step.title} ${step.text}`, /\bIA\b|inteligen/i, `${kind}/${step.id}`);
    }
  });

  it('los textos fijos del recorrido (bienvenida, botones, Ajustes) tampoco lo llaman IA', () => {
    for (const file of ['src/app/tourController.js', 'src/ui/tour.js']) {
      const strings = [...read(file).matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)].map((m) => m[1] ?? m[2]);
      for (const text of strings) assert.doesNotMatch(text, /\bIA\b|inteligen/i, `${file}: ${text}`);
    }
    const panel = tourPanel({ id: 'w', kind: 'personal', name: 'Mío' }, true).toString();
    assert.doesNotMatch(panel, /\bIA\b|inteligen/i);
  });
});

describe('recorrido guiado: recordar si ya se vio (por cuenta y por tipo)', () => {
  function memoryStorage() {
    const map = new Map();
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)) };
  }
  const NOW = '2026-11-12T10:00:00.000Z';

  it('al principio no se vio nada; marcar lo guarda con la clave de esa cuenta', () => {
    const storage = memoryStorage();
    const memory = createTourMemory(storage, 'cuenta-a');
    assert.equal(memory.hasSeen('personal'), false);
    assert.equal(memory.mark('personal', 'skipped', NOW), true);
    assert.equal(memory.hasSeen('personal'), true);
    assert.equal(memory.statusOf('personal'), 'skipped');
    assert.deepEqual(JSON.parse(storage.map.get(`${TOUR_KEY_PREFIX}cuenta-a`)), { personal: { status: 'skipped', at: NOW } });
  });

  it('se recuerda al volver a abrir la app (otra memoria sobre el mismo almacenamiento)', () => {
    const storage = memoryStorage();
    createTourMemory(storage, 'cuenta-a').mark('personal', 'done', NOW);
    const again = createTourMemory(storage, 'cuenta-a');
    assert.equal(again.hasSeen('personal'), true);
    assert.equal(again.statusOf('personal'), 'done');
  });

  it('es por TIPO: ver el de Personal no marca Freelancer (y crear otro espacio Personal no lo vuelve a ofrecer)', () => {
    const memory = createTourMemory(memoryStorage(), 'cuenta-a');
    memory.mark('personal', 'done', NOW);
    assert.equal(memory.hasSeen('personal'), true);
    assert.equal(memory.hasSeen('freelancer'), false);
  });

  it('es por CUENTA: otra cuenta en el mismo dispositivo no hereda lo visto', () => {
    const storage = memoryStorage();
    createTourMemory(storage, 'cuenta-a').mark('personal', 'done', NOW);
    assert.equal(createTourMemory(storage, 'cuenta-b').hasSeen('personal'), false);
    assert.equal(createTourMemory(storage, LOCAL_ACCOUNT).hasSeen('personal'), false);
  });

  it('si el navegador no deja guardar, se recuerda mientras la página esté abierta y no se rompe', () => {
    const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('lleno'); } };
    const memory = createTourMemory(broken, 'cuenta-a');
    assert.equal(memory.hasSeen('personal'), false);
    assert.equal(memory.mark('personal', 'skipped', NOW), false);
    assert.equal(memory.hasSeen('personal'), true);
    const none = createTourMemory(null, LOCAL_ACCOUNT);
    assert.equal(none.mark('company', 'done', NOW), false);
    assert.equal(none.hasSeen('company'), true);
  });

  it('lo guardado roto o con datos raros se ignora (sin romper nada)', () => {
    for (const raw of [null, '', 'no es json', '[]', '"texto"', '{"personal":"done"}', '{"otro":{"status":"done","at":"x"}}', '{"personal":{"status":"visto","at":"x"}}', 'x'.repeat(5000)]) {
      assert.deepEqual(parseTourRecord(raw), {}, String(raw).slice(0, 40));
    }
    assert.deepEqual(parseTourRecord('{"personal":{"status":"done","at":"2026"},"company":{"status":"x","at":"1"}}'), { personal: { status: 'done', at: '2026' } });
  });
});

describe('recorrido guiado: cuándo se ofrece la bienvenida', () => {
  const seen = (...kinds) => ({ hasSeen: (k) => kinds.includes(k) });
  const base = { ready: true, kind: 'personal', busy: false, dialogOpen: false, memory: seen() };

  it('la primera vez en un espacio Personal: sí', () => {
    assert.equal(tourToOffer(base), 'personal');
  });

  it('no, si ya se vio o se saltó ese tipo', () => {
    assert.equal(tourToOffer({ ...base, memory: seen('personal') }), null);
  });

  it('no, mientras carga, en la pantalla de elegir modalidad, con otra ventana abierta o con un recorrido en marcha', () => {
    assert.equal(tourToOffer({ ...base, ready: false }), null);
    assert.equal(tourToOffer({ ...base, kind: null }), null);
    assert.equal(tourToOffer({ ...base, dialogOpen: true }), null);
    assert.equal(tourToOffer({ ...base, busy: true }), null);
  });

  it('sí, la primera vez en cada tipo; y ver uno no apaga los demás', () => {
    for (const kind of WORKSPACE_KINDS) assert.equal(tourToOffer({ ...base, kind }), kind, kind);
    const onlyPersonal = { ...base, memory: seen('personal') };
    assert.equal(tourToOffer({ ...onlyPersonal, kind: 'company' }), 'company');
  });
});

describe('recorrido guiado: dónde va la tarjeta (sin navegador)', () => {
  const vp = { width: 390, height: 800 };
  const card = { width: 358, height: 200 };

  it('debajo del elemento si cabe', () => {
    assert.deepEqual(placeCard({ top: 100, left: 20, width: 100, height: 40 }, card, vp), { top: 152, left: 16, side: 'below' });
  });

  it('encima si no cabe debajo (por ejemplo, la barra de pestañas del celular)', () => {
    const where = placeCard({ top: 742, left: 100, width: 70, height: 58 }, card, vp);
    assert.equal(where.side, 'above');
    assert.equal(where.top, 742 - 12 - 200);
  });

  it('si no cabe ni arriba ni abajo, en la mitad contraria al elemento', () => {
    const tall = { width: 358, height: 300 };
    const topHalf = placeCard({ top: 120, left: 0, width: 390, height: 300 }, tall, { width: 390, height: 600 });
    assert.deepEqual([topHalf.side, topHalf.top], ['over', 600 - 300 - 16]);
    const bottomHalf = placeCard({ top: 250, left: 0, width: 390, height: 300 }, tall, { width: 390, height: 600 });
    assert.deepEqual([bottomHalf.side, bottomHalf.top], ['over', 16]);
  });

  it('nunca se sale por los lados', () => {
    const desktop = { width: 1280, height: 800 };
    const narrow = { width: 360, height: 200 };
    assert.equal(placeCard({ top: 10, left: 1250, width: 20, height: 20 }, narrow, desktop).left, 1280 - 360 - 16);
    assert.equal(placeCard({ top: 10, left: 0, width: 20, height: 20 }, narrow, desktop).left, 16);
    // Pantalla más angosta que la tarjeta: se queda en el margen izquierdo.
    assert.equal(placeCard({ top: 10, left: 0, width: 20, height: 20 }, { width: 400, height: 100 }, { width: 300, height: 800 }).left, 16);
  });

  it('el resaltado lleva aire alrededor y no se sale de la pantalla', () => {
    assert.deepEqual(spotRect({ top: 100, left: 50, width: 80, height: 40 }, vp), { top: 94, left: 44, width: 92, height: 52 });
    assert.deepEqual(spotRect({ top: 760, left: 0, width: 390, height: 58 }, vp), { top: 754, left: 0, width: 390, height: 46 });
  });
});

describe('Ajustes → Recorrido guiado', () => {
  const ws = { id: 'w', kind: 'personal', name: 'Mío' };

  it('con recorrido: botón «Ver el recorrido otra vez»', () => {
    const panel = tourPanel(ws, true).toString();
    assert.match(panel, /data-action="tour-replay"/);
    assert.match(panel, /Ver el recorrido otra vez/);
  });

  it('sin recorrido todavía: lo dice y no ofrece el botón', () => {
    const panel = tourPanel({ ...ws, kind: 'company' }, false).toString();
    assert.doesNotMatch(panel, /tour-replay/);
    assert.match(panel, /todavía no tienen recorrido/);
  });

  it('sin espacio abierto: nada', () => {
    assert.equal(tourPanel(null, true), '');
  });
});

describe('política de seguridad: sin código ni estilos en línea', () => {
  /** @param {string} dir @returns {string[]} */
  const filesIn = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(root, rel)).isDirectory() ? filesIn(rel) : [rel];
  });
  const sources = ['index.html', ...filesIn('src').filter((f) => f.endsWith('.js'))];

  it('ningún archivo de la app escribe atributos style="…", <style> ni <script> sin archivo', () => {
    for (const file of sources) {
      const text = read(file);
      assert.doesNotMatch(text, /\sstyle\s*=\s*["'`$]/i, `${file}: atributo style`);
      assert.doesNotMatch(text, /setAttribute\(\s*['"]style['"]/, `${file}: setAttribute('style')`);
      assert.doesNotMatch(text, /<style[\s>]/i, `${file}: etiqueta <style>`);
      assert.doesNotMatch(text, /<script(?![^>]*\ssrc=)[^>]*>/i, `${file}: <script> en línea`);
    }
  });

  it('la política de index.html sigue sin permitir código ni estilos en línea', () => {
    const csp = read('index.html').match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /style-src 'self';/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  });
});
