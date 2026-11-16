// @ts-check
// =============================================================================
// TIPOS Y CONSTANTES COMPARTIDAS
// -----------------------------------------------------------------------------
// Aquí se describe la FORMA de los datos de ACCONTROL. Los comentarios con
// @typedef no ejecutan nada: sirven para que VS Code te avise de errores
// (por ejemplo, si escribes `movement.amountCent` en lugar de `amountCents`).
//
// REGLAS DE ORO de los datos:
//  - Los montos se guardan en CENTAVOS como números enteros (RD$ 15.50 = 1550).
//    Así nunca aparecen errores de decimales como 0.1 + 0.2 = 0.30000000000000004.
//  - Las fechas se guardan como texto "AAAA-MM-DD" y las horas como "HH:mm"
//    (hora local del usuario). Sin zonas horarias, sin sorpresas.
//  - Cada registro tiene un `id` único (UUID). Cuando exista la nube (Etapa 2),
//    los mismos IDs servirán para sincronizar sin conflictos.
// =============================================================================

/** @typedef {'income' | 'expense'} MovementType Tipo de movimiento: ingreso o gasto. */

/**
 * Clasificación obligatoria (documento maestro §4.1 y §4.2).
 *  - Ingresos: fixed (fijo), variable, extraordinary (extraordinario)
 *  - Gastos:   fixed (fijo), variable, discretionary (discrecional)
 * @typedef {'fixed' | 'variable' | 'extraordinary' | 'discretionary'} Classification
 */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {MovementType} kind                   A qué tipo de movimiento pertenece.
 * @property {Classification} defaultClassification Clasificación sugerida al elegirla.
 * @property {boolean} builtIn                     true = viene con la app (es igual en todos los espacios).
 *   Las que crea el usuario pertenecen al espacio donde las creó (el almacén lo guarda; aquí no se ve).
 */

/**
 * Un ingreso o un gasto.
 * @typedef {Object} Movement
 * @property {string} id
 * @property {MovementType} type
 * @property {number} amountCents        Entero positivo, en centavos.
 * @property {string} date               "AAAA-MM-DD"
 * @property {string} time               "HH:mm"
 * @property {string} description
 * @property {Classification} classification
 * @property {string} categoryId
 * @property {string} [clientId]         Solo espacios con clientes. En un ingreso: de quién viene el pago. En un gasto: el cliente al que se le cargó (costo directo). Ausente = sin cliente.
 * @property {string} [serviceId]        Solo ingresos: a qué servicio corresponde el pago (implica el cliente de ese servicio). Un gasto no lleva servicio.
 * @property {string} [departmentId]     Solo gastos de espacios Empresa: a qué departamento se carga. Ausente = sin asignar.
 * @property {string} createdAt          Fecha ISO completa.
 * @property {string} updatedAt          Fecha ISO completa.
 * @property {boolean} [isDemo]          true = dato de demostración (se muestra etiquetado).
 */

/**
 * Cliente de un negocio (documento maestro §9). Solo los espacios Freelancer lo usan por ahora.
 * @typedef {Object} Client
 * @property {string} id
 * @property {string} firstName
 * @property {string} lastName          Puede estar vacío.
 * @property {string} company           Puede estar vacío.
 * @property {string} email             Puede estar vacío.
 * @property {string} phone             Puede estar vacío.
 * @property {string} country           Puede estar vacío.
 * @property {string} notes             Puede estar vacío.
 * @property {boolean} archived         true = ya no se ofrece al registrar ingresos, pero su historial se conserva.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Departamento o área de una empresa, con su presupuesto mensual de gastos (espacios Empresa). Lo gastado NO se guarda aquí:
 * son los gastos que llevan su `departmentId`.
 * @typedef {Object} Department
 * @property {string} id
 * @property {string} name
 * @property {number} monthlyBudgetCents  Presupuesto mensual de gastos, entero no negativo en centavos (0 = sin presupuesto).
 * @property {boolean} archived           true = ya no se ofrece al registrar gastos, pero su historial se conserva.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/** @typedef {'pending' | 'in_progress' | 'done' | 'cancelled'} ServiceStatus Pendiente, En proceso, Finalizado, Cancelado. */

