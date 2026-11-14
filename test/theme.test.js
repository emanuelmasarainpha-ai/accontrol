import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dayNightButton, readTheme, saveTheme, THEME_KEY, toggleTitle } from '../src/ui/theme.js';
import { devicePanel } from '../src/views/settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Almacenamiento de mentira. */
const memory = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};

describe('modo oscuro: lo que se recuerda', () => {
  it('por defecto, claro (nunca se eligió)', () => assert.equal(readTheme(memory()), 'light'));
  it('si se eligió oscuro, oscuro', () => assert.equal(readTheme(memory({ [THEME_KEY]: 'dark' })), 'dark'));
  it('un valor raro se ignora: claro', () => assert.equal(readTheme(memory({ [THEME_KEY]: '<b>' })), 'light'));
  it('sin almacenamiento o si el navegador no deja leer: claro, sin romper', () => {
    assert.equal(readTheme(null), 'light');
    assert.equal(readTheme({ getItem: () => { throw new Error('bloqueado'); }, setItem: () => {} }), 'light');
  });
  it('guardar escribe la clave de este dispositivo y no rompe si no se puede', () => {
    const store = memory();
    saveTheme('dark', store);
    assert.equal(store.data[THEME_KEY], 'dark');
    assert.doesNotThrow(() => saveTheme('dark', { getItem: () => null, setItem: () => { throw new Error('lleno'); } }));
  });
  it('el arranque (theme-boot.js) usa la misma clave y es un archivo (sin código en línea)', () => {
    assert.match(read('src/theme-boot.js'), new RegExp(THEME_KEY.replace(/\./g, '\\.')));
    const index = read('index.html');
    assert.match(index, /<script src="src\/theme-boot\.js"><\/script>/);
    assert.ok(index.indexOf('theme-boot.js') < index.indexOf('tokens.css'), 'se aplica antes de cargar los estilos');
  });
});

