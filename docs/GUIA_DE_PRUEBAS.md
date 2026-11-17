# Guía de pruebas — paso a paso

Pensada para quien está empezando. Si algo no coincide con lo que ves, anota el mensaje exacto y pídele ayuda a Claude con ese texto.

---

## 1. Preparar la computadora (una sola vez)

1. **Instala Node.js LTS** (20 o superior): <https://nodejs.org>. Acepta las opciones por defecto.
2. **Comprueba la instalación.** Abre una terminal (en Windows: *PowerShell*) y escribe:
   ```
   node --version
   ```
   Debe mostrar `v20...` o mayor.
3. **Descomprime** el `.zip` donde quieras (por ejemplo `Documentos/accontrol`).
4. En **VS Code**: *Archivo → Abrir carpeta…* y elige la carpeta `accontrol` (la que contiene `index.html`).

## 2. Ejecutar la app en la computadora

1. En VS Code: *Terminal → Nueva terminal*.
2. Escribe:
   ```
   npm start
   ```
3. Verás algo como:
   ```
   ACCONTROL está corriendo.

     En esta computadora:  http://localhost:5173
     En tu celular (mismo Wi-Fi):  http://192.168.x.x:5173
   ```
4. Abre <http://localhost:5173> en Chrome o Edge.
5. Para detener el servidor: `Ctrl + C` en la terminal.

> Si el puerto está ocupado: `npm start -- --port 5200`.

### Qué probar (recorrido sugerido, 5 minutos)

0. **Primera apertura.** *(Desde la 0.14.0 primero te pide entrar o crear una cuenta: ver el punto 29. Si probaste sin cuentas, deja `SUPABASE_URL` vacío en `src/config.js`.)* En un navegador sin datos de ACCONTROL (o en una ventana de incógnito de Chrome), al abrir la app —y, con cuentas, después de entrar— aparece la pantalla de bienvenida con cuatro tarjetas: **Personal, Freelancer, Emprendedor y Empresa**. Elige una, ponle nombre al espacio (o deja el sugerido) y entra. Arriba a la izquierda (en el teléfono, arriba) verás el **selector de espacios** con el nombre del espacio. Los pasos siguientes se hacen dentro de ese espacio.
1. En **Inicio**, pulsa **Añadir → Añadir ingreso**: monto `25000`, categoría *Salario*, fecha de hoy. Guarda.
2. **Añadir → Añadir gasto**: `1,500.50`, categoría *Alimentación*. Guarda.
3. Ve a **Finanzas**: deben aparecer los dos. Edita el gasto (cambia el monto) y bórralo.
4. Ve a **Metas → Nueva meta**: “Fondo de emergencia”, objetivo `60000`, fecha dentro de 12 meses. Pulsa **Aportar** `5000`.
5. Vuelve a **Inicio**: *Disponible* debe ser `ingresos − gastos − ahorrado en metas`.
6. Ve a **Estadísticas**: los gráficos salen de lo que registraste.
7. **Cierra la pestaña y vuelve a abrir** <http://localhost:5173>: tus datos siguen ahí.
8. En **Ajustes → Copia de seguridad → Exportar copia (.json)**: se descarga un `.json`.
9. **Deudas:** en **Finanzas → pestaña Deudas → Añadir deuda**: “Préstamo banco”, monto `100000`, tasa `12` anual, primera cuota el mes que viene y vencimiento final dentro de 12 meses. Mientras escribes verás la **cuota estimada** y los intereses. Guarda, pulsa **Registrar pago** y comprueba que en Finanzas aparece un gasto de “Pago de deudas” y que *Disponible* baja en ese monto.
10. En **Inicio** deben aparecer *Próximas deudas* y la tarjeta de *Presupuesto* (dinero comprometido este mes).
11. **Exportar:** en **Estadísticas** (reporte del mes) y en **Deudas** (reporte de deudas, y amortización dentro de cada deuda) pulsa **PDF**, **Excel** y **CSV**. Se descargan al instante; ábrelos con tu visor de PDF y con Excel o LibreOffice. Los textos con tilde y ñ deben verse bien.
12. **Meta con más dinero del que tienes:** aporta a una meta más que tu *Disponible*; la app te pregunta si la diferencia es un aporte externo.
13. **Patrimonio:** en **Añadir → Añadir activo** crea “Mi carro” (categoría *Vehículos*, tipo *Automóvil*, valor `500000`, fecha de adquisición de hace unos meses). Ve a **Finanzas → pestaña Patrimonio**: debes ver *activos − pasivos = patrimonio neto*, el gráfico de evolución mes a mes y tus deudas como pasivos. Pulsa **Actualizar valor** en el carro (por ejemplo `450000`): el patrimonio de hoy baja, pero los meses anteriores no cambian. En **Inicio** aparece la tarjeta de Patrimonio debajo de *Disponible*. Pulsa **PDF**, **Excel** o **CSV** en *Exportar patrimonio*.
14. **Estadísticas por período:** en **Estadísticas → Ingresos y gastos** cambia entre **Mensual**, **Trimestral** y **Anual**. El período en curso lleva la marca «en curso» porque todavía no termina. Más abajo, **Deudas** muestra cuánto debías mes a mes.
15. **Ritmo de una meta:** en **Metas** (y en *Progreso de metas* de Estadísticas) cada meta con aportes dice si, a tu ritmo de los últimos meses, llegarías a tiempo o tarde, y la fecha estimada.
16. **Calculadoras:** en **Estadísticas → Calculadoras** abre *Préstamo* (modo *Cuota mensual*): escribe *Monto del préstamo* `100000`, *Tasa de interés anual* `12` y *Plazo* `24` meses. La cuota debe salir RD$ 4,707.35. Prueba **Probar con un ejemplo** y **Borrar todo**, y exporta a PDF, Excel y CSV. Prueba también *Interés compuesto* y *Amortización* con un abono extra: el plazo se acorta y los intereses bajan.

17. **Espacios de trabajo:** en el selector pulsa **Crear otro espacio**, elige *Emprendedor* y llámalo «Mi negocio». Empieza **vacío**: *Disponible* en RD$ 0.00 y sin metas ni deudas. Registra un ingreso ahí. Vuelve a «Mi espacio personal» desde el selector: sus cifras siguen exactamente como estaban y el ingreso del negocio no aparece. En **Ajustes → Espacios de trabajo** prueba **Renombrar**, **Predeterminado** (el espacio que se abre primero) y **Borrar** (te pide confirmación; el último espacio no se puede borrar). **Ajustes → Copia de seguridad** ofrece **Exportar este espacio** y, con más de un espacio, **Exportar copia completa**.
18. **Actualizar desde la versión anterior (opcional):** si ya usas la 0.3.0 en un navegador, exporta antes una copia (*Ajustes → Copia de seguridad*), abre la versión nueva en la misma dirección y comprueba que *Disponible* es el mismo, que el selector dice «Mi espacio personal» y que **no** aparece la pantalla de bienvenida (tus datos ya existían). Recuerda: después de abrir la 0.4.0 no se puede volver a la 0.3.0 sobre esos mismos datos; para eso está la copia.

19. **Datos del negocio:** abre (o crea) un espacio *Emprendedor*, *Freelancer* o *Empresa*. En **Inicio** el aviso te invita a «Completa los datos de tu negocio». En **Ajustes → Datos del negocio** pulsa **Completar datos** y escribe, por ejemplo, razón social «Estudio Ruiz SRL», RNC `131123456`, un correo y un teléfono. Prueba también escribir un correo sin `@` o un teléfono de 3 números: el formulario te dice qué campo corregir y no guarda nada hasta que esté bien. Guarda. Luego, en **Estadísticas**, exporta el reporte del mes en **PDF** y **Excel**: arriba aparece «Espacio: …» y los datos del negocio; los números son los mismos de siempre. En el espacio *Personal* no hay datos de negocio (y su reporte solo dice de qué espacio es). Ajustes muestra también la **moneda** del espacio (peso dominicano, RD$; es la única por ahora). La app no verifica el RNC con ningún registro oficial.

