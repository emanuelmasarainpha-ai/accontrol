// @ts-check
// =============================================================================
// IDENTIFICADORES ÚNICOS
// -----------------------------------------------------------------------------
// Cada registro recibe un UUID v4. Se generan en el dispositivo (no en un
// servidor), así que funcionan sin internet y encajan con la base de datos
// en la nube de la Etapa 2.
//
// `crypto.randomUUID()` solo existe en páginas seguras (HTTPS o localhost). Si
// pruebas desde el celular con http://192.168.x.x, no existe; por eso hay un
// plan B con `crypto.getRandomValues`, que sí funciona en cualquier página.
// =============================================================================

/** @returns {string} */
export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