describe('modo oscuro: el interruptor del sol y la luna', () => {
  it('es un botón con nombre y estado (aria-pressed) y dice lo que hará', () => {
    const light = dayNightButton('light').toString();
    assert.match(light, /<button type="button"[^>]*data-action="toggle-theme"/);
    assert.match(light, /aria-label="Modo oscuro"/);
    assert.match(light, /aria-pressed="false"/);
    assert.match(dayNightButton('dark').toString(), /aria-pressed="true"/);
    assert.match(toggleTitle('light'), /oscuro/);
    assert.match(toggleTitle('dark'), /claro/);
  });

  it('está en el menú lateral, en la barra superior y en Ajustes → Este dispositivo', () => {
    const index = read('index.html');
    assert.equal((index.match(/data-action="toggle-theme"/g) ?? []).length, 2);
    const panel = devicePanel({ vibration: true, canVibrate: true, theme: 'dark' }).toString();
    assert.match(panel, /Modo oscuro/);
    assert.match(panel, /daynight--lg/);
    assert.match(panel, /data-theme-label>Activado</);
  });

  it('el dibujo es el sol y la luna en PNG sin fondo, con chispas; decorativo (sin texto alternativo) y sin estilos en línea', () => {
    const art = dayNightButton('light').toString();
    assert.match(art, /<span class="daynight__art" aria-hidden="true">/);
    assert.match(art, /<img class="dn-sun" src="[^"]*\/assets\/sun\.png" alt=""/);
    assert.match(art, /<img class="dn-moon" src="[^"]*\/assets\/moon\.png" alt=""/);
    assert.equal(art.match(/class="dn-spark dn-spark--\d"/g)?.length, 4);
    assert.doesNotMatch(art, /\sstyle=|\sid=/, 'sin estilos en línea ni id (hay varios interruptores en la página)');
  });

  it('los PNG existen, son PNG de verdad con transparencia (sin fondo) y están en la lista sin conexión', () => {
    const precache = JSON.parse(read('precache.json')).files;
    for (const name of ['sun', 'moon']) {
      const png = readFileSync(join(root, `src/assets/${name}.png`));
      assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG', `${name}: firma PNG`);
      assert.equal(png[25], 6, `${name}: color RGBA (con canal de transparencia)`);
      assert.ok(png.length < 80_000, `${name}: liviano (${png.length} bytes)`);
      assert.ok(precache.includes(`src/assets/${name}.png`), `${name}: en el precache`);
    }
  });

  it('el sol se pone y la luna sale solo con transform y opacity, y nada de eso fuera de «sin reducir movimiento»', () => {
    const css = noComments(read('src/styles/components.css'));
    const flat = css.replace(/\s+/g, ' ');
    assert.ok(flat.includes(":root[data-theme='dark'] .dn-sun { opacity: 0; transform: translate(-30%, 60%) rotate(140deg) scale(0.35); }"), 'de noche, el sol hundido');
    assert.ok(flat.includes(":root[data-theme='dark'] .dn-moon { opacity: 1; transform: none; }"), 'de noche, la luna en su sitio');
    const block = css.slice(css.indexOf('.daynight {'), css.indexOf('.theme-row'));
    for (const m of block.matchAll(/transition\s*:\s*([^;]+);/g)) {
      for (const part of m[1].split(',')) assert.match(part.trim(), /^(transform|opacity) var\(--dur-/);
    }
    for (const m of block.matchAll(/@keyframes (dn-spark-\d) \{([\s\S]*?)\n\}/g)) assert.doesNotMatch(m[2], /\b(top|left|width|height|filter|background)\s*:/, m[1]);
    assert.match(flat, /@media \(prefers-reduced-motion: no-preference\) \{ \.dn-sun, \.dn-moon \{ transition:/);
  });

  it('también está en las pantallas de acceso', async () => {
    const { renderAuth } = await import('../src/views/auth.js');
    const out = renderAuth({ mode: 'signin', email: '', notice: null, canResend: false, cooldown: 0 }).toString();
    assert.match(out, /<div class="auth__theme"><button type="button" class="daynight" data-action="toggle-theme"/);
  });

  it('el botón mide al menos 44 px (se toca bien con el dedo)', () => {
    const rule = noComments(read('src/styles/components.css')).match(/\.daynight \{([^}]*)\}/)[1];
    assert.match(rule, /min-width: var\(--tap\)/);
    assert.match(rule, /min-height: var\(--tap\)/);
  });
});

describe('modo oscuro: colores', () => {
  const tokens = noComments(read('src/styles/tokens.css'));
  /** Variables de un bloque, con los var() resueltos (primero el bloque, luego :root). */
  const block = (selector) => {
    const start = tokens.indexOf(`${selector} {`);
    const body = tokens.slice(start, tokens.indexOf('\n}', start));
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const light = block(':root');
  const dark = { ...light, ...block(":root[data-theme='dark']") };
  const resolve = (vars, name) => {
    let v = vars[name];
    for (let i = 0; i < 10 && v && v.startsWith('var('); i += 1) v = vars[v.slice(4, -1).trim()];
    return v;
  };
  const lum = (hex) => {
    const n = hex.replace('#', '');
    const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it('el modo oscuro redefine el papel, la hoja y la tinta (y cambia el esquema de colores)', () => {
    assert.match(tokens, /:root\[data-theme='dark'\] \{\s*color-scheme: dark;/);
    assert.notEqual(resolve(dark, '--paper'), resolve(light, '--paper'));
    assert.ok(lum(resolve(dark, '--surface')) < 0.05, 'la hoja es oscura');
  });

  /** [texto, fondo] que la app usa juntos. */
  const PAIRS = [
    ['--text', '--surface'], ['--text', '--bg'], ['--text-muted', '--surface'], ['--text-muted', '--bg'],
    ['--navy-800', '--surface'], ['--navy-800', '--navy-50'], ['--navy-700', '--surface'], ['--navy-600', '--surface'], ['--navy-600', '--navy-50'],
    ['--gray-800', '--surface'], ['--gray-600', '--surface'], ['--gray-600', '--gray-50'],
    ['--green-700', '--surface'], ['--green-700', '--green-50'], ['--red-700', '--surface'], ['--red-700', '--red-50'],
    ['--warn-700', '--surface'], ['--warn-700', '--warn-50'],
  ];
  const KINDS = ['personal', 'freelancer', 'entrepreneur', 'company'];

  it('cada texto sobre su fondo pasa AA (4.5:1) de noche, y sigue pasando de día', () => {
    for (const vars of [dark, light]) {
      for (const [fg, bg] of PAIRS) {
        const r = ratio(resolve(vars, fg), resolve(vars, bg));
        assert.ok(r >= 4.5, `${vars === dark ? 'oscuro' : 'claro'}: ${fg} sobre ${bg} = ${r.toFixed(2)}`);
      }
    }
  });

  it('cada denominación de noche: su tinta se lee sobre la hoja y sobre su fondo suave; el blanco, sobre su relleno', () => {
    for (const kind of KINDS) {
      const ink = resolve(dark, `--${kind}-ink`);
      for (const bg of [resolve(dark, '--surface'), resolve(dark, `--${kind}-soft`), resolve(dark, '--bg')]) {
        assert.ok(ratio(ink, bg) >= 4.5, `${kind}: tinta ${ink} sobre ${bg} = ${ratio(ink, bg).toFixed(2)}`);
      }
      for (const fill of [`--${kind}`, `--${kind}-deep`]) {
        const r = ratio('#ffffff', resolve(dark, fill));
        assert.ok(r >= 4.5, `${kind}: blanco sobre ${fill} = ${r.toFixed(2)}`);
      }
    }
  });

  it('los rellenos sólidos (avisos, ayuda, peligro, chips marcados) siguen oscuros: el texto blanco se lee', () => {
    for (const vars of [dark, light]) {
      // --solid-ok solo lleva un ícono (la ✓ de un logro conseguido): para gráficos AA pide 3:1 (WCAG 1.4.11).
      for (const [name, need] of [['--solid-ink', 4.5], ['--solid-ink-2', 4.5], ['--solid-ok', 3], ['--solid-danger', 4.5], ['--solid-danger-2', 4.5]]) {
        const r = ratio('#ffffff', resolve(vars, name));
        assert.ok(r >= need, `${name} = ${r.toFixed(2)} (mínimo ${need})`);
      }
    }
  });

  it('en modo claro los rellenos sólidos valen lo mismo que antes (nada cambia de día)', () => {
    assert.equal(light['--solid-ink'], '#141a2a');
    assert.equal(light['--solid-ink-2'], '#2a3449');
    assert.equal(light['--solid-ok'], '#168a55');
    assert.equal(light['--solid-danger'], '#c73a3a');
    assert.equal(light['--solid-danger-2'], '#a32727');
  });

  it('no quedan fondos blancos escritos a mano en hojas y controles (usan la superficie)', () => {
    for (const file of ['base.css', 'layout.css', 'components.css', 'views.css', 'charts.css']) {
      const css = noComments(read(`src/styles/${file}`));
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim();
        if (/\bbackground(-color)?\s*:\s*#fff\b/i.test(m[2])) {
          // Permitidos: el botón claro de la barra de color, la bolita del interruptor y la raya del menú activo.
          assert.ok(['.btn--light', '.switch::before', '.nav__link::after'].includes(sel), `${file} «${sel}»: background #fff`);
        }
      }
    }
  });
});