20. **Módulo Freelancer:** crea un espacio *Freelancer* (por ejemplo «Diseño»). En **Finanzas** aparece la pestaña **Clientes**. Pulsa **Nuevo cliente** (nombre «Ana Pérez», empresa «Estudio Sol»; el formulario rechaza un correo sin `@`). En la ficha del cliente, **Nuevo servicio**: «Sitio web», precio `60000`, estado *En proceso*. Pulsa **Registrar pago** `20000`: en la ficha ves *Cobrado* RD$ 20,000 y *Por cobrar* RD$ 40,000, y en **Finanzas → Movimientos** el ingreso aparece con el nombre del cliente y el servicio (también lo encuentras buscando el nombre del cliente). Cambia el servicio a *Finalizado* y registra otro pago de `40000`: *Por cobrar* baja a RD$ 0.00. En **Inicio** aparece el panel *Tu trabajo freelance* con el flujo del mes, lo por cobrar y el ranking. Prueba que **borrar** el cliente se rechaza (tiene servicios y pagos) y que **Archivar** lo oculta al registrar pagos pero conserva su historial. Exporta **Clientes** a PDF, Excel y CSV. En *Ajustes → Datos de demostración* puedes cargar clientes de ejemplo (llevan la etiqueta **DEMO**) y borrarlos con un clic. En un espacio *Personal* la pestaña Clientes no existe.
21. **Actualizar desde la 0.5.0 (opcional):** exporta antes una copia completa, abre la versión nueva en la misma dirección y comprueba que todos tus espacios y su *Disponible* siguen igual. La base pasa a la versión 5; **no se puede volver a la 0.5.0 con esos datos**, para eso está la copia. (De la 0.6.0 a la 0.7.0 la base no cambia.)
22. **Módulo Emprendedor:** crea un espacio *Emprendedor* (por ejemplo «Tienda Luna»). En **Finanzas** aparece la pestaña **Resultados** (no hay pestaña Clientes). Vacía te ofrece registrar movimientos o **Ver con datos de demostración** (una tienda inventada de ocho meses, con la etiqueta **DEMO**). Con la demostración cargada comprueba:
    - **Estado de resultados:** *ingresos − gastos = beneficio neto*, y el **margen** (beneficio ÷ ingresos) con la **rentabilidad** (beneficio ÷ gastos). Cambia entre **Mensual**, **Trimestral** y **Anual** y usa las flechas para ir a otros períodos; el período en curso lleva la marca «en curso» porque solo cuenta hasta hoy.
    - **Comparación:** el mes frente al anterior y frente al mismo mes del año anterior. Si ese mes no tuvo registros dice «Sin registros» en vez de inventar un porcentaje.
    - **Veredicto** («Tu negocio genera valor», «Resultados mixtos» o «Por ahora hay movimiento, no beneficio») y **proyección** de 3 meses con su rango. La proyección dice que es una estimación y cómo se calcula; con menos de 3 meses completos de historia explica que falta historia.
    - **Pagos de deudas:** registra una deuda y un pago (*Finanzas → Deudas*). En *Resultados* aparece «de los cuales, pagos de deudas» y el «Beneficio antes de pagos de deudas».
    - **Categorías de negocio:** pulsa **Añadir categorías de negocio**; al registrar un gasto ya puedes elegir «Marketing y publicidad» o «Nómina y colaboradores», y salen en *Gastos por categoría*.
    - **Inicio:** el panel *Tu negocio* con el beneficio del mes, el beneficio acumulado del año y la proyección.
    - **Exportar:** al final de *Resultados* pulsa **PDF**, **Excel** y **CSV**. El reporte es del período que estás viendo (mensual, trimestral o anual). El CSV trae la tabla de comparación; el Excel y el PDF traen también resumen, categorías, últimos 6 meses y proyección. Abre el PDF y comprueba que los números son los de la pantalla.
    - En un espacio *Empresa* también está *Resultados* (vacío al principio, con sus propios datos); en *Personal* y *Freelancer* no, y la dirección `#/resultados` lo explica.
    Al **borrar la demostración** (banner de arriba), lo que registraste tú se conserva.
23. **Módulo Empresa (salud financiera):** crea un espacio *Empresa* (por ejemplo «ABC Servicios»). En **Finanzas** aparecen las pestañas *Movimientos, Resultados, **Salud**, Deudas y Patrimonio* (en Personal, Freelancer y Emprendedor no existe *Salud*, y la dirección `#/salud` lo explica). Vacía te ofrece registrar movimientos o **Ver con datos de demostración** (la tienda inventada más un préstamo y un equipo, con la etiqueta **DEMO**). Con la demostración cargada comprueba:
    - **Cinco tarjetas**, cada una con su **cifra**, un nivel (**Bien**, **Atención** o **Riesgo**), una explicación en palabras y su detalle: *Punto de equilibrio*, *Meses de efectivo*, *Deuda sobre activos*, *Peso de las cuotas* y *Cuotas a 30 días*. Arriba, una línea resume cuántas están en riesgo, en atención o bien, y dice de dónde sale el **mes típico** (el promedio de tus últimos 3 meses completos con movimientos).
    - **La regla de cada nivel** se ve al pie de cada tarjeta (por ejemplo, 6 meses de efectivo o más = Bien). Son **reglas generales**, no asesoría: tu negocio puede ser distinto.
    - **Prueba con tus propias cifras** en un espacio Empresa vacío: registra, en un mes ya terminado, un ingreso de `100000`, un gasto clasificado como **Fijo** de `30000` y otro **Variable** de `20000`. Con eso el *margen de contribución* es 80 % y el *punto de equilibrio* es `30000 ÷ 0.8 = RD$ 37,500.00` al mes (si todos tus gastos son variables, la tarjeta dice que el equilibrio es RD$ 0.00 y te invita a clasificar los gastos que se repiten).
    - **Deudas y activos:** registra una deuda (*Finanzas → Deudas*): cambian *Deuda sobre activos*, *Peso de las cuotas* y *Cuotas a 30 días*. Un activo en *Patrimonio* sube lo que «tienes».
    - **Inicio:** en el panel *Tu negocio* una línea con la salud financiera y un enlace a *Salud*; si el efectivo cubre muy poco o los ingresos quedan por debajo del equilibrio, aparece un aviso.
    - **Exportar:** al final de *Salud* pulsa **PDF**, **Excel** y **CSV**; las cifras deben ser las mismas que ves en pantalla.
    - **Con datos solo del mes en curso** las cifras son parciales y la pantalla lo avisa; se afinan cuando termina el mes.
    - **Actualizar desde la 0.7.0 (opcional):** exporta antes una copia completa, abre la versión nueva en la misma dirección y comprueba que tus espacios y datos siguen iguales y que en Empresa aparece la pestaña *Salud*. La base de datos no cambia en esta versión.
24. **Inventario (Emprendedor y Empresa):** crea un espacio *Emprendedor* (por ejemplo «Tienda Luna»). En **Finanzas** aparece la pestaña **Inventario** (en Personal y Freelancer no existe, y la dirección `#/inventario` lo explica). Vacía te ofrece **Nuevo producto** o **Ver con datos de demostración** (una tienda inventada con productos, proveedores y movimientos, con la etiqueta **DEMO**). Para probarlo con tus propias cifras, en un espacio vacío:
    - **Producto:** pulsa **Nuevo producto**: nombre «Camisa azul», precio de venta `500`, avisarme cuando queden `3`. Prueba que sin nombre, o con el mismo nombre dos veces, se rechaza. Se abre su **ficha** con stock 0.
    - **Compra:** **Registrar compra** `10` unidades a `200`. El formulario muestra el **total** (RD$ 2,000.00) mientras escribes. En la ficha: stock 10, valor RD$ 2,000.00. En **Finanzas → Movimientos** aparece un **gasto** «Compra: 10 × Camisa azul» y tu *Disponible* baja RD$ 2,000. Al tocar ese gasto la app te lleva al producto: **no se edita suelto**.
    - **Venta:** **Registrar venta** `4` (el precio sale del producto: `500`). Stock 6, valor RD$ 1,200.00 (a **costo promedio**), y en Movimientos aparece un **ingreso** de RD$ 2,000. Intenta vender `7`: se **rechaza** (solo hay 6). Vende `3` más: el producto pasa a **Stock bajo** (aviso en 3) y en *Inicio* ves la línea de inventario y el aviso.
    - **Cuentas de la pantalla Inventario:** *Valor del inventario* RD$ 600.00; *Ventas del mes* RD$ 3,500.00; *Ganancia bruta* RD$ 2,100.00 (ventas 3,500 − costo de lo vendido 1,400), margen 60 %. Es distinta de *Resultados*, que cuenta el dinero cuando entra o sale.
    - **Borrar:** en la ficha, **Eliminar** la compra de 10 se **rechaza** (ya se vendió esa mercancía). Eliminar una venta pide confirmación, devuelve las unidades al stock y **borra también su ingreso** en Movimientos.
    - **Ajuste:** **Ajustar stock → Restar** `1` con la nota «Rota»: el stock baja y el costo se oculta; no se crea ni se borra dinero en Movimientos. **Sumar** pide el costo por unidad.
    - **Proveedores:** **Nuevo proveedor** «Distribuidora Sol» (un correo sin `@` se rechaza). Regístrale una compra: en su fila ves cuántas compras y cuánto le has comprado. Con compras no se puede eliminar, pero sí **archivar**.
    - **Archivar un producto:** deja de ofrecerse al comprar y vender, su valor sigue contando y se puede **Reactivar**. Un producto sin movimientos sí se puede **Eliminar**.
    - **Exportar:** al final de *Inventario* pulsa **PDF**, **Excel** y **CSV**; las cifras deben ser las mismas que ves en pantalla (el CSV lleva solo la tabla de productos; el Excel, las cinco hojas).
    - **Copia de seguridad:** exporta e importa una copia de ese espacio: productos, proveedores y movimientos de stock vuelven iguales. Una copia a la que le quites a mano una compra, de modo que las ventas se queden sin mercancía, se **rechaza completa**.
    - **Demostración:** en *Ajustes → Datos de demostración* puedes cargarla y borrarla de un clic; un movimiento que tú registres sobre un producto de demostración también cuenta como DEMO. Ten en cuenta que **suma ventas y compras a los totales de la demostración del negocio**.
    - **Actualizar desde la 0.8.0 (opcional):** exporta antes una copia completa, abre la versión nueva en la misma dirección y comprueba que todos tus espacios y su *Disponible* siguen iguales y que en Emprendedor y Empresa aparece la pestaña *Inventario*, vacía. La base pasa a la versión 6; **no se puede volver a la 0.8.0 con esos datos**, para eso está la copia.
