import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { GUIDE, guideWelcome, stepsFor, TOURS } from '../src/app/tourSteps.js';
import { KIND_INFO, WORKSPACE_KINDS } from '../src/domain/workspaces.js';
import { GUIDE_MOODS, GUIDE_PARTS, loadGuideArt, overlaps, parseGuideArt, placeGuide, startTyping } from '../src/ui/guide.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const ART = read('src/assets/chele.svg');
/** El dibujo sin sus comentarios (los comentarios explican, por ejemplo, que no hay <script>). */
const ART_CODE = ART.replace(/<!--[\s\S]*?-->/g, '');

/** Largo máximo de lo que dice Chele en un paso (que se lea en el globo sin cansar). */
const MAX_SAY = 200;

describe('Chele: el archivo de datos del recorrido', () => {
  it('cada paso que dice su expresión usa una válida (saluda, señala o contento)', () => {
    for (const kind of Object.keys(TOURS)) {
      for (const step of stepsFor(kind)) {
        if (step.mood !== undefined) assert.ok(GUIDE_MOODS.includes(step.mood), `${kind}/${step.id}: «${step.mood}»`);
      }
    }
  });

  it('TODOS los pasos de los cuatro recorridos los dice Chele: cada uno con su expresión y un texto corto', () => {
    for (const kind of Object.keys(TOURS)) {
      for (const step of stepsFor(kind)) {
        assert.ok(step.mood, `${kind}/${step.id}: falta la expresión`);
        assert.ok(step.text.length <= MAX_SAY, `${kind}/${step.id}: ${step.text.length} letras (máximo ${MAX_SAY})`);
      }
    }
  });

  it('en cada recorrido señala mientras explica y termina contento (el último paso se despide)', () => {
    for (const kind of Object.keys(TOURS)) {
      const steps = stepsFor(kind);
      assert.equal(steps.at(-1)?.mood, 'happy', `${kind}: el último paso`);
      assert.match(steps.at(-1)?.text ?? '', /¡Y listo/, `${kind}: se despide`);
      for (const step of steps.slice(0, -1)) assert.equal(step.mood, 'point', `${kind}/${step.id}`);
    }
  });

  it('la bienvenida la dice Chele saludando, con los dos botones de siempre, distinta en cada espacio y sin decir IA', () => {
    const titles = new Set();
    for (const kind of WORKSPACE_KINDS) {
      const w = guideWelcome(kind);
      assert.equal(w.mood, 'wave');
      assert.equal(w.startLabel, 'Empezar recorrido');
      assert.equal(w.skipLabel, 'Saltar, ya sé usar la app');
      assert.ok(`${w.title} ${w.text}`.includes(GUIDE.name), `${kind}: se presenta`);
      assert.ok(w.text.includes(`espacio ${KIND_INFO[kind].label}`), `${kind}: nombra el espacio`);
      assert.ok(w.text.length <= MAX_SAY, `${kind}: ${w.text.length} letras`);
      assert.doesNotMatch(`${w.title} ${w.text}`, /\bIA\b|inteligen/i);
      titles.add(w.title);
    }
    assert.equal(titles.size, WORKSPACE_KINDS.length, 'cada espacio tiene su propio saludo');
    assert.equal(guideWelcome('freelancer').title, '¡Oh, ahora somos freelancers!');
  });

  it('Chele conduce los recorridos de los cuatro tipos de espacio', () => {
    assert.deepEqual([...GUIDE.kinds].sort(), [...WORKSPACE_KINDS].sort());
  });

  it('Chele solo conduce tipos que tienen recorrido', () => {
    assert.ok(GUIDE.kinds.length > 0);
    for (const kind of GUIDE.kinds) assert.ok(stepsFor(kind).length > 0, kind);
  });
});

