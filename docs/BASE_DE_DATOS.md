# Base de datos en la nube y cuentas (Etapa 2, parte 1 · versión 0.14.0)

Este documento describe lo que se construyó en Supabase, cómo está protegido, cómo se probó y **qué tienes que configurar tú en el panel** (la app no puede hacerlo por ti). Está escrito para que, aunque cambie quien programa, se pueda retomar desde cero.

> **Estado honesto (0.15.0, paso 5):** las cuentas funcionan y, **si la persona la activa** en *Ajustes → Copia en la nube*, la app sube sus datos reales (nunca los de demostración), comprueba que llegaron completos y luego envía cada cambio. Lo que **todavía no** hace: **bajar** datos de la nube a otro dispositivo ni juntar dos dispositivos (paso 6). La sintaxis exacta de dos peticiones (el cursor para bajar cambios y el marcado de borrados) solo se probó contra la base simulada; falta probarla contra el servidor real con una cuenta de prueba (paso 7).

## 1. El proyecto

| Dato | Valor |
|---|---|
| Servicio | Supabase (plan gratuito) |
| Proyecto | ACCONTROL (el que creaste tú; no se creó ningún otro) |
| Dirección | `https://vuzlguqrbwgvyduysfkh.supabase.co` |
| Región | us-east-1 |
| Llave que usa la app | «publishable» (`sb_publishable_…`), **pública por diseño**; vive en `src/config.js` |
| Llave que la app NUNCA debe tener | la «secret» / de rol de servicio: daría acceso a todo. Una prueba automática (`test/config.test.js`) falla si aparece en `src/` |

## 2. Cómo está organizada la información

Una persona (`auth.users`, lo maneja Supabase) tiene un **perfil** y puede pertenecer a varios **espacios de trabajo** (Personal, Freelancer, Emprendedor, Empresa). **Todo dato financiero cuelga de un espacio** y solo lo ven y escriben los miembros de ese espacio. Es el mismo modelo que ya usa la app en el dispositivo.

```
auth.users ──1:1── profiles
     │
     └──< workspace_members >── workspaces ──┬──< categories (solo las propias; las de fábrica están en builtin_categories)
          (rol: owner, …)                    ├──< movements, goals, contributions
                                             ├──< debts, debt_payments, assets
                                             ├──< clients, services
                                             ├──< products, suppliers, stock_entries
                                             ├──< invoices, invoice_payments
                                             └──< departments
```

**Las 19 tablas:** `profiles`, `workspaces`, `workspace_members`, `builtin_categories` (22 categorías de fábrica, ya cargadas), `categories`, `departments`, `clients`, `services`, `movements`, `goals`, `contributions`, `debts`, `debt_payments`, `assets`, `products`, `suppliers`, `invoices`, `stock_entries`, `invoice_payments`.

Reglas comunes a todas las tablas de datos:

- **Llave primaria `(workspace_id, id)`** y llaves foráneas compuestas (por ejemplo, un movimiento solo puede apuntar a una categoría, cliente o departamento **del mismo espacio**). Se comprueban al final de cada transacción, así se pueden subir registros relacionados en cualquier orden.
- **Montos en centavos enteros** (`bigint`), igual que la app; entre 1 y 99 999 999 999. Fechas entre 1900 y 2200; horas con formato `HH:mm`; los largos de texto repiten los límites de la app. Son reglas de la base de datos: aunque alguien se salte la pantalla, no entran datos fuera de rango.
- **Los ids los crea el dispositivo** (UUID v4), así se puede trabajar sin internet.
- **`created_at` / `updated_at`** los pone el dispositivo; **`synced_at`** lo pone **siempre el servidor** (disparador `private.entity_guard`) y es el cursor que usará la sincronización. Ese disparador también impide cambiar el `id` o el `workspace_id` de un registro.
- **Borrado «blando»:** `deleted_at` marca un registro como borrado para que los demás dispositivos se enteren. **Nadie tiene permiso de `DELETE`.**
- **`is_demo`**: los datos de demostración llevan la marca, igual que en la app.
- **Facturas:** numeración única por espacio y tipo (real/demo); sus líneas (1 a 30) y valoraciones de stock (1 a 2000) se guardan como `jsonb` con límites.
- **Movimientos:** una categoría debe ser de fábrica o de ese espacio, y del mismo tipo (ingreso/gasto) que el movimiento (restricción diferida).

Reglas de los espacios: máximo **20 espacios** por cuenta; no se puede cambiar el `id`, el creador ni el tipo; quien crea un espacio queda como su **dueño** y el primero es el **predeterminado** (solo puede haber uno por persona). Los roles `admin`, `accountant`, `manager`, `cashier` y `employee` **existen en el esquema pero no se usan**: llegan con la etapa de roles e invitaciones (0.16.0).