/**
 * Servicio (trabajo o proyecto) que se hace para un cliente (documento maestro §9).
 * Lo cobrado se calcula con los ingresos vinculados a este servicio; no se guarda aquí.
 * @typedef {Object} Service
 * @property {string} id
 * @property {string} clientId
 * @property {string} name
 * @property {number} priceCents          Precio acordado, entero positivo en centavos.
 * @property {number | null} estimatedDays Duración estimada en días, o null si no se indicó.
 * @property {ServiceStatus} status
 * @property {string} startDate           "AAAA-MM-DD" o "" si no se indicó.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Producto de un negocio con inventario (espacios Emprendedor y Empresa). El stock NO se guarda aquí: se calcula siempre
 * sumando sus movimientos de stock (compras, ventas y ajustes), así nunca se desincroniza.
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} sku            Código interno; puede estar vacío.
 * @property {string} unit           Unidad de medida solo para mostrar («unidad», «caja», «par»…). Las cantidades son siempre enteras.
 * @property {number} priceCents     Precio de venta por unidad que se propone al vender (0 = sin precio).
 * @property {number} minStock       Cuando el stock baja a esta cantidad o menos, aparece un aviso (0 = sin aviso).
 * @property {string} notes          Puede estar vacío.
 * @property {boolean} archived      true = ya no se ofrece al comprar o vender, pero su historial se conserva.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Proveedor de un negocio (a quién le compras mercancía).
 * @typedef {Object} Supplier
 * @property {string} id
 * @property {string} name
 * @property {string} contact        Persona de contacto; puede estar vacío.
 * @property {string} email          Puede estar vacío.
 * @property {string} phone          Puede estar vacío.
 * @property {string} notes          Puede estar vacío.
 * @property {boolean} archived
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/** @typedef {'purchase' | 'sale' | 'adjustment'} StockKind Compra (entra), venta (sale) o ajuste (conteo, merma, stock inicial). */

/**
 * Un movimiento de stock de un producto. Compras y ventas llevan un movimiento de dinero (`movementId`) que se crea y se
 * borra junto con ellas; los ajustes no mueven dinero.
 * @typedef {Object} StockEntry
 * @property {string} id
 * @property {string} productId
 * @property {StockKind} kind
 * @property {number} quantity       Entero distinto de cero con signo: compra > 0, venta < 0, ajuste de cualquier signo.
 * @property {number} unitCents      Compra: costo por unidad. Venta: precio por unidad. Ajuste que suma: costo por unidad. Ajuste que resta: 0.
 * @property {string} date           "AAAA-MM-DD"
 * @property {string} time           "HH:mm"
 * @property {string} [supplierId]   Solo compras: a quién se le compró.
 * @property {string} [movementId]   Compras y ventas: el gasto o ingreso que registró el dinero.
 * @property {string} [invoiceId]    Solo ventas: la factura interna que las originó. Estas ventas no llevan `movementId`: el dinero entra
 *   cuando se cobra la factura, no cuando sale la mercancía. Se crean con la factura y se borran al anularla.
 * @property {string} note           Puede estar vacío.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Una línea de una factura interna: lo que se vende, cuántas unidades y a qué precio. Si lleva `productId`, al emitir la factura
 * salen esas unidades del inventario.
 * @typedef {Object} InvoiceLine
 * @property {string} description
 * @property {number} quantity       Entero mayor que cero.
 * @property {number} unitCents      Precio por unidad, entero positivo en centavos.
 * @property {string} [productId]    Producto del inventario del que salen las unidades (ausente = servicio o artículo sin inventario).
 * @property {string} [serviceId]    Solo Freelancer (0.14.5): servicio del cliente de la factura que esta línea factura (o una parte de él).
 *                                   Nunca junto con productId. Lo facturado de un servicio nunca pasa de lo que le queda por facturar.
 */