describe('Chele: dónde se pone (nunca tapa el elemento ni la barra de abajo)', () => {
  const PC = { width: 1280, height: 800 };
  const CEL = { width: 360, height: 740 };
  const bubblePC = { width: 340, height: 230 };
  const chelePC = { width: 112, height: 146 };
  const bubbleCel = { width: 252, height: 300 };
  const cheleCel = { width: 68, height: 88 };

  /** Recuadros de Chele y del globo según la colocación. */
  const boxes = (layout, bubble, chele) => [
    { ...layout.bubble, ...bubble },
    ...(layout.chele ? [{ ...layout.chele, ...chele }] : []),
  ];

  it('en muchas posiciones del elemento (PC y celular), si el bloque cabe, ni Chele ni el globo lo tapan', () => {
    let checked = 0;
    for (const [vp, bubble, chele, inset] of [[PC, bubblePC, chelePC, 0], [CEL, bubbleCel, cheleCel, 64]]) {
      for (let top = 0; top < vp.height - 40; top += 37) {
        for (let left = 0; left < vp.width - 40; left += 53) {
          const target = { top, left, width: 120, height: 48 };
          const layout = placeGuide(target, bubble, chele, vp, { inset });
          if (layout.side === 'over') continue; // ni encima ni debajo: caso de la tarjeta normal
          checked += 1;
          for (const box of boxes(layout, bubble, chele)) {
            assert.ok(!overlaps(box, target), `tapa el elemento en ${top},${left}`);
            assert.ok(box.left >= 0 && box.left + box.width <= vp.width, `se sale por los lados en ${top},${left}`);
            assert.ok(box.top >= 0 && box.top + box.height <= vp.height - inset, `pisa la barra de abajo en ${top},${left}`);
          }
          if (layout.chele) assert.ok(!overlaps(boxes(layout, bubble, chele)[0], boxes(layout, bubble, chele)[1]), 'Chele tapa su globo (y sus botones)');
        }
      }
    }
    assert.ok(checked > 200, `se comprobaron ${checked} posiciones`);
  });

  it('cuando Chele no cabe sin tapar, va el globo solo (Chele nunca queda encima del elemento)', () => {
    const big = { top: 60, left: 16, width: 328, height: 560 };
    const layout = placeGuide(big, bubbleCel, cheleCel, CEL, { inset: 64 });
    assert.equal(layout.side, 'over');
    assert.equal(layout.chele, null);
  });

  it('la barra de pestañas del celular: el bloque va encima de ella y de la pestaña resaltada', () => {
    const tab = { top: CEL.height - 58, left: 80, width: 72, height: 58 };
    const layout = placeGuide(tab, bubbleCel, cheleCel, CEL, { inset: 64 });
    assert.equal(layout.side, 'above');
    assert.equal(layout.tail.edge, 'bottom');
    for (const box of boxes(layout, bubbleCel, cheleCel)) assert.ok(box.top + box.height <= CEL.height - 64);
  });

  it('la colita sale del lado del elemento y apunta a él (dentro del globo)', () => {
    const target = { top: 40, left: 900, width: 100, height: 40 };
    const layout = placeGuide(target, bubblePC, chelePC, PC);
    assert.equal(layout.side, 'below');
    assert.equal(layout.tail.edge, 'top');
    const tip = layout.bubble.left + layout.tail.x;
    assert.ok(tip >= layout.bubble.left + 24 && tip <= layout.bubble.left + bubblePC.width - 24);
    assert.ok(Math.abs(tip - 950) <= bubblePC.width, 'la colita queda hacia el elemento');
  });

  it('Chele va en el lado del elemento, lo mira y señala hacia arriba o hacia abajo según dónde esté', () => {
    const right = placeGuide({ top: 40, left: 1100, width: 100, height: 40 }, bubblePC, chelePC, PC);
    assert.ok(right.chele && right.chele.left > right.bubble.left, 'elemento a la derecha: Chele a la derecha del globo');
    assert.equal(right.dir, 'up');
    const left = placeGuide({ top: 700, left: 40, width: 100, height: 40 }, bubblePC, chelePC, PC);
    assert.ok(left.chele && left.chele.left < left.bubble.left, 'elemento a la izquierda: Chele a la izquierda del globo');
    assert.equal(left.dir, 'down');
    // Siempre mira hacia el elemento.
    for (let x = 0; x < PC.width - 100; x += 40) {
      for (const y of [30, 700]) {
        const target = { top: y, left: x, width: 100, height: 40 };
        const layout = placeGuide(target, bubblePC, chelePC, PC);
        if (!layout.chele) continue;
        const cheleCx = layout.chele.left + chelePC.width / 2;
        assert.equal(layout.face, x + 50 > cheleCx ? 'right' : 'left', `elemento en ${x},${y}`);
      }
    }
  });

  it('la bienvenida (sin elemento) va en el centro, sin colita', () => {
    const layout = placeGuide(null, bubblePC, chelePC, PC);
    assert.equal(layout.side, 'center');
    assert.equal(layout.tail.edge, 'none');
    assert.ok(layout.chele);
  });

  it('si en una pantalla muy estrecha no caben de lado, va el globo solo', () => {
    const layout = placeGuide({ top: 40, left: 10, width: 50, height: 30 }, { width: 300, height: 200 }, cheleCel, { width: 320, height: 640 });
    assert.equal(layout.chele, null);
  });
});