25. **Facturas internas (Emprendedor y Empresa):** en un espacio *Emprendedor* (por ejemplo la «Tienda Luna» del paso anterior, con la «Camisa azul» y 10 unidades en stock) abre **Finanzas → Facturas** (en Personal y Freelancer no existe, y la dirección `#/facturas` lo explica). Vacía te ofrece **Nueva factura** o **Ver con datos de demostración** (cinco facturas inventadas, con todos los estados y la etiqueta **DEMO**, y su propia numeración `DEMO-001…`). Para probarla con tus cifras:
    - **Validaciones:** pulsa **Nueva factura** y **Emitir factura** sin escribir nada: pide el cliente y, en la línea, la descripción y el precio, cada error junto a su campo. Prueba una cantidad con decimales (`1.5`), un impuesto de `120`, una fecha futura y un vencimiento anterior a la fecha de la factura: todo se rechaza con su mensaje.
    - **Emitir:** cliente «Hotel Sol»; en la línea 1 elige el producto **Camisa azul** (se sugieren su nombre y su precio `500.00`; abajo ves el stock) y cantidad `4`; **Agregar otra línea**: «Servicio de envío», cantidad `1`, precio `300`; impuesto `18`; pulsa **30 días** (pone el vencimiento). Mientras escribes se ven el **subtotal RD$ 2,300.00**, el **impuesto RD$ 414.00** y el **total RD$ 2,714.00**. Al emitir se abre la **ficha** de la factura **F-0001**: total 2,714.00, cobrado 0, por cobrar 2,714.00, estado *Emitida*.
    - **Emitir no es cobrar:** en **Inventario**, la Camisa azul quedó en **6** unidades (salieron 4, con la nota «De la factura F-0001», y esa salida no se puede borrar suelta), pero en **Finanzas → Movimientos** **no** hay ningún ingreso nuevo y tu *Disponible* no cambió. Intenta una segunda factura con 7 camisas: se **rechaza** (solo hay 6).
    - **Cobrar en partes:** en la ficha, **Registrar cobro**: el monto sugerido es lo que falta (2,714.00); escribe `1,000` y una nota. La factura pasa a **Cobro parcial** (cobrado 1,000, por cobrar 1,714) y en *Movimientos* aparece un **ingreso** «Cobro F-0001: Hotel Sol» (tu *Disponible* sube RD$ 1,000). Cobrar más de lo que falta o con fecha futura se **rechaza**. Al tocar ese ingreso en *Movimientos* la app te lleva a la factura: **no se edita suelto**.
    - **Vencidas:** emite otra factura («Colegio Luz», `10` × `450`, sin impuesto) con **fecha de hace 45 días** y vencimiento de **hace 15 días**: queda *Vencida* con 15 días de atraso. La pantalla **Facturas** muestra lo **por cobrar** y lo **vencido**, el cuadro *Cuánto lleva vencido* (tramo «1 a 30 días»), *Quién te debe*, los filtros y, en **Inicio**, la línea *Por cobrar* y un aviso de factura vencida. Un cobro parcial **no** la quita de *Vencida* mientras se deba algo.
    - **Corregir:** en una factura emitida solo se editan **cliente, vencimiento y notas** (**Editar datos**). Si algo más está mal: **Anular factura** (con cobros, primero se **eliminan** sus cobros —con confirmación—, y con ello desaparece también su ingreso). Al anular, las unidades vuelven al stock (la Camisa azul vuelve a 10), la factura conserva su número y deja de sumar. Las facturas **no se borran**.
    - **PDF de la factura:** en la ficha, **Descargar PDF**: trae los datos, las líneas, los totales, los cobros y la leyenda **«Documento interno de control. No es un comprobante fiscal ni tiene validez tributaria»**. Al final de la pantalla *Facturas*, **PDF**, **Excel** y **CSV** exportan todo (resumen con cuentas por cobrar, facturas, líneas, cobros y por cliente); las cifras deben ser las mismas que ves en pantalla.
    - **Copia de seguridad:** exporta e importa una copia: facturas, cobros y salidas de stock vuelven iguales. Una copia a la que le quites a mano el ingreso de un cobro, o le cambies el monto de un cobro para que supere el total, se **rechaza completa**.
    - **Demostración:** en *Ajustes → Datos de demostración* puedes cargarla y borrarla de un clic. Ten en cuenta que **suma cobros de facturas a los ingresos de la demostración** (cambian *Resultados* y *Disponible* mientras esté cargada).
    - **En el teléfono:** con las 8 pestañas de *Finanzas* (Empresa), la fila de pestañas **se desliza** hacia los lados y la pestaña abierta queda a la vista.
    - **Actualizar desde la 0.9.0 (opcional):** exporta antes una copia completa, abre la versión nueva en la misma dirección y comprueba que todos tus espacios y su *Disponible* siguen iguales y que en Emprendedor y Empresa aparece la pestaña *Facturas*, vacía. La base pasa a la versión 7 (y luego a la 8 con la 0.11.0); **no se puede volver a la 0.9.0 con esos datos**, para eso está la copia.

26. **Departamentos (Empresa):** crea un espacio *Empresa* (por ejemplo «ABC Servicios»). En **Finanzas** aparece la pestaña **Departamentos** (en Personal, Freelancer y Emprendedor no existe, y la dirección `#/departamentos` lo explica). Vacía te ofrece **Nuevo departamento** o **Ver con datos de demostración** (cuatro áreas inventadas con etiqueta **DEMO**). Para probarla con tus cifras:
    - **Validaciones:** **Nuevo departamento** y **Guardar** sin nombre: lo pide. Escribe un presupuesto inválido (`abc`): se rechaza junto a su campo. Un nombre repetido (aunque cambies mayúsculas: «Ventas» y «ventas») también se rechaza.
    - **Crear:** «Ventas» con presupuesto `10,000`, «Administración» con `3,000` y «Mercadeo» sin presupuesto. Cada una arranca en cero (*En orden*; la de Mercadeo dice *Sin presupuesto*).
    - **Cargar gastos:** registra gastos desde **Inicio** (el formulario de **gasto** trae el selector *Departamento*; el de ingreso **no**): Ventas `5,000` y `3,500`; Administración `1,000` y `3,000`; Mercadeo `2,000`; y uno de `1,500` **sin departamento**. En **Movimientos** cada gasto muestra su departamento como etiqueta.
    - **Leer la pantalla:** Ventas gastó 8,500 de 10,000 → **85 %**, *Cerca del límite*; Administración 4,000 de 3,000 → **Excedido**, «Se pasó RD$ 1,000.00»; Mercadeo 2,000, *Sin presupuesto*. Arriba: *Presupuesto* **13,000** (2 áreas), *Gastado en esas áreas* **12,500**, *Excedido* **1,000** (lo que sobró en Ventas **no** lo tapa) y *Sin departamento* **1,500**. Abajo la cuenta cuadra: **16,000 = 14,500 en áreas + 1,500 sin departamento**. Cada estado lleva su texto, no solo el color. En **Inicio** aparecen los avisos de «Administración» (se pasó) y «Ventas» (cerca del límite).
    - **Mover un gasto:** en **Gastos sin departamento**, elige «Mercadeo» en el selector del gasto de 1,500: pasa a Mercadeo, *Sin departamento* queda en cero y tu *Disponible* **no cambia** (solo se reparte, el dinero es el mismo).
    - **Ficha de un área:** toca «Ventas»: ves su presupuesto, los últimos 6 meses, en qué categorías gasta y sus gastos del mes (cada uno con su selector para moverlo). Con las flechas del mes comparas meses anteriores (con el presupuesto **de hoy**; la app no guarda historial de presupuestos).
    - **Pagos de deudas:** si pagas una cuota de una deuda, **no** se carga a ningún departamento: la pantalla lo dice aparte y no cuenta para los presupuestos.
    - **Archivar y eliminar:** en **Editar** de «Ventas» (tiene gastos) solo hay **Archivar** (no se puede eliminar); archivada, deja de ofrecerse al registrar gastos y ya no tiene presupuesto que cumplir, pero su historial se conserva y se puede **Reactivar**. «Mercadeo» sin gastos sí se puede **Eliminar**.
    - **Exportar:** al final de la pantalla, **PDF**, **Excel** y **CSV** traen las mismas cifras que ves en pantalla.
    - **Copia de seguridad:** exporta e importa una copia: departamentos y reparto vuelven iguales. Una copia a la que le cambies a mano el departamento de un gasto por uno que no existe se **rechaza completa**.
    - **Demostración:** en *Ajustes → Datos de demostración* (en Empresa) puedes cargarla y borrarla de un clic. Si le cargaste un gasto tuyo a un área de demostración, esa área **pasa a ser tuya** al borrarla.
    - **En el teléfono:** la pestaña **Departamentos** queda a la vista dentro de la fila de pestañas y la pantalla no se desborda hacia los lados.
    - **Actualizar desde la 0.10.0 (opcional):** exporta antes una copia completa, abre la versión nueva en la misma dirección y comprueba que todos tus espacios y su *Disponible* siguen iguales y que en Empresa aparece la pestaña *Departamentos*, vacía; tus gastos de antes quedan «sin departamento» hasta que los muevas. La base pasa a la versión 8; **no se puede volver a la 0.10.0 con esos datos**, para eso está la copia.

