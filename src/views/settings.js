// @ts-check
// =============================================================================
// AJUSTES
// Perfil, categorías, copias de seguridad, datos de demostración, borrado total
// y una nota honesta sobre dónde viven tus datos y qué protección tienen.
// =============================================================================

import { plural } from '../domain/dates.js';
import { centsToInputValue } from '../domain/money.js';
import { TYPE_LABELS } from '../domain/types.js';
import { KIND_INFO } from '../domain/workspaces.js';
import { APP_VERSION } from '../version.js';
import { demoBadge } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { actionTarget } from '../ui/dom.js';
import { clearErrors, readForm, setBusy, showErrors } from '../ui/forms.js';
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { canVibrate, haptic, setVibration, vibrationEnabled } from '../ui/haptics.js';
import { currentTheme, dayNightButton } from '../ui/theme.js';
import { toast } from '../ui/toast.js';
import { accountDangerPanel, accountPanel, runAccountAction } from './account.js';
import { clearAllActions, cloudPanel, runCloudAction, watchCloudPanel } from './cloud.js';
import { membersPanel, runShareAction, watchMembers } from './members.js';
import { openCategoryForm } from './forms.js';
import { openOrganizationForm, workspaceDetailsPanel } from './organization.js';
import { runWorkspaceAction, workspacesPanel } from './workspaces.js';

/** @typedef {ReturnType<typeof import('../app/store.js').createStore>} Store */

const ROADMAP = [
  { stage: 'Etapa 1', text: 'Prototipo funcional en este dispositivo: ingresos, gastos, metas y estadísticas (hecha).', done: true },
  { stage: 'Etapa 2', text: 'Cuenta personal con correo y contraseña, base de datos en la nube con seguridad por usuario, copia en la nube y sincronización entre tus dispositivos (hechas); faltan los roles de usuario.', current: true },
  { stage: 'Etapa 3', text: 'Deudas con riesgo y amortización, presupuesto automático, alertas y exportación a PDF, Excel y CSV (hecha).', done: true },
  { stage: 'Etapa 4', text: 'Patrimonio neto, estadísticas avanzadas (por mes, trimestre y año) y 9 calculadoras de matemática financiera (hecha).', done: true },
  { stage: 'Ampliación', text: 'Espacios de trabajo: Personal, Freelancer, Emprendedor y Empresa, cada uno con sus datos separados; los de negocio con sus datos de organización en los reportes (pasos 1 y 2) y el módulo Freelancer con clientes, servicios, cobros por cliente, ranking y flujo de caja (paso 3), el módulo Emprendedor con estado de resultados, margen, comparación y proyección (paso 4), las finanzas de Empresa con la pantalla Salud financiera (paso 5), el inventario de Emprendedor y Empresa: productos, proveedores, compras, ventas, stock, valor y ganancia bruta (paso 6a), las facturas internas de Emprendedor y Empresa: emisión con varias líneas, impuesto, cobros parciales, cuentas por cobrar, anulación y PDF de cada factura (paso 6b) y los departamentos de Empresa: cada gasto cargado a un área, presupuesto mensual por área con estado En orden, Cerca del límite o Excedido, y gastos sin departamento (paso 6c), los gastos cargados a cada cliente en Freelancer, con neto y margen por cliente (rentabilidad real), y los logros, rachas y niveles de todos los espacios, calculados con tus datos reales (paso 6d), el diagnóstico financiero con la viabilidad de cada meta, con reglas fijas y a la vista (paso 6e), y las facturas internas también en Freelancer, ligadas a clientes y servicios, con recordatorios de cobro para copiar y enviar tú (paso 6f, hecha). Los roles, empleados e invitaciones llegan después de la sincronización.', done: true },
  { stage: 'Etapa 5', text: 'IA Financiera: coach, evaluación de riesgo y asistente conversacional (el diagnóstico y la viabilidad de metas con reglas fijas ya existen, ver Ampliación).' },
  { stage: 'Etapa 6', text: 'Aplicaciones de Android, iOS y escritorio, notificaciones inteligentes (los logros, rachas y niveles ya existen, ver Ampliación).' },
  { stage: 'Etapa 7', text: 'Módulos para freelancers y emprendedores (hechos en la ampliación).' },
  { stage: 'Etapa 8', text: 'Versión premium, pagos, panel administrativo y conexión bancaria.' },
];

