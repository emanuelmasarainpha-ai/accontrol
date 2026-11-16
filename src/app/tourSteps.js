// @ts-check
// =============================================================================
// RECORRIDO GUIADO: LOS PASOS DE CADA TIPO DE ESPACIO (un solo archivo de datos)
// -----------------------------------------------------------------------------
// Cada paso dice: a qué pantalla ir (`route`), qué elemento resaltar (`target`), el título y el texto de la
// tarjeta, y qué función de KIND_INFO[tipo].included explica (`covers`). Las pruebas comprueban que:
//   · cada pantalla existe y está disponible en ese tipo de espacio;
//   · cada elemento al que se apunta existe en el código (`data-tour="…"` o un enlace del menú);
//   · todo lo de `included` está explicado y nada de lo «próximamente» (`soon`) se presenta como si existiera.
//
// Es un recorrido con textos fijos: NO es inteligencia artificial. No usar «IA» ni «inteligente» en los textos.
//
// Cómo ampliarlo:
//   · Un paso nuevo: añadirlo a la lista del tipo y, si apunta a algo nuevo, poner `data-tour="nombre"` en ese
//     elemento de la pantalla.
//   · Roles (0.16): añadir a un paso `roles: ['dueño', …]` y filtrar en `stepsFor` según el rol de la cuenta.
//   · IA real (0.18): un paso nuevo que apunte a la pantalla de IA, SOLO cuando esa función exista de verdad.
// =============================================================================

/** @typedef {import('../domain/types.js').WorkspaceKind} WorkspaceKind */

/**
 * A qué elemento apunta un paso. Si hay varios, se resalta el PRIMERO que esté visible
 * (así un paso puede tener un plan B, por ejemplo cuando un panel solo aparece con datos).
 * @typedef {{ menu: string } | { mark: string } | { subtab: string }} TourTarget
 *   menu:   enlace del menú a esa pantalla (barra lateral en la computadora, barra de abajo o ícono de arriba en el celular)
 *   mark:   elemento con el atributo data-tour="…"
 *   subtab: pestaña de Finanzas que lleva a esa pantalla
 */

/**
 * @typedef {Object} TourStep
 * @property {string} id
 * @property {string} route          Pantalla a la que se navega antes de mostrar el paso.
 * @property {TourTarget[]} target   Elementos posibles, en orden de preferencia.
 * @property {string} title
 * @property {string} text           Explicación corta (máximo 220 caracteres).
 * @property {string[]} covers       Funciones de KIND_INFO[tipo].included que explica este paso.
 * @property {import('../ui/guide.js').GuideMood} [mood]  Expresión de Chele: 'wave' (saluda), 'point' (señala), 'happy' (contento).
 */

/**
 * Chele, el guía que dice el recorrido (0.14.4). Es un personaje con textos fijos: NO es IA.
 * Conduce el recorrido de los cuatro tipos de espacio y viste el color de cada uno (components.css, --kind).
 */
export const GUIDE = {
  name: 'Chele',
  /** @type {WorkspaceKind[]} */
  kinds: ['personal', 'freelancer', 'entrepreneur', 'company'],
};

/** Lo que dice Chele al llegar a cada tipo de espacio (con su color nuevo). */
const WELCOMES = {
  personal: {
    title: `¡Hola! Soy ${GUIDE.name}`,
    text: 'Soy el guía de ACCONTROL. En un par de minutos te enseño dónde está cada cosa de tu espacio Personal. Si luego quieres repasar, me llamas desde Ajustes.',
  },
  freelancer: {
    title: '¡Oh, ahora somos freelancers!',
    text: `Soy ${GUIDE.name} y me vestí de naranja para tu espacio Freelancer. Te enseño a llevar tus clientes, tus cobros y tus facturas sin perder un peso. ¿Vamos?`,
  },
  entrepreneur: {
    title: '¡A emprender se ha dicho!',
    text: `Soy ${GUIDE.name}, ahora en verde azulado para tu espacio Emprendedor. Te muestro si tu negocio gana dinero, tu inventario y tus facturas. ¡Esto va a estar bueno!`,
  },
  company: {
    title: '¡Modo empresa activado!',
    text: `Soy ${GUIDE.name}, de carmín y con la corbata bien puesta para tu espacio Empresa. Te enseño su salud financiera, los departamentos, el inventario y las facturas.`,
  },
};