27. **Gastos por cliente y Logros (0.12.0):**
    - **Gasto cargado a un cliente:** en un espacio *Freelancer* con clientes (o con la demostración cargada), pulsa **Registrar gasto**. Verás **Cargar a un cliente (opcional)** con «Sin cliente (gasto general)» elegido: elige a «Ana» y guarda `2,500`. Los gastos **nunca** piden servicio. Entra a **Finanzas → Clientes**: arriba aparece **Rentabilidad** (gastos cargados a clientes, neto de clientes, gastos generales y clientes en pérdida) y la fila de Ana muestra **Gastos cargados**, **Neto** y **margen**.
    - **Ficha del cliente:** muestra *Cobrado*, *Gastos cargados*, *Neto* y *Margen* (sin cobros, el margen sale «—»). **Registrar gasto** ya trae a ese cliente elegido; editar el gasto y pasarlo a otro cliente (o a «Sin cliente») mueve los números. Un cliente con gastos cargados **no se puede borrar** (archívalo). El **Disponible** baja por el gasto igual que con cualquier gasto: cargarlo a un cliente no lo cambia.
    - **En pérdida:** carga a un cliente más gastos de los que te ha pagado este año: aparece la etiqueta **En pérdida** (texto, no solo color) y un aviso informativo en *Inicio*. Un neto exactamente en cero **no** es pérdida. Exporta **Clientes** a PDF/Excel/CSV: trae las columnas de gastos, neto y margen y la hoja *Gastos de clientes*.
    - **Logros:** en **Inicio**, con al menos un movimiento, aparece la tarjeta **Tu nivel** (nivel, puntos, barra hacia el siguiente y tus tres rachas). Pulsa **Ver logros**: la pantalla muestra tu nivel y los 6 niveles, tus rachas, **Lo siguiente** y los logros por grupo; cada uno dice **Logrado**, **En progreso** (con «3 de 10») o **Pendiente**, y su valor (Bronce · 10 pts, Plata · 25 pts u Oro · 50 pts). Con un movimiento y una meta con un aporte deberías tener 40 puntos y el nivel **Organizador**.
    - **Rachas:** registra movimientos de hace 3 días, antier y ayer (cambia la **Fecha**): la racha diaria dice **3 días** y «En riesgo: registra algo hoy». Al registrar algo hoy pasa a 4 días y desaparece el aviso. Un movimiento de hace una semana no se suma a esa racha.
    - **La demostración no suma:** carga los datos de demostración: la tarjeta y la pantalla **no cambian** los puntos y avisan «Los datos de demostración no suman». Quitarla tampoco los cambia.
    - **Cada espacio tiene los suyos:** en *Personal* no hay logros de clientes; en *Freelancer* aparece el grupo **Clientes**; en *Emprendedor* y *Empresa*, **Negocio**. En el teléfono, ninguna de las dos pantallas se desborda hacia los lados.
    - **Actualizar desde la 0.11.0 (opcional):** exporta antes una copia completa, abre la versión nueva en la misma dirección y comprueba que todos tus espacios y su *Disponible* siguen iguales. **La base de datos no cambia** (sigue en la versión 8, así que la 0.11.0 todavía abre tus datos). Tus gastos de siempre quedan como **gastos generales** y los logros aparecen calculados con lo que ya habías registrado.

28. **Diagnóstico y viabilidad de metas (0.13.0):**
    - **Sin datos:** en un espacio vacío, **Estadísticas → Diagnóstico** dice «Aún no hay datos para el diagnóstico» y ofrece registrar un ingreso, un gasto o cargar la demostración. En **Inicio** no aparece la tarjeta *Diagnóstico* hasta que haya algo registrado.
    - **Con datos reales:** registra, en el mes pasado, un ingreso de `50,000` y un gasto de `40,000`. **Diagnóstico** muestra la **Tasa de ahorro** en **20%** con nivel **Bien**; cambia el gasto a `45,000` y pasa a **10%** con **Atención** y el texto «te faltan RD$ 5,000.00 al mes» para llegar a Bien; con `46,000` queda en **Riesgo**. El nivel siempre se lee en palabras (y con icono), no solo por el color.
    - **Colchón de emergencia:** dice cuántos meses cubre tu *Disponible* (sin lo apartado en metas ni los activos). Aparta dinero en una meta y verás que el colchón **baja**.
    - **Mes parcial:** si solo hay movimientos de este mes, aparece el aviso «el mes típico todavía es parcial».
    - **Deudas:** el indicador de deudas solo aparece si tienes una deuda activa (cuota mensual contra tu ingreso: 20% Bien, 35% Atención); con una cuota vencida sin pagar, **Cuotas vencidas** pasa a **Riesgo** y nombra la deuda.
    - **Viabilidad de metas:** crea dos metas que venzan en menos de un mes, una de `20,000` y otra de `20,000`, con una capacidad de ahorro de `30,000`: la que vence antes sale **Viable** y la otra **Ajustada**, con la fecha en que llegarías. Una tercera sin fecha posible sale **No alcanza**. Una meta con fecha pasada sale **Vencida**. La misma etiqueta se ve **dentro de cada meta** en *Metas* (en todos los espacios, también en Empresa).
    - **Empresa:** en un espacio *Empresa* no hay botón **Diagnóstico** en Estadísticas (allí está *Salud financiera*); si abres `#/diagnostico` a mano, dice que en Empresa el diagnóstico es Salud financiera.
    - **Exportar:** *Exportar el diagnóstico* a PDF, Excel y CSV: el CSV trae la tabla de indicadores y el Excel, además, el detalle, las metas y *Cómo se calcula*. Con la demostración cargada el reporte lo avisa arriba.
    - **En el teléfono:** la pantalla y las tarjetas no se desbordan hacia los lados.
    - **Actualizar desde la 0.12.0 (opcional):** exporta antes una copia completa y abre la versión nueva en la misma dirección. **La base de datos no cambia** (sigue en la versión 8): tus espacios, metas y deudas siguen igual.

29. **Cuentas e inicio de sesión (0.14.0):** *antes de empezar*, haz en el panel de Supabase los ajustes de `docs/BASE_DE_DATOS.md` (sección 5), sobre todo poner `http://localhost:5173` en *Redirect URLs*. **El envío real de correos no se pudo probar al programar (el entorno no tiene salida a Supabase): esta es la primera prueba real y es importante que la hagas.**
    - **Puerta de entrada:** al abrir la app (sin sesión) ves «Entra a ACCONTROL» a pantalla completa, **sin menú ni datos**.
    - **Validaciones:** pulsa **Entrar** sin escribir nada: pide el correo. En **Crear cuenta**, una contraseña corta (`abc`) o muy común (`12345678`) se rechaza junto a su campo, y un correo mal escrito también.
    - **Crear cuenta con un correo tuyo:** con *Confirm email* **activado**, aparece «Revisa tu correo». Abre el enlace **en el mismo dispositivo y navegador**: vuelves a la app ya dentro, con el aviso «Correo confirmado: ya estás dentro.» Si no llega: mira *spam*, espera unos minutos y usa **Reenviar correo** (se habilita a los 60 segundos); si sigue sin llegar, mira `docs/BASE_DE_DATOS.md` (sección 5, punto 2: el correo gratuito de Supabase solo envía a miembros de tu organización). Con *Confirm email* **desactivado**, entras al instante.
    - **Elegir modalidad:** al entrar por primera vez en un navegador sin datos aparece «¿Cómo deseas utilizar ACCONTROL?». Si ya tenías datos de la 0.13.0 en ese navegador, **entras directo a ellos** (pasan a la primera cuenta).
    - **Cerrar sesión y volver a entrar:** *Ajustes → Cuenta → Cerrar sesión* te devuelve a «Entrar». Con la **misma** cuenta ves tus datos; con **otra** cuenta en el mismo navegador empiezas limpio y no ves los de la primera.
    - **Recuperar la contraseña:** en «Entrar», **Olvidé mi contraseña** → escribe tu correo → llega un enlace → ábrelo → «Elige tu contraseña nueva» → entras. La app muestra el **mismo mensaje exista o no el correo** (a propósito, para no revelar quién tiene cuenta).
    - **Cambiar la contraseña (0.14.1: pide la actual):** *Ajustes → Cuenta → Cambiar contraseña*. Hay tres campos: actual, nueva y repetir. Prueba en este orden:
      1. Deja **la actual vacía** → «Escribe tu contraseña actual.»
      2. Escribe una **actual equivocada** → «La contraseña actual no es correcta.» (sale junto al campo de la actual). Después, cierra sesión y comprueba que **sigues entrando con la contraseña de antes**.
      3. Pon como nueva **la misma que la actual** → «La contraseña nueva debe ser distinta de la actual.»
      4. Con todo bien → «Contraseña cambiada.»; cierra sesión y entra con la nueva.
      5. **Comprobar que el servidor la exige** (solo si activaste la opción de `docs/BASE_DE_DATOS.md`, sección 5, punto 8): esta parte no se puede hacer desde la pantalla, porque la pantalla nunca deja enviar sin la actual. Si quieres hacerla, pídeme ayuda y la hacemos juntos.
      6. Después, haz otra vez **Recuperar la contraseña** (el punto anterior): tiene que seguir funcionando **sin pedir la actual**.
    - **Sin conexión:** con la sesión iniciada, apaga el Wi-Fi y recarga: la app **abre** (la sesión está guardada). Entrar o crear una cuenta sin internet dice que no hay conexión.
    - **Eliminar la cuenta (usa una cuenta de prueba):** *Ajustes → Eliminar mi cuenta* y escribe `ELIMINAR`. La cuenta desaparece del servidor (en Supabase: *Authentication → Users*) y ya no se puede entrar con ella. **Los datos guardados en el dispositivo no se borran** (para eso, *Borrar todos mis datos*).
    - **Copia en la nube y sincronización:** desde la 0.15.0 (puntos 36 y 37).
    - **Actualizar desde la 0.13.0 (opcional):** exporta antes una copia completa, abre la versión nueva en la misma dirección, entra o crea tu cuenta y comprueba que tus espacios y su *Disponible* siguen iguales. **La base de datos del dispositivo no cambia** (sigue en la versión 8).

