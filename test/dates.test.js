import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, addMonthsToDate, calendarDiff, daysBetween, describeTimeLeft, formatDate, formatDateLong,
  greetingFor, isValidISODate, isValidTime, monthKeysEndingAt, monthLabel, monthShortLabel, todayISO,
} from '../src/domain/dates.js';

test('isValidISODate: solo fechas reales', () => {
  assert.ok(isValidISODate('2026-07-05'));
  assert.ok(isValidISODate('2028-02-29')); // bisiesto
  assert.ok(!isValidISODate('2027-02-29'));
  assert.ok(!isValidISODate('2026-02-30'));
  assert.ok(!isValidISODate('2026-13-01'));
  assert.ok(!isValidISODate('2026-7-5'));
  assert.ok(!isValidISODate(''));
  assert.ok(!isValidISODate(null));
});

test('isValidTime', () => {
  assert.ok(isValidTime('00:00'));
  assert.ok(isValidTime('23:59'));
  assert.ok(!isValidTime('24:00'));
  assert.ok(!isValidTime('9:05'));
  assert.ok(!isValidTime('12:60'));
});

test('todayISO usa la hora LOCAL (no UTC)', () => {
  // 23:30 hora local del 5 de julio debe seguir siendo 5 de julio.
  assert.equal(todayISO(new Date(2026, 6, 5, 23, 30)), '2026-07-05');
  assert.equal(todayISO(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('addMonths y monthKeysEndingAt cruzan años', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-07', 0), '2026-07');
  assert.deepEqual(monthKeysEndingAt('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('etiquetas de mes y fecha', () => {
  assert.equal(monthLabel('2026-07'), 'julio 2026');
  assert.equal(monthShortLabel('2026-07'), 'jul');
  assert.equal(monthShortLabel('2027-01'), 'ene 27');
  assert.equal(formatDate('2026-07-05'), '5 jul 2026');
  assert.equal(formatDateLong('2026-10-25'), 'domingo 25 de octubre');
});

test('daysBetween y addMonthsToDate', () => {
  assert.equal(daysBetween('2026-07-05', '2026-07-06'), 1);
  assert.equal(daysBetween('2026-07-05', '2026-07-05'), 0);
  assert.equal(daysBetween('2026-07-10', '2026-07-05'), -5);
  assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.equal(addMonthsToDate('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsToDate('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonthsToDate('2026-11-15', 3), '2027-02-15');
});

test('calendarDiff y describeTimeLeft', () => {
  assert.deepEqual(calendarDiff('2026-01-15', '2026-04-27'), { months: 3, days: 12 });
  assert.deepEqual(calendarDiff('2026-01-31', '2026-03-01'), { months: 1, days: 1 });
  assert.equal(describeTimeLeft('2026-01-15', '2026-04-27'), 'Quedan 3 meses y 12 días');
  assert.equal(describeTimeLeft('2026-01-15', '2026-01-16'), 'Queda 1 día');
  assert.equal(describeTimeLeft('2026-01-15', '2026-02-15'), 'Queda 1 mes');
  assert.equal(describeTimeLeft('2026-01-15', '2026-01-15'), 'Vence hoy');
  assert.equal(describeTimeLeft('2026-01-20', '2026-01-15'), 'Venció hace 5 días');
  assert.equal(describeTimeLeft('2026-01-16', '2026-01-15'), 'Venció hace 1 día');
});

test('greetingFor', () => {
  assert.equal(greetingFor(4), 'Buenas noches');
  assert.equal(greetingFor(5), 'Buenos días');
  assert.equal(greetingFor(11), 'Buenos días');
  assert.equal(greetingFor(12), 'Buenas tardes');
  assert.equal(greetingFor(18), 'Buenas tardes');
  assert.equal(greetingFor(19), 'Buenas noches');
  assert.equal(greetingFor(0), 'Buenas noches');
});
