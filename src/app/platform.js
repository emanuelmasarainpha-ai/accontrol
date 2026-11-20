// @ts-check
// =============================================================================
// ¿Dónde corre ACCONTROL? En el navegador (la PWA) o dentro de la app nativa de Android
// (la misma app web envuelta con Capacitor). Capacitor pone `window.Capacitor` al arrancar la
// app nativa; en el navegador no existe. No se importa ninguna librería: solo se mira ese objeto.
// =============================================================================

/**
 * true si la app corre dentro de la app nativa (Android), false en el navegador.
 * @param {any} [win] la ventana (se puede pasar otra en las pruebas)
 */
export function isNativeApp(win = typeof window === 'undefined' ? undefined : window) {
  const cap = win?.Capacitor;
  if (!cap) return false;
  try {
    return typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() === true : false;
  } catch {
    return false;
  }
}

/**
 * Dirección a la que vuelven los enlaces de los correos de la cuenta.
 * En el navegador: esta misma página. En la app nativa la página vive dentro del teléfono
 * (https://localhost), que un enlace de correo no puede abrir: se deja vacío y Supabase usa
 * la dirección principal configurada en su panel (la app web). Confirmar la cuenta y recuperar
 * la contraseña se hacen igual con el código de 6 dígitos, dentro de la app.
 * @param {{ origin: string, pathname: string }} location @param {boolean} native
 */
export function emailReturnAddress(location, native) {
  return native ? '' : `${location.origin}${location.pathname}`;
}