## 3. Seguridad (lo que protege tus datos)

**Principio:** la seguridad la hace la base de datos, no la pantalla. Aunque alguien copie la llave pública de `src/config.js` y escriba sus propias consultas, solo puede tocar lo que las reglas le permiten.

| Capa | Qué hace |
|---|---|
| **RLS (seguridad por fila) en las 19 tablas** | Sin política, sin acceso. Una prueba automática (`test/supabase-schema.test.js`) falla si una tabla nueva no la activa. |
| **Quién lee** | Solo miembros del espacio (`private.is_member`). `profiles` y `workspace_members`: solo las filas propias. |
| **Quién escribe** | Solo dueño y administrador del espacio (`private.can_write`). Los demás roles quedarían de solo lectura. |
| **Quién cambia un espacio** | Solo su dueño. |
| **Visitante sin sesión (`anon`)** | No puede nada. Ni leer las categorías de fábrica. |
| **Sin `DELETE`** | Ningún permiso de borrado directo. El borrado definitivo pasa por tres funciones que verifican quién eres: `set_default_workspace(ws)`, `delete_workspace_permanently(ws)` (solo el dueño) y `delete_my_account()` (borra tu cuenta y, en cascada, todo lo tuyo). |
| **Esquema `private`** | Guarda las funciones auxiliares; la API **no lo expone**. |
| **Funciones `SECURITY DEFINER`** | Todas fijan `search_path` vacío (evita que se desvíen a otro esquema). Verificado por prueba automática. |
| **Permisos por defecto** | Lo que se cree después en `public` **no** se da a nadie por defecto: cada permiso es explícito. |

### Lo que dicen los avisos de Supabase (Security/Performance Advisors)

- **Seguridad:** 3 avisos WARN, **intencionales**: son las tres funciones de arriba, que Supabase marca porque un usuario con sesión puede ejecutarlas. Es justo lo que queremos y cada una comprueba quién llama.
- **Rendimiento:** solo avisos INFO de «índices sin usar», normales en una base vacía.

## 4. Las migraciones (`supabase/migrations/`)

Se aplican **en orden** (los nombres llevan la fecha para que ese sea el orden):

| Archivo | Contenido |
|---|---|
| `20261111000100_tenancy.sql` | Esquema `private`, perfiles (con su disparador al crearse una cuenta), espacios, miembros, funciones de permisos, disparadores de control. |
| `20261111000200_entities.sql` | Las 16 tablas de datos con sus llaves, restricciones y límites. |
| `20261111000300_security.sql` | RLS, permisos, políticas y las tres funciones públicas. |
| `20261111000400_seed_categories.sql` | Las 22 categorías de fábrica (una prueba comprueba que coinciden con `src/domain/categories.js`). |
| `20261115000100_freelance_invoices.sql` | **0.14.5.** Facturas en Freelancer: añade `invoices.client_id` (puede ir vacío) con llave foránea compuesta al cliente del mismo espacio, y una comprobación (trigger) de que cada `serviceId` de las líneas es un servicio vivo de ese espacio y de ese cliente, y no va junto con un producto. No borra ni cambia datos ni permisos. **Aplicada en el proyecto el 2026-11-14** (paso 1 de la 0.15.0), con las tablas vacías; verificada con una prueba que se deshace sola: acepta la factura correcta y rechaza un servicio de otro cliente y un cliente inexistente. |

Ya están **aplicadas** en tu proyecto. Para aplicarlas en otro proyecto nuevo: *SQL Editor* de Supabase, pegar y ejecutar cada archivo **en ese orden**; o, con la CLI de Supabase, `supabase db push`. Si cambian las categorías de fábrica de la app, se agrega una migración nueva (no se edita una ya aplicada).

## 5. Lo que tienes que configurar tú (solo se puede en el panel de Supabase)

La app no puede cambiar estas opciones. **Hazlo antes de crear tu primera cuenta real.** Los nombres de los menús pueden variar un poco: Supabase los cambia con el tiempo.

1. **Authentication → Providers → Email:** debe estar activado (correo y contraseña).
2. **«Confirm email» (confirmar el correo):** decide una de dos:
   - **Activado (recomendado para uso real):** nadie entra sin escribir el código de 6 dígitos (o abrir el enlace) que le llega al correo, así se verifica que el correo es suyo. **Pero** el servicio de correo incluido en el plan gratuito **solo envía a miembros de tu organización de Supabase y tiene un tope bajo por hora**. Para que lleguen correos a otras personas necesitas configurar un **SMTP propio** (Authentication → SMTP Settings), por ejemplo con un proveedor de correo con plan gratuito.
   - **Desactivado:** el que crea la cuenta entra de inmediato, sin verificar su correo (alguien podría registrar un correo ajeno). Sirve para probar solo tú.
   La app funciona con las dos opciones.