30. **Recorrido guiado (0.14.2):** se prueba en la computadora **y** en el celular, en los cuatro tipos de espacio (Personal 15 pasos, Freelancer 17, Emprendedor 18, Empresa 19).
    - **Bienvenida:** en un navegador sin datos (o una cuenta nueva), crea un espacio **Personal**. Sale «Te damos la bienvenida a tu espacio Personal» con **Empezar recorrido** y **Saltar, ya sé usar la app**.
    - **Recorrido:** pulsa *Empezar recorrido*. La pantalla se oscurece, **un** elemento queda iluminado y una tarjeta dice «Paso 1 de 15». Avanza con *Siguiente*: la app cambia sola de pantalla (Finanzas, Metas, Estadísticas, Logros, Ajustes). Comprueba en cada paso que lo iluminado es lo que dice la tarjeta y que la tarjeta no lo tapa.
    - **Computadora vs. celular:** en la computadora se ilumina el menú de la **izquierda**; en el celular, la **barra de abajo**, el botón redondo **+** y el ícono de **Ajustes** de arriba.
    - **Girar el celular** a mitad del recorrido: lo iluminado y la tarjeta se recolocan. **Cambiar el tamaño de la ventana** en la computadora: igual.
    - **Teclado (computadora):** flecha derecha o Enter = siguiente; flecha izquierda = atrás; **Esc** = cerrar.
    - **Último paso:** el botón dice **Terminar**. Al pulsarlo vuelves a la pantalla donde empezaste.
    - **Que se recuerde:** recarga la página: la bienvenida **no** vuelve a salir. Crea **otro** espacio Personal: tampoco. Entra con **otra** cuenta en el mismo navegador: a esa sí se le ofrece.
    - **Repetir:** *Ajustes → Recorrido guiado → Ver el recorrido otra vez*.
    - **Saltar:** en la bienvenida, *Saltar*: sale el aviso «Puedes ver el recorrido cuando quieras en Ajustes».
    - **Otros tipos:** crea (con *Cambiar de espacio → Crear otro espacio*) un espacio **Freelancer**, uno **Emprendedor** y uno **Empresa**. En cada uno sale **su** bienvenida, aunque ya hayas visto el de Personal.
      - Freelancer: señala la pestaña **Clientes** y el botón **Nuevo cliente**; no habla de facturas (en Freelancer todavía no existen).
      - Emprendedor: **Resultados**, **Inventario** y **Facturas**.
      - Empresa: **Resultados**, **Salud**, **Departamentos**, **Inventario** y **Facturas**; no tiene paso de Diagnóstico (Empresa usa Salud) ni habla de empleados o sucursales.
      - En el **celular**, las pestañas de Finanzas no caben en Emprendedor y Empresa: en los pasos Facturas, Deudas y Patrimonio la fila se desliza sola hasta mostrar la pestaña iluminada.
      - En Ajustes, el paso «Datos de tu negocio / organización / datos profesionales» ilumina el panel donde se completan.
    - **Lector de pantalla (opcional):** con NVDA o TalkBack, al avanzar se lee el título, «Paso X de N» y la explicación.
    - **Reducir movimiento:** con «Quitar animaciones» activado en Windows o Android, la tarjeta salta de un lugar a otro sin animación.

31. **Aspecto y movimiento (0.14.3, parte 1: Inicio y barra de navegación):** en la computadora **y** en el celular.
    - **Inicio, «el billete»:** la tarjeta «Disponible» es blanca con un **doble filete** fino del color del espacio, una **roseta de guilloché** (dibujo de líneas finas en círculo) a la derecha, la palabra DISPONIBLE en mayúsculas pequeñas, la cifra muy grande en letra condensada y, abajo del todo, una línea de **microtexto** diminuto. La roseta nunca tapa con fuerza la cifra, la explicación ni los botones. Con datos de demostración aparece el sello **DEMO** junto a «Disponible».
    - **Color por espacio:** abre un espacio de cada tipo. La barra (arriba en el celular, a la izquierda en la computadora), los botones principales y la pestaña activa cambian de color: Personal **violeta**, Freelancer **naranja tostado**, Emprendedor **verde azulado**, Empresa **carmín**. El fondo de la app es un gris verdoso muy claro («papel de seguridad»). El rojo solo aparece en errores, alertas y números negativos.
    - **Cifras del mes** (carga los datos de demostración si no tienes movimientos): cuatro baldosas; **Ingresos** en fondo verde suave con el monto en verde, **Gastos** en azul suave, las otras dos en gris claro. Las etiquetas van en mayúsculas pequeñas.
    - **Entrada suave:** ve a Metas y vuelve a Inicio: los bloques aparecen uno tras otro, con un fundido y subiendo un poco (todo dura menos de medio segundo). **Al guardar un ingreso estando en Inicio, NO debe repetirse la entrada.**
    - **Barra de abajo (celular):** la pestaña activa tiene una píldora clara del color del espacio detrás del ícono, que aparece con un frenado suave (sin rebote) al cambiar de pestaña. Al tocar una pestaña, el ícono se hunde un poco. La barra deja ver el contenido de atrás desenfocado.
    - **Botón +:** círculo del color del espacio (más oscuro abajo); al tocarlo se hunde. En el celular no tapa ningún número de Inicio (el patrimonio neto deja sitio a su derecha).
    - **Menú lateral (computadora):** el enlace activo tiene un fondo blanco tenue y una barrita blanca a la izquierda que «crece» al cambiar de pantalla. Al pasar el ratón por encima aparece un fondo tenue.
    - **Reducir movimiento:** en Android, *Ajustes → Accesibilidad → Quitar animaciones* (el nombre cambia según la marca); en Windows, *Configuración → Accesibilidad → Efectos visuales → Efectos de animación: desactivado*. Con eso, Inicio aparece de golpe, la roseta no gira y la píldora aparece sin movimiento.
    - **Toda la app (partes 2 y 3):**
      1. **Letra:** los textos usan Barlow y los títulos y cifras grandes Barlow Semi Condensed (más estrecha, como los números de un billete), también sin internet.
         **Íconos e instalación:** al instalar la app, el ícono es un cuadro oscuro con una «A» blanca (ya no el degradado azul-verde). En la barra de color se ve la marca «A» con doble filete.
      2. **Al cambiar de pantalla** (Finanzas, Metas, Estadísticas…) la pantalla aparece con un fundido corto y sube un poco. En Finanzas, las filas de movimientos entran una tras otra, rápido.
      3. **Al tocar** cualquier botón, pestaña o fila, se hunde un poco. Las pestañas de Finanzas tienen una «tarjeta» blanca que se mueve a la activa.
      4. **Hojas** (por ejemplo, el botón +): entran subiendo y, al cerrarlas (X, tocar fuera o el botón Atrás del celular), salen bajando con suavidad.
      5. **Avisos** («Gasto guardado.»): entran subiendo y salen bajando; tócalos para cerrarlos antes.
      6. **Montos que cuentan:** ve a Metas y vuelve a Inicio: «Disponible» y «Patrimonio neto» suben rápido hasta su valor. **El valor final debe ser exactamente el mismo de antes, al centavo.** Al guardar un dato estando en Inicio, NO deben volver a contar.
      7. **Barras:** al entrar a Metas, la barra de cada meta se llena de izquierda a derecha.
      8. **Estados vacíos:** en un espacio nuevo, Metas, Finanzas, Estadísticas… muestran un dibujo con el ícono de la sección y un título más cálido. Los avisos de error («Esa deuda ya no existe») siguen serios.
      9. **Celebración:** crea una meta pequeña (por ejemplo RD$ 500) y apórtale todo: salen papelitos de colores un instante y el aviso «¡Meta cumplida: «…»! Lo lograste.». Con datos de demostración **no** hay celebración.
      10. **Vibración (Android con Chrome):** al guardar un gasto o un aporte, el celular vibra muy corto; al cumplir la meta, dos toques. En *Ajustes → Este dispositivo* apaga «Vibrar al confirmar» y repite: ya no vibra. En iPhone o en la computadora no vibra nunca (el navegador no lo permite) y Ajustes lo dice.
      11. **Reducir movimiento** (activado): nada se mueve, «Disponible» aparece ya con su valor, las hojas se cierran de golpe y no hay papelitos (el aviso de meta cumplida sí sale).

