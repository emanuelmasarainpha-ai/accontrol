// @ts-check
// =============================================================================
// RUTAS (cómo se navega entre pantallas)
// -----------------------------------------------------------------------------
// Usamos la parte "#" de la dirección (por ejemplo  index.html#/metas).
// Ventajas para una app sin servidor propio:
//   - funciona igual abierta desde cualquier carpeta o hosting estático
//   - el botón "atrás" del celular y del navegador funcionan solos
//   - se puede instalar como PWA sin configurar nada especial
// =============================================================================

/**
 * @typedef {Object} Route
 * @property {string} id      Parte de la dirección: #/metas
 * @property {string} label   Texto completo (menú lateral y títulos).
 * @property {string} short   Texto corto (barra inferior del celular).
 * @property {string} icon    Nombre del ícono (ver ui/icons.js).
 * @property {boolean} [secondary]  true = no va en la barra inferior (Ajustes).
 * @property {boolean} [hidden]     true = no aparece en ningún menú (se llega desde otra pantalla).
 * @property {string} [parent]      Pantalla del menú que se marca como activa mientras estás aquí.
 */

/** @type {Route[]} */
export const ROUTES = [
  { id: 'inicio', label: 'Inicio', short: 'Inicio', icon: 'home' },
  { id: 'finanzas', label: 'Finanzas', short: 'Finanzas', icon: 'swap' },
  { id: 'metas', label: 'Metas', short: 'Metas', icon: 'target' },
  { id: 'estadisticas', label: 'Estadísticas', short: 'Estadíst.', icon: 'chart' },
  { id: 'ia', label: 'IA Financiera', short: 'IA', icon: 'spark' },
  { id: 'ajustes', label: 'Ajustes', short: 'Ajustes', icon: 'sliders', secondary: true },
  // Deudas vive dentro de Finanzas (pestaña "Deudas"): no tiene botón propio en el menú.
  { id: 'deudas', label: 'Deudas', short: 'Deudas', icon: 'card', hidden: true, parent: 'finanzas' },
  { id: 'patrimonio', label: 'Patrimonio', short: 'Patrimonio', icon: 'bank', hidden: true, parent: 'finanzas' },
  // Resultados (módulo Emprendedor / Empresa) vive dentro de Finanzas, como pestaña.
  { id: 'resultados', label: 'Resultados', short: 'Resultados', icon: 'chart', hidden: true, parent: 'finanzas' },
  // Salud financiera (módulo Empresa) vive dentro de Finanzas, como pestaña.
  { id: 'salud', label: 'Salud financiera', short: 'Salud', icon: 'building', hidden: true, parent: 'finanzas' },
  // Clientes (módulo Freelancer) vive dentro de Finanzas, como pestaña.
  { id: 'clientes', label: 'Clientes', short: 'Clientes', icon: 'user', hidden: true, parent: 'finanzas' },
  // Inventario (módulo Emprendedor / Empresa) vive dentro de Finanzas, como pestaña.
  { id: 'inventario', label: 'Inventario', short: 'Inventario', icon: 'box', hidden: true, parent: 'finanzas' },
  // Facturas internas (módulo Emprendedor / Empresa) vive dentro de Finanzas, como pestaña.
  { id: 'facturas', label: 'Facturas', short: 'Facturas', icon: 'receipt', hidden: true, parent: 'finanzas' },
  // Fiado (quién me debe, 0.16.3; Emprendedor / Empresa) vive dentro de Finanzas, como pestaña.
  { id: 'fiado', label: 'Fiado', short: 'Fiado', icon: 'user', hidden: true, parent: 'finanzas' },
  // Caja (modo facturación, 0.17.1; Emprendedor / Empresa): pantalla completa, se abre desde Inventario y Facturas.
  { id: 'caja', label: 'Caja', short: 'Caja', icon: 'receipt', hidden: true, parent: 'finanzas' },
  { id: 'departamentos', label: 'Departamentos', short: 'Áreas', icon: 'building', hidden: true, parent: 'finanzas' },
  // Logros, rachas y niveles se abren desde la tarjeta «Tu nivel» de Inicio.
  { id: 'logros', label: 'Logros', short: 'Logros', icon: 'target', hidden: true, parent: 'inicio' },
  // El diagnóstico financiero se abre desde Estadísticas (botón «Diagnóstico»), desde Inicio y desde Metas.
  { id: 'diagnostico', label: 'Diagnóstico', short: 'Diagnóstico', icon: 'chart', hidden: true, parent: 'estadisticas' },
  // Las calculadoras se abren desde Estadísticas (botón «Calculadoras»).
  { id: 'calculadoras', label: 'Calculadoras', short: 'Calculadoras', icon: 'calculator', hidden: true, parent: 'estadisticas' },
];

export const DEFAULT_ROUTE = 'inicio';

/**
 * Convierte "#/metas" en "metas". Si no existe esa pantalla, vuelve a Inicio.
 * @param {string} hash
 * @returns {string}
 */
export function routeFromHash(hash) {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return ROUTES.some((r) => r.id === id) ? id : DEFAULT_ROUTE;
}

/**
 * Partes de la dirección después de la pantalla: "#/deudas/abc" -> ["abc"].
 * @param {string} hash
 * @returns {string[]}
 */
export function routeParams(hash) {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return path
    .split('/')
    .slice(1)
    .filter((part) => part !== '')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/** @param {string} id */
export function routeById(id) {
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0];
}