/**
 * Panel «Este dispositivo»: preferencias que se guardan solo en este navegador (no son datos financieros).
 * @param {{ vibration: boolean, canVibrate: boolean, theme?: import('../ui/theme.js').Theme }} prefs
 */
export function devicePanel({ vibration, canVibrate, theme = 'light' }) {
  return html`<section class="panel" aria-labelledby="set-device">
    <h2 class="panel__title" id="set-device">Este dispositivo</h2>
    <div class="switch-row theme-row">
      <span class="switch-row__text">
        <strong>Modo oscuro <span class="theme-row__state" data-theme-label>${theme === 'dark' ? 'Activado' : 'Desactivado'}</span></strong>
        <small>Colores de noche, más suaves para la vista con poca luz. Toca el cielo: el sol se pone y sale la luna. Se recuerda en este dispositivo.</small>
      </span>
      ${dayNightButton(theme, { large: true })}
    </div>
    <label class="switch-row" for="pref-vibration">
      <span class="switch-row__text">
        <strong>Vibrar al confirmar</strong>
        <small>Una vibración corta al guardar dinero, confirmar algo importante o cumplir una meta.${canVibrate ? '' : ' Este navegador no permite vibrar (por ejemplo, en iPhone o en la computadora), así que aquí no tendrá efecto.'}</small>
      </span>
      <input type="checkbox" class="switch" id="pref-vibration" data-pref="vibration" ${vibration ? 'checked' : ''} />
    </label>
  </section>`;
}

/**
 * Panel «Recorrido guiado»: volver a ver el paseo por las funciones del espacio abierto.
 * @param {import('../domain/types.js').Workspace | null} workspace
 * @param {boolean} available  ¿Este tipo de espacio ya tiene recorrido?
 */
export function tourPanel(workspace, available) {
  if (!workspace) return '';
  const label = KIND_INFO[workspace.kind].label;
  return html`<section class="panel" aria-labelledby="set-tour" data-tour="settings-tour">
    <h2 class="panel__title" id="set-tour">Recorrido guiado</h2>
    ${available
      ? html`<p>Un paseo paso a paso por las funciones de los espacios ${label}: te señala cada una en la pantalla y te explica para qué sirve.</p>
          <div class="actions actions--start" data-write-only>
            <button type="button" class="btn btn--ghost" data-action="tour-replay">${icon('info', 18)}Ver el recorrido otra vez</button>
          </div>`
      : html`<p class="muted">Los espacios ${label} todavía no tienen recorrido guiado. Llega en la próxima actualización.</p>`}
  </section>`;
}

/**
 * @param {Store} store
 * @param {import('../app/app.js').ViewContext} [ctx]
 * @returns {import('../app/app.js').RenderedView}
 */