32. **Chele conduce el recorrido (0.14.4, parte 1: espacio Personal):** en la computadora **y** en el celular.
    1. Crea una cuenta nueva (o usa una que no haya visto el recorrido Personal) y abre un espacio **Personal**. Se oscurece la pantalla y aparece **Chele** en el centro **saludando con la mano**, con su globo: «¡Hola! Soy Chele…». El texto aparece letra a letra, rápido.
    2. **Toca el globo** (no los botones) mientras escribe: el texto sale completo al instante.
    3. Botones: **Empezar recorrido** y **Saltar, ya sé usar la app**. Saltar (o Esc) cierra y sale el aviso «Puedes ver el recorrido cuando quieras en Ajustes».
    4. Con **Empezar recorrido**: arriba del globo dice «Chele · Paso 1 de 15». Chele va al lado del globo, **mira y señala** hacia lo resaltado, y la **colita del globo apunta** al elemento. Pasos 1 a 3: Inicio, Disponible y el botón +. Al pulsar Siguiente, Chele **se desliza** al nuevo sitio; mientras esperas, **flota un poquito y parpadea**.
    5. Comprueba en cada paso: Chele y el globo **no tapan** lo resaltado ni los botones; en el celular Chele es **más pequeño** y **no pisa la barra de pestañas** de abajo. Si en el celular no cabe (por ejemplo en «Disponible», que es alto), Chele se aparta y queda el globo solo, a lo ancho.
    6. Atrás, Siguiente, Saltar, las flechas del teclado y Esc funcionan como antes.
    7. **Reducir movimiento** activado: el texto sale completo de una vez y Chele está quieto (con su expresión).
    8. **Lector de pantalla (opcional):** con NVDA o TalkBack se lee el texto completo del paso de una vez (no letra por letra) y el dibujo no se anuncia.
    9. **Los otros espacios:** crea (o abre por primera vez) un espacio **Freelancer**, **Emprendedor** y **Empresa**. Chele aparece del **color de ese espacio** (naranja tostado, verde azulado, carmín) y saluda distinto: «¡Oh, ahora somos freelancers!», «¡A emprender se ha dicho!», «¡Modo empresa activado!». En cada pantalla habla de lo suyo (clientes, facturas, inventario, salud financiera, departamentos…) y en el último paso se despide **contento** («¡Y listo…!»).
    10. **Modo oscuro:** repite un recorrido de noche: Chele mantiene el color de su espacio y se lee bien.

33. **Modo claro / oscuro (0.14.4):**
    1. **Computadora:** al pie del menú lateral, junto a *Ajustes*, hay un cielo pequeño con un sol. Tócalo: **anochece** (el sol baja y se esconde detrás de la colina, sale la luna y aparecen estrellas) y toda la app pasa a colores de noche. Tócalo otra vez: **amanece**.
    2. **Teléfono:** ve a *Ajustes → Este dispositivo → Modo oscuro*: el mismo cielo, más grande. Al lado dice *Activado* o *Desactivado*. (En la barra de arriba del teléfono no está, para que el nombre de tu espacio se lea completo.)
    3. Recorre Inicio, Finanzas, Deudas, Metas, Estadísticas, Logros y Ajustes en oscuro: todo se lee bien, el billete de Inicio es nocturno con la cifra en el color del espacio, y los avisos de error siguen viéndose serios (rojo).
    4. Cambia de espacio (Personal, Freelancer, Emprendedor, Empresa): cada uno conserva su color también de noche.
    5. **Cierra la app y vuelve a abrirla:** sigue en oscuro y no hay destello blanco al abrir.
    6. **Reducir movimiento** activado: el cielo cambia de golpe, sin animación.
    7. **Lector de pantalla (opcional):** el botón se anuncia como «Modo oscuro, botón de alternancia, activado/desactivado».

34. **Facturas en Freelancer (0.14.5):** en un espacio **Freelancer**.
    1. *Finanzas* tiene ahora la pestaña **Facturas**. Carga los datos de demostración: aparecen DEMO-001 (Beto, con cobro parcial y **vencida**), DEMO-002 (Ana, por vencer) y DEMO-003 (Dani, cobrada).
    2. Arriba de la lista está **Recordatorios de cobro** con la de Beto. Pulsa **Copiar mensaje de recordatorio** y pégalo en un chat o una nota: debe decir la factura, la fecha, el vencimiento, el saldo (RD$ 12,700.00) y lo ya recibido. El aviso dice que **ACCONTROL no lo envía**. (Si tu navegador no deja copiar, se abre el texto para copiarlo a mano.)
    3. Crea un cliente tuyo (real) con un servicio de RD$ 20,000 *En proceso*. En su ficha, en el servicio, pulsa **Facturar**: la factura llega con el cliente, su contacto y RD$ 20,000 propuestos («quedan RD$ 20,000.00 por facturar»).
    4. Cambia el precio a 20,000.01 y emite: **error** («Pasa de lo que queda por facturar»). Pon 10,000 y 18 % de impuesto: se emite **F-0001** (no DEMO), total RD$ 11,800.00, con «Servicio: …» en el detalle y un enlace a la ficha del cliente.
    5. En la ficha del cliente: el servicio muestra *Facturado RD$ 10,000.00 (lo cuenta su factura)* y *Por cobrar sin facturar RD$ 10,000.00*; *Por cobrar* del cliente = 11,800 (factura) + 10,000 (sin facturar) = **RD$ 21,800.00**, no más.
    6. Registra el cobro de 11,800 en la factura: el pago aparece en el cliente como «Cobro de F-0001», *Cobrado* sube **una sola vez** (11,800) y *Por cobrar* queda en RD$ 10,000.00. En *Movimientos* hay un solo ingreso de 11,800.
    7. Intenta **eliminar** ese cliente o el servicio: no se puede (tienen factura). Intenta bajar el precio del servicio a 5,000: no se puede (ya facturaste 10,000).
    8. Anula una factura **sin cobros** de un servicio: lo de ese servicio vuelve a «sin facturar».
    9. Descarga el **PDF** de la factura (dice que no es comprobante fiscal) y el reporte de facturas (la columna *Producto o servicio* muestra el servicio). Haz una **copia de seguridad**, restaúrala en otro espacio y comprueba que la factura sigue ligada a su cliente y su servicio.
    10. *Quitar la demostración*: se van las tres facturas DEMO y sus cobros; tu F-0001 se queda.

35. **Códigos, ojo y sol/luna (0.14.6).** Antes, haz el punto 9 de `docs/BASE_DE_DATOS.md` (plantillas con `{{ .Token }}` y, para correos de otras personas, SMTP propio).
    1. **Crear cuenta:** crea una cuenta con un correo tuyo. Aparece *Confirma tu correo* con un campo grande `000-000`. Te llega un correo con el código: cópialo y pégalo (con o sin guion; también puedes copiar el mensaje entero, o usar el botón *Pegar*). *Confirmar y entrar* → entras a elegir modalidad.
    2. **Código equivocado:** escribe 000000: sale en rojo «El código no es correcto, venció o ya se usó…». **Reenviar código** está gris un minuto; después pídelo: el código anterior deja de servir.
    3. **Olvidé mi contraseña:** en *Entrar* → *Olvidé mi contraseña* → tu correo → *Enviar código*. Pega el código → *Continuar* → «Código correcto. Ahora elige tu contraseña nueva» → escríbela dos veces → entras. Cierra sesión y entra con la contraseña nueva (la vieja ya no sirve).
    4. **El ojo:** en cualquier campo de contraseña (también en *Ajustes → Cuenta → Cambiar contraseña*) el ojo está **cerrado**; tócalo: se **abre** con una estela suave y se ve lo escrito; tócalo otra vez: se cierra.
    5. **Sol y luna:** en la pantalla de acceso, arriba a la derecha, está el **sol**. Tócalo: gira y se hunde, entra la **luna** girando y saltan chispitas; todo pasa a oscuro. Tócalo otra vez: amanece. Dentro de la app está igual en el menú lateral y en *Ajustes → Este dispositivo* (grande).
    6. **Reducir movimiento** activado: el ojo y el sol/luna cambian sin animación.
    7. **Contraseña fuerte:** al crear una cuenta prueba `micasa2026!` → «Le falta una mayúscula.»; `MiCasa2026` → «Le falta un símbolo…»; `Mi-Casa-2026!` → se acepta.
