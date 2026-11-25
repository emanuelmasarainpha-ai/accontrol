import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { celebrationMessages, celebrationsBetween, countRecords, MAX_RECORDS_CHANGED, MAX_TOASTS, snapshotOf } from '../src/app/celebrations.js';
import { formatMoney, moneyParts } from '../src/domain/money.js';
import { burstVectors } from '../src/ui/celebrate.js';
import { emptyArt, emptyState, heroMoney, netWorthCard } from '../src/ui/components.js';
import { COUNT_MS, countParts, countUp, countValueAt } from '../src/ui/countUp.js';
import { canVibrate, haptic, PATTERNS, setVibration, VIBRATION_KEY, vibrationEnabled } from '../src/ui/haptics.js';
import { devicePanel } from '../src/views/settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('montos que «cuentan»: el final es exacto al centavo', () => {
  const cases = [0, 1, 99, 100, 123456, 2485723, -16815452, 999999999, -1];

  it('al terminar (t ≥ 1) devuelve EXACTAMENTE el monto, sea cual sea el inicio', () => {
    for (const to of cases) {
      for (const from of [0, 5, -300, to]) {
        assert.equal(countValueAt(from, to, 1), to, `${from} → ${to}`);
        assert.equal(countValueAt(from, to, 1.7), to, `${from} → ${to} pasado de tiempo`);
        assert.equal(countValueAt(from, to, Infinity), to);
      }
    }
  });

  it('los valores intermedios son centavos enteros y avanzan siempre en la misma dirección', () => {
    for (const to of cases) {
      let previous = countValueAt(0, to, 0);
      assert.equal(previous, 0);
      for (let i = 1; i <= 60; i += 1) {
        const value = countValueAt(0, to, i / 60);
        assert.ok(Number.isInteger(value), `${to} en ${i}/60: ${value}`);
        if (to >= 0) assert.ok(value >= previous, `${to}: retrocede`);
        else assert.ok(value <= previous, `${to}: retrocede`);
        previous = value;
      }
      assert.equal(previous, to);
    }
  });

  it('un tiempo negativo o raro no rompe nada', () => {
    assert.equal(countValueAt(0, 500, -3), 0);
    assert.equal(countValueAt(0, 500, Number.NaN), 500); // NaN no es «< 1»: se muestra el final exacto
  });

  it('los textos del final son los mismos que dibuja la pantalla', () => {
    for (const cents of cases) {
      assert.equal(countParts(cents, 'plain').all, formatMoney(cents));
      const p = moneyParts(cents);
      assert.deepEqual(countParts(cents, 'hero'), { sign: `${p.negative ? '-' : ''}${p.symbol}`, whole: p.whole, fraction: `.${p.fraction}` });
    }
  });

  it('dura lo que una entrada (como mucho 300 ms)', () => {
    assert.ok(COUNT_MS > 0 && COUNT_MS <= 300);
  });
});

