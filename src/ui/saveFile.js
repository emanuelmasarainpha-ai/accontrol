// @ts-check
// =============================================================================
// GUARDAR UN ARCHIVO (0.18.0): en el navegador, como una descarga; en la app de Android, con el menú «Compartir».
// Todas las descargas de la app (reportes, calculadoras, copia de seguridad, ticket en PDF) pasan por aquí.
// =============================================================================

import { isNativeApp } from '../app/platform.js';
import { shareFileNative } from '../app/nativeFiles.js';
import { downloadFile } from '../export/index.js';
import { toast } from './toast.js';

/** @typedef {import('../app/nativeFiles.js').FileToSave} FileToSave */

/**
 * @param {FileToSave} file
 * @param {{ done?: string, dialogTitle?: string }} [messages] `done`: aviso cuando quedó guardado o enviado.
 * @returns {Promise<boolean>} true si se descargó o se compartió
 */
export async function saveFile(file, { done, dialogTitle } = {}) {
  if (!isNativeApp()) {
    downloadFile(file);
    if (done) toast(done);
    return true;
  }
  try {
    const result = await shareFileNative(/** @type {any} */ (window).Capacitor, file, dialogTitle);
    if (result === 'shared' && done) toast(done);
    return result === 'shared';
  } catch (error) {
    console.error('No se pudo compartir el archivo:', error);
    toast('No se pudo guardar el archivo en el teléfono. Inténtalo de nuevo.', 'error');
    return false;
  }
}
