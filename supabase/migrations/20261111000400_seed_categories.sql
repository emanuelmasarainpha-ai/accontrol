-- =============================================================================
-- ACCONTROL · Etapa 2 · Migración 4 de 4: categorías que vienen con la app
-- -----------------------------------------------------------------------------
-- Son las mismas 22 de src/domain/categories.js (defaultCategories). Si cambian allí, se actualizan aquí
-- con una migración nueva. Hay un test (test/supabase-schema.test.js) que compara ambas listas.
-- =============================================================================
insert into public.builtin_categories (id, name, kind, default_classification) values
  ('cat-inc-salario', 'Salario', 'income', 'fixed'),
  ('cat-inc-pension', 'Pensión', 'income', 'fixed'),
  ('cat-inc-alquiler', 'Alquiler recibido', 'income', 'fixed'),
  ('cat-inc-comisiones', 'Comisiones', 'income', 'variable'),
  ('cat-inc-ventas', 'Ventas', 'income', 'variable'),
  ('cat-inc-propinas', 'Propinas', 'income', 'variable'),
  ('cat-inc-bonificaciones', 'Bonificaciones', 'income', 'extraordinary'),
  ('cat-inc-regalos', 'Premios y regalos', 'income', 'extraordinary'),
  ('cat-inc-otros', 'Otros ingresos', 'income', 'variable'),
  ('cat-exp-alquiler', 'Alquiler', 'expense', 'fixed'),
  ('cat-exp-electricidad', 'Electricidad', 'expense', 'fixed'),
  ('cat-exp-agua', 'Agua', 'expense', 'fixed'),
  ('cat-exp-internet', 'Internet', 'expense', 'fixed'),
  ('cat-exp-transporte', 'Transporte', 'expense', 'fixed'),
  ('cat-exp-alimentacion', 'Alimentación', 'expense', 'variable'),
  ('cat-exp-combustible', 'Combustible', 'expense', 'variable'),
  ('cat-exp-salud', 'Salud y medicamentos', 'expense', 'variable'),
  ('cat-exp-ropa', 'Ropa', 'expense', 'discretionary'),
  ('cat-exp-restaurantes', 'Restaurantes', 'expense', 'discretionary'),
  ('cat-exp-entretenimiento', 'Entretenimiento', 'expense', 'discretionary'),
  ('cat-exp-deudas', 'Pago de deudas', 'expense', 'fixed'),
  ('cat-exp-otros', 'Otros gastos', 'expense', 'variable');