// @ts-check
// =============================================================================
// INTRO DEL LOGO al abrir la app (0.18.5)
// -----------------------------------------------------------------------------
// La A entra desde la izquierda y la C desde la derecha, chocan (destello y chispas), la raya lavanda sale y las
// cruza y aparece «ACCONTROL». Al final la A se va por la izquierda, la C por la derecha y la raya crece hasta
// tapar la pantalla con el color del papel: debajo ya espera el login (o Inicio), que entra con su animación.
//
// - Usa las formas reales del logo (icons/icon.svg): un solo dibujo para el ícono y la intro.
// - Sale UNA vez por sesión (al abrir la app; no al recargar tras cerrar sesión). Lo decide src/theme-boot.js
//   antes de dibujar, poniendo la clase `has-intro` en <html>, para que no se vea ni un instante de la app debajo.
// - Con «reducir movimiento» no sale. Un toque o una tecla la adelanta a la salida.
// - Solo se mueve con transformaciones (atributo transform del SVG) y opacidad; lo dinámico va por CSSOM
//   (la política de seguridad no permite estilos escritos en el HTML).
// =============================================================================

/** Clave de sessionStorage: la intro ya salió en esta sesión. Debe coincidir con src/theme-boot.js. */
export const INTRO_KEY = 'accontrol.intro.v1';

/** Línea de tiempo en milisegundos. */
export const INTRO_TIMES = {
  aIn: [120, 1000],
  cIn: [260, 1080],
  hit: 1060,
  line: [1080, 1780],
  word: [1650, 2350],
  exit: [3000, 3700],
  zoom: [3120, 3900],
  end: 3900,
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const IVORY = '#f4f1ea';
const LAVENDER = '#c9b3f0';
/** Centros de cada letra (unidades del dibujo) para girarlas sobre sí mismas. */
const A_CENTER = [217, 342];
const C_CENTER = [400, 346];
const LINE_FROM = 160;
const LINE_TO = 700;
const VIEW_WIDTH = 680;

// ---- Curvas de movimiento ----------------------------------------------------
/** @param {number} v */
const clamp = (v) => Math.min(1, Math.max(0, v));
/** @param {number} t @param {number[]} range */
const prog = (t, range) => clamp((t - range[0]) / (range[1] - range[0]));
/** @param {number} t */
const outExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
/** @param {number} t */
const outQuint = (t) => 1 - Math.pow(1 - t, 5);
/** @param {number} t */
const inExpo = (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));
/** @param {number} t */
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** @param {number} t @param {number} s */
const outBack = (t, s) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Mezcla dos colores #rrggbb.
 * @param {string} from @param {string} to @param {number} t
 */
export function mixColor(from, to, t) {
  /** @param {string} c */
  const parse = (c) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
    return hex ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) : null;
  };
  const a = parse(from);
  const b = parse(to) ?? a;
  if (!a || !b) return to;
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
}

/**
 * Saca del ícono las tres formas: la A, la C y la raya.
 * @param {string} svgText
 * @returns {{ a: string, c: string, line: string } | null}
 */
export function logoShapes(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const visible = [...doc.querySelectorAll('svg > path')];
  const line = visible.find((p) => (p.getAttribute('fill') ?? '').toLowerCase() === LAVENDER);
  const letters = visible.filter((p) => p !== line && p.hasAttribute('mask'));
  if (!line || letters.length !== 2) return null;
  // La A empieza más a la izquierda que la C.
  const startX = (/** @type {Element} */ p) => Number(/^M\s*(-?[\d.]+)/.exec(p.getAttribute('d') ?? '')?.[1] ?? 0);
  const [a, c] = letters.sort((x, y) => startX(x) - startX(y));
  const d = (/** @type {Element} */ p) => p.getAttribute('d') ?? '';
  return { a: d(a), c: d(c), line: d(line) };
}

/**
 * @param {string} tag @param {Record<string, string>} [attrs] @param {Element[]} [children]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}, children = []) {
  const el = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/**
 * Arma el dibujo con los cortes del entrelazado (C sobre A arriba, A sobre C abajo, la raya sobre las dos).
 * @param {{ a: string, c: string, line: string }} shapes
 */
