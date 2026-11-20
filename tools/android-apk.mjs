// =============================================================================
// APK de ACCONTROL para instalar en cualquier teléfono Android (sin Google Play).
//
//   npm run android:firma   Crea TU firma, UNA sola vez. Se guarda fuera del proyecto y de OneDrive:
//                           ~/.accontrol-firma/ (accontrol.jks + firma.properties con la contraseña).
//                           ⚠ Haz una copia de esa carpeta (por ejemplo en una memoria USB). Si se pierde,
//                           los teléfonos que ya tienen ACCONTROL no podrán recibir versiones nuevas.
//   npm run android:apk     Prepara la app, crea el APK firmado y lo copia al Escritorio
//                           como ACCONTROL-<versión>.apk.
//
// Java: usa JAVA_HOME si existe; si no, el que trae Android Studio.
// =============================================================================
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIRMA_DIR = join(homedir(), '.accontrol-firma');
const FIRMA_PROPS = join(FIRMA_DIR, 'firma.properties');
const KEYSTORE = 'accontrol.jks';
const ALIAS = 'accontrol';

/** Carpeta de Java: JAVA_HOME o el Java de Android Studio. */
function javaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const studio = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (existsSync(studio)) return studio;
  throw new Error('No encuentro Java. Instala Android Studio o define JAVA_HOME.');
}

/** @param {string} cmd @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [opts] */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (result.status !== 0) throw new Error(`Falló: ${cmd} ${args.join(' ')}`);
}

/**
 * Nombre del archivo final. @param {string} version
 * @returns {string}
 */
export function apkName(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versión no válida: ${version}`);
  return `ACCONTROL-${version}.apk`;
}

/** Crea la firma si no existe. Nunca sobrescribe una que ya existe. */
function makeFirma() {
  if (existsSync(FIRMA_PROPS)) {
    console.log(`Ya tienes una firma en ${FIRMA_DIR}. No se toca (cambiarla impediría actualizar la app).`);
    return;
  }
  if (existsSync(join(FIRMA_DIR, KEYSTORE))) {
    throw new Error(`Hay un ${KEYSTORE} en ${FIRMA_DIR} sin firma.properties. Revísalo a mano: no lo sobrescribo.`);
  }
  mkdirSync(FIRMA_DIR, { recursive: true });
  const password = randomBytes(24).toString('base64url');
  const keytool = join(javaHome(), 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
  const result = spawnSync(keytool, [
    '-genkeypair', '-v', '-keystore', join(FIRMA_DIR, KEYSTORE), '-alias', ALIAS,
    '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
    '-storepass', password, '-keypass', password,
    '-dname', 'CN=ACCONTROL, O=ACCONTROL, C=DO',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) throw new Error('keytool no pudo crear la firma.');
  writeFileSync(
    FIRMA_PROPS,
    [
      '# Firma de ACCONTROL para Android. SECRETO: no lo subas a ningún sitio ni lo compartas.',
      '# Guarda una copia de esta carpeta entera (por ejemplo en una memoria USB).',
      `storeFile=${KEYSTORE}`,
      `storePassword=${password}`,
      `keyAlias=${ALIAS}`,
      `keyPassword=${password}`,
      '',
    ].join('\n'),
  );
  console.log(`Firma creada en ${FIRMA_DIR}. Haz una copia de esa carpeta en un lugar seguro.`);
}

/** Crea el APK firmado y lo copia al Escritorio. */
function makeApk() {
  if (!existsSync(FIRMA_PROPS)) throw new Error('Primero crea tu firma: npm run android:firma');
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  run('npm', ['run', 'android'], { cwd: ROOT });
  // Ruta completa: cmd.exe no siempre busca programas en la carpeta actual.
  const gradlew = join(ROOT, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  run(`"${gradlew}"`, ['assembleRelease'], { cwd: join(ROOT, 'android'), env: { ...process.env, JAVA_HOME: javaHome() } });
  const buildRoot = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'accontrol-android-build', 'app') : join(ROOT, 'android', 'app', 'build');
  const apk = join(buildRoot, 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(apk)) throw new Error(`No apareció el APK firmado en ${apk}`);
  const desktop = [join(homedir(), 'OneDrive', 'Desktop'), join(homedir(), 'Desktop')].find((d) => existsSync(d)) ?? ROOT;
  const out = join(desktop, apkName(version));
  copyFileSync(apk, out);
  console.log(`\nListo: ${out}\nEnvíalo al teléfono y ábrelo para instalarlo.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'firma') makeFirma();
    else makeApk();
  } catch (error) {
    console.error(`\n✖ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
