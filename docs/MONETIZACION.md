# Cómo va a ganar dinero ACCONTROL (investigación, 21/11/2026)

> **Qué es este documento.** Lo que se investigó para cobrar por ACCONTROL desde República Dominicana, cobrando
> **como persona** (sin empresa registrada), y el plan para construirlo. **Nada de esto está hecho todavía**: la app no
> cobra, no tiene planes y no conecta con ningún sistema de pagos. Las cifras se consultaron el 21/11/2026 y
> **cambian**: confírmalas en la página oficial antes de firmar nada. Esto **no es asesoría legal ni fiscal**: lo de
> impuestos hay que verlo con un contador.

## 1. Decisiones ya tomadas (de la persona)

- **Sin anuncios.** En una app de finanzas, los anuncios meten código de otras empresas que recoge datos.
- **Solo el espacio Personal es gratis, y con funciones limitadas.** Lo que de verdad vale la pena es de pago.
- **Se cobra como persona física** (con la cédula), no como empresa.
- La app **todavía no ha salido**, así que no hay que respetar «lo que ya era gratis» para nadie.

## 2. Los planes (propuesta, falta que la persona la confirme)

| | **Gratis** | **Premium** | **Negocio** |
|---|---|---|---|
| Para quién | Probar la app | Personas que quieren controlar bien su dinero | Freelancers, colmados, emprendedores y empresas |
| Espacios | 1 espacio **Personal** | 1 espacio Personal | Personal + **Freelancer, Emprendedor y Empresa** |
| Ingresos y gastos | Sí, sin límite (si se limita lo básico, la gente se va antes de engancharse) | Sí | Sí |
| Metas y deudas | Hasta 2 metas y 2 deudas | Sin límite | Sin límite |
| Presupuesto automático y resumen del mes | Sí | Sí | Sí |
| Estadísticas avanzadas, patrimonio neto, diagnóstico | — | Sí | Sí |
| Calculadoras financieras | — | Sí | Sí |
| Exportar a PDF, Excel y CSV | — | Sí | Sí |
| Pagos en otra moneda y tasa automática | — | Sí | Sí |
| Nube | Copia en la nube, **1 dispositivo** (límite pendiente) | **Varios dispositivos** | Varios dispositivos |
| Clientes, servicios y facturas internas | — | — | Sí |
| Caja, ticket, lector de códigos, inventario, fiado | — | — | Sí |
| Departamentos, miembros y roles a medida (compartir el espacio) | — | — | Sí |
| Precio sugerido (a validar) | RD$0 | **US$ 2.99–3.99 al mes** (o un año con descuento) | **US$ 9.99–14.99 al mes** |