/**
 * La bienvenida, dicha por Chele (distinta en cada tipo de espacio).
 * @param {WorkspaceKind} kind
 */
export function guideWelcome(kind) {
  const said = WELCOMES[kind] ?? WELCOMES.personal;
  return {
    title: said.title,
    text: said.text,
    mood: /** @type {const} */ ('wave'),
    startLabel: 'Empezar recorrido',
    skipLabel: 'Saltar, ya sé usar la app',
  };
}

/**
 * Copia de un paso con otros textos o con otras funciones explicadas (`covers`).
 * @param {TourStep} step @param {Partial<TourStep>} changes
 * @returns {TourStep}
 */
const variant = (step, changes) => ({ ...step, ...changes });

/** Pasos que se repiten en varios tipos de espacio. */
const COMMON = {
  /** @type {TourStep} */
  home: {
    id: 'home',
    route: 'inicio',
    target: [{ menu: 'inicio' }],
    title: 'Inicio: tu resumen',
    mood: 'point',
    text: 'Esta es tu pantalla de Inicio. De un vistazo ves lo que tienes, cómo va el mes, tus metas, tus próximos pagos y tus avisos.',
    covers: [],
  },
  /** @type {TourStep} */
  available: {
    id: 'available',
    route: 'inicio',
    target: [{ mark: 'home-available' }],
    title: 'Disponible',
    mood: 'point',
    text: 'Mira: esto es lo que tienes disponible. Es tu saldo inicial más lo que entra, menos lo que gastas y lo que apartas en metas. Con estos botones anotas un ingreso o un gasto.',
    covers: [],
  },
  /** @type {TourStep} */
  add: {
    id: 'add',
    route: 'inicio',
    target: [{ mark: 'add' }],
    title: 'Añadir rápido',
    mood: 'point',
    text: 'Este botón te acompaña en todas las pantallas. Tócalo para anotar un ingreso, un gasto, un aporte a una meta, una deuda o algo de tu patrimonio.',
    covers: [],
  },
  /** @type {TourStep} */
  finances: {
    id: 'finances',
    route: 'finanzas',
    target: [{ menu: 'finanzas' }],
    title: 'Finanzas: tus movimientos',
    mood: 'point',
    text: 'Aquí está todo lo que entra y sale, mes por mes. Filtra, busca y toca un movimiento para corregirlo o borrarlo. ¡Orden total!',
    covers: [],
  },
  /** @type {TourStep} */
  debts: {
    id: 'debts',
    route: 'finanzas',
    target: [{ subtab: 'deudas' }],
    title: 'Deudas',
    mood: 'point',
    text: 'Tus préstamos y tarjetas, con su tasa y sus fechas. Te muestro cada cuota, la tabla de pagos y el nivel de riesgo. Ojo: las cuotas son estimaciones.',
    covers: [],
  },
  /** @type {TourStep} */
  netWorth: {
    id: 'net-worth',
    route: 'finanzas',
    target: [{ subtab: 'patrimonio' }],
    title: 'Patrimonio neto',
    mood: 'point',
    text: 'Lo que tienes menos lo que debes, y cómo cambia mes a mes. ¡Verlo crecer da gusto! El valor de tus bienes lo pones tú.',
    covers: [],
  },
  /** @type {TourStep} */
  goals: {
    id: 'goals',
    route: 'metas',
    target: [{ menu: 'metas' }],
    title: 'Metas de ahorro',
    mood: 'point',
    text: '¡Mi parte favorita! Crea una meta con su monto y su fecha, y te digo cuánto llevas, cuánto falta y cuánto aportar al mes para llegar a tiempo.',
    covers: [],
  },
  /** @type {TourStep} */
  stats: {
    id: 'stats',
    route: 'estadisticas',
    target: [{ menu: 'estadisticas' }],
    title: 'Estadísticas',
    mood: 'point',
    text: 'Tus números en gráficos por mes, trimestre y año. Desde aquí también exportas a PDF, Excel y CSV para guardarlos o compartirlos.',
    covers: [],
  },
  /** @type {TourStep} */
  diagnosis: {
    id: 'diagnosis',
    route: 'estadisticas',
    target: [{ mark: 'stats-diagnosis' }],
    title: 'Diagnóstico financiero',
    mood: 'point',
    text: 'Un chequeo de salud para tu dinero: ahorro, colchón de emergencia, deudas y si cada meta cabe. Uso reglas fijas: te orienta, no es asesoría.',
    covers: [],
  },
  /** @type {TourStep} */
  calculators: {
    id: 'calculators',
    route: 'estadisticas',
    target: [{ mark: 'stats-calculators' }],
    title: 'Calculadoras',
    mood: 'point',
    text: '¿Y si pido un préstamo? ¿Cuánto crece mi ahorro? Juega con las calculadoras: son simulaciones para aprender, no predicciones.',
    covers: [],
  },
  /** @type {TourStep} */
  achievements: {
    id: 'achievements',
    route: 'logros',
    target: [{ mark: 'achievements' }],
    title: 'Logros, rachas y niveles',
    mood: 'point',
    text: 'Cuando registras con constancia ganas puntos, rachas y logros. Ojo: la demostración no cuenta, aquí solo valen tus datos reales.',
    covers: ['Logros, rachas y niveles'],
  },
  /** @type {TourStep} */
  settings: {
    id: 'settings',
    route: 'ajustes',
    target: [{ menu: 'ajustes' }],
    title: 'Ajustes',
    mood: 'point',
    text: 'Tu perfil, tus categorías, tu cuenta y la demostración. Y si un día quieres repasar conmigo, me llamas desde aquí.',
    covers: [],
  },
  /** @type {TourStep} */
  organization: {
    id: 'organization',
    route: 'ajustes',
    target: [{ mark: 'settings-organization' }],
    title: 'Datos para tus reportes',
    mood: 'point',
    text: 'Pon aquí el nombre, el RNC, el teléfono y la dirección: salen en el encabezado de tus reportes en PDF y Excel.',
    covers: [],
  },
  /** @type {TourStep} */
  backup: {
    id: 'backup',
    route: 'ajustes',
    target: [{ mark: 'settings-backup' }],
    title: 'Copia de seguridad',
    mood: 'point',
    text: 'Importante: tus datos viven en este dispositivo (y en la nube si activas la copia en la nube, aquí en Ajustes). Exporta una copia de vez en cuando para no perderlos y para pasarlos a otro equipo.',
    covers: [],
  },
  /** @type {TourStep} */
  workspaces: {
    id: 'workspaces',
    route: 'ajustes',
    target: [{ mark: 'workspace-switch' }],
    title: 'Tus espacios',
    mood: 'happy',
    text: 'Aquí cambias de espacio o creas otro; cada uno guarda lo suyo aparte. ¡Y listo, ya conoces tu espacio! Si quieres repasar, aquí estaré.',
    covers: [],
  },
};

