// @ts-check
// =============================================================================
// TEXTOS DEL DIAGNÓSTICO Y DE LA VIABILIDAD DE METAS
// -----------------------------------------------------------------------------
// Convierte los números de `personalDiagnosis` y `goalFeasibility` (diagnosis.js) en lo que se lee
// en pantalla y en el reporte: título, nivel, cifra principal, una explicación en lenguaje llano, el
// detalle, la regla del nivel y lo que faltaría para llegar a «Bien». Aquí no se calcula nada nuevo:
// solo se dice con palabras lo que ya salió de las cuentas, para que la pantalla, las metas y el
// reporte digan exactamente lo mismo.
// =============================================================================

import { HEALTH_LEVEL_LABELS } from './company.js';
import { formatMonths } from './companyCards.js';
import { formatDate } from './dates.js';
import { DIAGNOSIS_THRESHOLDS, FEASIBILITY_LABELS } from './diagnosis.js';
import { formatMoney, formatPercent } from './money.js';

/** @typedef {ReturnType<typeof import('./diagnosis.js').personalDiagnosis>} Diagnosis */
/** @typedef {import('./diagnosis.js').GoalFeasibility} GoalFeasibility */
/** @typedef {import('./diagnosis.js').IndicatorId} IndicatorId */
/** @typedef {import('./company.js').HealthLevel} HealthLevel */

/**
 * @typedef {Object} DiagnosisCard
 * @property {IndicatorId} id
 * @property {string} title
 * @property {HealthLevel} level
 * @property {string} levelLabel
 * @property {string} value          La cifra principal («18%», «2.4 meses», «3 de 5»…); «—» si no se puede calcular.
 * @property {string} text           Qué significa, con los números de este espacio.
 * @property {string} hint           Lo que falta para llegar a «Bien» (vacío si ya está bien o no aplica).
 * @property {{ label: string, value: string }[]} details
 * @property {string} rule           La regla general con la que se asigna el nivel.
 * @property {{ route: string, label: string } | null} link  A dónde ir para actuar sobre este indicador.
 */

const $ = (/** @type {number} */ cents) => formatMoney(cents);

/**
 * «2 de tus 3 metas pendientes van al ritmo o caben», en singular y plural correctos.
 * @param {number} ok  Metas que van al ritmo o caben. @param {number} pending  Metas pendientes.
 */
function goalsSentence(ok, pending) {
  if (pending === 1) return ok === 1 ? 'Tu única meta pendiente va al ritmo o cabe' : 'Tu única meta pendiente no va al ritmo ni cabe';
  if (ok === 0) return `Ninguna de tus ${pending} metas pendientes va al ritmo ni cabe`;
  return `${ok} de tus ${pending} metas pendientes ${ok === 1 ? 'va' : 'van'} al ritmo o ${ok === 1 ? 'cabe' : 'caben'}`;
}

/**
 * De dónde salen las cifras del «mes típico».
 * @param {Pick<Diagnosis, 'hasData' | 'partial' | 'months'>} d
 */
export function diagnosisBaselineText(d) {
  if (!d.hasData) return 'Aún no hay movimientos para calcular un mes típico.';
  if (d.partial) return 'Solo hay datos del mes en curso, así que las cifras son parciales y cambiarán cuando termine el mes.';
  if (d.months === 1) return 'Mes típico: tu último mes completo con movimientos.';
  return `Mes típico: el promedio de tus últimos ${d.months} meses completos con movimientos.`;
}

/**
 * Una línea con cuántos indicadores hay en cada nivel.
 * @param {Pick<Diagnosis, 'counts' | 'indicators'>} d
 */
export function diagnosisSummaryText(d) {
  const { risk, watch, good, unknown } = d.counts;
  if (unknown === d.indicators.length) return 'Todavía no hay datos para hacer el diagnóstico.';
  /** @type {string[]} */
  const parts = [];
  if (risk > 0) parts.push(`${risk} en riesgo`);
  if (watch > 0) parts.push(`${watch} en atención`);
  if (good > 0) parts.push(`${good} bien`);
  if (unknown > 0) parts.push(`${unknown} sin datos`);
  return parts.join(' · ');
}

/**
 * Las tarjetas de los indicadores que aplican, en el orden fijo.
 * @param {Diagnosis} d
 * @returns {DiagnosisCard[]}
 */