3. **Authentication → URL Configuration:** en *Site URL* y en *Redirect URLs* hay que poner la dirección **real** desde la que se abre la app: `http://localhost:5173` para probar en tu computadora y, cuando la publiques, su dirección con HTTPS. Si no coincide, los enlaces de los correos no te traen de vuelta a la app. (Todavía no hay una dirección pública elegida.)
4. **Largo mínimo de contraseña:** súbelo a **8 o más** (por defecto Supabase deja 6). La app ya pide 8, pero la regla del servidor es la que cuenta si alguien se salta la pantalla.
   - **Password requirements:** en el proyecto está elegida **«Lowercase, uppercase letters, digits and symbols (recommended)»**. La app pide exactamente lo mismo al crear o cambiar una contraseña (`src/domain/accounts.js`: una minúscula a–z, una mayúscula A–Z, un número y uno de los símbolos que Supabase acepta; la ñ y las tildes no cuentan como letra). **Si cambias esta opción en Supabase, avisa para cambiar también la app.** Las cuentas que ya existen siguen entrando con su contraseña de antes; la regla se aplica al elegir una nueva.
   - **Email OTP length:** **6** (la app espera 6 dígitos).
5. **Plantillas de correo:** ver el punto 9 (desde la 0.14.6 deben mostrar el código `{{ .Token }}`).
6. **Protección contra contraseñas filtradas:** Supabase la ofrece solo en el plan Pro; en el gratuito no se puede activar. La app tiene su propia lista de contraseñas muy comunes que rechaza.
7. **Pausa del plan gratuito:** Supabase **pausa los proyectos gratuitos tras una semana sin actividad** (se reactivan desde el panel). Para finanzas reales, conviene el plan Pro o usar la app con regularidad. Revisa también, en tu plan, qué **copias de seguridad automáticas** incluye.
8. **Exigir la contraseña actual al cambiarla (desde la 0.14.1):** actívala. Supabase la documenta como *Require current password when changing password* en su guía [Password security](https://supabase.com/docs/guides/auth/password-security). En el servidor, el ajuste se llama `update_password_require_current_password`. Dónde buscarla: *Authentication*, en la configuración del proveedor **Email** (o en la parte de seguridad de contraseñas, según la versión del panel). **No se pudo confirmar desde aquí el nombre exacto del interruptor en el panel**: si no lo encuentras, avísame.
   - **Si está activada:** el servidor rechaza un cambio de contraseña que no traiga la actual correcta (errores `current_password_required` y `current_password_invalid`). Así, quien tome prestada tu sesión abierta no puede cambiarte la contraseña.
   - **Si está desactivada:** la app igual pide la actual en pantalla y la envía, **pero el servidor no la comprueba**: la protección es solo de la pantalla.
   - **«Olvidé mi contraseña» sigue funcionando:** según el código del servidor de Supabase, la sesión que abre el enlace de recuperación no necesita la actual. **Compruébalo una vez de verdad** (ver `docs/GUIA_DE_PRUEBAS.md`).

9. **Códigos de 6 dígitos (desde la 0.14.6).** La app pide el código que llega al correo al **crear la cuenta** y al **recuperar la contraseña**. Supabase genera ese código en cada correo, pero **sus plantillas de fábrica solo muestran el enlace**. Pasos, en orden:
   1. Entra a [supabase.com](https://supabase.com) → tu proyecto **ACCONTROL** → menú izquierdo **Authentication** → **Emails** (en algunas versiones: *Email Templates*).
   2. Abre la plantilla **Confirm signup** y, en el cuerpo del mensaje, añade (o deja como texto principal): `<p>Tu código de ACCONTROL es:</p><h2>{{ .Token }}</h2><p>Escríbelo o pégalo en la app. Sirve una sola vez.</p>`. Puedes dejar también `{{ .ConfirmationURL }}` (el enlace sigue funcionando). Pulsa **Save**.
   3. Haz lo mismo en la plantilla **Reset Password** (recuperar contraseña), con el mismo `{{ .Token }}`. **Save**.
   4. **Authentication → Sign In / Providers → Email** (o *Providers → Email*): revisa que **Email OTP Length** sea **6** (la app espera 6 dígitos) y mira **Email OTP Expiration** (cuánto vale el código; 3600 segundos = 1 hora es razonable).
   5. **Correo de salida:** el correo de fábrica de Supabase **solo escribe a los miembros de tu organización** y envía pocos mensajes por hora. Para que el código llegue a **cualquier persona** (por ejemplo a cuentas de Gmail), configura un **SMTP propio** en **Authentication → Emails → SMTP Settings** (o *Project Settings → Authentication → SMTP*). Opciones: tu Gmail con una «contraseña de aplicación» (Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones; servidor `smtp.gmail.com`, puerto 465) o un servicio de correo con plan gratuito (Resend, Brevo…). **Nunca pongas esa contraseña dentro de la app ni en archivos del proyecto**: solo en el panel de Supabase.
   6. Prueba de verdad: crea una cuenta con un correo tuyo, comprueba que llega el código y que la app lo acepta; luego usa «Olvidé mi contraseña» (ver `docs/GUIA_DE_PRUEBAS.md`, paso 35).
   - **Qué no se pudo comprobar desde aquí:** que tu proyecto real envíe el código (depende de las plantillas y del SMTP) y que, con «exigir la contraseña actual» activado (punto 8), la sesión abierta con el **código** de recuperación deje elegir la contraseña nueva igual que la del enlace. Según la documentación de Supabase debería; si al guardar la contraseña nueva aparece «Escribe tu contraseña actual», avísame.

## 6. Cómo se probó (y qué no se pudo probar)

**Pruebas contra la base de datos real** (en Supabase, con usuarios falsos y todo en transacciones que se deshacen, sin dejar datos): **39 comprobaciones**. Resumen de lo que cubren:

- Dos usuarios falsos: cada uno **solo ve lo suyo** y no puede leer, insertar ni modificar datos de espacios ajenos.
- **Sin sesión (`anon`):** no lee ni escribe nada.
- Los permisos de borrado: `DELETE` directo es rechazado; las tres funciones exigen sesión y permisos (por ejemplo, solo el dueño borra un espacio).
- Los límites de las tablas (montos, fechas, largos de texto, máximo de espacios y demás restricciones descritas arriba).
- Las cascadas: al borrar un espacio o una cuenta se va todo lo que contenían.
- Al terminar, la base quedó **limpia**: 0 usuarios, 0 espacios y las 22 categorías de fábrica.

**Pruebas automáticas del repositorio** (`npm test`, 1133 en total): leen los archivos SQL y comprueban que ninguna tabla se quede sin RLS, que nadie reciba `DELETE`, `ALL` ni permisos para `anon`, que las funciones privilegiadas fijen `search_path` y que las categorías de fábrica coincidan con las de la app. Se verificó con mutaciones (se rompió cada regla a propósito y la prueba falló).

**Lo que NO se pudo probar desde aquí (y por qué):** el entorno donde se programó **no tiene salida a internet hacia Supabase**, así que **no se probó el envío real de correos** (confirmación y recuperación de contraseña), ni el comportamiento real del servicio de cuentas. El cliente de cuentas se probó contra un servidor simulado (`tools/mock-auth-server.mjs`) que imita sus respuestas. **Haz una prueba real con un correo tuyo** (ver `docs/GUIA_DE_PRUEBAS.md`, sección de cuentas) y cuéntame qué pasa: si algo del servicio real se comporta distinto, se corrige.

## 7. Límites honestos y pendientes

- **Sincronización a medias (0.15.0, pasos 1 a 5):** la copia en la nube sube y envía cambios cuando la persona la activa; bajar datos a otro dispositivo y juntar dos dispositivos es el paso 6. Hasta entonces, si la cuenta ya tiene espacios en la nube desde otro dispositivo, la app no sube nada para no mezclar.
- **Los datos no están cifrados «de extremo a extremo».** Viajan cifrados (HTTPS) y Supabase los guarda cifrados en disco, y las reglas RLS impiden que otras cuentas los vean, pero **quien administre el proyecto de Supabase (tú) técnicamente podría leerlos**. Cifrado de extremo a extremo (que ni el servidor pueda leerlos) no se ofrece.
- **`delete_my_account()` borra todo lo que creaste, incluidos espacios que otros miembros pudieran tener.** Hoy no hay espacios compartidos, así que no hay problema; **al llegar los roles (0.16.0) hay que cambiarla** para traspasar o conservar esos espacios.
- **Roles distintos de dueño/administrador no se usan** y no se simulan.
- **Cuentas con Google, Apple o Microsoft, verificación en dos pasos y recuperación por otros medios** no están hechas.
- **El correo de una cuenta no se puede cambiar desde la app** (solo la contraseña).
- Las contraseñas las guarda Supabase (cifradas con bcrypt); ACCONTROL nunca las ve ni las guarda. La sesión se guarda en el navegador de cada dispositivo (`localStorage`) y se renueva sola; al cerrar sesión se borra.
