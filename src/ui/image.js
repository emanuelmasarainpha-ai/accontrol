// @ts-check
// =============================================================================
// FOTOS DE PRODUCTOS (0.17.0)
// -----------------------------------------------------------------------------
// Convierte la foto que elige la persona (de la cámara o de la galería) en una MINIATURA cuadrada y liviana, en el mismo
// dispositivo: nada sale a ningún servidor hasta que el producto se guarda (y entonces viaja con él, si la copia en la nube
// está activa). Se recorta al centro, se reduce a THUMB_SIZE píxeles y se guarda como WEBP (o JPG si el navegador no sabe
// hacer WEBP), bajando la calidad hasta que quepa en LIMITS.productImage caracteres.
// =============================================================================

import { isValidProductImage } from '../domain/inventory.js';
import { LIMITS } from '../domain/types.js';

/** Lado de la miniatura, en píxeles (0.17.3: 256 para que se vea nítida en las tarjetas grandes de la caja). */
export const THUMB_SIZE = 256;
/** Fotos más grandes que esto ni se intentan abrir (una foto de teléfono pesa 2–8 MB). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * @param {File} file
 * @returns {Promise<{ ok: true, dataUrl: string } | { ok: false, error: string }>}
 */
export async function shrinkProductImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return { ok: false, error: 'Elige una foto (JPG, PNG, WEBP o la de la cámara).' };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: 'Esa foto es demasiado grande. Elige otra o tómala con menos resolución.' };
  /** @type {ImageBitmap | null} */
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, error: 'No se pudo abrir esa foto. Prueba con otra.' };
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: 'Este navegador no puede preparar la foto.' };
    // Recorte cuadrado al centro (como una foto de perfil).
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.fillStyle = '#ffffff'; // fondo blanco para las fotos con transparencia (al pasar a JPG)
    ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
    for (const type of ['image/webp', 'image/jpeg']) {
      for (let quality = 0.82; quality >= 0.3; quality -= 0.12) {
        const dataUrl = canvas.toDataURL(type, quality);
        if (!dataUrl.startsWith(`data:${type};`)) break; // el navegador no sabe hacer ese formato: probar el siguiente
        if (dataUrl.length <= LIMITS.productImage && isValidProductImage(dataUrl)) return { ok: true, dataUrl };
      }
    }
    return { ok: false, error: 'No se pudo reducir esa foto lo suficiente. Prueba con otra.' };
  } finally {
    bitmap.close();
  }
}
