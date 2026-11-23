// @ts-check
// =============================================================================
// CONFIGURACIÓN DEL SERVIDOR DE CUENTAS Y DE LA BASE DE DATOS EN LA NUBE (Supabase)
// -----------------------------------------------------------------------------
// Estos dos valores son PÚBLICOS por diseño: cualquiera que abra la app los puede ver, igual que la
// dirección de una página web. Lo que protege tus datos no es ocultarlos, sino las reglas de seguridad
// de la base de datos (RLS): cada cuenta solo puede leer y escribir lo suyo.
//
//   ⚠ NUNCA pongas aquí la llave «secret» (la de rol de servicio): esa sí daría acceso a TODO. Hay una prueba
//     automática (test/config.test.js) que falla si alguien lo hace por error.
//
// Para usar otro proyecto de Supabase cambia estos dos valores y la dirección permitida en `connect-src`
// de la política de seguridad de index.html (otra prueba comprueba que coincidan).
//
// Si SUPABASE_URL queda vacío, la app funciona como en la versión 0.13.0: sin cuentas, todo en este dispositivo.
// =============================================================================

/** Dirección del proyecto ACCONTROL en Supabase. */
export const SUPABASE_URL = 'https://vuzlguqrbwgvyduysfkh.supabase.co';

/** Llave pública («publishable») del proyecto. */
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_j5eQoSOnCfDoaLC9jCDRrw_wh0fSq3i';

/**
 * 0.20.1: el «Client ID» web de Google (termina en .apps.googleusercontent.com). También es PÚBLICO: Google lo
 * muestra en su propia página al entrar. Con él, en el navegador, «Continuar con Google» va directo a Google y vuelve
 * a ACCONTROL sin pasar por la dirección de Supabase. Debe ser el mismo que está en Supabase (Authentication →
 * Providers → Google → Client IDs) y tener la dirección de la app como «Authorized redirect URI» en Google Cloud.
 * Vacío = como antes (pasando por Supabase). La app de Android sigue pasando por Supabase.
 */
export const GOOGLE_WEB_CLIENT_ID = '398052259507-glk5ml9alkkr0veosf6ubvk25av3ej9h.apps.googleusercontent.com';
