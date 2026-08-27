/**
 * Type-check the macOS-only Rust code without a Mac.
 *
 * `src-tauri/src/macos.rs` is behind `#[cfg(target_os = "macos")]`, so an
 * ordinary `cargo check` on another platform skips it entirely. Checking
 * against the `aarch64-apple-darwin` target compiles it for real — no linking
 * is involved, so no Apple SDK is needed.
 *
 * One dependency, `objc2-exception-helper`, builds a small Objective-C file in
 * its build script and cannot do that off a Mac. It skips that step when
 * `DOCS_RS` is set, which is safe here because `cargo check` never links.
 *
 *   npm run check:macos
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = 'aarch64-apple-darwin';

const installed = spawnSync('rustup', ['target', 'list', '--installed'], {
  encoding: 'utf8',
});
if (installed.status === 0 && !installed.stdout.includes(target)) {
  console.log(`Installing the ${target} standard library…`);
  const add = spawnSync('rustup', ['target', 'add', target], { stdio: 'inherit' });
  if (add.status !== 0) process.exit(add.status ?? 1);
}

const result = spawnSync(
  'cargo',
  ['check', '--all-targets', '--target', target],
  {
    cwd: join(root, 'src-tauri'),
    stdio: 'inherit',
    env: { ...process.env, DOCS_RS: '1' },
  },
);
process.exit(result.status ?? 1);
