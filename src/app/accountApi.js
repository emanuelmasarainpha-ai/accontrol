// @ts-check
// =============================================================================
// CUENTA PARA LAS PANTALLAS
// -----------------------------------------------------------------------------
// Une el cliente de cuentas (src/auth/authClient.js) con lo que necesitan las pantallas (AccountApi), sin que
// ellas sepan nada del servidor. Separado de main.js para poder probarlo.
// =============================================================================

/** @typedef {ReturnType<typeof import('../auth/authClient.js').createAuthClient>} AuthClient */

/** @param {{ ok: false, error: { message: string, field?: string } }} failed */
const toFailure = (failed) => ({ ok: /** @type {const} */ (false), error: failed.error.message, field: failed.error.field });

/**
 * @param {AuthClient} auth
 * @param {{ email: string }} user
 * @returns {import('./app.js').AccountApi}
 */
export function createAccountApi(auth, user) {
  return {
    email: user.email,
    signOut: () => auth.signOut(),
    // Desde Cuenta siempre se pide la contraseña actual (el servidor también la comprueba).
    async changePassword(input) {
      const result = await auth.changePassword(input);
      return result.ok ? result : toFailure(result);
    },
    // 0.20.3: eliminar la cuenta = pedir el código al correo → escribirlo → borrar.
    async requestDeletionCode() {
      const result = await auth.requestDeletionCode();
      return result.ok ? result : { ok: false, error: result.error.message };
    },
    async confirmDeletionCode(code) {
      const result = await auth.confirmDeletionCode(code);
      return result.ok ? result : { ok: false, error: result.error.message };
    },
    async deleteAccount() {
      const result = await auth.deleteAccount();
      return result.ok ? result : { ok: false, error: result.error.message };
    },
  };
}