/** Pestañas de Finanzas propias de los negocios. */
const BUSINESS = {
  /** @type {TourStep} */
  results: {
    id: 'results',
    route: 'finanzas',
    target: [{ subtab: 'resultados' }],
    title: 'Resultados',
    mood: 'point',
    text: 'El estado de resultados de tu negocio: beneficio, margen y rentabilidad, comparados con el mes y el año anteriores. La proyección es una estimación.',
    covers: [],
  },
  /** @type {TourStep} */
  inventory: {
    id: 'inventory',
    route: 'finanzas',
    target: [{ subtab: 'inventario' }],
    title: 'Inventario',
    mood: 'point',
    text: 'Tus productos y proveedores. Cada compra suma stock y cada venta lo resta: verás cuánto vale lo que tienes, el margen de cada producto y qué se agota.',
    covers: [],
  },
  /** @type {TourStep} */
  invoices: {
    id: 'invoices',
    route: 'finanzas',
    target: [{ subtab: 'facturas' }],
    title: 'Facturas',
    mood: 'point',
    text: 'Facturas internas con varias líneas e impuesto. Registra cobros parciales, mira quién te debe y copia un recordatorio para las vencidas: lo envías tú.',
    covers: [],
  },
};

/**
 * Los recorridos. Un tipo de espacio sin lista todavía no tiene recorrido (no se ofrece).
 * @type {Partial<Record<WorkspaceKind, TourStep[]>>}
 */