export function renderSettings(store, ctx) {
  const account = ctx?.account ?? null;
  const sync = account?.sync ?? null;
  const cloudOn = sync?.state().enabled ?? false;
  const { data } = store.getState();
  const workspace = store.activeWorkspace();
  const workspaceName = workspace?.name ?? 'este espacio';
  const hasDemo = store.hasDemoData();
  const opening = data.settings.openingBalanceCents;
  // En un espacio de otra persona el saldo inicial es del dueño (0.16.0): se ve, pero no se cambia.
  const ownsSpace = store.canManageWorkspace();

  /** @param {'income' | 'expense'} kind */
  const categoryList = (kind) => {
    const list = data.categories.filter((c) => c.kind === kind).sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name, 'es'));
    return html`<ul class="cat-list">${list.map((c) => {
      const uses = data.movements.filter((m) => m.categoryId === c.id).length;
      return html`<li class="cat">
        <span class="cat__name">${c.name}</span>
        <span class="cat__meta">${uses} ${uses === 1 ? 'uso' : 'usos'}</span>
        ${c.builtIn
          ? html`<span class="chip">Predeterminada</span>`
          : html`<span class="cat__actions">
              <button type="button" class="btn btn--ghost btn--small" data-action="cat-edit" data-id="${c.id}" aria-label="Renombrar ${c.name}">Renombrar</button>
              <button type="button" class="btn btn--danger-ghost btn--small" data-action="cat-delete" data-id="${c.id}" aria-label="Borrar ${c.name}">Borrar</button>
            </span>`}
      </li>`;
    })}</ul>`;
  };

  const counts = `${plural(data.movements.length, 'movimiento', 'movimientos')}, ${plural(data.goals.length, 'meta', 'metas')} y ${plural(data.contributions.length, 'aporte', 'aportes')}`;

  const page = html`
    <header class="page-header">
      <div>
        <h1 class="page-title">Ajustes</h1>
        <p class="page-subtitle">Tu perfil, tus datos y cómo se protegen.</p>
      </div>
    </header>

    ${accountPanel(account)}

    <section class="panel" aria-labelledby="set-profile">
      <h2 class="panel__title" id="set-profile">Perfil</h2>
      <form class="stack" data-form="profile" novalidate>
        <div class="field" data-field="displayName">
          <label for="set-name">Tu nombre</label>
          <input id="set-name" name="displayName" class="input" type="text" maxlength="40" autocomplete="given-name" value="${data.settings.displayName}" aria-describedby="displayName-error" />
          <p class="hint">Se usa para saludarte en Inicio y es el nombre que ven las personas con las que compartes un espacio. Es el mismo en todos tus espacios.</p>
          <p class="field__error" id="displayName-error" data-error-for="displayName" hidden></p>
        </div>
        <div class="field" data-field="opening">
          <label for="set-opening">Saldo inicial de «${workspaceName}»</label>
          <div class="input-money">
            <span class="input-money__symbol" aria-hidden="true">RD$</span>
            <input id="set-opening" name="openingText" class="input input--money" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${opening > 0 ? centsToInputValue(opening) : ''}" aria-describedby="opening-hint opening-error" ${ownsSpace ? '' : 'readonly'} />
          </div>
          <p class="hint" id="opening-hint">${ownsSpace ? 'El dinero que ya tenías (efectivo, cuentas) el día que empiezas a usar este espacio. Se suma a su “Disponible”. Cada espacio tiene el suyo.' : `«${workspaceName}» es de otra persona: solo su dueño puede cambiar su saldo inicial.`}</p>
          <p class="field__error" id="opening-error" data-error-for="opening" hidden></p>
        </div>
        <p class="field__error field__error--form" data-error-for="form" role="alert" hidden></p>
        <div class="actions"><button type="submit" class="btn btn--primary">Guardar perfil</button></div>
      </form>
    </section>

    ${tourPanel(workspace, ctx?.tour.available() ?? false)}

    ${devicePanel({ vibration: vibrationEnabled(), canVibrate: canVibrate(), theme: currentTheme() })}

    ${workspacesPanel(store, { canShare: Boolean(sync) })}

    ${workspaceDetailsPanel(store)}

    ${membersPanel(store, sync)}

    <section class="panel" aria-labelledby="set-cats">
      <div class="panel__head">
        <h2 class="panel__title" id="set-cats">Categorías</h2>
        <button type="button" class="btn btn--ghost btn--small" data-action="cat-new">${icon('plus', 16)}Nueva categoría</button>
      </div>
      <p class="panel__sub">Las predeterminadas salen del documento maestro y no se pueden cambiar. Las tuyas son de «${workspaceName}»: se pueden renombrar, y borrar si ningún movimiento las usa.</p>
      <div class="grid-2">
        <div><h3 class="indicator-group__title">${TYPE_LABELS.expense}s</h3>${categoryList('expense')}</div>
        <div><h3 class="indicator-group__title">${TYPE_LABELS.income}s</h3>${categoryList('income')}</div>
      </div>
    </section>

${cloudPanel(sync)}

    <section class="panel" aria-labelledby="set-backup" data-tour="settings-backup">
      <h2 class="panel__title" id="set-backup">Copia de seguridad</h2>
      <p>«${workspaceName}» guarda ${counts}. Exportar crea un archivo; importarlo en otro dispositivo (o después de un borrado) lo restaura.</p>
      <div class="actions actions--start">
        <button type="button" class="btn btn--primary" data-action="export-backup">${icon('download', 18)}Exportar este espacio</button>
        ${store.getState().workspaces.length > 1
          ? html`<button type="button" class="btn btn--primary" data-action="export-full">${icon('download', 18)}Exportar copia completa</button>`
          : ''}
        <button type="button" class="btn btn--ghost" data-action="import-backup">${icon('upload', 18)}Importar copia…</button>
        <input type="file" id="backup-file" accept="application/json,.json" hidden />
      </div>
      <p class="hint">${store.getState().workspaces.length > 1
        ? html`La copia de <strong>este espacio</strong> solo trae «${workspaceName}»; la <strong>completa</strong> trae todos tus espacios y tu nombre. Al importar te digo qué va a reemplazar antes de tocar nada.`
        : html`Importar <strong>reemplaza</strong> lo que hay ahora en este espacio, y antes te pido confirmación.`}
        El archivo no está cifrado: guárdalo en un lugar seguro.</p>
    </section>

    <section class="panel" aria-labelledby="set-privacy">
      <h2 class="panel__title" id="set-privacy">Privacidad y seguridad de tus datos</h2>
      <ul class="plain-list">
        <li><strong>Dónde están:</strong> ${cloudOn
          ? 'en este dispositivo y en la nube (tu cuenta). Solo tu cuenta puede leerlos; viajan por una conexión cifrada. Los datos de demostración no se suben.'
          : account
            ? 'solo en este navegador, en este dispositivo. Tu cuenta (correo y contraseña) vive en el servidor de cuentas, pero tus datos financieros no se envían a ningún sitio mientras no actives la copia en la nube.'
            : 'solo en este navegador, en este dispositivo. Esta copia no tiene cuenta ni servidor, así que tus datos no se envían a ningún sitio.'}</li>
        <li><strong>Protección:</strong> los datos <strong>no están cifrados</strong> ni protegidos con contraseña. Quien use este navegador con tu usuario del dispositivo podría verlos. Bloquea tu equipo y tu teléfono.</li>
        <li><strong>Pérdida:</strong> ${cloudOn ? 'si borras los datos del sitio o limpias el navegador, este dispositivo los pierde, pero siguen en la nube.' : 'si borras los datos del sitio, limpias el navegador o lo desinstalas, se pierden. Exporta copias con frecuencia.'}</li>
        <li><strong>Dispositivos:</strong> ${cloudOn ? 'tus dispositivos con esta cuenta comparten los datos a través de la nube: lo que cambias en uno llega a los otros. Si el mismo dato cambió en dos, se queda el cambio más reciente y la app te avisa.' : 'tu computadora y tu celular guardan datos separados. Para pasar datos de uno a otro usa la copia de seguridad.'}</li>
      </ul>
      <p class="storage-status" id="storage-status" role="status">Comprobando el almacenamiento…</p>
    </section>

    <section class="panel" aria-labelledby="set-demo">
      <h2 class="panel__title" id="set-demo">Datos de demostración</h2>
      <p>${workspace && (workspace.kind === 'entrepreneur' || workspace.kind === 'company') ? 'Datos inventados de una tienda (ventas, gastos y su inventario con productos, proveedores y movimientos de stock' + (workspace.kind === 'company' ? ', más un préstamo y un equipo' : '') + ')' : 'Datos inventados (de una persona, no de un negocio)'} para que veas la app llena en «${workspaceName}». Todos llevan la etiqueta ${demoBadge()}. Mientras estén cargados cuentan en tus totales; al borrarlos no se toca nada de lo tuyo.</p>
      <div class="actions actions--start">
        ${hasDemo
          ? html`<button type="button" class="btn btn--ghost" data-action="remove-demo">Borrar demostración</button>`
          : html`<button type="button" class="btn btn--ghost" data-action="load-demo">Cargar datos de demostración</button>`}
      </div>
    </section>

    <section class="panel panel--danger" aria-labelledby="set-danger">
      <h2 class="panel__title" id="set-danger">Borrar todo</h2>
      <p>${cloudOn ? html`<strong>Tienes la copia en la nube activada.</strong> «Borrar de este dispositivo» deja tus datos en la nube y apaga la sincronización aquí; «Borrar de todos mis dispositivos» los borra también de la nube (necesita conexión). ` : ''}Elimina de este dispositivo <strong>todos tus espacios de trabajo</strong> con sus movimientos, metas, aportes, deudas, activos, categorías propias y ajustes. Al terminar volverás a la pantalla de elegir modalidad. No se puede deshacer; exporta una copia antes si quieres conservarlos. (Para borrar un solo espacio usa «Espacios de trabajo», arriba.)</p>
      <div class="actions actions--start">
        ${clearAllActions(sync)}
      </div>
    </section>

    ${accountDangerPanel(account)}

    <section class="panel" aria-labelledby="set-next">
      <h2 class="panel__title" id="set-next">Qué viene</h2>
      <ol class="roadmap">${ROADMAP.map(
        (r) => html`<li class="roadmap__item${r.current ? ' roadmap__item--current' : ''}${r.done ? ' roadmap__item--done' : ''}"><span class="roadmap__stage">${r.stage}</span><span>${r.text}</span></li>`,
      )}</ol>
      <p class="panel__foot">ACCONTROL · versión ${APP_VERSION} · Copia en la nube y sincronización (Etapa 2, parte 2)</p>
    </section>
  `;

  return {
    html: page,
    mount(root, signal) {
      // ---- perfil ------------------------------------------------------------
      const profile = root.querySelector('[data-form="profile"]');
      if (profile instanceof HTMLFormElement) {
        profile.addEventListener(
          'submit',
          async (event) => {
            event.preventDefault();
            clearErrors(profile);
            setBusy(profile, true);
            const values = readForm(profile);
            const result = await store.saveSettings({ displayName: values.displayName ?? '', openingText: values.openingText ?? '' });
            setBusy(profile, false);
            if (!result.ok) showErrors(profile, result.errors);
            else toast('Perfil guardado.');
          },
          { signal },
        );
      }

      // ---- estado del almacenamiento ----------------------------------------
      void describeStorage().then((text) => {
        const slot = root.querySelector('#storage-status');
        if (slot) slot.textContent = text;
      });

      // ---- archivo de respaldo -----------------------------------------------
      const fileInput = root.querySelector('#backup-file');
      const openFilePicker = () => {
        if (fileInput instanceof HTMLInputElement) fileInput.click();
      };
      if (fileInput instanceof HTMLInputElement) {
        fileInput.addEventListener(
          'change',
          async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (file) await importFromFile(store, file);
          },
          { signal },
        );
      }

      // ---- copia en la nube: el estado se actualiza solo ---------------------
      const stopWatching = watchCloudPanel(sync, root, () => ctx?.rerender());
      signal.addEventListener('abort', stopWatching, { once: true });

      // ---- miembros del espacio abierto (0.16.0) -----------------------------
      watchMembers(root, store, sync, signal);

      // ---- preferencias de este dispositivo ---------------------------------
      const vibrationBox = root.querySelector('[data-pref="vibration"]');
      if (vibrationBox instanceof HTMLInputElement) {
        vibrationBox.addEventListener(
          'change',
          () => {
            const saved = setVibration(vibrationBox.checked);
            if (vibrationBox.checked) haptic('confirm');
            toast(saved ? (vibrationBox.checked ? 'Vibración encendida.' : 'Vibración apagada.') : 'Este navegador no deja guardar la preferencia.', saved ? 'success' : 'error');
          },
          { signal },
        );
      }

      // ---- botones -----------------------------------------------------------
      root.addEventListener(
        'click',
        (event) => {
          const el = actionTarget(event.target);
          if (!el) return;
          if (runAccountAction(account, el.dataset.action)) return;
          if (runCloudAction(sync, el.dataset.action, { store, rerender: () => ctx?.rerender(), button: el })) return;
          if (runShareAction({ store, sync, root }, el)) return;
          switch (el.dataset.action) {
            case 'tour-replay':
              ctx?.tour.start();
              break;
            case 'cat-new':
              openCategoryForm(store, {});
              break;
            case 'cat-edit': {
              const category = data.categories.find((c) => c.id === el.dataset.id);
              if (category) openCategoryForm(store, { category });
              break;
            }
            case 'cat-delete':
              void deleteCategory(store, el.dataset.id ?? '');
              break;
            case 'org-edit':
              openOrganizationForm(store, el.dataset.id ?? '');
              break;
            case 'export-backup':
              exportBackup(store);
              break;
            case 'export-full':
              void exportFullBackup(store);
              break;
            case 'import-backup':
              openFilePicker();
              break;
            case 'clear-all':
              void clearAll(store);
              break;
            default:
              runWorkspaceAction(store, el);
          }
        },
        { signal },
      );
    },
  };
}