describe('Chele: escribe como si hablara', () => {
  it('con «reducir movimiento» (instant) el texto sale completo de una vez', () => {
    const said = { textContent: '' };
    const rest = { textContent: '' };
    const typing = startTyping(said, rest, 'Hola, soy Chele.', { instant: true });
    assert.equal(said.textContent, 'Hola, soy Chele.');
    assert.equal(rest.textContent, '');
    assert.equal(typing.isDone(), true);
  });

  it('sin requestAnimationFrame (no se puede animar) también sale completo', () => {
    const said = { textContent: '' };
    const rest = { textContent: '' };
    startTyping(said, rest, 'Texto entero');
    assert.equal(`${said.textContent}${rest.textContent}`, 'Texto entero');
    assert.equal(said.textContent, 'Texto entero');
  });
});

describe('Chele: si el dibujo no carga, el recorrido sigue con la tarjeta normal', () => {
  it('sin conexión (la descarga falla): null, sin romper nada', async () => {
    const art = await loadGuideArt({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    assert.equal(art, null);
  });

  it('el servidor responde con error (404): null', async () => {
    const art = await loadGuideArt({ fetchImpl: async () => ({ ok: false, text: async () => '' }) });
    assert.equal(art, null);
  });

  it('un archivo que no es el dibujo: null', () => {
    assert.equal(parseGuideArt('<html>no soy un svg</html>'), null);
    assert.equal(parseGuideArt(''), null);
  });

  it('el motor dibuja la tarjeta normal cuando no hay guía (guide = null)', () => {
    const tour = read('src/ui/tour.js');
    assert.match(tour, /guide = null/);
    assert.match(tour, /dialog\.className = guide \? 'tour tour--guided' : 'tour'/);
    assert.match(tour, /instant: !guide \|\| prefersReducedMotion\(\)/, 'sin guía, el texto sale entero');
    const controller = read('src/app/tourController.js');
    assert.match(controller, /choiceDialog\(/, 'sin guía, la bienvenida es la ventana de siempre');
  });
});

describe('Chele: el dibujo', () => {
  it('tiene todas las partes que se animan', () => {
    for (const part of GUIDE_PARTS) assert.match(ART, new RegExp(`class="(?:[^"]* )?${part}(?: [^"]*)?"`), part);
  });

  it('es decorativo para el lector de pantalla', () => {
    assert.match(ART, /<svg[^>]*aria-hidden="true"/);
    assert.match(read('src/ui/tour.js'), /class="tour__guide" aria-hidden="true"/);
  });

  it('no tiene código, estilos en línea ni enlaces de fuera (política de seguridad)', () => {
    assert.doesNotMatch(ART_CODE, /<script|\son\w+\s*=|\sstyle\s*=|<style|<foreignObject|<image|href="(?!#)/i);
  });

  it('las partes que se mueven no llevan transform propio (lo pisaría el CSS)', () => {
    for (const part of ['chele-bob', 'chele-arm', 'chele-wave', 'chele-eyes']) {
      assert.doesNotMatch(ART, new RegExp(`class="${part}"[^>]*transform=`), part);
    }
  });

  it('viste el color del espacio: sus partes de color usan --kind en el CSS (y el morado del dibujo queda de respaldo)', () => {
    for (const part of ['t-fill', 't-light', 't-mid', 't-deep', 't-eye', 't-line']) assert.match(ART_CODE, new RegExp(`class="(?:[^"]* )?${part}(?: [^"]*)?"`), part);
    const css = read('src/styles/components.css');
    const flat = css.replace(/\s+/g, ' ');
    for (const rule of [
      '.chele .t-fill { fill: var(--kind); }',
      '.chele .t-deep { stop-color: var(--kind-deep); }',
      '.chele .t-light { stop-color: color-mix(in srgb, var(--kind) 55%, #fff); }',
      '.chele .t-eye { stop-color: color-mix(in srgb, var(--kind) 40%, #fff); }',
    ]) assert.ok(flat.includes(rule), `falta: ${rule}`);
  });

  it('sus id llevan el prefijo chele- (no chocan con los de la app)', () => {
    for (const m of ART.matchAll(/\sid="([^"]+)"/g)) assert.match(m[1], /^chele-/);
  });

  it('cada expresión tiene su estilo y el movimiento va dentro de «sin reducir movimiento»', () => {
    const css = read('src/styles/components.css');
    for (const mood of GUIDE_MOODS) assert.match(css, new RegExp(`\\.chele\\[data-mood='${mood}'\\]`), mood);
    assert.match(css, /prefers-reduced-motion: no-preference\)\s*\{\s*\.tour__guide \{/);
  });

  it('está en la lista sin conexión (precache)', () => {
    assert.ok(JSON.parse(read('precache.json')).files.includes('src/assets/chele.svg'));
  });
});