export const TOURS = {
  personal: [
    variant(COMMON.home, {
      text: 'Esta es tu pantalla de Inicio. De un vistazo ves lo que tienes, cómo va el mes, tus metas, tus próximos pagos y tus avisos.',
      mood: 'point',
    }),
    variant(COMMON.available, {
      text: 'Mira: esto es lo que tienes disponible. Es tu saldo inicial más lo que entra, menos lo que gastas y lo que apartas en metas. Con estos botones anotas un ingreso o un gasto.',
      covers: ['Ingresos y gastos'],
      mood: 'point',
    }),
    variant(COMMON.add, {
      text: 'Este botón te acompaña en todas las pantallas. Tócalo para anotar un ingreso, un gasto, un aporte a una meta, una deuda o algo de tu patrimonio.',
      mood: 'point',
    }),
    {
      id: 'budget',
      route: 'inicio',
      // El panel de presupuesto aparece cuando ya hay movimientos; si todavía no, se señala «Disponible».
      target: [{ mark: 'home-budget' }, { mark: 'home-available' }],
      title: 'Presupuesto',
      mood: 'point',
      text: 'Cuando anotes movimientos, aquí verás cuánto del mes ya está comprometido en cuotas y cuánto te quedaría libre. Es una estimación.',
      covers: ['Presupuesto'],
    },
    variant(COMMON.finances, { covers: ['Ingresos y gastos'] }),
    variant(COMMON.debts, { covers: ['Deudas'] }),
    variant(COMMON.netWorth, { covers: ['Patrimonio neto'] }),
    variant(COMMON.goals, { covers: ['Metas de ahorro'] }),
    variant(COMMON.stats, { covers: ['Estadísticas y calculadoras'] }),
    variant(COMMON.diagnosis, { covers: ['Diagnóstico financiero y viabilidad de cada meta'] }),
    variant(COMMON.calculators, { covers: ['Estadísticas y calculadoras'] }),
    COMMON.achievements,
    COMMON.settings,
    COMMON.backup,
    COMMON.workspaces,
  ],

  freelancer: [
    variant(COMMON.home, { text: 'Tu centro de mando freelance: lo disponible, lo cobrado del mes, quién te debe y tus mejores clientes, todo de un vistazo.' }),
    variant(COMMON.available, { covers: ['Ingresos y gastos profesionales'] }),
    COMMON.add,
    variant(COMMON.finances, {
      text: 'Tus ingresos y gastos profesionales, mes por mes. Truco: al anotar un cobro, elige su cliente y así sabrás quién te paga de verdad.',
      covers: ['Ingresos y gastos profesionales'],
    }),
    {
      id: 'clients',
      route: 'finanzas',
      target: [{ subtab: 'clientes' }],
      title: 'Clientes',
      mood: 'point',
      text: '¡Aquí viven tus clientes! Cada uno con sus servicios, lo que te ha pagado y lo que todavía te debe.',
      covers: ['Clientes y servicios, con lo cobrado y lo que te deben'],
    },
    {
      id: 'clients-new',
      route: 'clientes',
      target: [{ mark: 'clients-new' }],
      title: 'Quién te paga más',
      mood: 'point',
      text: 'Con tus cobros armo el ranking de clientes y tu flujo de caja. Cárgale a cada cliente sus gastos y sabrás cuánto te deja de verdad.',
      covers: ['Ranking de clientes y flujo de caja', 'Gastos cargados a cada cliente: cuánto te deja de verdad'],
    },
    variant(BUSINESS.invoices, {
      text: 'Factúrale a un cliente con varias líneas, impuesto y vencimiento; cada línea puede facturar un servicio suyo. Registra cobros parciales y, si una vence, copia un recordatorio y envíalo tú.',
      covers: ['Facturas internas a tus clientes, ligadas a sus servicios, con cobros parciales y PDF', 'Recordatorio de cobro listo para copiar y enviar tú'],
    }),
    COMMON.debts,
    COMMON.netWorth,
    variant(COMMON.goals, { covers: ['Diagnóstico financiero y viabilidad de cada meta'] }),
    variant(COMMON.stats, { covers: ['Estadísticas y calculadoras', 'Exportar a PDF, Excel y CSV'] }),
    variant(COMMON.diagnosis, { covers: ['Diagnóstico financiero y viabilidad de cada meta'] }),
    variant(COMMON.calculators, { covers: ['Estadísticas y calculadoras'] }),
    COMMON.achievements,
    COMMON.settings,
    variant(COMMON.organization, {
      title: 'Tus datos profesionales',
      mood: 'point',
      text: 'Tus datos profesionales: nombre, RNC, teléfono y dirección. Salen en el encabezado de tus reportes y le dan un toque pro a todo.',
      covers: ['Datos profesionales en los reportes'],
    }),
    COMMON.backup,
    COMMON.workspaces,
  ],

  entrepreneur: [
    variant(COMMON.home, { text: 'Tu negocio de un vistazo: lo disponible, el beneficio del mes, el inventario y lo que te deben. ¡Así se lleva un negocio!' }),
    variant(COMMON.available, { covers: ['Ingresos y gastos del negocio, separados de los personales'] }),
    COMMON.add,
    variant(COMMON.finances, {
      text: 'Los ingresos y gastos de tu negocio, separados de los personales: cada espacio guarda lo suyo. Con filtro y búsqueda.',
      covers: ['Ingresos y gastos del negocio, separados de los personales'],
    }),
    variant(BUSINESS.results, {
      covers: ['Estado de resultados con beneficio, margen y rentabilidad', 'Comparación con el mes anterior y el año anterior', 'Proyección de ingresos, gastos y beneficio'],
    }),
    variant(BUSINESS.inventory, {
      covers: ['Inventario: productos, stock, proveedores, compras y ventas', 'Margen por producto y avisos de stock bajo'],
    }),
    variant(BUSINESS.invoices, { covers: ['Facturas internas con cobros parciales, cuentas por cobrar y PDF de cada factura', 'Recordatorio de cobro listo para copiar y enviar tú'] }),
    COMMON.debts,
    COMMON.netWorth,
    variant(COMMON.goals, { covers: ['Diagnóstico financiero y viabilidad de cada meta'] }),
    variant(COMMON.stats, { covers: ['Estadísticas y calculadoras', 'Exportar a PDF, Excel y CSV'] }),
    variant(COMMON.diagnosis, { covers: ['Diagnóstico financiero y viabilidad de cada meta'] }),
    variant(COMMON.calculators, { covers: ['Estadísticas y calculadoras'] }),
    COMMON.achievements,
    COMMON.settings,
    variant(COMMON.organization, {
      title: 'Los datos de tu negocio',
      mood: 'point',
      text: 'Los datos de tu negocio: nombre, RNC, teléfono y dirección. Salen en el encabezado de tus reportes y de tus facturas en PDF.',
      covers: ['Datos del negocio en los reportes'],
    }),
    COMMON.backup,
    COMMON.workspaces,
  ],

  company: [
    variant(COMMON.home, { text: 'Tu empresa de un vistazo: lo disponible, el beneficio del mes, su salud financiera, el inventario y lo que te deben.' }),
    variant(COMMON.available, { covers: ['Ingresos y gastos del espacio'] }),
    COMMON.add,
    variant(COMMON.finances, {
      text: 'Los ingresos y gastos de tu empresa, con filtro y búsqueda. Cada gasto se puede cargar a un departamento para saber a dónde va el dinero.',
      covers: ['Ingresos y gastos del espacio'],
    }),
    variant(BUSINESS.results, { covers: ['Estado de resultados, comparación y proyección'] }),
    {
      id: 'health',
      route: 'finanzas',
      target: [{ subtab: 'salud' }],
      title: 'Salud financiera',
      mood: 'point',
      text: '¿Cuánto necesitas vender para cubrir tus gastos? ¿Cuántos meses aguanta tu efectivo? ¿Cuánto pesa la deuda? Aquí lo ves, con reglas fijas.',
      covers: ['Salud financiera: punto de equilibrio, meses de efectivo y peso de la deuda'],
    },
    {
      id: 'departments',
      route: 'finanzas',
      target: [{ subtab: 'departamentos' }],
      title: 'Departamentos',
      mood: 'point',
      text: 'Crea las áreas de tu empresa con un presupuesto mensual. Te aviso si cada una va «En orden», «Cerca del límite» o «Excedido».',
      covers: ['Departamentos con presupuesto mensual y gastos por área'],
    },
    variant(BUSINESS.inventory, { covers: ['Inventario: productos, stock, proveedores, compras y ventas'] }),
    variant(BUSINESS.invoices, { covers: ['Facturas internas con cobros parciales, cuentas por cobrar y PDF de cada factura', 'Recordatorio de cobro listo para copiar y enviar tú'] }),
    COMMON.debts,
    COMMON.netWorth,
    variant(COMMON.goals, {
      text: 'Metas de ahorro de la empresa con monto y fecha. Te digo cuánto llevas, cuánto aportar al mes y si la meta cabe en lo que le sobra a la empresa.',
      covers: ['Viabilidad de cada meta de ahorro'],
    }),
    variant(COMMON.stats, { covers: ['Estadísticas y exportación'] }),
    COMMON.calculators,
    COMMON.achievements,
    COMMON.settings,
    variant(COMMON.organization, {
      title: 'Los datos de tu organización',
      mood: 'point',
      text: 'Los datos de tu organización: nombre, RNC, teléfono y dirección. Salen en el encabezado de tus reportes y de tus facturas en PDF.',
      covers: ['Datos de la organización en los reportes'],
    }),
    COMMON.backup,
    COMMON.workspaces,
  ],
};

/**
 * Pasos del recorrido de un tipo de espacio (lista vacía si todavía no tiene).
 * @param {WorkspaceKind | null | undefined} kind
 * @returns {TourStep[]}
 */
export function stepsFor(kind) {
  return (kind && TOURS[kind]) || [];
}

/** @param {WorkspaceKind | null | undefined} kind */
export function hasTour(kind) {
  return stepsFor(kind).length > 0;
}

/** @param {string} value  Para usar dentro de un selector entre comillas. */
const quote = (value) => value.replace(/["\\]/g, '\\$&');

/**
 * Selectores CSS de un paso, en orden de preferencia. El motor resalta el primero que esté visible.
 * @param {TourTarget[]} targets
 * @returns {string[]}
 */
export function selectorsFor(targets) {
  return targets.map((t) => {
    if ('menu' in t) return `a[data-route="${quote(t.menu)}"]`;
    if ('subtab' in t) return `.subtabs a[href="#/${quote(t.subtab)}"]`;
    return `[data-tour="${quote(t.mark)}"]`;
  });
}
