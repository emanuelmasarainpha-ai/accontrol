// @ts-check
// =============================================================================
// IMAGEN DE CADA CATEGORÍA (0.20.6, pedido de la persona: que la app se vea menos formal y más creativa)
// -----------------------------------------------------------------------------
// Decide QUÉ dibujo lleva una categoría; cómo se dibuja está en ui/categoryArt.js.
//   · Las de fábrica, por su id (cat-exp-alimentacion → comida).
//   · Las del negocio y las que crea cada persona, por palabras de su nombre, sin tildes ni mayúsculas
//     («Comida del colmado» → comida, «Gasolina» → combustible, «Netflix» → entretenimiento).
//   · Si ninguna palabra encaja: una moneda que entra (ingreso) o una bolsa de compras (gasto).
// Solo es decoración: no cambia ningún dato ni ningún cálculo.
// =============================================================================

/**
 * @typedef {'salary' | 'pension' | 'rentIn' | 'commission' | 'sales' | 'tips' | 'bonus' | 'gift' | 'incomeOther'
 *   | 'rent' | 'electricity' | 'water' | 'internet' | 'transport' | 'food' | 'fuel' | 'health' | 'clothes'
 *   | 'restaurant' | 'entertainment' | 'debt' | 'expenseOther' | 'services' | 'merchandise' | 'marketing'
 *   | 'payroll' | 'taxes' | 'software' | 'professional' | 'bank' | 'equipment' | 'education' | 'phone' | 'pets'
 *   | 'gym' | 'travel' | 'savings' | 'coffee'} ArtKey
 */

/** Las de fábrica (domain/categories.js). @type {Readonly<Record<string, ArtKey>>} */
const BY_ID = Object.freeze({
  'cat-inc-salario': 'salary',
  'cat-inc-pension': 'pension',
  'cat-inc-alquiler': 'rentIn',
  'cat-inc-comisiones': 'commission',
  'cat-inc-ventas': 'sales',
  'cat-inc-propinas': 'tips',
  'cat-inc-bonificaciones': 'bonus',
  'cat-inc-regalos': 'gift',
  'cat-inc-otros': 'incomeOther',
  'cat-exp-alquiler': 'rent',
  'cat-exp-electricidad': 'electricity',
  'cat-exp-agua': 'water',
  'cat-exp-internet': 'internet',
  'cat-exp-transporte': 'transport',
  'cat-exp-alimentacion': 'food',
  'cat-exp-combustible': 'fuel',
  'cat-exp-salud': 'health',
  'cat-exp-ropa': 'clothes',
  'cat-exp-restaurantes': 'restaurant',
  'cat-exp-entretenimiento': 'entertainment',
  'cat-exp-deudas': 'debt',
  'cat-exp-otros': 'expenseOther',
});

/**
 * Palabras del nombre → dibujo. Se revisan EN ORDEN: la primera que aparece gana (por eso «comisiones bancarias»
 * va antes que «comisiones», y «servicios profesionales» antes que «servicios»). Se comparan sin tildes.
 * @type {ReadonlyArray<readonly [RegExp, ArtKey]>}
 */
const BY_WORDS = Object.freeze([
  [/comisiones? bancari|banco|bancari/, 'bank'],
  [/servicios? profesional|abogad|contador|contable|asesor|consultor/, 'professional'],
  [/colaborador|emplead|trabajadores/, 'payroll'],
  [/salario|sueldo|quincena|nomina/, 'salary'],
  [/pension|jubilaci|retiro/, 'pension'],
  [/alquiler recibido|renta recibida|inquilin/, 'rentIn'],
  [/comision/, 'commission'],
  [/venta|vendid|cliente/, 'sales'],
  [/propina/, 'tips'],
  [/bono|bonific|incentivo|regalia/, 'bonus'],
  [/regalo|premio|loteria/, 'gift'],
  [/alquiler|renta|hipoteca|vivienda|casa|hogar|apartamento/, 'rent'],
  [/electric|\bluz\b|energia|edenorte|edesur|edeeste|inversor/, 'electricity'],
  [/\bagua\b|botellon|acueducto|caasd|coraasan/, 'water'],
  [/internet|wifi|cable|claro|altice|viva\b/, 'internet'],
  [/telefono|celular|movil|recarga|plan de datos/, 'phone'],
  [/combustible|gasolina|gasoil|diesel|\bgas\b|glp/, 'fuel'],
  [/transporte|pasaje|guagua|taxi|uber|indriver|metro|motoconcho|peaje|carro|vehiculo|parqueo/, 'transport'],
  [/restaurante|comida rapida|delivery|pedidos ya|pizza|almuerzo|cena|uber eats/, 'restaurant'],
  [/cafe|cafeteria|desayuno/, 'coffee'],
  [/aliment|comida|supermercado|super\b|colmado|mercado|compra del mes|despensa|viveres/, 'food'],
  [/salud|medic|farmacia|doctor|clinica|hospital|seguro medico|ars\b|dentista|optica/, 'health'],
  [/ropa|zapato|calzado|vestido|moda/, 'clothes'],
  [/entreten|netflix|spotify|cine|streaming|juego|fiesta|salida|diversion|concierto/, 'entertainment'],
  [/deuda|prestamo|tarjeta|credito|cuota/, 'debt'],
  [/servicio/, 'services'],
  [/mercancia|insumo|inventario|materia prima|proveedor/, 'merchandise'],
  [/marketing|publicidad|anuncio|promocion|redes sociales/, 'marketing'],
  [/impuesto|tasa|dgii|itbis|isr\b|tributo/, 'taxes'],
  [/software|suscripci|aplicacion|\bapp\b|hosting|dominio|nube/, 'software'],
  [/equipo|mantenimiento|reparaci|herramienta|maquina/, 'equipment'],
  [/educaci|escuela|colegio|universidad|curso|libro|matricula|clases/, 'education'],
  [/mascota|perro|gato|veterinari/, 'pets'],
  [/gimnasio|\bgym\b|deporte|entrenamiento/, 'gym'],
  [/viaje|vacacion|vuelo|hotel|turismo/, 'travel'],
  [/ahorro|alcancia|inversion|fondo de emergencia/, 'savings'],
]);

/** Sin tildes, en minúsculas y con espacios simples. @param {string} text */
export function foldText(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * El dibujo de una categoría.
 * @param {{ id?: string, name?: string, kind?: string } | null | undefined} category
 * @param {'income' | 'expense' | string} [fallbackKind] tipo del movimiento si no hay categoría
 * @returns {ArtKey}
 */
export function categoryArtKey(category, fallbackKind = 'expense') {
  if (category?.id && Object.hasOwn(BY_ID, category.id)) return BY_ID[category.id];
  const name = foldText(category?.name ?? '');
  if (name) {
    for (const [pattern, key] of BY_WORDS) if (pattern.test(name)) return key;
  }
  return (category?.kind ?? fallbackKind) === 'income' ? 'incomeOther' : 'expenseOther';
}
