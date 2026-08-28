# Codex code review

**Review date:** 2026-08-28  
**Reviewed revision:** `977f2fb` (`Customer Journey Flow`)  
**Scope:** the product and installation documentation, decision log, changelog,
TypeScript application, Rust/Tauri shell, automated tests, build scripts, and CI
configuration present in this repository.

## Executive assessment

FlowShark is a substantial and coherent MVP, rather than a prototype. The model,
shape library, connector engine, editor, exports, macOS bridge, and documentation
cover most of the capabilities claimed for 0.1.0. The shared scene builder and
command registry are particularly good architectural choices. The checked-in
unit suite passes (98 tests), and the production front end builds successfully.

It is **not yet possible to conclude that every project-brief objective is met**.
The repository does not contain a document actually named or identifiable as the
project brief, although several documents refer to numbered brief sections. The
decision log also leaves the two explicit Milestone 0 acceptance gates open:
performance on Apple Silicon and usability with real VoiceOver. In addition,
the save implementation has a data-loss race, hostile documents are insufficiently
bounded, and several release/security assertions are stronger than the code or CI
currently establishes.

### Answers to the requested questions

1. **Purpose — mostly, but not demonstrably all.** The implementation covers the
   documented MVP feature set. Deliberately deferred items are clearly recorded.
   Completion cannot be certified while the source brief is absent, the hardware
   gates remain open, and the save race can lose edits despite the stated
   reliability objective.
2. **Quality — good architecture and breadth, with important reliability and
   validation gaps.** The source is well organised, strongly typed, documented,
   and tested at the model level. Error handling and format normalization are
   generally thoughtful. The highest-quality concern is incorrect dirty-state
   handling around asynchronous saves.
3. **Performance — promising but unproven for the target.** Scene generation and
   interaction deliberately avoid full rebuilds during drags, and recorded browser
   measurements are fast. Committed edits still rebuild the entire SVG and
   accessible outline; history can clone broad document state; serialization and
   recovery are synchronous. The required target-hardware frame-rate and idle-CPU
   measurements have not been performed.
4. **Drift — present.** The changelog calls the MVP complete and makes some
   absolute security/release claims even though the decision log says mandatory
   gates and signing are open. Documentation also says automatic saving protects
   work, which the race below contradicts.
5. **Security — good baseline, incomplete defence in depth.** CSP, output escaping,
   MIME allowlists, atomic writes, and minimal plugin permissions are positive.
   However, custom commands expose unrestricted path reads/writes to the webview,
   and document validation has no structural or decoded-payload budgets. No
   production dependency audit result was available during this review because
   the npm advisory endpoint returned HTTP 403.

## Findings, ordered by criticality

### 1. High — an edit made while a save is in flight can be marked saved and then lost

`writeDocument` serializes the current document and awaits the native write. When
that promise resolves, it unconditionally calls `markSaved`, which clears the
single dirty flag. The UI remains editable during the await. Therefore:

1. save starts with document state **A**;
2. the user makes edit **B** while the IPC/disk write is pending, setting dirty;
3. the write of **A** completes and clears dirty;
4. closing the window no longer prompts, and automatic save no longer sees work;
5. **B is lost**.

The automatic-save interval calls the same routine and can also start overlapping
writes. There is no save generation, mutex, queued follow-up save, or comparison
between the serialized revision and the current revision. This violates the
brief-derived guarantees around safe saves, discard warnings, automatic saving,
and recovery.

**Recommended fix**

- Add a monotonically increasing document revision to the store and increment it
  on every document mutation, undo, redo, and replacement as appropriate.
- Capture both serialized text and revision before starting a write. Clear dirty
  only if the current revision still equals the captured revision.
- Serialize writes through one save queue/mutex. If edits happen during a save,
  leave dirty set and queue one follow-up autosave rather than allowing overlapping
  renames.
- Update the in-memory `meta.modified` consistently with the successfully written
  payload.
- Add deterministic tests using a deferred write promise for edit-during-save,
  two overlapping autosaves, write failure, and close-after-raced-save.

### 2. High — hostile documents can cause severe CPU and memory exhaustion despite the 256 MB file cap

The native layer limits only the UTF-8 file size. After `JSON.parse`, normalization
allows unbounded numbers of elements, order entries, group children, connector
waypoints and labels, presets, layers, strings, and embedded images. Base64 syntax
is checked, but decoded size, aggregate decoded size, pixel dimensions, and the
number of image records are not. A 256 MB JSON document can expand into a much
larger object graph and SVG string, then be duplicated by history snapshots,
serialization, `innerHTML` parsing, raster canvases, or base64 decoding. Extremely
large finite dimensions and font/stroke values are also accepted.

This makes the changelog statement that size limits prevent a malformed file from
exhausting memory inaccurate. It is a local denial-of-service vector and may make
an apparently small diagram hang or crash during open, render, export, or autosave.

**Recommended fix**

- Establish and enforce explicit budgets before rendering: element count, order
  length, layers, presets, labels per connector, waypoints per connector, group
  children, text length, total string length, image count, per-image decoded bytes,
  total decoded image bytes, and maximum image pixels/dimensions.