describe('montos que «cuentan»: en la pantalla', () => {
  /** Elementos falsos con lo mínimo que usa countUp (sin navegador). */
  function fakeAmount(cents, style, parts) {
    const partEls = Object.entries(parts).map(([name, text]) => ({ name, textContent: text, getAttribute: (a) => (a === 'data-count-part' ? name : null) }));
    return {
      partEls,
      getAttribute: (a) => (a === 'data-count-to' ? String(cents) : a === 'data-count-style' ? style : null),
      querySelectorAll: () => partEls,
    };
  }
  function fakeRoot(amounts) {
    return { querySelectorAll: () => amounts };
  }
  function clock() {
    let t = 0;
    const queue = [];
    return {
      now: () => t,
      frame: (cb) => queue.push(cb),
      cancel: () => {},
      advance(ms) {
        t += ms;
        const cb = queue.shift();
        if (cb) cb(t);
      },
      pending: () => queue.length,
    };
  }

  it('cuenta hacia arriba y termina con el MISMO texto que dibujó la pantalla', () => {
    const p = moneyParts(2485723);
    const hero = fakeAmount(2485723, 'hero', { sign: p.symbol, whole: p.whole, fraction: `.${p.fraction}` });
    const plain = fakeAmount(-16815452, 'plain', { all: formatMoney(-16815452) });
    const before = [...hero.partEls, ...plain.partEls].map((e) => e.textContent);
    const c = clock();
    countUp(fakeRoot([hero, plain]), { reduced: false, now: c.now, frame: c.frame, cancel: c.cancel });
    assert.equal(hero.partEls[1].textContent, '0', 'empieza en 0');
    c.advance(COUNT_MS / 2);
    const middle = Number(hero.partEls[1].textContent.replace(/,/g, ''));
    assert.ok(middle > 0 && middle < 24857, `a la mitad: ${middle}`);
    c.advance(COUNT_MS);
    assert.deepEqual([...hero.partEls, ...plain.partEls].map((e) => e.textContent), before);
    assert.equal(c.pending(), 0, 'no queda nada corriendo');
  });

  it('con «reducir movimiento» no cambia nada', () => {
    const hero = fakeAmount(500, 'hero', { sign: 'RD$', whole: '5', fraction: '.00' });
    const c = clock();
    countUp(fakeRoot([hero]), { reduced: true, now: c.now, frame: c.frame, cancel: c.cancel });
    assert.deepEqual(hero.partEls.map((e) => e.textContent), ['RD$', '5', '.00']);
    assert.equal(c.pending(), 0);
  });

  it('si se detiene a la mitad (la pantalla se vuelve a dibujar), deja el valor exacto', () => {
    const hero = fakeAmount(123456, 'plain', { all: formatMoney(123456) });
    const c = clock();
    const stop = countUp(fakeRoot([hero]), { reduced: false, now: c.now, frame: c.frame, cancel: c.cancel });
    c.advance(30);
    stop();
    assert.equal(hero.partEls[0].textContent, formatMoney(123456));
  });

  it('el lector de pantalla oye solo el monto exacto: las cifras que se mueven están ocultas para él', () => {
    for (const cents of [2485723, -1500, 0]) {
      const markup = heroMoney(cents).toString();
      assert.match(markup, new RegExp(`<span class="sr-only">${formatMoney(cents).replace(/[$.]/g, '\\$&')}</span>`));
      for (const part of markup.matchAll(/<span[^>]*data-count-part[^>]*>/g)) assert.match(part[0], /aria-hidden="true"/);
      assert.doesNotMatch(markup, /aria-label=/, 'no depende de aria-label en un <span>');
      assert.match(markup, new RegExp(`data-count-to="${cents}"`));
    }
    const summary = { now: { netWorthCents: -16815452, assetsCents: 0, liabilitiesCents: 16815452 }, monthly: null, annual: null };
    const card = netWorthCard(summary, '2026-11-12').toString();
    assert.match(card, /<span class="sr-only">-RD\$ 168,154\.52<\/span><span aria-hidden="true" data-count-part="all">-RD\$ 168,154\.52<\/span>/);
  });
});

describe('vibración opcional', () => {
  function storage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)) };
  }
  function phone() {
    const calls = [];
    return { calls, vibrate: (pattern) => (calls.push(pattern), true) };
  }

  it('encendida si nunca se tocó; vibra con el patrón corto de cada caso', () => {
    const s = storage();
    const nav = phone();
    assert.equal(vibrationEnabled(s), true);
    assert.equal(haptic('confirm', { storage: s, nav }), true);
    assert.equal(haptic('success', { storage: s, nav }), true);
    assert.deepEqual(nav.calls, [PATTERNS.confirm, PATTERNS.success]);
  });

  it('apagada en Ajustes: NO vibra', () => {
    const s = storage();
    const nav = phone();
    assert.equal(setVibration(false, s), true);
    assert.equal(s.map.get(VIBRATION_KEY), 'off');
    assert.equal(haptic('warning', { storage: s, nav }), false);
    assert.deepEqual(nav.calls, []);
    setVibration(true, s);
    assert.equal(haptic('warning', { storage: s, nav }), true);
  });

  it('sin vibración en el navegador (iPhone, computadora): no hace nada y no se rompe', () => {
    assert.equal(canVibrate({}), false);
    assert.equal(haptic('confirm', { storage: storage(), nav: {} }), false);
    const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('lleno'); } };
    assert.equal(vibrationEnabled(broken), true);
    assert.equal(setVibration(false, broken), false);
    assert.equal(haptic('confirm', { storage: broken, nav: { vibrate: () => { throw new Error('x'); } } }), false);
  });

  it('las vibraciones son cortas (menos de un tercio de segundo en total)', () => {
    for (const [kind, pattern] of Object.entries(PATTERNS)) {
      const total = [].concat(pattern).reduce((a, b) => a + b, 0);
      assert.ok(total <= 300, `${kind}: ${total} ms`);
    }
  });

  it('Ajustes → Este dispositivo: el interruptor refleja la preferencia y avisa si no se puede vibrar', () => {
    const on = devicePanel({ vibration: true, canVibrate: true }).toString();
    assert.match(on, /type="checkbox"[^>]*data-pref="vibration"[^>]*checked/);
    assert.doesNotMatch(on, /no permite vibrar/);
    const off = devicePanel({ vibration: false, canVibrate: false }).toString();
    assert.doesNotMatch(off, /data-pref="vibration"[^>]*checked/);
    assert.match(off, /no permite vibrar/);
  });
});

