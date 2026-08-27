/**
 * Keep the application version in step across the three files that carry it.
 *
 * `package.json` is the source of truth; `src-tauri/tauri.conf.json` and
 * `src-tauri/Cargo.toml` follow it. CI runs this with `--check` so a release
 * can never ship three different version numbers.
 *
 *   node scripts/sync-version.mjs          rewrite the other two files
 *   node scripts/sync-version.mjs --check  fail if they disagree
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const packagePath = join(root, 'package.json');
const tauriPath = join(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');

const version = JSON.parse(readFileSync(packagePath, 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`package.json has "${version}", which is not a semantic version.`);
  process.exit(1);
}

const problems = [];

// tauri.conf.json
const tauriText = readFileSync(tauriPath, 'utf8');
const tauriVersion = JSON.parse(tauriText).version;
if (tauriVersion !== version) {
  if (check) problems.push(`src-tauri/tauri.conf.json has ${tauriVersion}`);
  else {
    writeFileSync(tauriPath, tauriText.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
    console.log(`tauri.conf.json ${tauriVersion} -> ${version}`);
  }
}

// Cargo.toml: only the [package] version, which is the first one in the file.
const cargoText = readFileSync(cargoPath, 'utf8');
const cargoMatch = /^version\s*=\s*"([^"]+)"/m.exec(cargoText);
if (!cargoMatch) {
  console.error('src-tauri/Cargo.toml has no version field.');
  process.exit(1);
}
if (cargoMatch[1] !== version) {
  if (check) problems.push(`src-tauri/Cargo.toml has ${cargoMatch[1]}`);
  else {
    writeFileSync(
      cargoPath,
      cargoText.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`),
    );
    console.log(`Cargo.toml ${cargoMatch[1]} -> ${version}`);
  }
}

// The version the front end reports in About and writes into saved documents.
const defaultsPath = join(root, 'src', 'model', 'defaults.ts');
const defaultsText = readFileSync(defaultsPath, 'utf8');
const defaultsMatch = /export const APP_VERSION = '([^']+)';/.exec(defaultsText);
if (!defaultsMatch) {
  console.error('src/model/defaults.ts has no APP_VERSION.');
  process.exit(1);
}
if (defaultsMatch[1] !== version) {
  if (check) problems.push(`src/model/defaults.ts has ${defaultsMatch[1]}`);
  else {
    writeFileSync(
      defaultsPath,
      defaultsText.replace(
        /export const APP_VERSION = '[^']+';/,
        `export const APP_VERSION = '${version}';`,
      ),
    );
    console.log(`defaults.ts ${defaultsMatch[1]} -> ${version}`);
  }
}

if (check && problems.length > 0) {
  console.error(`package.json says ${version}, but:`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('Run "npm run version:sync" to bring them into line.');
  process.exit(1);
}

console.log(check ? `Version ${version} is consistent.` : `Version ${version} written.`);
