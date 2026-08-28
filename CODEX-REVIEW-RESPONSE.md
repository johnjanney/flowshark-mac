# Response to the Codex review

## First: the review document is not in this repository

The task was to read `CODEX-REVIEW.md`, verify each finding in it, and respond.
**That file does not exist anywhere in this repository.** Before concluding
that, I checked:

| Where I looked | Result |
|---|---|
| The working tree (`ls`, `find . -iname '*codex*'`) | Not present |
| Every commit on every branch (`git ls-tree -r` over `git rev-list --all`) | Not present |
| All remote branches (`claude/app-dev-and-docs-efn6gt`, `claude/text-box-selection-edit-6g5umy`) | Not present |
| Pull requests, open and closed | There are none |

The working tree was clean at the start of this session, so it was not a stray
uncommitted file either.

**Nothing below is a verification of Codex's findings, because there were none
to verify.** What follows is the fresh review the task also asked for, done
from scratch against the same five criteria — purpose, quality, performance,
drift, and security — with the problems found and fixed. If you can supply
`CODEX-REVIEW.md`, I will go through it finding by finding and reconcile it
against this.

---

## What this review covered

The whole repository: about 20,000 lines across the TypeScript front end, the
Rust shell, the tests, the build scripts, the CI workflows, and the six
documentation files. Baseline before any changes was green — `tsc --noEmit`
clean, 98 unit tests passing, and the headless smoke test passing.

`cargo test` and `npm run check:macos` could **not** be run here: this
container is Linux and lacks the GTK development packages `cargo` needs for the
host target. I made no changes to any Rust file, so the Rust side is
byte-for-byte as CI last saw it, but I am flagging that rather than implying I
verified it.

---

## Findings

Severity is my own judgement. "Verified" means I reproduced the problem with a
test that fails on the original code and passes on the fixed code.

### S-1 — A document could inject markup into the canvas and into exports
**Severity: high · Verified · Fixed**

`src/canvas/scene.ts` built two identifiers out of an element's id:

```ts
const id = `fs-grad-${element.id}`;     // written into id="…" and url(#…)
const clipId = `fs-clip-${element.id}`; // same
```

An element id comes out of a `.flowshark` file, so it can be any string. The
value went into the markup unescaped, both in the `<defs>` block and — the part
that matters — in the `fill="url(#…)"` and `clip-path="url(#…)"` attributes of
elements that are actually drawn. `escapeXml` was applied to `data-id` a few
lines away, but not here.

An element with id `a" onmouseover="alert(1)` and a gradient fill produced
this in the rendered scene body:

```
<path class="fs-shape-path" d="…" fill="url(#fs-grad-a" onmouseover="alert(1))" …/>
```

That is a live event handler on a visible element. The same defect existed in
`src/connectors/markers.ts`, where a connector's stroke colour was interpolated
into `<marker>` markup unescaped.

The scene reaches the DOM through `innerHTML` in three places
(`renderer.ts:191`, `renderer.ts:193`, `dialogs.ts:146`) and through a fourth
in the print sheet (`app.ts`), and it is also written verbatim into exported
`.svg` files.

**How bad it actually is.** Inside the packaged app, `tauri.conf.json` sets
`script-src 'self'` with no `'unsafe-inline'`, which stops the injected handler
from firing. That is a real mitigation and worth crediting. But it is the only
thing standing in the way, and it does not cover two cases:

- `npm run dev` and `npm run smoke` serve the same front end with no CSP.
- **An exported `.svg` carries no CSP at all.** A recipient opening a diagram
  in a browser opens a full SVG *document*, where scripting is enabled. So
  FlowShark could be used to produce a malicious SVG from a malicious
  `.flowshark` — which is precisely the guarantee `README.md` and the export
  test claim to hold.

**Fix.** Gradients and clip paths are now named by a counter instead of by the
document. Nothing outside a scene refers to them by name, so a counter is both
safe and collision-free — safer than sanitising the id, which would let two
different ids collapse onto one name and silently share a gradient. `escapeXml`
was moved into a new `src/util/xml.ts` so `markers.ts` can use it without a
circular import, and the marker colour is now escaped. The embedded-image
`mimeType` and `data` are escaped at the sink too, as belt and braces.

