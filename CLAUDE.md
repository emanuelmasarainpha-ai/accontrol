# CLAUDE.md — Reglas de trabajo para ACCONTROL

Estas reglas valen para todo el trabajo en este proyecto.

## 1. Idioma y forma de explicar

- Habla siempre en **español**.
- Mi nivel de programación es **básico**. Explica **paso a paso**, con palabras sencillas.
- Cuando uses un término técnico (por ejemplo «RLS», «migración», «sincronización»), explica en una frase qué significa.
- Si tengo que hacer algo yo (en el panel de Supabase, en la terminal, en el teléfono), dime exactamente qué pulsar o qué escribir, en orden.

## 2. Etapas pequeñas y verificadas

- Trabaja en **pasos pequeños**. Cada paso termina **verificado** antes de empezar el siguiente.
- «Verificado» significa que se comprobó de verdad: pruebas (`npm test`), revisión de tipos (`npm run typecheck`) y, cuando aplique, en el navegador real.
- Al terminar cada paso, di: qué se hizo, cómo se verificó y qué falta.
- No mezcles en un mismo paso cosas que no tienen que ver entre sí.
- Mantén actualizados `README.md` y `docs/ROADMAP.md` cuando cambie lo que la app hace.

## 3. Nunca presentar como real algo simulado

- Nunca digas que algo funciona si no se probó. Si algo está a medias, dilo.
- Los **datos de demostración** llevan siempre la etiqueta **DEMO** (en pantalla, en los reportes y en los números de documento, por ejemplo `DEMO-001`).
- Los datos de demostración **no cuentan** como datos reales (por ejemplo, no suman logros).
- Si una función depende de un servicio que todavía no existe (nube, IA, bancos, pagos), no se simula como si existiera: se marca como pendiente.
- Las estimaciones (cuotas, proyecciones, calculadoras, diagnóstico) se presentan como estimaciones, no como asesoría ni promesas.

## 4. La seguridad de los datos financieros va primero

- Antes de cualquier cambio, piensa si puede **perder, exponer o mezclar** datos financieros. Si hay riesgo, avísame antes de hacerlo.
- Cada cuenta y cada espacio de trabajo ve **solo sus propios datos** (en el dispositivo y en Supabase con reglas de seguridad por fila, RLS).
- **Nunca** pongas claves secretas (por ejemplo la clave `service_role` de Supabase o claves de IA) dentro de la app ni en archivos que se publiquen.
- Las cantidades de dinero se guardan en **centavos enteros**.
- Los cambios en la base de datos deben **conservar los datos existentes** (migración automática) y probarse con datos reales antes de darlos por buenos.
- Recomienda hacer una **copia de seguridad** antes de cualquier actualización que cambie la base de datos.
- No borres ni sobrescribas nada sin mirarlo antes y sin avisarme.

## 5. Honestidad con los errores

- Si un error **no se resuelve**, explícalo con honestidad: qué pasa, qué se intentó, qué se sabe y qué no.
- No escondas pruebas que fallan ni las desactives para que «pasen».
- Si no estás seguro de algo, dilo.

## 6. Hasta la versión final

- Seguimos trabajando, versión por versión, hasta la **versión final 1.0.0** (ver «Versiones previstas hasta la final» en `docs/ROADMAP.md`).
- Al empezar una sesión, revisa `docs/ROADMAP.md` para saber en qué punto estamos.

## Datos útiles del proyecto

- App web (PWA) en JavaScript sin framework; código en `src/`, pruebas en `test/`.
- Comandos: `npm start` (abre el servidor local), `npm test` (pruebas), `npm run typecheck` (revisión de tipos), `npm run precache` (actualiza la lista de archivos sin conexión), `npm run build` (prepara `dist/` para publicar; lo usa Vercel).
- Publicación: repositorio privado en GitHub; Vercel publica cada subida a `main`. Se sube al cerrar cada paso verificado.
- Moneda: pesos dominicanos (RD$).
- Documentación: `README.md`, `docs/ROADMAP.md`, `docs/ARQUITECTURA.md`, `docs/GUIA_DE_PRUEBAS.md`, `docs/COBERTURA_DOCUMENTO_MAESTRO.md`.