36. **Copia en la nube (0.15.0, paso 5).** Hazlo con una cuenta **de prueba** (no la tuya de siempre) y **antes descarga una copia de seguridad**.
    1. **La pregunta, una sola vez:** entra, crea o abre un espacio. A los pocos segundos aparece «¿Guardar tus datos en la nube?» con *Ahora no* y *Sí, ver cómo*. No aparece encima de la pantalla de elegir modalidad ni encima del recorrido guiado. Toca *Sí, ver cómo*: te lleva a *Ajustes → Copia en la nube*. Recarga la página: la pregunta **no** vuelve a salir.
    2. **Activar:** en *Copia en la nube* toca **1. Descargar copia de seguridad** (se descarga el archivo) y luego **2. Activar copia en la nube** → *Activar y subir mis datos*. Sale «Copia en la nube activada: N registros subidos y comprobados.» y la sección dice *Activada*. N es la cantidad de tus registros **reales**: los de demostración no cuentan ni se suben.
    3. **En Supabase** (panel → *Table Editor*): en `workspaces` aparece tu espacio y en `movements` tus movimientos reales (columna `is_demo` = false). Ninguna fila de demostración.
    4. **Cambios que llegan solos:** registra un gasto. En *Ajustes → Copia en la nube* el estado pasa a «Todo enviado a la nube. Último envío: …». En Supabase aparece el gasto nuevo.
    5. **Sin internet:** apaga el wifi o pon el modo avión, registra otro gasto y abre *Ajustes*: «No hay conexión con la nube… Quedan 1 cambio por enviar; están guardados en este dispositivo.» Vuelve a conectar: en unos segundos «Todo enviado».
    6. **Borrar todo:** con la copia activada, *Ajustes → Borrar todo* tiene **dos** botones. *Borrar de este dispositivo* (escribe BORRAR) deja tus datos en Supabase y apaga la copia aquí. *Borrar de todos mis dispositivos* los marca como borrados también en Supabase (columna `deleted_at` con fecha) y sin internet no borra nada.
    7. **Otro dispositivo con datos propios:** entra con la misma cuenta en otro dispositivo que ya tiene datos y toca *Activar*. La confirmación dice que tu cuenta ya tiene espacios en la nube y que **se juntarán** con los de aquí; el botón dice *Activar y juntar mis datos*. Al terminar, los dos dispositivos tienen los espacios de ambos.
37. **Sincronización entre dispositivos (0.15.0).** Con la misma cuenta **de prueba** del punto 36 y dos navegadores (por ejemplo, la computadora y el teléfono, o Chrome y Edge).
    1. **Dispositivo vacío:** entra en el segundo navegador. Aparece «Tus datos están en la nube» con *Traer mis datos* y *Empezar de cero aquí*. Toca *Traer mis datos*: sale «Listo: tu espacio está en este dispositivo y sincronizando.» y ves los mismos movimientos que en el primero.
    2. **Un cambio llega al otro:** en el primero registra un gasto. En el segundo toca *Ajustes → Copia en la nube → Sincronizar ahora* (o sal de la app y vuelve, o espera unos 3 minutos): el gasto aparece **sin recargar**.
    3. **Espacio nuevo:** crea un espacio en el primero y sincroniza el segundo: sale «Llegó el espacio «…» desde tu otro dispositivo».
    4. **Borrado:** borra un gasto en el primero y sincroniza el segundo: desaparece también allí.
    5. **Conflicto:** apaga el wifi del segundo, edita **el mismo gasto** en los dos (primero en el segundo, luego en el primero), vuelve a conectar y sincroniza: se queda la edición **más reciente** y la app avisa «Un dato había cambiado en dos dispositivos…».

38. **Compartir un espacio (0.16.0).** Necesitas **dos cuentas de prueba** (A y B), cada una en un navegador distinto, las dos con la copia en la nube activada. Usa un espacio **Emprendedor, Freelancer o Empresa** (el Personal no se comparte).
    1. **Invitar:** con A, en *Ajustes → Miembros*, toca *Invitar*, elige **Contador** y *Crear código*. Sale un código `XXXX-XXXX-XXXX` y un mensaje. Cópialo (este código no se vuelve a mostrar).
    2. **Unirse:** con B, en *Ajustes → Espacios de trabajo*, toca *Unirme con un código*, pega el código y *Unirme*. Sale «Te uniste a «…» como Contador» y el espacio queda abierto con el aviso **Solo lectura**: no hay botones para añadir ni editar.
    3. **Cambiar el rol:** con A, en *Miembros*, cambia a B a **Administrador**. Con B, *Copia en la nube → Sincronizar ahora*: sale «Tu rol… ahora es Administrador», desaparece el aviso y ya puede registrar un gasto, que le llega a A al sincronizar. B sigue sin poder renombrar el espacio ni cambiar su saldo inicial.
    4. **Anular:** con A crea otro código y luego toca *Anular*. Ese código ya no sirve.
    5. **Salir y quitar:** con B toca *Salir* en el espacio de A: desaparece de B, y A lo conserva con todos sus datos. Invítalo otra vez y, con A, toca *Quitar*: al sincronizar, B deja de verlo.

39. **Roles a medida (0.16.1).** Con las mismas dos cuentas del punto 38 (A dueña de un espacio de negocio, B miembro).
    1. Con A, en *Ajustes → Miembros → Roles a medida*, toca *Nuevo rol*, elige la plantilla **Cajero** y guarda. La lista dice qué permite.
    2. Cambia a B a **Cajero** en su selector de rol (o invítalo con ese rol). Con B, *Copia en la nube → Sincronizar ahora*: el espacio dice «Cajero», no aparecen **Metas** ni **Patrimonio**, y sí puede registrar un gasto.
    3. Con B, toca un movimiento que registró A: no se abre y explica «solo puedes corregir lo que registraste tú». El gasto que registró B sí se abre para corregir, y le llega a A al sincronizar.
    4. Con A, edita el rol y dale **Patrimonio: Ver**. Con B, sincroniza: sale «Tu rol… ahora es Cajero» y ya ve el patrimonio.

40. **Filtros del inventario y fiado (0.16.2 y 0.16.3).** En un espacio **Emprendedor**:
    1. *Finanzas → Inventario*: toca **Stock bajo**, **Agotados** y **Con stock** y comprueba que cada producto cumple lo que dice el botón; escribe parte de un nombre sin tildes (por ejemplo «cafe») o un código completo en el buscador.
    2. *Finanzas → Fiado → Fiar*: anota «José Pérez», «Pan y leche», RD$ 150. Vuelve a fiar a «jose perez» RD$ 100: debe salir **una sola persona** con RD$ 250, con el nombre «José Pérez».
    3. Abre a José → **Cobrar abono** de RD$ 300: debe decir que debe RD$ 250 y no guardar nada. Cobra RD$ 200: queda debiendo RD$ 50, y en *Movimientos* aparecen dos ingresos «Cobro F-0001» y «Cobro F-0002».
    4. **Copiar estado de cuenta** y pégalo en una nota: debe terminar en «Saldo pendiente: RD$ 50.00».

41. **Productos para la caja (0.17.0).** En un espacio **Emprendedor**, *Finanzas → Inventario → Nuevo producto*:
    1. Toca **Elegir foto** y elige una foto del teléfono (o tómala con la cámara): debe verse la miniatura. **Quitar foto** la borra.
    2. Escribe un **Grupo** (por ejemplo «Bebidas»); en el siguiente producto, el grupo aparece como sugerencia.
    3. Crea «Gomitas sueltas» con **Sin control de stock**: en la lista sale «Sin conteo» y «No se cuenta»; no aparece al **Registrar compra**; una factura de 300 gomitas se emite sin pedir stock.
    4. A un producto con compras, la casilla «Sin control de stock» le sale bloqueada.
    5. Con la copia en la nube activa, abre el mismo espacio en otro dispositivo: la foto y el grupo llegan.

42. **La caja (0.17.1).** En un espacio **Emprendedor** con productos (o con la demostración):
    1. *Finanzas → Inventario → Abrir caja*: la pantalla ocupa todo, sin menús. Toca un grupo y luego **Todos**.
    2. Toca un producto varias veces: sube su cantidad en «Venta actual». Un producto agotado no entra. Usa − y +.
    3. Escribe un código (por ejemplo `CAM-001` de la demostración) y pulsa Enter: el producto entra (así funciona la pistola lectora).
    4. Marca **ITBIS 18 %** y toca **Cobrar**: en **Efectivo**, toca un monto rápido y mira la **devuelta**; cobra. Debe decir «Venta cobrada» y en *Inventario* el stock baja; en *Facturas* aparece la factura cobrada.
    5. Haz otra venta con **Fiado**: sin nombre no deja; con nombre, aparece en *Fiado*.
    6. En el teléfono, la barra de abajo muestra el total y **Ver venta** baja hasta la venta.

43. **Ticket y lector de códigos (0.17.2).** Con aparatos reales (lo que la prueba automática no puede comprobar):
    1. **Impresora de tickets de 80 mm** conectada a la computadora: en la caja cobra una venta y toca **Imprimir ticket**; en la ventana de imprimir elige la impresora. Debe salir del ancho del papel y cortarse al final. Sin impresora, elige **Guardar como PDF**.
    2. **Pistola lectora** (USB o Bluetooth, en modo teclado): en la caja, toca un producto y luego escanea el código de otro: debe entrar a la venta sin tocar el buscador. En *Inventario*, escanea en el buscador: se abre la ficha.
    3. **Cámara** (teléfono Android con Chrome): en la caja toca **Cámara**, da permiso y apunta al código de barras de un producto que tengas guardado con ese código. Si el botón no aparece, ese navegador no sabe leer códigos.