describe('celebración: solo lo que logras mientras usas la app', () => {
  const goal = (id, name, isDemo = false) => ({ id, name, isDemo, targetCents: 100 });
  const ach = (id, title, done) => ({ id, title, done });
  const snap = (ws, goals, done, achievements, records = 10) => snapshotOf(ws, goals, (g) => done.includes(g.id), achievements, records);

  it('una meta recién cumplida y un logro recién conseguido se celebran', () => {
    const before = snap('w1', [goal('g1', 'Laptop')], [], [ach('a1', 'Primer paso', false)]);
    const after = snap('w1', [goal('g1', 'Laptop')], ['g1'], [ach('a1', 'Primer paso', true)]);
    assert.deepEqual(celebrationsBetween(before, after), { goals: ['Laptop'], achievements: ['Primer paso'] });
  });

  it('lo que ya estaba cumplido no se celebra otra vez', () => {
    const s = snap('w1', [goal('g1', 'Laptop')], ['g1'], [ach('a1', 'Primer paso', true)]);
    assert.deepEqual(celebrationsBetween(s, s), { goals: [], achievements: [] });
  });

  it('las metas de DEMOSTRACIÓN no cuentan', () => {
    const before = snap('w1', [goal('d1', 'Demo', true)], [], []);
    const after = snap('w1', [goal('d1', 'Demo', true)], ['d1'], []);
    assert.deepEqual(celebrationsBetween(before, after).goals, []);
  });

  it('al abrir la app o cambiar de espacio no se celebra nada', () => {
    const after = snap('w2', [goal('g1', 'Laptop')], ['g1'], [ach('a1', 'X', true)]);
    assert.deepEqual(celebrationsBetween(null, after), { goals: [], achievements: [] });
    const other = snap('w1', [], [], []);
    assert.deepEqual(celebrationsBetween(other, after), { goals: [], achievements: [] });
  });

  it('cumplir una meta que además trae varios logros a la vez SÍ se celebra (un aporte = 1 o 2 registros)', () => {
    const achievements = (done) => [ach('a1', 'Ahorrador', done), ach('a2', 'Meta cumplida', done), ach('a3', 'Constancia', done)];
    const before = snap('w1', [goal('g1', 'Bicicleta')], [], achievements(false), 10);
    const after = snap('w1', [goal('g1', 'Bicicleta')], ['g1'], achievements(true), 12);
    assert.deepEqual(celebrationsBetween(before, after), { goals: ['Bicicleta'], achievements: ['Ahorrador', 'Meta cumplida', 'Constancia'] });
  });

  it(`si cambian más de ${MAX_RECORDS_CHANGED} registros de golpe (importar, demostración), no se celebra`, () => {
    const before = snap('w1', [goal('g1', 'Casa')], [], [ach('a1', 'A', false)], 10);
    const after = snap('w1', [goal('g1', 'Casa')], ['g1'], [ach('a1', 'A', true)], 10 + MAX_RECORDS_CHANGED + 1);
    assert.deepEqual(celebrationsBetween(before, after), { goals: [], achievements: [] });
    const removed = snap('w1', [goal('g1', 'Casa')], ['g1'], [ach('a1', 'A', true)], 10 - MAX_RECORDS_CHANGED - 1);
    assert.deepEqual(celebrationsBetween(before, removed), { goals: [], achievements: [] });
  });

  it('los avisos: la meta primero, como mucho dos, y el resto resumido', () => {
    assert.deepEqual(celebrationMessages({ goals: ['Bicicleta'], achievements: [] }), ['¡Meta cumplida: «Bicicleta»! Lo lograste.']);
    const many = celebrationMessages({ goals: ['Bicicleta'], achievements: ['A', 'B', 'C'] });
    assert.equal(many.length, MAX_TOASTS);
    assert.equal(many[0], '¡Meta cumplida: «Bicicleta»! Lo lograste.');
    assert.match(many[1], /^Y 3 más/);
    assert.deepEqual(celebrationMessages({ goals: [], achievements: [] }), []);
  });

  it('cuenta los registros de todas las listas del espacio', () => {
    assert.equal(countRecords({ movements: [1, 2], goals: [1], contributions: [], settings: { x: 1 }, categories: [1, 2, 3] }), 6);
  });

  it('los papelitos salen en todas direcciones, con números enteros y retrasos cortos', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const vectors = burstVectors(18, random);
    assert.equal(vectors.length, 18);
    for (const v of vectors) {
      for (const key of ['dx', 'dy', 'rot', 'delay']) assert.ok(Number.isInteger(v[key]), key);
      assert.ok(v.delay >= 0 && v.delay <= 60);
    }
    assert.ok(vectors.some((v) => v.dx < 0) && vectors.some((v) => v.dx > 0), 'a los dos lados');
  });
});

