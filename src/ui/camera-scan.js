// @ts-check
// =============================================================================
// LEER CÓDIGOS CON LA CÁMARA (0.17.2)
// Usa el lector de códigos que trae el navegador (BarcodeDetector): códigos de barras (EAN, UPC, Code 128…) y QR. No todos
// los navegadores lo tienen (sí Chrome y Edge en Android; no Safari en iPhone): si no lo hay, el botón no se muestra.
// La imagen de la cámara no sale del teléfono ni se guarda: solo se lee el código.
// =============================================================================

import { openSheet } from './dialog.js';
import { html } from './html.js';

/** Formatos que se piden (los que el navegador sepa leer). */
const WANTED = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

/** ¿Este navegador puede leer códigos con la cámara? */
export function cameraScanSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Abre la cámara y entrega cada código leído (el mismo código no se repite antes de 1.5 s). Se cierra con «Listo».
 * @param {{ onCode: (code: string) => void }} options
 */
export function openCameraScanner({ onCode }) {
  /** @type {MediaStream | null} */
  let stream = null;
  let running = true;
  let lastCode = '';
  let lastAt = 0;
  openSheet({
    title: 'Leer código con la cámara',
    content: html`<div class="stack camera-scan">
      <video class="camera-scan__video" data-camera playsinline muted aria-label="Vista de la cámara"></video>
      <p class="muted" data-camera-status role="status">Abriendo la cámara…</p>
      <p class="hint">Apunta al código de barras o al QR del producto. Puedes leer varios seguidos.</p>
      <div class="actions"><button type="button" class="btn btn--primary" data-close>Listo</button></div>
    </div>`,
    onMount: async (sheet) => {
      const video = /** @type {HTMLVideoElement} */ (sheet.querySelector('[data-camera]'));
      const status = /** @type {HTMLElement} */ (sheet.querySelector('[data-camera-status]'));
      const stop = () => {
        running = false;
        for (const track of stream?.getTracks() ?? []) track.stop();
        stream = null;
      };
      sheet.addEventListener('close', stop);
      try {
        const Detector = /** @type {any} */ (window).BarcodeDetector;
        const supported = typeof Detector.getSupportedFormats === 'function' ? await Detector.getSupportedFormats() : WANTED;
        const formats = WANTED.filter((f) => supported.includes(f));
        const detector = new Detector(formats.length > 0 ? { formats } : undefined);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!running) { stop(); return; }
        video.srcObject = stream;
        // Sin esperar a que empiece a verse: si la cámara tarda, se sigue intentando leer cada cuarto de segundo.
        void video.play().catch(() => {});
        status.textContent = 'Buscando un código…';
        const tick = async () => {
          if (!running) return;
          try {
            const found = await detector.detect(video);
            const code = String(found?.[0]?.rawValue ?? '').trim();
            const now = Date.now();
            if (code && (code !== lastCode || now - lastAt > 1500)) {
              lastCode = code;
              lastAt = now;
              status.textContent = `Leído: ${code}`;
              onCode(code);
            }
          } catch {
            // un cuadro que no se pudo leer: se prueba con el siguiente
          }
          if (running) window.setTimeout(tick, 250);
        };
        void tick();
      } catch (error) {
        stop();
        const denied = error instanceof Error && /Permission|NotAllowed/i.test(`${error.name} ${error.message}`);
        status.textContent = denied
          ? 'No se dio permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio, o usa la pistola lectora.'
          : 'No se pudo abrir la cámara en este dispositivo. Usa la pistola lectora o escribe el código.';
      }
    },
  });
}