44. **Un espacio de cada tipo y menú «Añadir» (0.17.4).**
    1. *Ajustes → Espacios de trabajo → Crear otro espacio*: los tipos que ya tienes salen desactivados con «Ya lo tienes: …». Crea los que faltan; con los cuatro, el botón avisa en vez de abrir la ventana.
    2. En el teléfono toca **+**: arriba Ingreso (verde) y Gasto, abajo Ahorro, Deuda y Activo; en un espacio Emprendedor, también «Tu negocio» (Abrir caja, Fiar, Nueva factura, Nuevo producto). Prueba en modo oscuro.
    3. Toca **Gasto**: el monto se ve grande sobre una banda; escribe una cifra y guarda.

45. **Oferta por cantidad (0.17.5).**
    1. En un espacio Emprendedor: *Inventario → Nuevo producto*: «Pan», precio 8, oferta **2** por **15**. Mira la ayuda: «2 = RD$15.00 · 3 = RD$23.00 · 6 = RD$45.00». Prueba 2 por 16: no te deja (no sale más barata).
    2. *Abrir caja*: la tarjeta del pan dice «2 por RD$15.00». Tócala 7 veces: la venta da **RD$53.00** y dice «Ahorra RD$3.00».
    3. Cobra y abre la factura: una línea «Pan (oferta 2 por RD$15.00)» de 6 a RD$7.50 y otra «Pan» de 1 a RD$8.00.

## 3. Probar en el teléfono Android

### Opción A — Misma red Wi-Fi (la más rápida)

1. Conecta el teléfono **a la misma Wi-Fi** que la computadora.
2. Con `npm start` en marcha, escribe en Chrome del teléfono la dirección `http://192.168.x.x:5173` que mostró la terminal en la línea “En tu celular”.
3. La app funciona completa. **Pero Android no ofrecerá instalarla**: instalar una PWA exige HTTPS (la excepción es `localhost`).

Si no abre:
- **Windows**: la primera vez, el Firewall pregunta si permites Node.js en redes privadas → *Permitir*.
- Revisa que ambos estén en la misma red (no “red de invitados”) y que no haya VPN activa.
- Algunos routers aíslan los dispositivos entre sí (“aislamiento de clientes”); en ese caso usa la Opción B.

### Opción B — Publicarla con HTTPS gratis (para poder **instalarla**)

**Forma actual: GitHub + Vercel.** El código está en un repositorio **privado** de GitHub y Vercel publica sola cada versión que se sube. Vercel ejecuta `npm run build`, que copia a `dist/` **solo** los archivos de la app (sin pruebas, documentos ni migraciones) y recalcula `precache.json`. La configuración está en `vercel.json`. Después de cada subida, abre la dirección `https://….vercel.app`: la app avisa que hay una versión nueva. Recuerda agregar esa dirección en Supabase (*Authentication → URL Configuration → Redirect URLs*).

Otra opción: la app es solo archivos estáticos, así que también se puede publicar a mano en un hosting gratuito. Ejemplos: **Cloudflare Pages**, **Netlify** o **GitHub Pages**. Con cualquiera:

1. Sube el contenido de la carpeta `accontrol` (sin `node_modules`).
2. No hay paso de compilación: el directorio a publicar es la raíz del proyecto.
3. Abre la dirección `https://…` en Chrome del teléfono → menú ⋮ → **Instalar aplicación** (o *Añadir a pantalla de inicio*).

> Antes de publicar, recuerda que en la Etapa 1 **no hay cuentas ni cifrado** y que los datos quedan solo en cada dispositivo. Publicar la app no publica tus datos (viven en tu navegador), pero la dirección será accesible para cualquiera que la conozca; la app estará vacía para ellos.

### Opción C — Depuración remota con cable (avanzado, opcional)

Chrome del teléfono por USB + `chrome://inspect` en la computadora permite ver la consola del teléfono. Úsalo solo si algo falla en el teléfono y no en la computadora.

## 4. Mover datos entre computadora y teléfono

Con la **copia en la nube** activada (0.15.0) tus dispositivos ya comparten los datos solos (punto 37). Sin activarla, se pasan a mano:

1. En el dispositivo con los datos: **Ajustes → Copia de seguridad → Exportar copia (.json)**.
2. Pasa el `.json` al otro dispositivo (correo, USB, Drive…).
3. En el otro: **Ajustes → Copia de seguridad → Importar copia…**. La app muestra qué trae (los registros de un espacio, o todos los espacios si es una copia completa) y pide confirmación; **reemplaza** lo que haya: el espacio abierto si la copia es de un solo espacio, o todos tus espacios si es completa. En una primera apertura (pantalla de bienvenida) también puedes restaurar una copia desde ahí.
4. Si quieres llevar **todos** tus espacios, usa **Exportar copia completa** (aparece cuando tienes más de un espacio).

## 5. Comprobar el modo sin conexión

1. Abre la app una vez con internet (se descarga todo a la caché del navegador).
2. En Chrome (computadora): `F12 → Network → Offline`, o apaga el Wi-Fi del teléfono.
3. Recarga: la app debe abrir y mostrar tus datos.

## 6. Pruebas automáticas

| Comando | Qué comprueba |
|---|---|
| `npm test` | 1133 pruebas de la lógica: dinero, fechas, movimientos, metas (con su ritmo), deudas, presupuesto, patrimonio, matemática financiera, calculadoras, exportación (CSV, Excel, PDF), resúmenes por período, copias de seguridad (de un espacio y completas), almacén, espacios de trabajo (aislamiento, migración, varias pestañas), datos de la organización, clientes y servicios (reglas, cálculos, copias de seguridad, demostración), resultados del negocio (estado de resultados, comparación, proyección, avisos, reporte), salud financiera de la empresa (indicadores, niveles, textos, avisos, demostración, reporte), inventario (costo promedio, stock nunca negativo, compras y ventas ligadas al dinero, borrados, copias de seguridad manipuladas, avisos, demostración, reporte), facturas internas (totales e impuesto derivados, estados, cobros ligados al dinero, existencias, anulación, copias de seguridad manipuladas, demostración, reporte), departamentos (validación, estados con frontera al centavo, cuentas del mes que cuadran, ritmo, pagos de deudas aparte, reparto de gastos, avisos, copias de seguridad manipuladas, demostración, reporte), gastos cargados a clientes (reglas, neto y margen, ranking, pérdida, avisos, copias de seguridad, reporte), logros y rachas (días, semanas y meses, racha en riesgo, demostración excluida, puntos y niveles), cuentas (validación de correo y contraseña, cliente de inicio de sesión contra un servidor simulado: renovación de sesión, enlaces del correo, errores de red, varias pestañas), configuración y esquema de la base de datos (RLS, permisos, categorías de fábrica), rutas y lista de precache. Deben salir **todas en verde** (`pass 1133`, `fail 0`). |
| `npm install` y luego `npm run typecheck` | Revisión de tipos con TypeScript. No debe imprimir errores. |

Los recorridos en navegador real (escritorio, celular simulado, sin conexión) se ejecutaron con Playwright durante el desarrollo; **no van incluidos** en el zip porque dependen de herramientas que no son parte de la app.

## 7. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `npm` no se reconoce | Node no está instalado o la terminal se abrió antes de instalarlo | Cierra y vuelve a abrir VS Code. |
| La pantalla dice “No se pudieron abrir tus datos” | Ventana privada o almacenamiento bloqueado | Abre en ventana normal y permite datos del sitio. Tus datos no se borraron. |
| Cambié un archivo y no veo el cambio | El service worker sirve la copia guardada | `Ctrl + F5`, o F12 → Application → Service Workers → *Unregister* / *Update on reload*. |
| El teléfono no conecta | Firewall, VPN o red distinta | Ver Opción A; o usa la Opción B. |
| “Instalar” no aparece | Falta HTTPS | Usa la Opción B. |
| Añadí archivos nuevos y no funcionan sin conexión | `precache.json` desactualizado | `npm run precache`. |
| No me llega el correo de confirmación o de recuperación | Spam; o el correo gratuito de Supabase solo envía a miembros de tu organización y tiene tope por hora | Mira en spam, usa **Reenviar correo** tras 60 s y revisa `docs/BASE_DE_DATOS.md` (sección 5). |
| El enlace del correo no me trae a la app (o dice que venció) | La dirección de la app no está en *Redirect URLs* de Supabase, o el enlace ya se usó / venció | Agrega la dirección exacta (por ejemplo `http://localhost:5173`) y pide un correo nuevo. Ábrelo en el mismo navegador. |
| «No hay conexión con el servidor» al entrar | Sin internet, o la dirección de Supabase en `src/config.js` o en la política de `index.html` no coincide | Revisa tu internet; si cambiaste de proyecto, cambia ambos sitios (hay una prueba que lo verifica). |
| La app me pide entrar de nuevo | La sesión venció o se cerró desde otra pestaña | Entra otra vez: tus datos del dispositivo siguen ahí. |