- Clamp all geometry and styling numerics to documented, safe ranges, not merely
  “finite” or positive values.
- Reject over-budget files with `DocumentFormatError` and a user-actionable detail;
  do not silently truncate relationships.
- Decode/validate base64 in a bounded fashion and verify the bytes' actual image
  signature rather than trusting the declared MIME type.
- Add adversarial tests at each boundary and a memory/time regression test for the
  maximum supported document.

### 3. High — the required target-hardware performance and VoiceOver gates remain open

The decision log explicitly says Gate 1 must be rerun in WKWebView on Apple Silicon,
on battery and mains, and Gate 2 must be exercised with real VoiceOver. Those are
acceptance gates, not optional future enhancements. Browser smoke checks only show
that an accessibility outline exists; they do not establish that announcements,
rotor navigation, focus, or live drag feedback are usable.

The implementation is performance-conscious during pan/zoom and live drag, but
every committed document change rebuilds the complete SVG with `innerHTML`, rebuilds
the node index, and recreates the accessible outline. That is a plausible scaling
bottleneck at the documented 2,000-object target and makes measured acceptance
especially important.

**Recommended fix**

- Execute the exact Gate 1 matrix on supported Apple Silicon hardware and record
  model, macOS version, power state, display refresh rate, document generator,
  p50/p95 frame time, idle CPU, save/open time, and pass thresholds.
- Run Gate 2 with VoiceOver users where possible; record the tested navigation,
  editing, connection descriptions, selection announcements, and reduced-motion/
  increased-contrast combinations.
- Treat failures as release blockers. If committed-edit latency misses the target,
  implement keyed incremental DOM/outline updates instead of whole-scene replacement.
- Change release/MVP language to “candidate” until both results pass.

### 4. Medium — custom Tauri file commands bypass the capability allowlist and accept arbitrary paths

The capability file is commendably narrow for Tauri plugins, but the application’s
custom `read_text_file`, `read_binary_file`, `save_text_atomic`,
`save_binary_atomic`, and `file_modified_at` commands accept any supplied path.
They are registered for every main window, including newly created windows. Because
the app is deliberately not sandboxed, a renderer compromise would turn these into
read/write access anywhere the user can access. Atomic replacement does not make an
arbitrary destination safe, and `save_binary_atomic` has no output-size limit.

No direct document-to-script injection was found: scene strings escape user text
and CSP is strong. This finding is defence in depth, but the impact of any future
renderer injection would be unnecessarily high.

**Recommended fix**

- Do not expose general pathname I/O to the renderer. Return opaque, short-lived
  grants from native Open/Save panels and require a matching grant for each read or
  write; separately grant paths received from trusted OS open/drop events.
- Restrict document reads to granted `.flowshark` files and image reads to supported
  formats; restrict writes to a user-approved export/document destination.
- Add size limits to text and binary writes and expire grants after use or window
  closure.
- If general path commands must remain, isolate them behind a custom Tauri capability
  and add authorization/path-policy tests. Keep CSP and escaping as independent
  layers, not as the only protection.

### 5. Medium — external-change detection can miss changes and retains stale state across documents

The overwrite warning only fires when the current modification timestamp is more
than one second *newer* than `lastKnownFileTime`. A replacement with an equal,
older, or sub-second timestamp is not detected. Filesystem timestamp manipulation,
cloud-sync conflict resolution, restores, and coarse timestamp resolution can all
produce those cases. The application also does not reset `lastKnownFileTime` before
new/open operations, and setting the new value is fire-and-forget, so a quick save
can compare against the prior document’s timestamp.

**Recommended fix**

- Track a native file fingerprint captured at open/save: stable identity where
  available, exact length, high-resolution modification time, and preferably a
  content hash for this bounded document format.
- Treat any fingerprint difference—not only a sufficiently newer timestamp—as a
  conflict.
- Reset the fingerprint synchronously when replacing/creating a document and await
  fingerprint capture before declaring open complete.
- Add tests for equal/older timestamps, rapid open-then-save, Save As over an
  existing path, deletion/recreation, and cloud-style replacement.

### 6. Medium — verification does not cover several release-critical paths and some documentation overstates coverage

The unit suite is valuable but predominantly exercises pure model/export code. The
browser smoke test is a single broad script rather than isolated regression tests,
and CI does not run a signed/notarized launch-and-open test or automated VoiceOver
test. The release workflow permits an absent signing identity to exit successfully,
while user-facing material describes the 0.1.0 bundle as signed and notarized and
the decision log says the signing identity remains open.

The docs also claim unit coverage for text layout and accelerator behavior without
dedicated test files, and Rust atomic-save tests do not prove crash consistency of
the containing directory. `sync_all` is called on the temporary file, but the
parent directory is not synced after rename; after power loss, rename durability is
filesystem-dependent.

**Recommended fix**

- Make certificate/notarization secrets mandatory for a release-tag job and fail
  rather than downgrade a release to unsigned. Keep unsigned artifacts in the
  separate CI bundle job and label them unmistakably.
