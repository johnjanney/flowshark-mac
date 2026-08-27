# Versioning

How FlowShark numbers its releases, keeps four files in step, and versions the
document format separately from the application. The user-facing summary is at
the top of [CHANGELOG.md](CHANGELOG.md); this is the contributor guide.

---

## 1. Application versions

FlowShark follows [Semantic Versioning 2.0.0](https://semver.org/):
`MAJOR.MINOR.PATCH`.

| Part | Increase it when |
|---|---|
| **MAJOR** | Something people relied on breaks — a document older versions can no longer open, a removed command, a shortcut that now does something else. |
| **MINOR** | A capability is added and everything that worked before still works. |
| **PATCH** | Only defects are fixed. |

**While FlowShark is at `0.x`**, `MINOR` carries breaking changes. `0.x` is the
pre-release series and the interface is not yet promised to be stable. Reaching
`1.0.0` is the commitment that it is.

Pre-release builds use a suffix: `0.2.0-beta.1`. Build metadata (`+2026.08.27`)
is never used in the version, because Apple's `CFBundleShortVersionString` will
not accept it.

## 2. One version, four files

| File | Field | Role |
|---|---|---|
| `package.json` | `version` | **The source of truth.** |
| `src-tauri/tauri.conf.json` | `version` | Becomes `CFBundleShortVersionString`. |
| `src-tauri/Cargo.toml` | `[package] version` | The Rust crate. |
| `src/model/defaults.ts` | `APP_VERSION` | Shown in About, and written into saved documents as `meta.application`. |

Two commands manage this:

```bash
npm run version:sync    # copy package.json's version into the other three
npm run version:check   # fail if any of them disagree
```

CI runs `version:check` on every push, and the release workflow additionally
checks that the tag matches. A release cannot ship with mismatched numbers.

**Never edit the other three by hand.** Change `package.json` and run
`version:sync`.

## 3. Apple's two version fields

macOS uses two separate numbers, and they mean different things.

| Key | Value | Rule |
|---|---|---|
| `CFBundleShortVersionString` | The semantic version, e.g. `0.2.0` | What people see. Tauri sets it from `tauri.conf.json`. |
| `CFBundleVersion` | A build number | Must **always increase**, even across a version that goes backwards. The Mac App Store rejects a build number that has been used before. |

Tauri derives `CFBundleVersion` from the same version string by default. That
is fine for Developer ID distribution, where nothing enforces monotonicity. If
FlowShark is ever submitted to the Mac App Store, set `CFBundleVersion`
explicitly to a counter — the CI run number is a good source — through
`src-tauri/Info.plist`.

## 4. Document schema versions

A `.flowshark` file carries an integer `schemaVersion`. It is **independent of
the application version** and has its own rules.

- It starts at `1` and goes up by exactly one whenever the on-disk shape of a
  document changes.
- It never encodes the application version. FlowShark 3.4.0 may still write
  `schemaVersion: 2`.
- The current value lives in one place:
  `CURRENT_SCHEMA_VERSION` in `src/model/types.ts`.

### Which changes need a bump

| Change | Bump? |
|---|---|
| A new optional field with a sensible default | **No.** Older files load, because loading fills in defaults. |
| Renaming or removing a field | **Yes.** |
| Changing what an existing field means, or its units | **Yes.** |
| A new element kind that older versions would drop | **Yes.** |
| A new shape key in the library | **No.** Unknown shapes fall back to Process. |

### Adding a migration

`src/model/serialization.ts` holds a list of migrations. Entry *n* upgrades a
document from version *n* to version *n + 1*, and they run in order:

```ts
const MIGRATIONS: Array<(raw: Raw) => Raw> = [
  (raw) => ({ ...raw, schemaVersion: 1 }),        // 0 -> 1
  // 1 -> 2: connectors gained a per-end offset.
  (raw) => ({ ...raw, schemaVersion: 2, /* … */ }),
];
```

To add one:

1. Increase `CURRENT_SCHEMA_VERSION` in `src/model/types.ts`.
2. Append a function to `MIGRATIONS` that turns the previous shape into the
   new one.
3. Add a test in `tests/serialization.test.ts` that loads a document in the old
   shape and asserts the result.
4. Record it in [CHANGELOG.md](CHANGELOG.md) under **Changed**, naming both
   numbers.

**Migrations only go forward.** A document from a newer format is refused with
`NewerSchemaError` and a message telling the user to update, rather than being
partly loaded. That behaviour is covered by a test; do not weaken it.

## 5. Dependencies

- **npm** dependencies are pinned with a caret (`^2.11.1`) and locked by
  `package-lock.json`, which is committed. Use `npm ci` in automation.
- **Cargo** dependencies use a major-version constraint (`"2"`) and are locked
  by `Cargo.lock`, which is committed because this crate produces a binary.
- A dependency update that changes nothing a user can see does not need a
  changelog entry. One that does, does.

## 6. Making a release

1. **Write the changelog.** Rename **Unreleased** to the new version with
   today's date in `YYYY-MM-DD` form. Start a fresh empty **Unreleased**.
   Update the two link definitions at the bottom of the file.
2. **Set the version.** Edit `version` in `package.json`, then:

   ```bash
   npm run version:sync
   npm run version:check
   ```

3. **Check the build is sound.**

   ```bash
   npm run typecheck && npm test && npm run smoke
   cd src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test
   ```

4. **Commit and tag.**

   ```bash
   git commit -am "Release 0.2.0"
   git tag -a v0.2.0 -m "FlowShark 0.2.0"
   git push && git push origin v0.2.0
   ```

   The tag is what triggers the release. Pushing the branch alone does
   nothing.

5. **Wait for CI.** The release workflow builds on a macOS runner, signs with
   the Developer ID certificate, notarises, staples the ticket, builds the
   DMG, and attaches it to a **draft** GitHub release.
6. **Check the draft.** Download the DMG, install it on a Mac that has never
   run FlowShark, and confirm it opens with no Gatekeeper warning and that
   double-clicking a `.flowshark` file works.
7. **Publish.** Paste the changelog section for this release into the release
   notes and publish it.

Tag names are always `vMAJOR.MINOR.PATCH`. The workflow refuses a tag that does
not match `package.json`.

## CI secrets

The release job needs these repository secrets. Set them under
**Settings > Secrets and variables > Actions**.

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | The Developer ID Application certificate as a base64-encoded `.p12`: `base64 -i certificate.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password set when the `.p12` was exported |
| `APPLE_SIGNING_IDENTITY` | The full identity name, e.g. `Developer ID Application: Your Name (ABCDE12345)` |
| `APPLE_ID` | The Apple ID used for notarisation |
| `APPLE_PASSWORD` | An app-specific password from <https://appleid.apple.com> |
| `APPLE_TEAM_ID` | The Apple Developer Team ID |

**Prefer an App Store Connect API key** if you can. Replace `APPLE_ID`,
`APPLE_PASSWORD`, and `APPLE_TEAM_ID` with `APPLE_API_ISSUER`, `APPLE_API_KEY`,
and `APPLE_API_KEY_PATH`. A key does not stop working when someone changes
their Apple ID password, and it is not tied to one person's account.

Without these secrets the release job still builds and produces a DMG — it is
simply unsigned, and macOS will warn on first launch.

CI's `bundle` job builds an unsigned `.app` and `.dmg` on **every push** and
uploads the disk image as an artifact named `FlowShark-unsigned-dmg`. Two
reasons: a signing problem is never the first thing you discover at release
time, and there is always an installable build to hand without cutting a
release. Download it from the run's page under **Artifacts**.

That job also asserts the things that fail silently — that both the `.app` and
the `.dmg` exist, and that `document.icns` is really inside the bundle rather
than merely referenced by `Info.plist`.
