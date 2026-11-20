// @ts-check
// =============================================================================
// ARCHIVOS EN LA APP DE ANDROID (0.18.0)
// -----------------------------------------------------------------------------
// Dentro de la app nativa el navegador interno no descarga archivos. Aquí el archivo (copia de seguridad, reporte o
// ticket) se escribe en la carpeta PRIVADA de la app (caché/compartir, la única que el FileProvider deja compartir) con el
// complemento oficial Filesystem, y se abre el menú «Compartir» de Android (complemento Share): desde ahí la persona lo
// guarda en Archivos o Drive, lo envía por WhatsApp o correo, o lo manda a la app de su impresora.
// Antes de escribir se vacía esa carpeta: en el teléfono queda, como mucho, el último archivo compartido.
// Se llama a los complementos con `Capacitor.nativePromise` (lo pone la app nativa); no se importa ninguna librería.
// =============================================================================

/** @typedef {{ filename: string, mime: string, bytes: Uint8Array }} FileToSave */
/** @typedef {{ nativePromise: (plugin: string, method: string, options?: object) => Promise<any> }} CapacitorBridge */

const FOLDER = 'compartir';

/** Bytes a base64 (en trozos, para no pasarse del límite de argumentos con archivos grandes). @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Nombre de archivo sin carpetas ni caracteres raros (nunca puede salirse de la carpeta «compartir»). @param {string} name */
export function safeFileName(name) {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim();
  return clean === '' ? 'archivo' : clean.slice(0, 120);
}

/** ¿La persona cerró el menú «Compartir» sin elegir nada? @param {unknown} error */
export function isShareCancel(error) {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /cancel/i.test(text);
}

/**
 * Guarda el archivo en la carpeta privada y abre «Compartir».
 * @param {CapacitorBridge} cap @param {FileToSave} file @param {string} [dialogTitle]
 * @returns {Promise<'shared' | 'cancelled'>}
 */
export async function shareFileNative(cap, file, dialogTitle = 'Guardar o enviar') {
  const name = safeFileName(file.filename);
  await cap.nativePromise('Filesystem', 'rmdir', { path: FOLDER, directory: 'CACHE', recursive: true }).catch(() => undefined);
  const written = await cap.nativePromise('Filesystem', 'writeFile', {
    path: `${FOLDER}/${name}`,
    data: bytesToBase64(file.bytes),
    directory: 'CACHE',
    recursive: true,
  });
  const uri = written?.uri;
  if (typeof uri !== 'string' || uri === '') throw new Error('No se pudo guardar el archivo en el teléfono.');
  try {
    await cap.nativePromise('Share', 'share', { title: name, files: [uri], dialogTitle });
    return 'shared';
  } catch (error) {
    if (isShareCancel(error)) return 'cancelled';
    throw error;
  }
}