/**
 * Factura INTERNA de un negocio (espacios Emprendedor y Empresa; Freelancer desde la 0.14.5). NO es un comprobante fiscal: sirve para llevar el control de lo
 * que se vende y de lo que falta por cobrar. Una vez emitida no se cambian sus líneas, su fecha ni su impuesto: si algo está mal,
 * se anula y se emite otra. Lo cobrado NO se guarda aquí (son los cobros, `InvoicePayment`) y los totales tampoco: se calculan.
 * @typedef {Object} Invoice
 * @property {string} id
 * @property {number} number          Consecutivo del espacio (1, 2, 3…). Nunca se repite ni se reutiliza.
 * @property {string} [clientId]      Solo Freelancer: la ficha del cliente (sus datos se copian a customerName/customerContact al emitir).
 *                                   No cambia después de emitir. El ingreso de cada cobro lleva este mismo cliente.
 * @property {string} customerName
 * @property {string} customerTaxId   RNC o cédula del cliente; puede estar vacío.
 * @property {string} customerContact Correo o teléfono; puede estar vacío.
 * @property {string} issueDate       "AAAA-MM-DD"
 * @property {string} dueDate         "AAAA-MM-DD" o "" si se paga al recibirla.
 * @property {InvoiceLine[]} lines
 * @property {number} taxRateBp       Impuesto sobre el subtotal, en centésimas de por ciento: 18 % = 1800 (0 = sin impuesto).
 * @property {string} notes           Puede estar vacío.
 * @property {string} [voidedAt]      Fecha-hora ISO en que se anuló. Ausente = vigente.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Un cobro de una factura. Cada cobro tiene su ingreso vinculado (`movementId`): así el dinero disponible y los resultados lo
 * reflejan sin registrarlo dos veces, y se borran juntos.
 * @typedef {Object} InvoicePayment
 * @property {string} id
 * @property {string} invoiceId
 * @property {number} amountCents
 * @property {string} date
 * @property {string} time
 * @property {string} note
 * @property {string} movementId      Ingreso vinculado.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Meta de ahorro (documento maestro §4.5).
 * @typedef {Object} Goal
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} targetCents
 * @property {string} targetDate         "AAAA-MM-DD"
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Dinero que se aparta para una meta (aporte) o que se saca de ella (retiro).
 * @typedef {Object} Contribution
 * @property {string} id
 * @property {string} goalId
 * @property {'deposit' | 'withdrawal'} kind
 * @property {number} amountCents        Siempre positivo; `kind` indica la dirección.
 * @property {string} date
 * @property {string} time
 * @property {string} note
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/** @typedef {'monthly' | 'bimonthly' | 'quarterly' | 'fourmonthly' | 'semiannual'} DebtFrequency Frecuencia de pago (documento §4.4). */

/** @typedef {'physical' | 'personal'} CollateralKind Garantía física o personal (documento §4.4). */

/**
 * Una deuda (documento maestro §4.4).
 * `totalCents` es lo que se debe en el momento de registrarla. Lo que se ha pagado después
 * NO se guarda aquí: se calcula con los pagos (así nunca hay dos números que se contradigan).
 * @typedef {Object} Debt
 * @property {string} id
 * @property {string} name
 * @property {string} note
 * @property {number} totalCents          Monto adeudado al registrarla (entero positivo, en centavos).
 * @property {number} rateBp              Tasa en centésimas de por ciento: 18.5 % = 1850.
 * @property {'annual' | 'monthly'} rateBasis  Si la tasa es anual o mensual.
 * @property {DebtFrequency} frequency
 * @property {CollateralKind} collateralKind
 * @property {string} collateralType      Clave de la lista de garantías (ver domain/debts.js).
 * @property {string} firstDueDate        Vencimiento de la próxima cuota al registrarla. "AAAA-MM-DD"
 * @property {string} firstDueTime        "HH:mm"
 * @property {string} finalDueDate        Vencimiento final. "AAAA-MM-DD"
 * @property {string} finalDueTime        "HH:mm"
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * Un pago de una deuda. Cada pago tiene un gasto vinculado (`movementId`) para que el dinero
 * disponible y las estadísticas lo reflejen sin registrarlo dos veces.
 * La parte de interés y de capital NO se guarda: se calcula en orden cronológico.
 * @typedef {Object} DebtPayment
 * @property {string} id
 * @property {string} debtId
 * @property {'regular' | 'extra'} kind   regular = cuota; extra = abono a capital.
 * @property {number} amountCents
 * @property {string} date
 * @property {string} time
 * @property {string} note
 * @property {string} movementId          Gasto vinculado.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/** @typedef {'cash' | 'bank' | 'investments' | 'vehicles' | 'realEstate' | 'business' | 'other'} AssetCategory Categorías de activos (documento §5). */

