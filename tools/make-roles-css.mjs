// Escribe src/styles/roles.css a partir de las reglas de src/domain/roles.js (0.16.0).
// La página no puede crear estilos desde JavaScript (la política de seguridad solo admite hojas de estilo propias),
// así que las reglas viven en un archivo; esta herramienta lo genera y una prueba comprueba que no se desactualice.
// Uso: npm run roles-css
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleCss } from '../src/domain/roles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROLES_CSS_PATH = join(ROOT, 'src', 'styles', 'roles.css');

/** El contenido exacto que debe tener src/styles/roles.css. */
export function rolesCssFile() {
  return '/* ROLES (0.16.0): esconde los botones que tu rol no permite. NO SE EDITA A MANO: sale de roleCss() en\n' +
    '   src/domain/roles.js (una prueba comprueba que coinciden). Para regenerarlo: npm run roles-css */\n' + roleCss();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(ROLES_CSS_PATH, rolesCssFile());
  console.log('src/styles/roles.css listo.');
}
