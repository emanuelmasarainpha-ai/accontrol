// @ts-check
// =============================================================================
// TEXTOS DE LA SALUD FINANCIERA
// -----------------------------------------------------------------------------
// Convierte los números de `companyHealth` (company.js) en las cinco tarjetas que se
// leen en pantalla y en el reporte: título, nivel, cifra principal, una explicación en
// lenguaje llano y el detalle. Aquí no se calcula nada: solo se dice con palabras lo
// que ya salió de las cuentas, para que la pantalla y el reporte digan lo mismo.
// =============================================================================

import { HEALTH_LEVEL_LABELS, HEALTH_THRESHOLDS } from './company.js';
import { formatMoney, formatPercent } from './money.js';

/** @typedef {import('./company.js').CompanyHealth} CompanyHealth */
/** @typedef {import('./company.js').HealthLevel} HealthLevel */

/**
 * @typedef {Object} HealthCard
 * @property {'breakEven' | 'runway' | 'leverage' | 'debtService' | 'obligations'} id
 * @property {string} title
 * @property {HealthLevel} level
 * @property {string} levelLabel
 * @property {string} value          La cifra principal («RD$ 47,142.86 al mes», «1.8 meses», «10.5 %»…).
 * @property {string} text           Qué significa, con los números de este espacio.
 * @property {{ label: string, value: string }[]} details
 * @property {string} rule           La regla general con la que se asigna el nivel.
 */

/** «1.8 meses», «1.0 mes», «menos de 1 mes». @param {number} months */
export function formatMonths(months) {
  if (months < 1) return 'menos de 1 mes';
  const rounded = Math.round(months * 10) / 10;
  return rounded === 1 ? '1.0 mes' : `${rounded.toFixed(1)} meses`;
}

/**
 * Las cinco tarjetas de salud de la empresa.
 * @param {CompanyHealth} h
 * @returns {HealthCard[]}
 */