/**
 * Un valor de un activo en una fecha. El valor "vigente" en cada fecha es el último registrado hasta ella.
 * @typedef {Object} AssetValuation
 * @property {string} date          "AAAA-MM-DD"
 * @property {number} valueCents    Entero, en centavos (puede ser 0: ya no lo tienes).
 */

/**
 * Un activo: algo que posees y que tiene valor (documento maestro §5).
 * Su valor cambia con el tiempo: cada cambio es un punto de `valuations` (nunca se reescribe el pasado).
 * El primer punto está en `acquiredDate`.
 * @typedef {Object} Asset
 * @property {string} id
 * @property {string} name
 * @property {AssetCategory} category
 * @property {string} subtype             Clave del tipo dentro de la categoría ("" si no se eligió).
 * @property {string} description
 * @property {string} acquiredDate        "AAAA-MM-DD"
 * @property {AssetValuation[]} valuations  Ordenadas por fecha, una por fecha, al menos una.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {boolean} [isDemo]
 */

/**
 * @typedef {Object} Settings
 * @property {string} displayName          Nombre para el saludo (puede estar vacío).
 * @property {number} openingBalanceCents  Saldo con el que empiezas en ACCONTROL.
 */

/**
 * Para qué usas ACCONTROL en un espacio de trabajo (documento de ampliación, secciones 1 y 2).
 * @typedef {'personal' | 'freelancer' | 'entrepreneur' | 'company'} WorkspaceKind
 */

/**
 * Rol de una persona en un espacio compartido (0.16.0): Dueño (todo), Administrador (registra y edita, invita
 * contadores) y Contador (solo ve y exporta). Desde la 0.16.1, 'custom' = un rol a medida que armó el dueño (customRole).
 * @typedef {'owner' | 'admin' | 'accountant' | 'custom'} WorkspaceRole
 */

/**
 * Un rol a medida (0.16.1): nombre y nivel en cada módulo (ver src/domain/permissions.js).
 * @typedef {{ id: string, name: string, permissions: import('./permissions.js').Permissions }} CustomRole
 */

/**
 * Un espacio de trabajo: un conjunto de datos aislado (Mi espacio personal, Mi emprendimiento, Empresa ABC...).
 * Un ingreso de un espacio nunca aparece en otro. El saldo inicial es de cada espacio.
 * @typedef {Object} Workspace
 * @property {string} id
 * @property {WorkspaceKind} kind
 * @property {string} name
 * @property {'DOP'} currency             Hoy solo pesos dominicanos (RD$); se guarda para poder ampliarlo.
 * @property {number} openingBalanceCents Saldo con el que empiezas en este espacio.
 * @property {boolean} isDefault          El que se abre primero si no hay un "último usado".
 * @property {Organization} [organization] Datos del negocio u organización (solo espacios que no son Personal). Ausente = sin completar.
 * @property {WorkspaceRole} [role]        Tu rol en un espacio COMPARTIDO contigo (0.16.0). Ausente = eres el dueño. Solo vive en el dispositivo: no se sube.
 * @property {CustomRole} [customRole]    Con role = 'custom': el rol a medida y sus permisos (0.16.1). Solo vive en el dispositivo.
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Datos de identificación de un negocio u organización. Todos son texto; vacío = sin completar.
 * Son informativos: se muestran en Ajustes y en la cabecera de los reportes exportados.
 * @typedef {Object} Organization
 * @property {string} legalName  Nombre legal o razón social.
 * @property {string} taxId      RNC o cédula (identificación fiscal).
 * @property {string} activity   Actividad o sector.
 * @property {string} email      Correo de contacto.
 * @property {string} phone      Teléfono de contacto.
 * @property {string} address    Dirección o ciudad.
 */

