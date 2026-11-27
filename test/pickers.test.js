// 0.20.12 — Selectores propios: listas, hora y fecha (src/domain/pickers.js, src/ui/picker.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  currencySymbolOf, dateAllowed, dateValue, from12h, longDateLabel, monthAllowed, monthGrid, nudgeTime, parseDateValue,
  parseTimeValue, previousDay, shiftMonth, timeLabel, timeValue, to12h, todayValue,
} from '../src/domain/pickers.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('selector de hora: las cuentas', () => {
  it('lee y escribe «HH:MM»', () => {
    assert.deepEqual(parseTimeValue('16:24'), { hour: 16, minute: 24 });
    assert.deepEqual(parseTimeValue('09:05:30'), { hour: 9, minute: 5 });
    assert.equal(parseTimeValue(''), null);
    assert.equal(parseTimeValue('25:00'), null);
    assert.equal(timeValue(7, 3), '07:03');
  });
  it('reloj de 12 horas, ida y vuelta', () => {
    assert.deepEqual(to12h(0), { hour12: 12, pm: false });
    assert.deepEqual(to12h(12), { hour12: 12, pm: true });
    assert.deepEqual(to12h(16), { hour12: 4, pm: true });
    for (let h = 0; h < 24; h += 1) {
      const { hour12, pm } = to12h(h);
      assert.equal(from12h(hour12, pm), h);
    }
  });
  it('±1 minuto da la vuelta al día', () => {
    assert.deepEqual(nudgeTime({ hour: 23, minute: 59 }, 1), { hour: 0, minute: 0 });
    assert.deepEqual(nudgeTime({ hour: 0, minute: 0 }, -1), { hour: 23, minute: 59 });
    assert.deepEqual(nudgeTime({ hour: 4, minute: 24 }, 1), { hour: 4, minute: 25 });
  });
  it('se lee en español', () => {
    assert.equal(timeLabel({ hour: 16, minute: 24 }), '4:24 p. m.');
    assert.equal(timeLabel({ hour: 0, minute: 5 }), '12:05 a. m.');
  });
});

describe('selector de fecha: el calendario', () => {
  it('lee y escribe «AAAA-MM-DD» y rechaza días que no existen', () => {
    assert.deepEqual(parseDateValue('2026-11-26'), { year: 2026, month: 10, day: 26 });
    assert.equal(parseDateValue('2026-02-30'), null);
    assert.equal(parseDateValue('2026-13-01'), null);
    assert.equal(parseDateValue(''), null);
    assert.equal(dateValue(2026, 0, 5), '2026-01-05');
  });
  it('la semana empieza el lunes', () => {
    assert.deepEqual(monthGrid(2026, 10), { offset: 6, days: 30 }); // 1 de noviembre de 2026: domingo
    assert.deepEqual(monthGrid(2026, 5), { offset: 0, days: 30 }); // 1 de junio de 2026: lunes
    assert.equal(monthGrid(2028, 1).days, 29); // bisiesto
  });
  it('mes anterior y siguiente cruzan el año', () => {
    assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  });
  it('respeta el mínimo y el máximo del campo', () => {
    assert.ok(dateAllowed('2026-11-26', '2026-11-01', '2026-11-26'));
    assert.ok(!dateAllowed('2026-11-27', '', '2026-11-26'));
    assert.ok(!dateAllowed('2026-10-31', '2026-11-01', ''));
    assert.ok(monthAllowed(2026, 10, '', '2026-11-26'));
    assert.ok(!monthAllowed(2026, 11, '', '2026-11-26'));
    assert.ok(!monthAllowed(2026, 9, '2026-11-01', ''));
  });
  it('textos y atajos', () => {
    assert.equal(longDateLabel({ year: 2026, month: 10, day: 26 }), 'jueves, 26 de noviembre de 2026');
    assert.equal(previousDay('2026-03-01'), '2026-02-28');
    assert.equal(todayValue(new Date(2026, 10, 26, 23, 50)), '2026-11-26');
    assert.equal(currencySymbolOf('Dólar estadounidense (US$)'), 'US$');
    assert.equal(currencySymbolOf('Balboa panameño (B/.)'), 'B/.');
    assert.equal(currencySymbolOf('Sin símbolo'), '');
  });
});

describe('selectores propios: en toda la app', () => {
  const ui = read('src/ui/picker.js');
  it('se conectan una vez al arrancar, para listas, horas y fechas', () => {
    assert.match(read('src/main.js'), /installPickers\(\);/);
    assert.match(ui, /export const PICKABLE = 'select\.input, input\.input\[type="time"\], input\.input\[type="date"\]'/);
  });
  it('cancelan la ventanita del sistema (al levantar el dedo y con el ratón) sin romper el desplazamiento', () => {
    assert.match(ui, /addEventListener\('touchend'[\s\S]*?event\.preventDefault\(\)[\s\S]*?passive: false/);
    assert.match(ui, /addEventListener\('touchstart'[\s\S]*?passive: true/);
    assert.match(ui, /addEventListener\('mousedown'[\s\S]*?event\.preventDefault\(\)/);
  });
  it('el formulario se entera del cambio como siempre (input y change)', () => {
    assert.match(ui, /new Event\('input', \{ bubbles: true \}\)/);
    assert.match(ui, /new Event\('change', \{ bubbles: true \}\)/);
  });
  it('se puede dejar un campo con el del sistema', () => {
    assert.match(ui, /data-native-picker/);
  });
  it('las categorías llevan su dibujo; la hora, su cielo', () => {
    assert.match(ui, /select\.name === 'categoryId'[\s\S]*?categoryArt\(/);
    assert.match(ui, /skyArt\(nextPhase\)/);
  });
  it('estilos: todo el movimiento dentro de «sin reducir movimiento» y el reloj respeta «Imágenes en movimiento»', () => {
    const css = read('src/styles/components.css');
    const block = css.slice(css.indexOf('SELECTORES PROPIOS'));
    const motion = block.slice(block.indexOf('@media (prefers-reduced-motion: no-preference)'));
    assert.ok(!block.slice(0, block.indexOf('@media (prefers-reduced-motion: no-preference)')).includes('animation:'));
    assert.match(motion, /:root:not\(\[data-art-motion='off'\]\) \.tp__colon/);
    assert.match(block, /\.pk-hue-5 \{/);
  });
});