function buildLogo(shapes) {
  const cut = { fill: '#000', stroke: '#000', 'stroke-width': '17.6', 'stroke-linejoin': 'round' };
  const big = { x: '-9999', y: '-9999', width: '99999', height: '99999' };
  const maskBox = { maskUnits: 'userSpaceOnUse', ...big };
  const revealRect = svgEl('rect', { x: String(LINE_FROM), y: '0', width: '0', height: '800' });
  const maskC = svgEl('path', { d: shapes.c, ...cut, 'clip-path': 'url(#intro-top)' });
  const maskA = svgEl('path', { d: shapes.a, ...cut, 'clip-path': 'url(#intro-bot)' });
  const maskLines = [1, 2].map(() => svgEl('path', { d: shapes.line, ...cut, 'clip-path': 'url(#intro-reveal)' }));
  const blurA = svgEl('feGaussianBlur', { stdDeviation: '0 0' });
  const blurC = svgEl('feGaussianBlur', { stdDeviation: '0 0' });
  const wide = { x: '-50%', y: '-50%', width: '200%', height: '200%' };

  const defs = svgEl('defs', {}, [
    svgEl('filter', { id: 'intro-blur-a', ...wide }, [blurA]),
    svgEl('filter', { id: 'intro-blur-c', ...wide }, [blurC]),
    svgEl('filter', { id: 'intro-glow', ...wide }, [
      svgEl('feGaussianBlur', { stdDeviation: '10', result: 'b' }),
      svgEl('feMerge', {}, [svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'SourceGraphic' })]),
    ]),
    svgEl('clipPath', { id: 'intro-reveal', clipPathUnits: 'userSpaceOnUse' }, [revealRect]),
    svgEl('clipPath', { id: 'intro-top', clipPathUnits: 'userSpaceOnUse' }, [svgEl('rect', { x: '-9999', y: '-9999', width: '99999', height: '10341' })]),
    svgEl('clipPath', { id: 'intro-bot', clipPathUnits: 'userSpaceOnUse' }, [svgEl('rect', { x: '-9999', y: '342', width: '99999', height: '99999' })]),
    svgEl('mask', { id: 'intro-mask-a', ...maskBox }, [svgEl('rect', { ...big, fill: '#fff' }), maskC, maskLines[0]]),
    svgEl('mask', { id: 'intro-mask-c', ...maskBox }, [svgEl('rect', { ...big, fill: '#fff' }), maskA, maskLines[1]]),
  ]);
  const a = svgEl('path', { d: shapes.a, fill: IVORY, filter: 'url(#intro-blur-a)' });
  const c = svgEl('path', { d: shapes.c, fill: IVORY, filter: 'url(#intro-blur-c)' });
  const line = svgEl('path', { d: shapes.line, fill: LAVENDER, 'clip-path': 'url(#intro-reveal)' });
  const svg = /** @type {SVGSVGElement} */ (svgEl('svg', { class: 'intro__logo', viewBox: `30 150 ${VIEW_WIDTH} 380`, 'aria-hidden': 'true', focusable: 'false' }, [
    defs,
    svgEl('g', { mask: 'url(#intro-mask-a)' }, [a]),
    svgEl('g', { mask: 'url(#intro-mask-c)' }, [c]),
    line,
  ]));
  return { svg, a, c, line, maskA, maskC, maskLines, revealRect, blurA, blurC };
}

/**
 * Busca el centro del grosor de la raya: desde ahí crece para tapar toda la pantalla.
 * @param {SVGSVGElement} svg @param {SVGElement} line
 */
function zoomOrigin(svg, line) {
  try {
    const p = svg.createSVGPoint();
    const geometry = /** @type {SVGGeometryElement} */ (/** @type {unknown} */ (line));
    for (let x = 420; x <= 480; x += 4) {
      let top = -1;
      let bottom = -1;
      for (let y = 180; y <= 420; y += 0.5) {
        p.x = x;
        p.y = y;
        const inside = geometry.isPointInFill(p);
        if (inside && top < 0) top = y;
        if (inside) bottom = y;
        else if (top >= 0) break;
      }
      if (top >= 0) return [x, (top + bottom) / 2];
    }
  } catch {
    // Navegador sin isPointInFill: se usa el punto de abajo.
  }
  return [430, 300];
}

/** ¿Debe salir la intro? (theme-boot.js ya lo decidió antes de dibujar.) */
function wanted() {
  return document.documentElement.classList.contains('has-intro');
}