describe('estados vacíos: dibujo propio y decorativo', () => {
  // 0.20.7 (pedido de la persona: una app más creativa): los temas con escena usan su dibujo animado
  // (test/empty-scenes.test.js); el medallón de guilloché queda para los íconos sin escena.
  it('el dibujo es SVG propio, oculto para el lector de pantalla, con el ícono de la sección', () => {
    const art = emptyArt('info').toString();
    assert.match(art, /^<span class="empty__art" aria-hidden="true">/);
    assert.match(art, /<svg class="empty__rosette"[^>]*aria-hidden="true"/);
    assert.match(art, /class="empty__glyph"/);
    for (const name of ['info', 'target', 'swap', 'box']) {
      assert.doesNotMatch(emptyArt(name).toString(), /<img|https?:\/\/(?!www\.w3\.org)/, `${name}: sin imágenes ni nada de afuera`);
      assert.match(emptyArt(name).toString(), /aria-hidden="true"/, name);
    }
  });

  it('el estado vacío lleva el dibujo, el título y el texto', () => {
    const empty = emptyState({ icon: 'swap', title: 'Tu primer movimiento te está esperando', text: 'Registra uno.' }).toString();
    assert.match(empty, /class="scene" data-scene="swap"/);
    assert.match(empty, /Tu primer movimiento te está esperando/);
  });

  it('los avisos de error siguen serios (sin títulos «simpáticos»)', () => {
    for (const file of ['src/views/debts.js', 'src/views/clients.js', 'src/views/invoices.js']) {
      assert.match(read(file), /ya no existe|no existe/, file);
    }
  });
});