- Add tests specifically for text layout, keyboard accelerators, file/open event
  handling, autosave recovery, import signatures and limits, custom-command
  authorization, and complete menu/command reachability.
- On supported Unix/macOS filesystems, sync the containing directory after rename
  when promising power-loss durability; document the exact guarantee.
- Add a post-build macOS acceptance job that installs the DMG, launches the app,
  opens a fixture through Finder/document registration, saves, exports, validates
  signing/notarization, and checks for console/native errors.
- Reword coverage and signing claims until those checks exist and pass.

### 7. Medium — the authoritative project brief is missing, weakening scope and drift traceability

README, source comments, and DECISIONS repeatedly cite brief sections such as
§8.14, §8.15, §13, and §14, but no brief is present in the tracked repository and
the commit history does not show one. Consequently a reviewer cannot independently
map each original “must” to code, a test, an accepted deferral, and evidence. The
changelog’s assertion that the complete MVP scope is covered is therefore not
auditable from this repository alone.

**Recommended fix**

- Add the versioned original brief (or a faithful, approved copy) to `docs/`.
- Add a requirements traceability matrix with requirement ID, status, implementation
  files, automated/manual evidence, and decision/deferral reference.
- Keep open questions and gates in one status table and prevent release while any
  mandatory row is unresolved.

### 8. Low — autosave performs synchronous whole-document work and produces intrusive save side effects

For an unsaved document, every autosave serializes the whole document and then wraps
that serialized JSON string inside another JSON object before writing to
`localStorage`, all on the UI thread. `localStorage` itself is synchronous and often
has a small quota, so embedded-image diagrams are unlikely to be recoverable and may
pause interaction. For saved documents, every interval invokes the full normal Save
flow, including conflict checks, native menu rebuilds, recovery clearing, and a
“Saved” toast. Combined with whole-document scene replacement and broad history
snapshots, this is avoidable recurring work.

**Recommended fix**

- Store recovery snapshots through a native, atomic file command in Application
  Support rather than `localStorage`; write a binary UTF-8 payload without double
  JSON encoding.
- Debounce from the last edit and run only when the revision changed. Queue writes
  as described in Finding 1.
- Separate silent autosave from explicit Save UI side effects.
- Measure worst-case serialization/recovery latency at supported maximum document
  size and define a main-thread budget.

### 9. Low — image validation trusts extensions/MIME labels more than file contents

Path imports select a MIME type solely from the extension, and document images keep
payloads when their base64 characters and declared MIME are allowed. Loading into an
`Image` rejects many malformed payloads, but this is not the “payloads are checked
before use” guarantee described in the changelog, and SVG is accepted during
document normalization even though SVG import is explicitly out of scope.

**Recommended fix**

- Sniff PNG, JPEG, WebP, and GIF magic bytes in Rust before crossing IPC and again
  when loading embedded records; reject a mismatch with the declared type.
- Remove `image/svg+xml` from document normalization unless legacy SVG embedding is
  an intentional, documented feature with a sanitization policy. If it must remain,
  parse and sanitize it, reject scripts/external references/animation, and test it
  under the production CSP.
- Validate decoded dimensions and pixel count before creating canvases or SVG image
  nodes.

## Positive observations

- The model is normalized field by field, newer schema versions are rejected, and
  dangling references are repaired before render.
- User-controlled text and most SVG attributes pass through XML escaping, while the
  Tauri CSP disallows remote scripts, inline scripts, objects, forms, and frames.
- The same scene geometry feeds screen, SVG, raster, and much of PDF output, reducing
  visual drift.
- Atomic same-directory replacement, temporary-name sanitization, and input file-size
  checks are sound foundations, even though the durability and authorization models
  need strengthening.
- Drag transforms only affected nodes and attached routes rather than rebuilding on
  every pointer event; pan and zoom use transforms.
- CI covers TypeScript, unit tests, production build, browser smoke, Rust formatting/
  lint/tests, a macOS-code cross-check, and bundle artifact presence.

## Verification performed for this review

| Check | Result |
|---|---|
| `npm test` | Passed: 9 files, 98 tests. jsdom emitted two expected canvas-not-implemented notices. |
| `npm run build` | Passed: TypeScript check and Vite production build. |
| `npm run smoke` | Not run to completion: the installed Playwright package had no local Chromium executable. |
| `cargo test` in `src-tauri` | Environment-blocked: Linux GLib development metadata (`glib-2.0.pc`) is absent. CI runs this on macOS. |
| `npm audit --omit=dev` | Environment-blocked: the npm advisory bulk endpoint returned HTTP 403. This is not evidence that dependencies are vulnerability-free. |

## Recommended disposition

Do not label the current revision as fully accepted against the brief. Fix Findings
1 and 2 before relying on it for important documents; complete both hardware gates
before closing the technology/MVP decision; and resolve Findings 4–7 before calling
a release signed, hardened, secure, and completely traceable. The remaining findings
are appropriate for the same stabilization milestone because they affect recovery,
security assertions, and maximum-document behavior rather than optional new features.