One note on that fix, because it nearly introduced a bug of its own. My first
version reset the counter for each scene. That is wrong: more than one scene
can be in the page at once — the canvas, the print sheet, and a preview for
every template in the chooser — and `url(#…)` resolves across the whole
document, so two scenes both naming a gradient `fs-grad-1` would have had the
print sheet paint with the canvas's gradient. No bundled template uses a
gradient today, so it would not have shown up in the test suite; it would have
shown up when someone printed a diagram with a gradient in it. The counter is
now module-level and monotonic, and a test pins that two scenes never share a
definition name.

### S-2 — The "no scripts in exported SVG" test could not have caught S-1
**Severity: medium (test gap) · Verified · Fixed**

`tests/export.test.ts` had two relevant tests. One asserted no `<script>` and
no `on…=` in the export — but built its document from a bundled template, which
contains nothing hostile. The other checked escaping of a shape's `text` only.
Neither exercised an id, a colour, a label, or alt text.

**Fix.** New `tests/hostile-document.test.ts` builds documents specifically
designed to break out of each attribute and asserts against the **parsed DOM**,
not against the raw string. That distinction matters: my first attempt used a
regex and reported false positives, because escaped text such as
`data-id="a&quot; onmouseover=&quot;…"` contains the characters `onmouseover=`
while being completely inert. The tests now parse the markup and look for real
script elements and real event-handler attributes.

Eight of the first ten new tests fail against the original code.

### S-3 — A document could embed an SVG image, contradicting D-010
**Severity: medium · Verified · Fixed**

`src/model/serialization.ts` accepted `image/svg+xml` in `IMAGE_MIME_TYPES`.
`src/io/import.ts` does not — its `IMPORTABLE_IMAGE_TYPES` is PNG, JPEG, WebP,
GIF — and D-010 says why, in unusually direct terms:

> a half-sanitised import is a security hole in an application that otherwise
> never executes anything from a document

A `.flowshark` file can be written by hand, so refusing SVG at the file dialog
while accepting it out of a document left exactly the hole that decision
refuses. The payload flowed to `<image href="data:image/svg+xml;base64,…">` on
screen and into every export.

I want to be accurate about the severity: SVG loaded through an `<image>`
element does not execute script per spec, so this was not by itself remote code
execution. It was a policy the code did not enforce, and an unsanitised
attacker-controlled document embedded in every file the user exported.

**Fix.** `image/svg+xml` removed. The two lists now match. D-010 gained a
"Where it is enforced" paragraph naming both, so the next person changing one
knows to change the other.

### S-4 — Style presets bypassed the document normaliser
**Severity: low · Verified · Fixed**

Every other part of a loaded document is type-checked into shape. Presets were
cast through:

```ts
shape: isObject(raw.shape) ? (raw.shape as StylePreset['shape']) : {},
```

`applyPreset` then spreads that object straight into an element's style. A
hand-written preset could put a string where the renderer expects a number, or
add keys that mean nothing. No injection — everything is still escaped — but it
contradicts the module's own claim to be "deliberately strict about structure",
and a preset with `strokeWidth: "wide"` renders a broken shape.

**Fix.** Presets are normalised by running the raw patch through the existing
style normalisers and keeping only the keys that were actually present. That
reuses the validation the rest of the file already has rather than adding a
second one. There were no preset tests at all; there are three now, including a
round-trip of the built-in presets.

### C-1 — Copy and paste lost embedded images between documents
**Severity: medium · Verified · Fixed**

`serializeSelection` put the selected elements on the pasteboard but not the
images they refer to. Pasting into the same document worked by accident, because
`doc.images` still held the entry. Pasting into another window or another
document produced a shape whose `imageRef` resolved to nothing — a silently
blank shape.

**Fix.** The payload carries the referenced images; the paste path routes them
through `parseDocument` (so they get the same validation as a file) and merges
them in.

Verified end to end by a new smoke step: drop a PNG, select all, ⌘C, ⌘N, ⌘V,
and assert an `<image>` with a `data:image/png;base64,` source appears in the
new document. Against the unfixed code it fails with "the pasted shape lost its
picture in the new document".

### C-2 — Deleted pictures stayed in the file forever
**Severity: medium · Verified · Fixed**

`removeElement` deletes the shape but never `doc.images[imageRef]`, and
`serializeDocument` wrote the whole map. Place a photograph, delete it, save —
the base64 is still there. Repeat, and the file grows without bound and never
shrinks.

**Fix.** `serializeDocument` writes only images some element still references.
I deliberately did **not** prune on delete: undo has to be able to bring the
picture back. Pruning on the way out reads the document without changing it, so
undo after a save still restores both the shape and its picture — there is an
explicit test for that.

