import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(root, 'src/styles');
const files = readdirSync(STYLES).filter((f) => f.endsWith('.css'));
/** Sin comentarios (para que un ejemplo dentro de un comentario no cuente). */
const css = Object.fromEntries(files.map((f) => [f, readFileSync(join(STYLES, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]));

/** Todas las reglas «selector { declaraciones }» (las de dentro de @media también). */
function rules(text) {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2], index: m.index }));
}

/** Variables de tokens.css (solo :root), con los var() resueltos. */
const TOKENS = (() => {
  const raw = {};
  for (const m of css['tokens.css'].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in raw)) raw[m[1]] = m[2].trim();
  const resolve = (value, depth = 0) => (depth > 10 ? value : value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => resolve(raw[name] ?? '', depth + 1)));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v)]));
})();

/**
 * Excepciones a «solo transform y opacity». En la parte 1 había tres antiguas (botones, «Saltar al contenido» y el
 * recorrido guiado); se corrigieron en la parte 2 y ya no queda ninguna. No añadir excepciones sin una razón escrita.
 */
const LEGACY_PENDING = new Set();

describe('movimiento: un solo juego de duraciones y curvas', () => {
  it('las duraciones están entre 120 y 300 ms', () => {
    for (const name of ['--dur-press', '--dur-base', '--dur-enter']) {
      const ms = Number(TOKENS[name]?.replace('ms', ''));
      assert.ok(ms >= 120 && ms <= 300, `${name} = ${TOKENS[name]}`);
    }
    assert.ok(Number(TOKENS['--stagger'].replace('ms', '')) <= 60, 'la entrada escalonada debe ser corta');
  });

  it('las curvas existen y son cubic-bezier', () => {
    for (const name of ['--ease-out', '--ease-in-out', '--ease-pop']) assert.match(TOKENS[name] ?? '', /^cubic-bezier\(/, name);
  });

  it('las transiciones nuevas usan las variables (no duraciones sueltas)', () => {
    for (const [file, text] of Object.entries(css)) {
      for (const rule of rules(text)) {
        if (LEGACY_PENDING.has(rule.selector)) continue;
        for (const m of rule.body.matchAll(/transition\s*:\s*([^;]+);/g)) {
          assert.match(m[1], /var\(--dur-/, `${file} «${rule.selector}»: ${m[1]}`);
        }
      }
    }
  });
});

describe('movimiento: solo transform y opacity', () => {
  it('cada transición anima solo transform u opacity', () => {
    for (const [file, text] of Object.entries(css)) {
      for (const rule of rules(text)) {
        if (LEGACY_PENDING.has(rule.selector)) continue;
        for (const m of rule.body.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
          if (m[1].trim() === 'none') continue;
          for (const part of m[1].split(',')) {
            const property = part.trim().split(/\s+/)[0];
            assert.ok(['transform', 'opacity'].includes(property), `${file} «${rule.selector}» anima «${property}»`);
          }
        }
      }
    }
  });

  it('cada animación (@keyframes) cambia solo transform u opacity', () => {
    let frames = 0;
    for (const [file, text] of Object.entries(css)) {
      for (const block of text.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
        for (const frame of rules(block[2])) {
          frames += 1;
          for (const decl of frame.body.split(';').map((d) => d.trim()).filter(Boolean)) {
            const property = decl.split(':')[0].trim();
            assert.ok(['transform', 'opacity'].includes(property), `${file} @keyframes ${block[1]}: «${property}»`);
          }
        }
      }
    }
    assert.ok(frames >= 4, 'debería haber encontrado los cuadros de enter-up y de las hojas');
  });

  it('la pantalla de Inicio y la barra de navegación ya no animan nada que no sea transform u opacity', () => {
    const touched = rules(css['layout.css']).concat(rules(css['views.css']).filter((r) => r.selector.includes("data-screen='inicio'")));
    assert.ok(touched.some((r) => /transition/.test(r.body)), 'no se encontraron transiciones (¿cambió el archivo?)');
    for (const rule of touched) {
      for (const m of rule.body.matchAll(/transition\s*:\s*([^;]+);/g)) {
        assert.doesNotMatch(m[1], /color|background|top|left|width|height|box-shadow|border/, `«${rule.selector}»`);
      }
    }
  });
});

describe('movimiento: respeta «reducir movimiento»', () => {
  it('con reduce, todo es instantáneo: sin duración y sin esperas', () => {
    const block = css['base.css'].match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\}\s*)\}/)?.[1] ?? '';
    for (const rule of ['animation-duration: 0.01ms !important', 'transition-duration: 0.01ms !important', 'animation-delay: 0s !important', 'transition-delay: 0s !important', 'scroll-behavior: auto !important']) {
      assert.ok(block.includes(rule), `falta «${rule}»`);
    }
  });

  it('toda animación de entrada está dentro de @media (prefers-reduced-motion: no-preference)', () => {
    for (const [file, text] of Object.entries(css)) {
      // Se quita el contenido de los bloques no-preference y de los @keyframes; lo que quede no puede tener animation:.
      let outside = text;
      for (;;) {
        const start = outside.search(/@media \(prefers-reduced-motion: no-preference\)\s*\{|@keyframes\s+[\w-]+\s*\{/);
        if (start < 0) break;
        let depth = 0;
        let end = outside.indexOf('{', start);
        for (let i = end; i < outside.length; i += 1) {
          if (outside[i] === '{') depth += 1;
          if (outside[i] === '}') depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
        outside = outside.slice(0, start) + outside.slice(end + 1);
      }
      for (const m of outside.matchAll(/(?<![-\w])animation\s*:\s*([^;]+);/g)) {
        assert.equal(m[1].trim(), 'none', `${file}: «animation: ${m[1]}» fuera de prefers-reduced-motion: no-preference`);
      }
    }
  });

  it('durante el recorrido guiado no hay entrada animada (el resaltado mide los elementos)', () => {
    assert.match(css['views.css'], /body\.is-touring \.view\[data-enter\] > \*\s*\{\s*animation: none;/);
  });
});

describe('colores: contraste AA de lo nuevo', () => {
  const hex = (value) => {
    const m = value.trim().match(/^#([0-9a-f]{6})$/i);
    assert.ok(m, `no es un color #rrggbb: ${value}`);
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  };
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [luminance(hex(a)), luminance(hex(b))].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const T = (name) => TOKENS[name] ?? name;

  it('textos (4.5:1 o más)', () => {
    const pairs = [
      ['--gray-600', '--tint-income', 'etiqueta INGRESOS sobre verde claro'],
      ['--gray-600', '--tint-expense', 'etiqueta GASTOS sobre azul claro'],
      ['--gray-600', '--tint-neutral', 'etiqueta sobre gris claro'],
      ['--green-700', '--tint-income', 'monto de ingresos sobre verde claro'],
      ['--navy-800', '--tint-expense', 'monto de gastos sobre azul claro'],
      ['--navy-800', '--tint-neutral', 'montos neutros'],
      ['--text-muted', '--surface', 'pestaña sin seleccionar'],
      ['--navy-800', '--surface', 'pestaña seleccionada'],
      // Las cuatro denominaciones (un color por tipo de espacio)
      ...['personal', 'freelancer', 'entrepreneur', 'company'].flatMap((k) => [
        ['#ffffff', `--${k}`, `texto blanco sobre el botón de ${k}`],
        ['#ffffff', `--${k}-deep`, `texto blanco sobre la barra de ${k}`],
        [`--${k}-ink`, '--surface', `cifra y textos de ${k} sobre «el billete»`],
        [`--${k}-ink`, `--${k}-soft`, `pestaña activa de ${k} sobre su píldora`],
        [`--${k}-ink`, '--paper', `texto de ${k} sobre el papel`],
      ]),
      ['--text-muted', '--paper', 'texto secundario sobre el papel'],
      ['--text', '--paper', 'texto sobre el papel'],
    ];
    for (const [fg, bg, what] of pairs) {
      const r = ratio(T(fg), T(bg));
      assert.ok(r >= 4.5, `${what}: ${r.toFixed(2)}:1`);
    }
  });

  it('íconos y elementos gráficos (3:1 o más)', () => {
    const pairs = [
      ['--navy-800', '--navy-100', 'ícono de la pestaña activa sobre su píldora'],
      ['#ffffff', '--green-600', 'ícono + sobre el botón verde'],
      ['#ffffff', '--green-700', 'ícono + sobre el botón verde (parte oscura)'],
      ['--gray-500', '--surface', 'interruptor apagado sobre el panel'],
      ['--green-600', '--surface', 'interruptor encendido sobre el panel'],
      ['#ffffff', '--gray-500', 'botoncito blanco del interruptor apagado'],
    ];
    for (const [fg, bg, what] of pairs) {
      const r = ratio(T(fg), T(bg));
      assert.ok(r >= 3, `${what}: ${r.toFixed(2)}:1`);
    }
  });
});
