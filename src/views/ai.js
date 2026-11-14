// @ts-check
// =============================================================================
// IA FINANCIERA (documento maestro §7, §12 y §21)
// -----------------------------------------------------------------------------
// ESTA PANTALLA NO TIENE IA TODAVÍA, y lo dice claramente.
// No hay chat, no hay respuestas inventadas ni "análisis" simulados.
// La IA llega en la Etapa 5 (ver docs/ROADMAP.md). Hasta entonces, lo único
// parecido son los "Avisos" de Inicio, que son reglas fijas y se explican solas.
// =============================================================================

import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';

/**
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderAi() {
  return {
    html: html`
      <header class="page-header">
        <div>
          <h1 class="page-title">IA Financiera</h1>
          <p class="page-subtitle">Tu asesor financiero personal. Todavía no está disponible.</p>
        </div>
      </header>

      <section class="panel panel--soon" aria-labelledby="ai-soon">
        <span class="empty__icon">${icon('spark', 22)}</span>
        <h2 class="panel__title" id="ai-soon">Próximamente · Etapa 5</h2>
        <p>
          En esta versión <strong>no hay inteligencia artificial</strong>: no verás un chat ni recomendaciones, porque
          todavía no existen. Preferimos decírtelo a mostrarte respuestas inventadas con las que podrías tomar decisiones de dinero.
        </p>
      </section>

      <section class="panel" aria-labelledby="ai-plan">
        <h2 class="panel__title" id="ai-plan">Lo que está planificado</h2>
        <p class="panel__sub">Según el documento maestro, la IA tendrá tres niveles:</p>
        <ol class="levels">
          <li><strong>Describir</strong> lo que ocurre. Ejemplo: “tus gastos aumentaron un 12 %”.</li>
          <li><strong>Anticipar</strong> lo que podría ocurrir. Ejemplo: “a este ritmo superarás tu presupuesto antes de fin de mes”.</li>
          <li><strong>Recomendar</strong> qué hacer. Ejemplo: “reducir gastos discrecionales permitiría alcanzar tu meta antes”.</li>
        </ol>
        <p class="muted">Se construirá por pasos: primero reglas claras y comprobables sobre tus datos; después, un asistente conversacional.</p>
      </section>

      <section class="panel" aria-labelledby="ai-now">
        <h2 class="panel__title" id="ai-now">Lo que sí existe hoy</h2>
        <p>
          En <a href="#/inicio">Inicio</a> aparece un panel de <strong>Avisos</strong>: reglas simples que cualquiera puede comprobar
          (por ejemplo, “este mes gastaste más de lo que ingresó” o “una meta vence pronto”). No usan inteligencia artificial.
        </p>
        <p>
          En <a href="#/estadisticas">Estadísticas</a> está el <strong>Diagnóstico financiero</strong>: indicadores de ahorro, colchón de emergencia y deudas
          con su nivel (Bien, Atención o Riesgo) y si cada meta cabe en lo que te sobra cada mes. También son reglas fijas, no inteligencia artificial.
        </p>
      </section>

      <section class="panel" aria-labelledby="ai-cost">
        <h2 class="panel__title" id="ai-cost">Qué necesitará cuando llegue</h2>
        <ul class="plain-list">
          <li>Un servicio externo de IA, que normalmente cobra según el uso. Tendrá un costo que hoy no existe.</li>
          <li>Un servidor propio que guarde las claves de ese servicio (nunca dentro de la app que se instala en tu teléfono).</li>
          <li>Que decidas expresamente si quieres usarla, sabiendo qué datos se enviarían. Hoy tus datos no salen de este dispositivo.</li>
        </ul>
      </section>
    `,
  };
}