export function healthCards(h) {
  const $ = (/** @type {number} */ cents) => formatMoney(cents);
  const T = HEALTH_THRESHOLDS;
  /** @param {HealthCard['id']} id @returns {{ level: HealthLevel, levelLabel: string }} */
  const lv = (id) => ({ level: h.levels[id], levelLabel: HEALTH_LEVEL_LABELS[h.levels[id]] });
  const noData = 'Todavía no hay datos suficientes para calcularlo.';

  // ---- 1. Punto de equilibrio ----------------------------------------------------------------------------------
  const be = h.breakEven;
  /** @type {HealthCard} */
  const breakEven = {
    id: 'breakEven',
    title: 'Punto de equilibrio',
    ...lv('breakEven'),
    value: '—',
    text: noData,
    details: [],
    rule: `Margen de seguridad (con cuotas de deuda): ${T.safety.good}% o más = Bien; entre ${T.safety.watch}% y ${T.safety.good}% = Atención; menos = Riesgo.`,
  };
  if (be.ok && be.withDebtCents !== null && be.operatingCents !== null && be.safetyPercent !== null && be.contributionPercent !== null) {
    const debt = h.baseline.debtServiceCents;
    const safety = be.safetyPercent;
    breakEven.value = `${$(be.withDebtCents)} al mes`;
    if (be.withDebtCents === 0) {
      // Sin costos fijos ni cuotas, el equilibrio es cero: se dice claro y se invita a clasificar los gastos que se repiten.
      breakEven.text = `No tienes costos fijos ni cuotas de deuda registrados, así que el punto de equilibrio es ${$(0)}: cualquier ingreso por encima de tus costos variables ya es ganancia. Si tienes gastos que se repiten (alquiler, nómina, servicios), clasifícalos como «Fijo» para que este número sea útil.`;
    } else {
      breakEven.text =
        `Con tus costos fijos (${$(h.baseline.fixedCents)} al mes)${debt > 0 ? ` y tus cuotas de deuda (${$(debt)} al mes)` : ''} necesitas ingresar al menos ${$(be.withDebtCents)} al mes para no perder dinero. ` +
        (safety >= 0
          ? `Un mes típico trae ${$(h.baseline.incomeCents)}: tus ingresos podrían bajar un ${formatPercent(safety)} antes de llegar a ese punto.`
          : `Un mes típico trae ${$(h.baseline.incomeCents)}, que está ${$(be.withDebtCents - h.baseline.incomeCents)} por debajo: con esos costos, hoy se pierde dinero.`);
    }
    breakEven.details = [
      { label: 'Ingreso de un mes típico', value: $(h.baseline.incomeCents) },
      { label: 'Costos fijos (fijos y discrecionales)', value: $(h.baseline.fixedCents) },
      { label: 'Costos variables', value: $(h.baseline.variableCents) },
      { label: 'Margen de contribución', value: formatPercent(be.contributionPercent) },
      { label: 'Equilibrio sin contar deudas', value: $(be.operatingCents) },
      { label: 'Margen de seguridad', value: formatPercent(safety) },
    ];
  } else if (be.reason === 'no-income') {
    breakEven.text = 'Un mes típico todavía no tiene ingresos, así que no se puede calcular el punto de equilibrio.';
  } else if (be.reason === 'no-margin') {
    breakEven.value = 'Sin margen';
    breakEven.text = `Tus costos variables (${$(h.baseline.variableCents)}) ya se comen todo lo que ingresa (${$(h.baseline.incomeCents)}): por mucho que vendas, no alcanza para pagar los costos fijos. Revisa tus precios o tus costos variables.`;
  }

  // ---- 2. Meses de efectivo ------------------------------------------------------------------------------------
  const r = h.runway;
  /** @type {HealthCard} */
  const runway = {
    id: 'runway',
    title: 'Meses de efectivo',
    ...lv('runway'),
    value: '—',
    text: noData,
    details: [],
    rule: `${T.runway.good} meses o más = Bien. Menos de 1 mes = Riesgo. Entre 1 y ${T.runway.good} meses depende de si el negocio gana o pierde cada mes (si pierde, es peor).`,
  };
  if (r.coverageMonths !== null) {
    runway.value = formatMonths(r.coverageMonths);
    runway.text =
      `Tu dinero disponible (${$(r.cashCents)}) cubre ${formatMonths(r.coverageMonths)} de lo que sale cada mes (${$(r.monthlyOutflowCents)}, entre costos y cuotas). ` +
      (r.burnMonths !== null
        ? `En un mes típico sale más de lo que entra (${$(-r.monthlyNetCents)} de diferencia): al ritmo actual el efectivo duraría ${formatMonths(r.burnMonths)}.`
        : 'En un mes típico no sale más de lo que entra, así que el efectivo no se agota al ritmo actual.');
    runway.details = [
      { label: 'Dinero disponible', value: $(r.cashCents) },
      { label: 'Sale cada mes (costos + cuotas)', value: $(r.monthlyOutflowCents) },
      { label: 'Resultado de un mes típico', value: formatMoney(r.monthlyNetCents, { sign: true }) },
    ];
  } else if (h.hasData) {
    runway.text = 'Todavía no hay gastos en un mes típico para medir cuánto cubre tu efectivo.';
  }

  // ---- 3. Deuda sobre activos ----------------------------------------------------------------------------------
  const lg = h.leverage;
  /** @type {HealthCard} */
  const leverage = {
    id: 'leverage',
    title: 'Deuda sobre activos',
    ...lv('leverage'),
    value: lg.debtToAssetsPercent === null ? 'Sin base' : formatPercent(lg.debtToAssetsPercent),
    text: noData,
    details: [
      { label: 'Lo que debes', value: $(lg.liabilitiesCents) },
      { label: 'Lo que tienes (dinero y activos registrados)', value: $(lg.assetsCents) },
    ],
    rule: `${T.leverage.good}% o menos = Bien; hasta ${T.leverage.watch}% = Atención; más = Riesgo.`,
  };
  if (h.levels.leverage !== 'unknown') {
    leverage.text =
      lg.liabilitiesCents === 0
        ? 'No tienes deudas activas.'
        : lg.debtToAssetsPercent === null
          ? `Debes ${$(lg.liabilitiesCents)} y tu dinero y activos registrados no alcanzan para compararlos (${$(lg.assetsCents)}): debes más de lo que tienes registrado.`
          : `Debes ${$(lg.liabilitiesCents)} y tienes ${$(lg.assetsCents)} entre dinero y activos registrados: tu deuda es el ${formatPercent(lg.debtToAssetsPercent)} de lo que tienes.`;
  }

  // ---- 4. Peso de las cuotas -----------------------------------------------------------------------------------
  const dl = h.debtLoad;
  /** @type {HealthCard} */
  const debtService = {
    id: 'debtService',
    title: 'Peso de las cuotas',
    ...lv('debtService'),
    value: dl.percentOfIncome === null ? 'Sin base' : formatPercent(dl.percentOfIncome),
    text: noData,
    details: [
      { label: 'Cuotas de deuda al mes', value: $(dl.monthlyServiceCents) },
      { label: 'Ingreso de un mes típico', value: $(h.baseline.incomeCents) },
    ],
    rule: `${T.debtService.good}% de los ingresos o menos = Bien; hasta ${T.debtService.watch}% = Atención; más = Riesgo.`,
  };
  if (h.levels.debtService !== 'unknown') {
    debtService.text =
      dl.monthlyServiceCents === 0
        ? 'No tienes cuotas de deuda por pagar.'
        : dl.percentOfIncome === null
          ? `Tus cuotas suman ${$(dl.monthlyServiceCents)} al mes y un mes típico no tiene ingresos con qué compararlas.`
          : `Tus cuotas suman ${$(dl.monthlyServiceCents)} al mes: el ${formatPercent(dl.percentOfIncome)} de lo que ingresa en un mes típico (${$(h.baseline.incomeCents)}).`;
  }

  // ---- 5. Cuotas a 30 días -------------------------------------------------------------------------------------
  const ob = h.obligations;
  /** @type {HealthCard} */
  const obligations = {
    id: 'obligations',
    title: 'Cuotas a 30 días',
    ...lv('obligations'),
    value: ob.count === 0 ? 'Nada por vencer' : $(ob.dueCents),
    text: noData,
    details: [
      { label: 'Cuotas vencidas sin pagar', value: $(ob.overdueCents) },
      { label: 'Total a pagar (vencido y próximos 30 días)', value: $(ob.dueCents) },
      { label: 'Dinero disponible', value: $(r.cashCents) },
      { label: ob.coverCents >= 0 ? 'Sobra después de pagarlas' : 'Falta para pagarlas', value: $(Math.abs(ob.coverCents)) },
    ],
    rule: 'Bien: tu dinero disponible cubre al menos el doble de lo que vence. Atención: lo cubre, pero con menos holgura. Riesgo: no lo cubre.',
  };
  if (h.levels.obligations !== 'unknown') {
    obligations.text =
      ob.count === 0
        ? 'No hay cuotas vencidas ni por vencer en los próximos 30 días.'
        : `Hay ${ob.count === 1 ? '1 cuota' : `${ob.count} cuotas`} por ${$(ob.dueCents)}${ob.overdueCents > 0 ? ` (${$(ob.overdueCents)} ya vencidas)` : ''} entre lo vencido y los próximos 30 días. ` +
          (ob.coverCents >= 0
            ? `Tu dinero disponible (${$(r.cashCents)}) alcanza y sobran ${$(ob.coverCents)}.`
            : `Tu dinero disponible (${$(r.cashCents)}) no alcanza: faltan ${$(-ob.coverCents)}.`);
  }
  if (ob.count === 0) obligations.details = [{ label: 'Dinero disponible', value: $(r.cashCents) }];

  return [breakEven, runway, leverage, debtService, obligations];
}

/**
 * Una línea que resume cuántos indicadores están en cada nivel.
 * @param {CompanyHealth} h
 */
export function healthSummaryText(h) {
  const { risk, watch, good, unknown } = h.counts;
  if (unknown === 5) return 'Todavía no hay datos para evaluar la empresa.';
  const parts = [];
  if (risk > 0) parts.push(`${risk} en riesgo`);
  if (watch > 0) parts.push(`${watch} en atención`);
  if (good > 0) parts.push(`${good} bien`);
  if (unknown > 0) parts.push(`${unknown} sin datos`);
  return parts.join(' · ');
}

/**
 * De dónde salen las cifras del «mes típico».
 * @param {CompanyHealth} h
 */
export function baselineText(h) {
  if (!h.hasData) return 'Aún no hay movimientos para calcular un mes típico.';
  if (h.partial) return 'Solo hay datos del mes en curso, así que las cifras son parciales y cambiarán cuando termine el mes.';
  if (h.months === 1) return 'Mes típico: tu último mes completo con movimientos.';
  return `Mes típico: el promedio de tus últimos ${h.months} meses completos con movimientos.`;
}