describe('celular y navegador: lo que no se ve en una captura', () => {
  const styles = readdirSync(join(root, 'src/styles')).filter((f) => f.endsWith('.css'));

  it('los efectos «al pasar el ratón» solo existen donde hay ratón (en el celular quedarían pegados)', () => {
    for (const file of styles) {
      let text = read(`src/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
      // Quita los bloques @media (hover: hover)…
      for (;;) {
        const start = text.indexOf('@media (hover: hover)');
        if (start < 0) break;
        let depth = 0;
        let end = text.indexOf('{', start);
        for (let i = end; i < text.length; i += 1) {
          if (text[i] === '{') depth += 1;
          if (text[i] === '}' && --depth === 0) { end = i; break; }
        }
        text = text.slice(0, start) + text.slice(end + 1);
      }
      for (const m of text.matchAll(/([^{}]*:hover[^{}]*)\{/g)) {
        // Excepción a propósito: los gráficos muestran el dato del punto (también con el teclado).
        assert.match(m[1], /\.band|\.seg\b/, `${file}: «${m[1].trim()}» sin @media (hover: hover)`);
      }
    }
  });

  const FONT_FILES = ['barlow-400-latin.woff2', 'barlow-600-latin.woff2', 'barlow-semi-condensed-600-latin.woff2', 'barlow-semi-condensed-700-latin.woff2'];

  it('las letras Barlow están en la app, son woff2 de verdad, se cargan desde base.css y llevan su licencia', () => {
    const base = read('src/styles/base.css');
    for (const file of FONT_FILES) {
      const font = readFileSync(join(root, 'src/styles/fonts', file));
      assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2', file);
      assert.ok(font.length < 40_000, `${file} pesa ${font.length} bytes`);
      assert.ok(base.includes(`url('fonts/${file}')`), `base.css no carga ${file}`);
    }
    assert.match(read('src/styles/fonts/OFL-Barlow.txt'), /SIL Open Font License/);
    assert.match(read('src/styles/tokens.css'), /--font: 'Barlow', system-ui/);
    assert.match(read('src/styles/tokens.css'), /--font-value: 'Barlow Semi Condensed'/);
    assert.ok(!readdirSync(join(root, 'src/styles/fonts')).some((f) => /manrope/i.test(f)), 'queda Manrope sin usar');
  });

  it('la letra y los estilos nuevos están en la lista sin conexión', () => {
    const files = JSON.parse(read('precache.json')).files;
    for (const f of ['src/styles/motion.css', ...FONT_FILES.map((x) => `src/styles/fonts/${x}`), 'src/ui/countUp.js', 'src/ui/haptics.js', 'src/ui/celebrate.js', 'src/app/celebrations.js', 'src/ui/guilloche.js']) {
      assert.ok(files.includes(f), `falta ${f}`);
    }
    assert.match(read('index.html'), /<link rel="stylesheet" href="src\/styles\/motion\.css" \/>/);
  });

  it('los controles responden al instante al tocar y no seleccionan su texto', () => {
    const base = read('src/styles/base.css');
    assert.match(base, /touch-action: manipulation;/);
    assert.match(base, /-webkit-tap-highlight-color: transparent;/);
    assert.match(base, /::selection \{/);
  });
});

describe('mundo «El billete dominicano»: la roseta de guilloché', async () => {
  const { hypotrochoid, RINGS, ROSETTE_EXTENT, rosettePaths, guillocheRosette, toPath } = await import('../src/ui/guilloche.js');
  const { microtext } = await import('../src/views/home.js');

  it('cada anillo es una curva cerrada (termina donde empieza)', () => {
    for (const ring of RINGS) {
      const points = hypotrochoid(ring);
      const [x0, y0] = points[0];
      const [x1, y1] = points.at(-1);
      assert.ok(Math.hypot(x1 - x0, y1 - y0) < 0.01, `R${ring.R} r${ring.r}: no cierra`);
    }
  });

  it('todo cabe dentro de su cuadro (nada se corta)', () => {
    for (const ring of RINGS) {
      for (const [x, y] of hypotrochoid(ring)) assert.ok(Math.abs(x) <= ROSETTE_EXTENT && Math.abs(y) <= ROSETTE_EXTENT, `R${ring.R}`);
    }
  });

  it('dos familias de bandas con distinto número de ondas, que se entrecruzan como en un billete', () => {
    const petals = RINGS.map((g) => g.R / (function gcd(a, b) { return b ? gcd(b, a % b) : a; })(g.R, g.r));
    assert.deepEqual([...new Set(petals)].sort((a, b) => a - b), [15, 20]);
    assert.ok(RINGS.length >= 8, 'una roseta de billete tiene muchas bandas');
    for (const g of RINGS) assert.equal(g.R % g.r, 0, 'cada banda cierra en una sola vuelta (liviana)');
  });

  it('siempre sale igual, y es decorativa (oculta para el lector de pantalla)', () => {
    assert.deepEqual(rosettePaths(), RINGS.map((g) => toPath(hypotrochoid(g))));
    const svg = guillocheRosette('hero__rosette').toString();
    assert.match(svg, /^<svg class="hero__rosette"[^>]*aria-hidden="true"[^>]*focusable="false"/);
    assert.equal((svg.match(/<path /g) ?? []).length, RINGS.length);
    assert.match(svg, /stroke="currentColor"/, 'toma el color del espacio');
    assert.ok(svg.length < 60_000, `pesa ${svg.length} caracteres`);
  });

  it('el microtexto repite el nombre del espacio y nunca queda vacío', () => {
    const text = microtext('Mi tienda');
    assert.match(text, /^MI TIENDA · ACCONTROL · RD\$ · /);
    assert.ok(text.length >= 200);
    assert.ok(microtext('').length > 0);
  });

  it('«el billete» de Inicio lleva la roseta y el microtexto ocultos para el lector de pantalla', () => {
    const home = read('src/views/home.js');
    assert.match(home, /\$\{guillocheRosette\('hero__rosette'\)\}/);
    assert.match(home, /<span class="hero__micro" aria-hidden="true">/);
  });
});