/**
 * Datos del dispositivo (después, del usuario): no pertenecen a ningún espacio.
 * @typedef {Object} Profile
 * @property {string} displayName            Nombre para el saludo (puede estar vacío).
 * @property {string | null} lastWorkspaceId Último espacio usado.
 */

/**
 * Todo lo que guarda la aplicación DENTRO DE UN ESPACIO. Los cálculos de `domain/` trabajan sobre esto:
 * un espacio de trabajo es, para ellos, simplemente otro AppData.
 * `settings.displayName` viene del perfil y `settings.openingBalanceCents` del espacio.
 * @typedef {Object} AppData
 * @property {Category[]} categories
 * @property {Movement[]} movements
 * @property {Goal[]} goals
 * @property {Contribution[]} contributions
 * @property {Debt[]} debts
 * @property {DebtPayment[]} debtPayments
 * @property {Asset[]} assets
 * @property {Client[]} clients
 * @property {Service[]} services
 * @property {Product[]} products
 * @property {Supplier[]} suppliers
 * @property {StockEntry[]} stockEntries
 * @property {Invoice[]} invoices
 * @property {InvoicePayment[]} invoicePayments
 * @property {Department[]} departments
 * @property {Settings} settings
 */

/** Versión del formato de datos. Súbela si cambias la forma de los registros. */
export const SCHEMA_VERSION = 8;

/** @type {Record<Classification, string>} */
export const CLASSIFICATION_LABELS = {
  fixed: 'Fijo',
  variable: 'Variable',
  extraordinary: 'Extraordinario',
  discretionary: 'Discrecional',
};

/** @type {Record<Classification, string>} Nombres en plural, para gráficos y resúmenes. */
export const CLASSIFICATION_LABELS_PLURAL = {
  fixed: 'Fijos',
  variable: 'Variables',
  extraordinary: 'Extraordinarios',
  discretionary: 'Discrecionales',
};

/** @type {Record<MovementType, Classification[]>} */
export const CLASSIFICATIONS_BY_TYPE = {
  income: ['fixed', 'variable', 'extraordinary'],
  expense: ['fixed', 'variable', 'discretionary'],
};

/** @type {Record<MovementType, string>} */
export const TYPE_LABELS = { income: 'Ingreso', expense: 'Gasto' };

/** Límites de texto para evitar datos absurdos. */
export const LIMITS = {
  description: 80,
  categoryName: 40,
  goalName: 60,
  goalDescription: 200,
  debtName: 60,
  debtNote: 200,
  assetName: 60,
  assetDescription: 200,
  note: 120,
  displayName: 40,
  workspaceName: 40,
  maxWorkspaces: 20,
  orgLegalName: 80,
  orgTaxId: 20,
  orgActivity: 60,
  orgEmail: 80,
  orgPhone: 25,
  orgAddress: 120,
  clientName: 60,
  clientCompany: 80,
  clientEmail: 80,
  clientPhone: 25,
  clientCountry: 60,
  clientNotes: 200,
  serviceName: 80,
  productName: 60,
  productSku: 30,
  productUnit: 20,
  productNotes: 200,
  supplierName: 80,
  supplierContact: 60,
  supplierEmail: 80,
  supplierPhone: 25,
  supplierNotes: 200,
  stockNote: 120,
  customerName: 80,
  customerTaxId: 20,
  customerContact: 120,
  invoiceNotes: 300,
  invoiceLine: 80,
  invoiceLines: 30,
  paymentNote: 120,
  departmentName: 40,
  maxDepartments: 30,
};