/**
 * Reproduce la intro (si toca) y se cumple cuando termina: en ese momento la pantalla es el papel de la app y lo
 * que se dibuje debajo (login o Inicio) puede hacer su propia entrada.
 * @param {{ root?: HTMLElement | null, iconUrl?: string }} [options]
 * @returns {Promise<void>}
 */
export function playIntro({ root = document.getElementById('intro'), iconUrl = 'icons/icon.svg' } = {}) {
  return new Promise((resolve) => {
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      document.documentElement.classList.remove('has-intro');
      root?.remove();
      resolve();
    }
    if (!root || !wanted() || document.visibilityState === 'hidden') {
      finish();
      return;
    }
    try {
      sessionStorage.setItem(INTRO_KEY, 'seen');
    } catch {
      // Sin almacenamiento: la intro saldrá también al recargar. No pasa nada.
    }
    // Red de seguridad: pase lo que pase (pestaña en segundo plano, error), la app abre.
    const safety = setTimeout(finish, INTRO_TIMES.end + 2500);

    fetch(iconUrl)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((text) => {
        const shapes = logoShapes(text);
        if (!shapes) throw new Error('El ícono no tiene la forma esperada.');
        run(shapes);
      })
      .catch((error) => {
        console.warn('Intro del logo omitida:', error);
        clearTimeout(safety);
        finish();
      });

    /** @param {{ a: string, c: string, line: string }} shapes */
    function run(shapes) {
      const host = /** @type {HTMLElement} */ (root);
      const logo = buildLogo(shapes);
      const word = document.createElement('div');
      word.className = 'intro__word';
      word.setAttribute('aria-hidden', 'true');
      const letters = [...'ACCONTROL'].map((ch) => {
        const span = document.createElement('span');
        span.textContent = ch;
        word.append(span);
        return span;
      });
      const inner = document.createElement('div');
      inner.className = 'intro__inner';
      inner.append(logo.svg, word);
      const flash = document.createElement('div');
      flash.className = 'intro__flash';
      const sparks = Array.from({ length: 14 }, (_, i) => {
        const el = document.createElement('div');
        el.className = 'intro__spark';
        return { el, angle: (i / 14) * Math.PI * 2 + Math.random() * 0.4, distance: 90 + Math.random() * 110, size: 0.5 + Math.random() * 0.9 };
      });
      host.append(inner, flash, ...sparks.map((s) => s.el));

      const T = INTRO_TIMES;
      const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#eef1ec';
      const [zx, zy] = zoomOrigin(logo.svg, logo.line);
      const [acx, acy] = A_CENTER;
      const [ccx, ccy] = C_CENTER;
      let off = 900;
      const measure = () => {
        const box = logo.svg.getBoundingClientRect();
        if (box.width > 0) off = (window.innerWidth / 2 + box.width) * (VIEW_WIDTH / box.width);
      };
      measure();

      /** @param {number} x @param {number} y */
      const toScreen = (x, y) => {
        const m = logo.svg.getScreenCTM();
        const p = logo.svg.createSVGPoint();
        p.x = x;
        p.y = y;
        return m ? p.matrixTransform(m) : p;
      };

      /** @param {number} t */
      function frame(t) {
        const pa = outQuint(prog(t, T.aIn));
        const pc = outQuint(prog(t, T.cIn));
        const pe = inExpo(prog(t, T.exit));
        const ph = prog(t, [T.hit, T.hit + 380]);
        const squash = ph > 0 && ph < 1 ? 1 + 0.05 * Math.sin(ph * Math.PI) * (1 - ph) : 1;

        const ax = lerp(-off, 0, pa) - off * 1.1 * pe;
        const ay = lerp(260, 0, pa);
        const ar = lerp(-38, 0, pa) - 24 * pe;
        const cx = lerp(off, 0, pc) + off * 1.1 * pe;
        const cy = lerp(260, 0, pc);
        const cr = lerp(38, 0, pc) + 24 * pe;
        const tA = `translate(${ax} ${ay}) rotate(${ar} ${acx} ${acy}) translate(${acx} ${acy}) scale(${squash}) translate(${-acx} ${-acy})`;
        const tC = `translate(${cx} ${cy}) rotate(${cr} ${ccx} ${ccy}) translate(${ccx} ${ccy}) scale(${squash}) translate(${-ccx} ${-ccy})`;
        logo.a.setAttribute('transform', tA);
        logo.maskA.setAttribute('transform', tA);
        logo.c.setAttribute('transform', tC);
        logo.maskC.setAttribute('transform', tC);

        // Estela: más desenfoque cuanto más rápido va la letra.
        const va = t > T.aIn[0] ? Math.pow(1 - prog(t, T.aIn), 2.2) : 0;
        const vc = t > T.cIn[0] ? Math.pow(1 - prog(t, T.cIn), 2.2) : 0;
        logo.blurA.setAttribute('stdDeviation', `${(va * 40 + pe * 46).toFixed(1)} ${(va * 6).toFixed(1)}`);
        logo.blurC.setAttribute('stdDeviation', `${(vc * 40 + pe * 46).toFixed(1)} ${(vc * 6).toFixed(1)}`);
        logo.a.style.opacity = String(clamp(prog(t, T.aIn) * 3));
        logo.c.style.opacity = String(clamp(prog(t, T.cIn) * 3));

        // La raya: de izquierda a derecha; al salir crece hasta tapar todo y se vuelve papel.
        const pl = inOutCubic(prog(t, T.line));
        const pz = inExpo(prog(t, T.zoom));
        const r = logo.revealRect;
        if (pz > 0) {
          r.setAttribute('x', '-99999');
          r.setAttribute('y', '-99999');
          r.setAttribute('width', '199999');
          r.setAttribute('height', '199999');
        } else {
          r.setAttribute('x', String(LINE_FROM));
          r.setAttribute('y', '0');
          r.setAttribute('height', '800');
          r.setAttribute('width', String((LINE_TO - LINE_FROM) * pl));
        }
        const s = lerp(1, 420, pz);
        const tL = `translate(${zx} ${zy}) scale(${s}) translate(${-zx} ${-zy})`;
        logo.line.setAttribute('transform', tL);
        logo.maskLines.forEach((m) => m.setAttribute('transform', tL));
        logo.line.setAttribute('fill', mixColor(LAVENDER, paper, clamp(pz * 1.6)));
        if (pl > 0 && pl < 1) logo.line.setAttribute('filter', 'url(#intro-glow)');
        else logo.line.removeAttribute('filter');

        // Destello y chispas al chocar.
        const center = toScreen(318, 330);
        const pf = prog(t, [T.hit - 40, T.hit + 520]);
        flash.style.transform = `translate(${center.x}px, ${center.y}px) scale(${lerp(0.3, 1.5, outExpo(pf))})`;
        flash.style.opacity = String(pf > 0 && pf < 1 ? (1 - pf) * 0.95 : 0);
        const ps = prog(t, [T.hit, T.hit + 760]);
        for (const sp of sparks) {
          const d = outExpo(ps) * sp.distance;
          sp.el.style.transform = `translate(${center.x + Math.cos(sp.angle) * d - 3.5}px, ${center.y + Math.sin(sp.angle) * d - 3.5}px) scale(${sp.size * (1 - ps * 0.7)})`;
          sp.el.style.opacity = String(ps > 0 && ps < 1 ? 1 - ps : 0);
        }

        // «ACCONTROL»: letra por letra desde abajo; al salir se abre hacia los lados.
        const out = inExpo(prog(t, [T.exit[0] - 60, T.exit[0] + 360]));
        letters.forEach((el, i) => {
          const begin = T.word[0] + i * 45;
          const p = outBack(prog(t, [begin, begin + 520]), 1.2);
          el.style.opacity = String(clamp(prog(t, [begin, begin + 260])) * (1 - out));
          el.style.transform = `translate(${(i - 4) * 34 * out}px, ${lerp(22, 0, p)}px)`;
        });
      }

      frame(0);
      const start = performance.now();

      // Un toque o una tecla: salta directo a la salida (sin cortar en seco).
      let shift = 0;
      const skip = () => {
        const now = performance.now() - start + shift;
        if (now < T.exit[0]) shift += T.exit[0] - now;
      };
      host.addEventListener('pointerdown', skip);
      window.addEventListener('keydown', skip);
      window.addEventListener('resize', measure);
      /** @param {number} now */
      const tick = (now) => {
        const t = now - start + shift;
        frame(t);
        if (t >= T.end) {
          clearTimeout(safety);
          window.removeEventListener('keydown', skip);
          window.removeEventListener('resize', measure);
          finish();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  });
}