**Por qué esos precios** (solo como punto de partida):
- Las apps de presupuesto personal cobran entre unos US$ 2 y US$ 18 al mes. Spendee Plus cuesta US$ 1.99 y Monarch Money US$ 14.99 ([fuente](https://pocketclear.app/blog/cheapest-budgeting-apps-2026.html), [fuente](https://www.thepennyhoarder.com/budgeting/monarch-money-review/)). En República Dominicana conviene quedarse en la parte baja.
- Alegra, muy usada por negocios dominicanos, cobra su POS desde unos **US$ 23–25 al mes** ([fuente](https://www.alegra.com/rdominicana/precios/)). ACCONTROL Negocio puede costar menos. Ojo, con honestidad: **Alegra emite facturas fiscales electrónicas (e-CF) y ACCONTROL no.** Las facturas de ACCONTROL son internas. Para empresas que necesitan factura fiscal, eso le resta valor.
- **La mejor forma de fijar el precio** es preguntar a 5–10 personas y dueños de negocio reales cuánto pagarían.
- Google Play deja poner el precio en **pesos dominicanos** para quien compra desde aquí.

## 3. Cómo te llega el dinero a República Dominicana

### Lo que NO sirve

| Opción | Por qué no |
|---|---|
| **Stripe directo** | No abre cuentas a negocios con base en República Dominicana. Lo dicen varias fuentes, no Stripe directamente, pero todas coinciden ([fuente](https://www.dr-webstudio.com/en/blog/how-to-accept-online-payments-dominican-republic), [fuente](https://agentaos.ai/answers/which-countries-does-stripe-not-support)). |
| **Lemon Squeezy** | **Cierra.** Desde el 16/11/2026 ya no acepta tiendas nuevas y deja de cobrar el **31/03/2027** ([anuncio](https://x.com/lemonsqueezy/status/2122349068706017700), [noticia](https://techstartups.com/2026/11/16/stripe-shuts-down-lemon-squeezy-just-two-years-after-acquisition-giving-businesses-until-march-2027-to-migrate/)). |
| **Anuncios** | Descartado por decisión (sección 1). |

### Lo que sí sirve

| Opción | Dónde cobra | Comisión | Lo bueno | Lo malo / por confirmar |
|---|---|---|---|---|
| **Google Play (facturación de Google)** | App de Android | **15 %** en suscripciones (10 % por el servicio + 5 % por la facturación) ([fuente](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)) | República Dominicana está en la lista oficial de países donde se puede ser vendedor ([fuente](https://support.google.com/googleplay/android-developer/answer/9306917?hl=en)). Google cobra la tarjeta, maneja reembolsos y renovaciones, y paga en dólares a tu banco. | Cuenta de desarrollador: pago único de unos 25 USD. **Cuentas personales nuevas: antes de publicar hay que hacer una prueba cerrada con al menos 12 personas durante 14 días seguidos** ([fuente](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)). |
| **Paddle** (vende por ti: es el «vendedor oficial» y cobra los impuestos de cada país) | Web | Unos **5 % + US$ 0.50** por cobro, según fuentes no oficiales ([fuente](https://checkoutpage.com/blog/paddle-pricing)); confirmar en [su página](https://www.paddle.com/pricing) | República Dominicana aparece en sus países, con pagos en USD ([fuente](https://developer.paddle.com/concepts/sell/supported-countries-locales.md)). Está hecho para software por suscripción. | **Por confirmar con Paddle:** si acepta a una persona física sin empresa y qué documentos pide. |
| **Polar** (también vendedor oficial) | Web | Unos **4 % + US$ 0.40**; además cobra por cada pago que te envía ([fuente](https://polar.sh/docs/fees)) | Paga a República Dominicana, tanto a personas como a empresas ([fuente](https://polar.sh/docs/documentation/polar-as-merchant-of-record/supported-countries)). | Hay fuentes que dicen que subió sus tarifas en 2026. **Confirmar el precio actual.** |
| **Azul** (Banco Popular) | Web, tarjetas locales en pesos | Cuota mensual de pagos recurrentes de unos **RD$ 1,050** más un cargo por cobro ([tarifario](https://www.azul.com.do/Pages/es/tarifarioAzul.aspx)) | Acepta personas físicas con cédula ([requisitos](https://www.azul.com.do/Pages/es/requisitos.aspx)). Cobra en pesos. | Pide fotos del comercio, pensadas para tiendas físicas. **Preguntar a Azul** si aplica a una app. La cuota mensual pesa mucho con pocos clientes. Los impuestos los manejas tú. |
| **PayPal** | Web | Entre 2.5 % y 5 %, más la conversión de moneda, según fuentes no oficiales ([fuente](https://comparalatam.com/do/transferencia/paypal.html)) | Se puede retirar a una cuenta del Banco Popular ([PayPal RD](https://www.paypal.com/do/webapps/mpp/withdrawal-options)). | Las suscripciones y los impuestos los manejas tú. Más trabajo y más riesgo. |

### Recomendación

1. **Primero, solo Google Play.** ACCONTROL ya es una app de Android. Google cobra, renueva y maneja reembolsos. Es la vía con menos papeleo para una persona física.
2. **Después, la web con Paddle o Polar.** Se elige el que acepte persona física en República Dominicana con menos comisión.
3. **Una sola suscripción por cuenta, venga de donde venga.** Quien paga en el teléfono también tiene Premium en la web, y al revés.
   - Google permite que una app muestre lo que el usuario ya pagó en otro sitio ([fuente](https://support.google.com/googleplay/android-developer/answer/9858738)).
   - Lo que **no** permite es, dentro de la app de Android, mandar a la gente a pagar en la web. Allí solo se vende con Google Play.

## 4. Lo legal y los impuestos (hablar con un contador)

- Al cobrar como persona física, esos ingresos se declaran ante la **DGII** (la oficina de impuestos). El **Régimen Simplificado de Tributación (RST)** puede aplicar a personas con ingresos por servicios por debajo de un tope anual. Las fuentes no coinciden en el monto del tope ([guía DGII](https://dgii.gov.do/publicacionesOficiales/bibliotecaVirtual/contribuyentes/rst/Documents/Guia%20de%20Regimen%20Simplificado%20de%20Tributacion%20(RST).pdf), [Ley 30-26](https://siemprealdia.co/republica-dominicana/impuestos/ley-30-26-por-tipo-de-contribuyente/)). **No encontré nada específico sobre vender una app al extranjero**: es justo la pregunta para el contador.
- Antes de cobrar, la app necesita **términos de uso** y **política de privacidad** publicados. Google Play también los pide.

## 5. Lo que cuesta mantener la app cuando haya clientes

| Qué | Costo | Por qué |
|---|---|---|
| Supabase Pro | **US$ 25 al mes** ([fuente](https://supabase.com/pricing)) | El plan gratis se **pausa tras 7 días sin uso**, tiene 500 MB y no hace copias diarias. Con dinero real de clientes hacen falta copias diarias (Pro guarda 7 días). |
| Google Play | Unos US$ 25, una sola vez | Para publicar. |
| Correos (códigos de acceso) | Hay servicios con plan gratis | Gmail sirve para pocas personas, no para miles. |
| Dominio propio | Pago anual | Para la web y los correos. |

**Cuántos clientes hacen falta para no perder dinero:** con unos US$ 30 al mes de gastos y Premium a US$ 3.99 (te quedan unos US$ 3.39 después del 15 % de Google), salen **unos 9 suscriptores**. Es una estimación, no una promesa.

## 6. Cómo se construye (versión 0.20, en pasos pequeños)

| Paso | Qué | Notas de seguridad |
|---|---|---|
| **0.20.0** | **Planes dentro de la app.** Lista fija de qué trae cada plan (`src/domain/plans.js`). Las funciones de pago muestran «Esto es Premium / Negocio». Pantalla *Planes* con precios y el botón **«Próximamente»**: no se simula ningún pago. Tabla en Supabase con el plan de cada cuenta: cada uno **solo puede leer el suyo**. | **Nadie puede darse un plan a sí mismo**: solo el servidor escribe en esa tabla. Los límites importantes, como crear espacios de Negocio o añadir miembros, se revisan también **en la base de datos** (RLS), no solo en la pantalla. Para las pruebas, el plan se da a mano desde Supabase a quien ayude a probar. |
| **0.20.3** | **Cobro con Google Play** en la app de Android. Una función del servidor comprueba cada compra con Google antes de activar el plan. | La llave de Google para comprobar compras va **solo en Supabase**, nunca en la app. |
| **0.20.4** | **Cobro en la web** con Paddle o Polar. Su aviso de pago llega a una función del servidor, que activa el plan. | Se comprueba la firma de cada aviso, para que nadie pueda falsificar un pago. |
| **0.20.5** | **Panel para el dueño de ACCONTROL**: cuántas cuentas hay, cuántas pagan y cuánto entra. | Solo lo ve tu cuenta. Muestra números, no los datos financieros de nadie. |

## 7. Lo que tiene que hacer la persona (fuera de la app)

1. **Confirmar los planes** de la sección 2: qué va en cada uno y los precios.
2. **Hablar con un contador**: RNC o cédula, RST e impuestos de ventas al extranjero.
3. **Crear la cuenta de Google Play Console** (unos 25 USD) como persona y **conseguir 12 personas** para la prueba cerrada de 14 días. Las personas que ya están probando ACCONTROL sirven.
4. **Escribir a Paddle y a Polar** para preguntar si aceptan a una persona física de República Dominicana y qué piden.
5. (Opcional) **Preguntar a Azul** si su pago recurrente sirve para una app y cuánto cuesta para una persona física.