export function diagnosisCards(d) {
  const T = DIAGNOSIS_THRESHOLDS;
  const income = d.baseline.incomeCents;
  const expense = d.baseline.expenseCents;
  const service = d.baseline.debtServiceCents;
  const capacity = d.capacityCents;
  const noData = 'Todavía no hay datos suficientes para calcularlo. Registra tus ingresos y gastos del mes.';

  return d.indicators.map((i) => {
    /** @type {DiagnosisCard} */
    const card = {
      id: i.id, title: '', level: i.level, levelLabel: HEALTH_LEVEL_LABELS[i.level],
      value: '—', text: noData, hint: '', details: [], rule: '', link: null,
    };

    if (i.id === 'savings') {
      card.title = 'Tasa de ahorro';
      card.rule = `${T.savings.good}% o más de tu ingreso = Bien; entre ${T.savings.watch}% y ${T.savings.good}% = Atención; menos de ${T.savings.watch}% = Riesgo.`;
      card.link = { route: 'finanzas', label: 'Ver mis finanzas' };
      if (d.hasData && capacity !== null) {
        card.details = [
          { label: 'Ingreso de un mes típico', value: $(income) },
          { label: 'Gastos de un mes típico (sin pagos de deudas)', value: $(expense) },
          { label: 'Cuotas de deudas al mes', value: $(service) },
          { label: 'Te quedan al mes', value: formatMoney(capacity, { sign: true }) },
        ];
        if (i.value === null) {
          card.text = `Un mes típico no tiene ingresos y salen ${$(expense + service)} (entre gastos y cuotas), así que no hay con qué ahorrar.`;
        } else {
          card.value = formatPercent(i.value);
          card.text = `En un mes típico entran ${$(income)} y salen ${$(expense)} en gastos${service > 0 ? ` y ${$(service)} en cuotas de deudas` : ''}. ${capacity >= 0
            ? `Te quedan ${$(capacity)} al mes: el ${formatPercent(i.value)} de tu ingreso.`
            : `Gastas ${$(-capacity)} más de lo que entra cada mes (${formatPercent(i.value)} de tu ingreso).`}`;
          if (i.gapCents) card.hint = `Para llegar a «Bien» (${T.savings.good}% de tu ingreso, ${$(Math.ceil((income * T.savings.good) / 100))} al mes) te faltan ${$(i.gapCents)} al mes: ganar más o gastar menos.`;
        }
      }
    } else if (i.id === 'emergency') {
      card.title = 'Colchón de emergencia';
      card.rule = `${T.emergency.good} meses o más de lo que sale cada mes = Bien; entre ${T.emergency.watch} y ${T.emergency.good} meses = Atención; menos de ${T.emergency.watch} = Riesgo.`;
      card.link = { route: 'metas', label: 'Ver mis metas' };
      if (i.value !== null) {
        card.value = formatMonths(i.value);
        card.details = [
          { label: 'Dinero disponible (sin lo apartado en metas)', value: $(d.cashCents) },
          { label: 'Sale cada mes (gastos + cuotas)', value: $(d.outflowCents) },
        ];
        card.text = `Tu dinero disponible (${$(d.cashCents)}) cubriría ${formatMonths(i.value)} de lo que sale cada mes (${$(d.outflowCents)}, entre gastos y cuotas). No cuenta lo que tienes apartado en metas ni tus activos: solo el dinero libre.`;
        if (i.gapCents) {
          card.hint = `Para llegar a «Bien» (${T.emergency.good} meses = ${$(T.emergency.good * d.outflowCents)}) te faltan ${$(i.gapCents)}. ${i.monthsToClose !== null
            ? `Con tu capacidad de ahorro de ${$(/** @type {number} */ (capacity))} al mes tardarías ${formatMonths(i.monthsToClose)} en juntarlos.`
            : 'Hoy tu capacidad de ahorro no es positiva, así que primero hay que liberar dinero cada mes.'}`;
        }
      } else if (d.hasData) {
        card.text = 'En un mes típico no salen gastos ni cuotas, así que no se puede medir cuántos meses cubre tu dinero.';
      }
    } else if (i.id === 'debtLoad') {
      card.title = 'Peso de las deudas';
      card.rule = `Las cuotas mensuales son ${T.debtService.good}% de tu ingreso o menos = Bien; hasta ${T.debtService.watch}% = Atención; más = Riesgo.`;
      card.link = { route: 'deudas', label: 'Ver mis deudas' };
      if (d.hasData) {
        card.details = [
          { label: 'Cuotas de deudas al mes', value: $(service) },
          { label: 'Ingreso de un mes típico', value: $(income) },
        ];
        if (i.value === null) {
          card.text = `Pagas ${$(service)} al mes en deudas y un mes típico no tiene ingresos: las cuotas pesan más de lo que entra.`;
        } else {
          card.value = formatPercent(i.value);
          card.text = `Entre todas tus deudas activas pagas ${$(service)} al mes: el ${formatPercent(i.value)} de tu ingreso de un mes típico (${$(income)}).`;
          if (i.gapCents) card.hint = `Para llegar a «Bien» (${T.debtService.good}% del ingreso) tus cuotas deberían bajar ${$(i.gapCents)} al mes: pagar parte de una deuda, renegociarla o ganar más.`;
        }
      } else {
        card.text = `Pagas ${$(service)} al mes en deudas, pero todavía no hay ingresos registrados para medir qué peso tienen.`;
      }
    } else if (i.id === 'lateDebts') {
      card.title = 'Cuotas vencidas';
      card.rule = 'Ninguna cuota vencida sin pagar = Bien; una o más = Riesgo.';
      card.link = { route: 'deudas', label: 'Ver mis deudas' };
      const n = i.value ?? 0;
      card.value = n === 0 ? 'Ninguna' : `${n}`;
      card.text = n === 0
        ? 'Estás al día: no tienes cuotas vencidas sin pagar.'
        : `Tienes ${n === 1 ? '1 cuota vencida' : `${n} cuotas vencidas`} sin pagar en ${d.lateDebtNames.join(', ')}. Los atrasos pueden generar recargos e intereses: ponerte al día es lo primero.`;
      if (n > 0) card.hint = 'Registra el pago de lo vencido (o ajusta la deuda si ya se pagó) para volver a «Bien».';
    } else if (i.id === 'goals') {
      const f = d.feasibility;
      const pending = f.goals.length;
      card.title = 'Metas';
      card.rule = 'Todas las metas pendientes van al ritmo o caben en tu capacidad de ahorro = Bien; al menos la mitad = Atención; menos de la mitad = Riesgo.';
      card.link = { route: 'metas', label: 'Ver mis metas' };
      card.value = i.level === 'unknown' ? '—' : `${i.value} de ${pending}`;
      card.details = [
        { label: 'Van al ritmo', value: `${f.counts['on-track']}` },
        { label: 'Viables con tu capacidad', value: `${f.counts.viable}` },
        { label: 'Ajustadas (llegarías más tarde)', value: `${f.counts.tight}` },
        { label: 'No alcanzan', value: `${f.counts.unreachable}` },
        { label: 'Vencidas', value: `${f.counts.overdue}` },
        { label: 'Sin datos para evaluarlas', value: `${f.counts.unknown}` },
        { label: 'Piden aportar al mes', value: $(f.totalNeededCents) },
        { label: 'Tu capacidad de ahorro al mes', value: capacity === null ? '—' : formatMoney(capacity) },
      ];
      card.text = i.level === 'unknown'
        ? `Tienes ${pending === 1 ? '1 meta pendiente' : `${pending} metas pendientes`}, pero todavía no hay un mes con movimientos para saber si caben en tu capacidad de ahorro.`
        : `${goalsSentence(i.value ?? 0, pending)} en tu capacidad de ahorro (${capacity === null ? '—' : $(capacity)} al mes, repartida por fecha entre todas).`;
      if (i.gapCents) card.hint = `Las metas piden aportar ${$(f.totalNeededCents)} al mes y tu capacidad de ahorro es ${$(Math.max(0, /** @type {number} */ (capacity)))}: faltan ${$(i.gapCents)} al mes. Abajo ves qué le pasa a cada una.`;
    } else {
      card.title = 'Patrimonio neto';
      card.rule = 'Mayor que cero (tienes más de lo que debes) = Bien; cero o menos = Atención.';
      card.link = { route: 'patrimonio', label: 'Ver mi patrimonio' };
      const nw = d.netWorth;
      card.value = $(nw.netWorthCents);
      card.details = [
        { label: 'Lo que tienes (dinero y activos)', value: $(nw.assetsCents) },
        { label: 'Lo que debes', value: $(nw.liabilitiesCents) },
      ];
      card.text = nw.netWorthCents > 0
        ? `Tienes ${$(nw.assetsCents)} entre dinero y activos y debes ${$(nw.liabilitiesCents)}: te quedan ${$(nw.netWorthCents)}.`
        : nw.netWorthCents === 0
          ? `Lo que tienes (${$(nw.assetsCents)}) es justo lo que debes.`
          : `Tienes ${$(nw.assetsCents)} entre dinero y activos y debes ${$(nw.liabilitiesCents)}: debes ${$(-nw.netWorthCents)} más de lo que tienes.`;
      if (nw.netWorthCents <= 0) card.hint = 'Para llegar a «Bien» hace falta tener más de lo que debes: bajar deudas o sumar dinero y activos.';
    }
    return card;
  });
}