### C-3 — PDF drew connector-label borders in the wrong colour
**Severity: low · Verified · Fixed**

`drawConnector` emits `re B` (fill and stroke) for a bordered label but never
set the stroke colour, so the border inherited the connector's line colour set
earlier in the same graphics state. The SVG path uses `label.border` correctly,
so the PDF drifted from the screen — against the repository's central "one
drawing path" promise.

**Fix.** Set the stroke to `label.border` before the box. New test asserts the
last stroke colour before the bordered rectangle is the label's blue and not the
connector's red.

### P-1 — Every unscoped edit copied and stringified all embedded images
**Severity: medium · Fixed**

`history.snapshot` did `deepClone(doc.images)` and `history.diff` did
`JSON.stringify` on the whole image map, on every transaction without a
`scope`. Adding a shape, deleting, duplicating, grouping and the canvas
settings are all unscoped. With a 5 MB photograph in the document, adding one
shape meant deep-cloning and stringifying about 6.7 MB of base64 — twice.

Embedded images are immutable: `import.ts` adds one, `applyPatch` adds or
removes one, and nothing ever edits an entry in place. I checked every write to
`.images` to confirm this before relying on it.

**Fix.** The image map is captured with a shallow copy and compared by
identity. Three new history tests cover restore, no-op detection, and
replacement, so the weaker comparison cannot silently stop noticing changes.

### P-2 — Binary IPC sends bytes as a JSON number array
**Severity: medium · Documented, not fixed**

`writeBinaryFile`, `writeTemporaryFile`, and `writeDiagram` all do
`Array.from(bytes)`. Measured here:

> An 8 MB payload becomes a **28.6 MB** JSON string and costs about **540 ms**
> of main-thread work before the IPC transfer even starts.

Copying a diagram does this twice, for the PNG and the PDF, on every ⌘C. The
irony is that `files.rs` already calls this out on the read side:

> The bytes come back as a binary IPC response rather than a JSON array, so
> importing a photograph does not turn a few megabytes into tens of megabytes
> of JSON on the way across.

The write side never got the same treatment.

**Why I did not fix it.** The fix changes the IPC contract — the commands would
take `tauri::ipc::Request` with the path in a header instead of `Vec<u8>` in
JSON — and it touches Rust I cannot compile or test in this container. Pushing
an unverifiable change to the signed shell is worse than reporting it. It is a
contained, well-understood piece of work for someone on a Mac.

### D-1 — README miscounted the shape library
**Severity: cosmetic · Fixed**

README said "All 27 standard flowchart shapes plus 15 general shapes,
containers, and annotations". The library has 23 `flowchart`, 15 `general`,
2 `container`, 2 `annotation` — 42 total. CHANGELOG is right: its enumerated
list of 27 includes the swimlane, phase, annotation and callout. The README
sentence put those in the second group as well, so it double-counted. Reworded.

---

## Reported but deliberately not changed

These are real observations where I judged a change to be out of scope, riskier
than the problem, or a design call that is the maintainer's to make.

| # | Observation | Why I left it |
|---|---|---|
| 1 | The Rust commands (`read_text_file`, `save_text_atomic`, `write_temp_file`, `share_files`, `begin_file_drag`) take arbitrary paths and do not check that the path came from a dialog. | This is the app's design — it has to open files the user picks — and the frontend is trusted. Worth stating plainly as the thing S-1 would have escalated against; narrowing it is an architectural decision. |
| 2 | `tauri_plugin_fs` is registered in `lib.rs` but the capability file grants it no permissions, so it is dead weight in the bundle. | Harmless; removing it is a judgement call about future use. |
| 3 | `TransactionOptions.transient` is documented and implemented but has no caller anywhere. So is the exported `documentMarkers` in `scene.ts`. | Dead code, not a defect. |
| 4 | Autosave calls `writeDocument`, which can raise a modal "the file on disk changed" confirmation from a timer with no user present. | A genuine UX flaw, but the right answer (defer? skip? toast?) is a product decision. |
| 5 | The recovery snapshot goes to `localStorage`, whose quota is around 5 MB. An untitled document with a photograph silently fails to snapshot; the failure is caught and swallowed. | D-024 already accepts localStorage for recovery. The silent failure is worth surfacing, but the fix is a product decision. |
| 6 | `handle_opened_urls` overwrites `PendingOpen` in a loop, so launching by opening several documents at once keeps only the last. | Rust, unverifiable here, and an edge case. |
| 7 | `CommandRegistry.run` drops any repeat of the same command within 60 ms. | Documented and deliberate, guarding against a menu accelerator firing twice. Noting it because it also swallows genuine fast repeats. |
| 8 | Store comments say updates coalesce "into one render per frame"; `queueMicrotask` is per microtask, not per frame. `resetMeasureCache` clears a context, not a measurement cache. | Comment inaccuracies with no behavioural effect. |
| 9 | Vector PDF ignores `options.includeGrid`, which SVG and raster honour. | Probably intentional; changing export output on a guess is not worth it. |
| 10 | `reorder` uses `Array.includes` inside a filter, so it is quadratic in selection size. | Only reachable with very large selections; not worth the churn. |