// -----------------------------------------------------------------------------

/** @param {Store} store @param {string} id */
async function deleteCategory(store, id) {
  const category = store.getState().data.categories.find((c) => c.id === id);
  if (!category) return;
  const ok = await confirmDialog({
    title: `¿Borrar la categoría “${category.name}”?`,
    message: 'Solo se puede borrar si ningún movimiento la usa.',
    confirmLabel: 'Borrar categoría',
    danger: true,
  });
  if (!ok) return;
  const result = await store.deleteCategory(id);
  if (result.ok) toast('Categoría borrada.');
  else toast(result.errors.form ?? 'No se pudo borrar.', 'error');
}

/** Descarga un texto como archivo. @param {string} fileName @param {string} json */
function downloadJson(fileName, json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Copia exportada: ${fileName}`);
}

/** @param {Store} store */
function exportBackup(store) {
  const { fileName, json } = store.exportBackup();
  downloadJson(fileName, json);
}

/** @param {Store} store */
async function exportFullBackup(store) {
  const result = await store.exportFullBackup();
  if (result.ok) downloadJson(result.fileName, result.json);
  else toast(result.errors.form ?? 'No se pudo preparar la copia.', 'error');
}

/** @param {{ movements: number, goals: number, debts: number, assets: number, clients: number, products: number, invoices: number }} c */
function countsText(c) {
  const parts = [plural(c.movements, 'movimiento', 'movimientos'), plural(c.goals, 'meta', 'metas'), plural(c.debts, 'deuda', 'deudas'), plural(c.assets, 'activo', 'activos')];
  if (c.clients > 0) parts.push(plural(c.clients, 'cliente', 'clientes'));
  if (c.products > 0) parts.push(plural(c.products, 'producto', 'productos'));
  if (c.invoices > 0) parts.push(plural(c.invoices, 'factura', 'facturas'));
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/** @param {Store} store @param {File} file */
async function importFromFile(store, file) {
  let text = '';
  try {
    text = await file.text();
  } catch {
    toast('No se pudo leer el archivo.', 'error');
    return;
  }
  const inspected = store.inspectBackup(text);
  if (!inspected.ok) {
    toast(inspected.error, 'error');
    return;
  }
  const ok =
    inspected.kind === 'full'
      ? await confirmDialog({
          title: '¿Reemplazar TODOS tus espacios con esta copia?',
          message: `La copia completa trae ${plural(inspected.workspaceNames.length, 'espacio', 'espacios')} (${inspected.workspaceNames.join(', ')}) con ${countsText(inspected.counts)}. Se borrará TODO lo que tienes ahora en este dispositivo: todos tus espacios y sus datos.`,
          confirmLabel: 'Reemplazar todo',
          danger: true,
          requireText: 'REEMPLAZAR',
        })
      : await confirmDialog({
          title: `¿Reemplazar «${store.activeWorkspace()?.name ?? 'este espacio'}» con esta copia?`,
          message: `El archivo${inspected.sourceName ? ` viene de «${inspected.sourceName}» y` : ''} trae ${countsText(inspected.counts)}. Se borrará lo que tiene ahora el espacio que tienes abierto. Tus otros espacios no se tocan.`,
          confirmLabel: 'Reemplazar este espacio',
          danger: true,
        });
  if (!ok) return;
  const result = await store.importBackup(text);
  if (result.ok) toast(result.kind === 'full' ? 'Copia completa restaurada.' : 'Copia restaurada.');
  else toast(result.errors.form ?? 'No se pudo importar.', 'error');
}

/** @param {Store} store */
async function clearAll(store) {
  const ok = await confirmDialog({
    title: '¿Borrar todos tus datos?',
    message: 'Se eliminarán de este dispositivo TODOS tus espacios de trabajo y todo lo que contienen: movimientos, metas, aportes, deudas, activos, categorías propias y ajustes. Volverás a la pantalla de elegir modalidad. No se puede deshacer.',
    confirmLabel: 'Borrar todo',
    danger: true,
    requireText: 'BORRAR',
  });
  if (!ok) return;
  const result = await store.clearAllData();
  if (result.ok) toast('Todos tus datos fueron borrados.');
  else toast(result.errors.form ?? 'No se pudo borrar.', 'error');
}

/** Dice con honestidad si el navegador promete conservar los datos. */
async function describeStorage() {
  const storage = navigator.storage;
  if (!storage || typeof storage.persisted !== 'function') {
    return 'Este navegador no informa si conservará tus datos: haz copias de seguridad con frecuencia.';
  }
  try {
    const persisted = await storage.persisted();
    let usage = '';
    if (typeof storage.estimate === 'function') {
      const { usage: used } = await storage.estimate();
      if (typeof used === 'number') usage = ` Espacio usado: ${used < 1024 * 1024 ? `${Math.max(1, Math.round(used / 1024))} KB` : `${(used / 1024 / 1024).toFixed(1)} MB`}.`;
    }
    return persisted
      ? `Almacenamiento protegido: el navegador se comprometió a no borrar tus datos por falta de espacio.${usage}`
      : `Almacenamiento no garantizado: el navegador podría borrar los datos si le falta espacio, aunque es poco común. Haz copias de seguridad.${usage}`;
  } catch {
    return 'No se pudo comprobar el estado del almacenamiento.';
  }
}