/**
 * «Qué mirar primero»: los indicadores en riesgo o atención, del más urgente al menos, con lo que falta para «Bien».
 * @param {Diagnosis} d
 * @returns {{ id: IndicatorId, title: string, levelLabel: string, level: HealthLevel, text: string }[]}
 */
export function diagnosisPriorities(d) {
  const byId = new Map(diagnosisCards(d).map((c) => [c.id, c]));
  return d.priorities
    .filter((i) => i.level === 'risk' || i.level === 'watch')
    .map((i) => {
      const c = /** @type {DiagnosisCard} */ (byId.get(i.id));
      return { id: c.id, title: c.title, level: c.level, levelLabel: c.levelLabel, text: c.hint || c.text };
    });
}

/**
 * Cómo se lee la viabilidad de UNA meta, con los números de este espacio.
 * @param {GoalFeasibility} g
 * @param {number | null} capacityCents  La capacidad de ahorro del espacio (null si no hay datos).
 * @returns {{ status: import('./diagnosis.js').FeasibilityStatus, label: string, text: string }}
 */
export function feasibilityText(g, capacityCents) {
  const { status } = g;
  const label = FEASIBILITY_LABELS[status];
  const remaining = g.progress.remainingCents;
  /** @type {string} */
  let text;
  if (status === 'on-track') {
    text = `Con lo que aportas hoy (${$(g.paceCents)} al mes) la completarías ${g.paceDate ? `hacia el ${formatDate(g.paceDate)}` : 'a tiempo'}, antes de la fecha objetivo.`;
  } else if (status === 'viable') {
    text = `Necesitas aportar ${$(g.neededCents)} al mes y tu capacidad de ahorro lo cubre (le tocan ${$(g.allocatedCents)}, después de las metas que vencen antes).`;
  } else if (status === 'tight') {
    text = `Necesitas ${$(g.neededCents)} al mes pero solo le tocan ${$(g.allocatedCents)} de tu capacidad de ahorro: llegarías hacia el ${formatDate(/** @type {string} */ (g.suggestedDate))}, no el ${formatDate(g.goal.targetDate)}. Para llegar a tiempo faltan ${$(/** @type {number} */ (g.extraMonthlyCents))} al mes.`;
  } else if (status === 'unreachable') {
    text = g.allocatedCents > 0
      ? `Con los ${$(g.allocatedCents)} al mes que le tocan tardarías más de 100 años. Para llegar a tiempo necesitas ${$(g.neededCents)} al mes.`
      : `Necesitas ${$(g.neededCents)} al mes y ${capacityCents !== null && capacityCents > 0
        ? 'tu capacidad de ahorro ya se va en metas que vencen antes'
        : 'hoy no te sobra dinero cada mes'}. Para llegar a tiempo faltan ${$(/** @type {number} */ (g.extraMonthlyCents))} al mes.`;
  } else if (status === 'overdue') {
    text = g.progress.daysLeft === 0
      ? `La fecha objetivo es hoy y aún faltan ${$(remaining)}. Puedes aportar lo que falta o ampliar la fecha.`
      : `La fecha objetivo pasó y aún faltan ${$(remaining)}. Puedes ampliar la fecha o ajustar el monto editando la meta.`;
  } else {
    text = 'Todavía no hay un mes con movimientos para saber si cabe en tu capacidad de ahorro, y tus aportes actuales no alcanzan para llegar a tiempo.';
  }
  return { status, label, text };
}