I also checked, and found nothing wrong with: the atomic-write implementation
and its path-traversal guard (which has a test), the PDF writer's string
escaping and cross-reference table, the main-thread dispatch in `macos.rs`, the
accelerator matching, the paste path's re-parse and id remapping (which was
already the right design and is why pasted content gets safe ids), the CSP, and
the release workflow's signing and notarisation checks.

---

## Changes made

| File | Change |
|---|---|
| `src/util/xml.ts` | **New.** `escapeXml` and `safeIdToken`, shared so `markers.ts` can escape without a circular import. |
| `src/canvas/scene.ts` | Scene-local generated ids for gradients and clip paths; escape embedded-image fields; `escapeXml` re-exported from the new module. |
| `src/connectors/markers.ts` | Escape the marker colour; make the marker id injective so two colours cannot share one arrowhead. |
| `src/model/serialization.ts` | Drop `image/svg+xml`; normalise style presets; prune unreferenced images on save. |
| `src/commands/history.ts` | Compare and carry embedded images by identity instead of by deep clone and JSON. |
| `src/app.ts` | Carry referenced images through copy and paste. |
| `src/io/export-pdf.ts` | Set the stroke colour for a connector label's border. |
| `tests/hostile-document.test.ts` | **New.** 14 tests: markup injection, definition-name uniqueness, image formats, preset normalisation, image pruning. |
| `tests/export.test.ts` | PDF label-border colour test. |
| `tests/history.test.ts` | Three tests for image handling through undo and redo. |
| `scripts/smoke.mjs` | End-to-end check that a picture survives a copy into a new document. |
| `README.md` | Shape count corrected; document-format and testing sections brought in line with the code. |
| `CHANGELOG.md` | Security and Fixed entries under Unreleased. |
| `DECISIONS.md` | D-010 gained a "Where it is enforced" paragraph. |
| `.github/workflows/ci.yml` | `permissions: contents: read`. |

## Verification

| Check | Before | After |
|---|---|---|
| `npm run version:check` | pass | pass |
| `npm run typecheck` | clean | clean |
| `npm test` | 98 passing | **116 passing** |
| `npm run build` | pass | pass |
| `npm run smoke` | 25 steps pass | **26 steps pass** |
| `cargo test`, `npm run check:macos` | not runnable in this container | not runnable; no Rust changed |

Every fix has a test that fails against the original code. I confirmed that by
stashing each source change in turn and re-running:

- `tests/hostile-document.test.ts` — 8 of 10 markup and format tests fail
  without `scene.ts`, `markers.ts` and `serialization.ts`; the preset and image
  tests fail without `serialization.ts`.
- `tests/export.test.ts` — the label-border test fails without `export-pdf.ts`.
- `npm run smoke` — the new step fails with "the pasted shape lost its picture
  in the new document" without `app.ts`.

## What I would look at next

1. **P-2**, the binary IPC encoding, on a Mac where it can be measured and
   tested.
2. **Gate 1 and Gate 2**, still open in `DECISIONS.md` and still the only two
   questions this repository cannot answer for itself. Nothing I found changes
   that assessment; the documentation is honest about it.
3. A **fuzz corpus for `parseDocument`**. The normaliser is careful and the new
   tests probe it deliberately, but generated input would cover more of it than
   hand-written cases.
4. **One open Dependabot alert** (moderate) on the default branch, surfaced by
   the push at the end of this session. `npm audit` reports zero
   vulnerabilities, so it is almost certainly a Cargo advisory somewhere in the
   transitive GTK/WebKit dependency tree that Tauri pulls in. I could not
   enumerate it from this session — there is no Dependabot tool available here
   — so it is unread rather than assessed. It is worth opening
   `/security/dependabot` and checking whether it reaches any code that
   actually ships in the macOS bundle.
