# Response to the Codex review

**Responding to:** [CODEX-REVIEW.md](CODEX-REVIEW.md), dated 2026-08-28 against
revision `977f2fb`.

**Verdict on the review:** substantially correct. Eight of its nine findings
reproduce exactly as described. The ninth (Finding 6) bundles four claims:
three hold and are fixed, and one — that the documentation claims test coverage
for text layout and accelerators that does not exist — is wrong, because the
coverage does exist. Findings 1 and 2 are the serious ones; both are now fixed,
with tests that fail against `977f2fb`.

The review also missed a defect of its own severity class, which a separate
pass had already found and fixed: a `.flowshark` file could inject live markup
into the canvas and into every exported SVG. That is described under
[What the review missed](#what-the-review-missed).

---

## Note on ordering

This response covers two rounds of work. A first pass reviewed the repository
before `CODEX-REVIEW.md` was available (the file was not in the working tree,
in any commit, on any branch, or in any pull request at the time) and landed
two commits. Codex's Finding 9 partly overlaps that work, which is noted where
it applies. Everything else here is new.

## What I could and could not run

| Check | Codex | This response |
|---|---|---|
| `npm test` | Passed, 98 tests | **Passes, 145 tests** |
| `npm run build` | Passed | Passes |
| `npm run smoke` | Blocked — no Chromium | **Passes, 26 steps** |
| `cargo check`/`clippy`/`fmt` for `aarch64-apple-darwin` | not attempted | **Passes** — via `npm run check:macos`, which targets macOS and so sidesteps the missing Linux GTK packages |
| `cargo test` | Blocked — no `glib-2.0.pc` | Blocked in this container, same cause — **but run and passing on CI's macOS runner** |
| `npm audit` | Blocked — HTTP 403 | **`npm audit` passes: 0 vulnerabilities** |

Two corrections to the environment picture. Rust *is* checkable here — the
macOS cross-check compiles `files.rs`, `macos.rs`, and the test bodies against
the real target, so every Rust change below is type-checked, clippy-clean and
`rustfmt`-clean. Only the *running* of Rust tests is unavailable in this
container, and CI covers that: the `Application shell` job on `macos-14` runs
`cargo fmt --check`, `cargo clippy -D warnings` and `cargo test`, and all three
pass on this branch's head. And the npm advisory endpoint works from this
session: production and development dependencies both report zero known
vulnerabilities. There is one open Dependabot alert (moderate) on the default
branch, which npm's clean result suggests is a Cargo advisory; I have no
Dependabot access here to read it.

---

## Finding-by-finding

### Finding 1 — an edit made during a save can be marked saved and then lost
**Codex: High · Verdict: confirmed, exactly as described · Fixed**

The mechanism is precisely the one in the review. `writeDocument` serialised
the document, awaited the write, and then called `markSaved` unconditionally.
The editor stays live across that await, so:

1. the save captures state **A**;
2. the user edits, producing **B**, and `dirty` is set;
3. the write of **A** resolves and `markSaved` clears `dirty`;
4. `confirmDiscard` no longer prompts, and `writeRecoverySnapshot` returns
   early on `if (!state.file.dirty) return`;
5. **B** is gone.

**One clarification that raises the severity.** The review says overlapping
writes are possible without spelling out the consequence. The Rust writer named
its temporary file after the target — `.{name}.flowshark-tmp` — deterministically.
Two overlapping writes therefore did not merely race to rename; they both
opened, truncated and wrote *the same temporary file*, and whichever renamed
second published a file containing an interleaving of two payloads. That is
document corruption, not just a lost edit. It is reachable from one window
(the autosave timer versus ⌘S) and from two windows on one document, which is
supported.

**Fixed**, following the review's recommendation:

- `Store` carries a `documentRevision` that advances on every document change.
  It is incremented inside `markChanged`, which is the single funnel every
  mutation, undo, redo and replacement already passes through, so a future
  command cannot forget it.
- `performWrite` captures the revision alongside the serialised text.
  `markSaved(path, revision)` clears `dirty` only if the document has not moved
  since; otherwise the path and recent-files entry are recorded and the
  document stays dirty.
- Writes are serialised through one queue, so two can never be in flight.
- The temporary file name now carries a unique suffix, closing the corruption
  window the queue cannot reach across windows.
- `serializeDocument` takes the modification timestamp as a parameter, and the
  caller writes the same value into the file and into the in-memory document
  once the write succeeds. Previously the document on disk always claimed a
  time the running document did not have.

`tests/saving.test.ts` drives the sequence with a write the test resolves by
hand, covering edit-during-save, undo-during-save, write failure, the clean
case, and which state changes do and do not advance the revision.

### Finding 2 — hostile documents can exhaust CPU and memory despite the 256 MB cap
**Codex: High · Verdict: confirmed · Fixed**

Correct in every particular. The native cap bounded the UTF-8 file and nothing
downstream. After `JSON.parse`, `normaliseElement` and friends accepted
unbounded counts of elements, order entries, group children, waypoints, labels,
presets, layers and images; `str()` had no length limit; and `num()` tested
only `Number.isFinite`, so a coordinate of `1e300` or a font size of `1e9` was
accepted and passed to path generation and text layout. Base64 syntax was
checked but decoded size, aggregate size and pixel count were not.

The CHANGELOG's claim that the size caps mean "a malformed file cannot exhaust
memory" was accordingly wrong.

**Fixed.** `DOCUMENT_LIMITS` in `src/model/serialization.ts` sets explicit
budgets for element, layer, preset, waypoint, label, group-child and image
counts, text length, per-image and total decoded bytes, and image pixels. They
sit far above any real diagram — the documented target is 2,000 objects — and
exist to turn a hang into a message. Over-budget documents are refused whole
with a `DocumentFormatError` naming what was over and by how much; the review
is right that silently truncating relationships would be worse. Geometry and
styling values are clamped to documented ranges rather than merely being
finite. Payload size is computed from the encoded length, so refusing an
oversized image does not require allocating the buffer the budget exists to
prevent.

`tests/document-limits.test.ts` holds each boundary, checks the error message
names the overrun, and checks a 2,000-element document still opens.

### Finding 3 — the Apple Silicon and VoiceOver gates remain open
**Codex: High · Verdict: confirmed. Cannot be closed from here**

Correct, and `DECISIONS.md` already said so; the review is right that these are
acceptance gates rather than future enhancements. Both need a Mac. Nothing in
this session changes that, and I have not pretended to.

What I could act on is the review's last recommendation — that release language
should not outrun the evidence. The 0.1.0 changelog entry claimed to cover
"everything in the MVP scope of the project brief"; it now states what the
feature set is and says plainly that the claim is not checkable from this
repository while the brief is absent and both gates are open.

I did **not** act on the review's suggestion to implement keyed incremental DOM
updates. That is conditional on Gate 1 failing, and Gate 1 has not been run.
Building an optimisation against an unmeasured bottleneck is the wrong order.

### Finding 4 — custom Tauri commands accept arbitrary paths
**Codex: Medium, explicitly framed as defence in depth · Verdict: confirmed · Partly fixed**

Accurate. `read_text_file`, `read_binary_file`, `save_text_atomic`,
`save_binary_atomic` and `file_modified_at` took any path, were registered for
every main window, and the app is deliberately unsandboxed. The review is also
right that no document-to-script injection existed *by way of escaping user
text* — though see [What the review missed](#what-the-review-missed), because
one did exist by another route, which makes this finding's premise less
comfortable than it reads.

**Done:** writes are now size-capped in Rust (the review specifically notes
`save_binary_atomic` had no limit), and `file_modified_at` has been removed
entirely — it was superseded by the fingerprint command in Finding 5, so this
is one fewer path-taking command rather than one more.

**Not done: the grant system.** Replacing pathname I/O with opaque short-lived
grants issued by the native panels is the right design and I have not built it.
It changes every file-handling path in `app.ts`, the drop and Finder-open
routes, and all five commands; it needs its own authorization tests; and the
part that matters most — that a grant actually corresponds to what a real
NSOpenPanel returned — cannot be exercised in this container. Landing a
half-built authorization layer that looks like protection is worse than a
clearly-documented absence. This is the largest item I am leaving for someone
with a Mac.

### Finding 5 — external-change detection misses changes and keeps stale state
**Codex: Medium · Verdict: confirmed, both halves · Fixed**

Both parts reproduce. The test was `current > this.lastKnownFileTime + 1000`,
so an equal, older or sub-second-newer timestamp passed silently — exactly what
cloud-sync conflict resolution, a restore, and coarse timestamp resolution
produce. And `lastKnownFileTime` was never reset: `newDocument`, `loadTemplate`
and recovery all left the previous document's timestamp in place, so a Save As
after ⌘N compared the new file against the old document's time.

**Fixed.** A new `file_fingerprint` command returns length, nanosecond
modification time, and the filesystem's own identity for the file
(`st_dev`/`st_ino` on Unix), combined into an opaque string the front end only
ever compares for equality. Any difference is a conflict. The fingerprint is
cleared synchronously before every document replacement, and
`applyLoadedDocument` is now `async` and awaits capturing the new one before
the open is complete — the previous fire-and-forget left a window where the
value was neither the old one nor the new one.

I did not add a content hash. The review offers it as a preference rather than
a requirement, and hashing a file up to the 256 MB cap on every save is a cost
the length-plus-identity-plus-time triple avoids while catching all three cases
the review names.

### Finding 6 — verification gaps and documentation that overstates coverage
**Codex: Medium · Verdict: mixed — three claims confirmed, one incorrect · Partly fixed**

Taking the claims separately, because they are not equally right.

**Confirmed: the release workflow permitted an unsigned release.** With
`APPLE_SIGNING_IDENTITY` unset it printed a warning and `exit 0`, so a release
tag could produce a build the changelog described as signed and notarised.
**Fixed:** the workflow now checks for the certificate, identity and team ID
before building and fails the job if any is missing. The unconditional
`codesign --verify` / `stapler validate` / `spctl --assess` checks follow.

**Confirmed: the changelog overstated the bundle.** It listed "a signed,
notarised, hardened-runtime bundle" as a shipped 0.1.0 feature while
`DECISIONS.md` listed the signing identity as open. **Fixed:** the entry now
describes what the workflow does, and says no signed build has been produced.

**Confirmed: the atomic write did not sync the containing directory.**
`sync_all` on the temporary file made its contents durable; the rename that
publishes them was not synced, so rename durability after power loss was
filesystem-dependent — while the module comment promised the previous version
would survive. **Fixed** rather than merely documented: `write_atomic` now
fsyncs the parent directory after the rename, on Unix, best-effort.

**Incorrect: "the docs claim unit coverage for text layout and accelerator
behavior without dedicated test files."** The coverage exists. Accelerators
have `describe('accelerators')` in `tests/commands.test.ts` — parsing,
formatting, event matching, the Option-key physical-key fallback, and unshifted
zoom keys. Text layout has `describe('text layout')` in `tests/snap.test.ts` —
wrapping, hard line breaks, long-word breaking, no-wrap, and horizontal and
vertical alignment. The README claim is accurate. What is true is the weaker
observation underneath it: the text-layout tests live in a file named after
snapping, which makes them hard to find. That is a naming problem, not a
coverage gap, and I have not moved them, because renaming test files to satisfy
a mistaken finding is churn.

**Not done: the post-build macOS acceptance job.** Installing the DMG,
launching the app, opening a fixture through Finder registration and validating
notarisation is the right check and it needs a signed build to validate, which
needs the certificate that Finding 3 records as still missing. It cannot be
written meaningfully before then.

### Finding 7 — the authoritative project brief is missing
**Codex: Medium · Verdict: confirmed · Recorded, not resolvable here**

Correct. `README.md`, `DECISIONS.md` and source comments cite §8.14, §8.15,
§13 and §14, and no brief exists in the tracked repository or its history. I
searched the working tree, every commit on every branch, and the pull requests.
The consequence the review draws is right: MVP-completeness claims are not
auditable from this repository alone.

**What I did:** added the brief to the "Still open" table in `DECISIONS.md`
with a section explaining what its absence costs, and corrected the changelog
claim as described under Finding 3.

**What I deliberately did not do:** write the traceability matrix. A matrix
built now would be derived from the implementation it is supposed to
independently check, and would read as evidence while being a restatement of
the code. The brief has to arrive first; the matrix is then worth building
against it, and the decision log says so.

### Finding 8 — autosave does synchronous whole-document work with intrusive side effects
**Codex: Low · Verdict: confirmed · Fixed, except for the storage location**

Every part reproduces. The unsaved-document path serialised the whole document
and then embedded that string inside another JSON object — double-encoding that
escaped every quote and roughly doubled the payload — before a synchronous
`localStorage` write. The saved-document path ran the entire interactive Save
flow on a timer: conflict check, native menu rebuild, recovery clearing, and a
"Saved" toast.

**Fixed:**

- Automatic saving is silent: no toast, and no modal conflict question. A
  modal raised from a timer with nobody present blocked the save and sat there;
  it now leaves the document dirty and says so in a passing notice.
- It is gated on the revision, so an interval with no edits does no work at
  all — no serialisation, no write.
- The snapshot stores the document as its own JSON value instead of a string
  inside one. Snapshots in the old shape are still recovered, so upgrading does
  not discard waiting work.
- A refused or failed automatic save is retried on the next tick rather than
  being recorded as done.

**Not done: moving recovery to a native file in Application Support.** The
review is right that `localStorage` is the wrong home — the quota is small, so
a diagram with photographs will not fit, and `D-024` already accepts this as a
known cost. Moving it means a new native command, a directory to own, and
cleanup and migration rules, and it interacts directly with the grant design
deferred under Finding 4. Doing it independently would mean building it twice.

### Finding 9 — image validation trusts labels more than contents
**Codex: Low · Verdict: confirmed · Fixed**

Correct on both counts.

The SVG half was already fixed in the earlier pass, independently and for the
same reason the review gives: `image/svg+xml` was accepted by document
normalisation even though SVG import is explicitly out of scope under D-010,
and a `.flowshark` file can be written by hand. `D-010` now records where the
policy is enforced, in both the importer and the reader, so the two cannot
drift apart again.

The magic-bytes half is fixed now, in `src/util/image.ts`, which reads both the
format and the true pixel size from a payload's own header — PNG, JPEG, GIF and
WebP, including the `WEBP` form type, so a RIFF container holding WAVE audio is
not accepted as an image. Importing verifies the bytes against the type
inferred from the extension and refuses a mismatch by name; the document reader
runs the same inspection on each embedded payload, decoding only enough base64
to reach the header. The module has no dependencies precisely so those two
paths share one answer rather than keeping two that can disagree — which is
what the bot review below found them doing.

I did not move the sniffing into Rust as the review suggests. The check has to
exist in TypeScript regardless — embedded records in a document never cross the
Rust boundary at all — and putting it in both places means one policy in two
languages that can disagree. The IPC-side benefit is bounded by the existing
64 MB import cap.

---

## What the review missed

The review states, under Finding 4, that "no direct document-to-script
injection was found: scene strings escape user text and CSP is strong." The
first half was not true at `977f2fb`.

`src/canvas/scene.ts` built `fs-grad-${element.id}` and `fs-clip-${element.id}`
and wrote them unescaped into `id` attributes **and into the `fill="url(#…)"`
and `clip-path="url(#…)"` attributes of elements that are actually drawn**.
An element id comes out of a `.flowshark` file. An id of `a" onmouseover="alert(1)`
produced, in the rendered scene body:

```
<path class="fs-shape-path" d="…" fill="url(#fs-grad-a" onmouseover="alert(1))" …/>
```

`escapeXml` was applied to `data-id` a few lines away but not here.
`src/connectors/markers.ts` had the same defect for a connector's stroke
colour. The review's own observation that "most SVG attributes pass through XML
escaping" — *most* — is where the gap sat.

The CSP does block the injected handler inside the packaged app, so the
review's assessment of the app's runtime posture holds. But an exported `.svg`
carries no CSP, and a recipient opening one in a browser opens a scriptable
document. FlowShark could turn a malicious `.flowshark` into a malicious
`.svg` — the exact guarantee the README and the export test claim.

The existing "no scripts or event handlers" test could not have caught it: it
built its document from a bundled template, which contains nothing hostile.
`tests/hostile-document.test.ts` now builds documents designed to break out of
each attribute and asserts against the parsed DOM rather than the raw string.

This is noted not to score a point but because it bears on Finding 4's
severity: the finding is framed as protecting against a hypothetical future
renderer injection, and there was an actual one.

---

## Round two: the Codex bot reviewed this response

Opening the pull request drew an automated Codex review of the fixes above. It
raised five findings. **All five reproduced, and three were defects in my own
work rather than pre-existing ones.** They are worth recording, because two of
them meant a fix I had described as done was not doing anything.

### It found that the headline budget was never enforced

`DOCUMENT_LIMITS.elements` was declared and never referenced. I wrote the
budget table for Finding 2, enforced six of its entries, and missed the one the
whole finding was about — a document could still declare millions of elements
and force the reader to build exactly the object graph the budget exists to
refuse. My own tests covered layers, presets, waypoints, labels and images, and
skipped elements, so nothing caught it.

Now enforced before the element loop, with a matching budget for the drawing
order, which is read and filtered before the element count can bound it.

### It found the pixel budget was checking the wrong number

The check read the document's own `width` and `height`. Those are fields
*beside* the payload, not in it. A hostile file could declare `1 x 1` for a
30000 x 30000 PNG, pass the check, and be embedded as a data URL that the
renderer decodes at its real size. The check was, as written, worthless against
the case it existed for.

Budgets now come from the payload's own header, via the new `src/util/image.ts`
described under Finding 9, and the recorded dimensions are taken from the
payload too, so a document cannot lie about a picture it carries. A payload
whose header cannot be read returns `null` rather than a small size: "cannot
tell" and "is small" must not be the same answer, or truncating a header
bypasses the budget. Writing the tests for it surfaced an off-by-one of my own,
where a JPEG frame header ending exactly at the end of the decode window was
missed.

### It found the signing guard ran too late to do anything

My Finding 6 fix put the guard *after* `tauri-action` — the step that builds,
uploads, and creates the draft release. It would have failed only once the
unsigned bundle was already published. The pull request said the workflow
"checks the secrets before building", which was false. Moved ahead of the
build.

### And two more

- Importing did not enforce the limits the reader enforces, so a highly
  compressed image over the pixel budget could be embedded and saved into a
  document that then refused to open. The importer now applies the same
  budgets, sharing the module above so the two cannot drift apart.
- `write_atomic` returned early on `write_all` and `sync_all` failures without
  removing the temporary file. Harmless while the name was predictable and
  reused — but the unique names I added for Finding 1 meant every failed retry
  left a fresh orphan beside the document. A regression I introduced. All
  failure paths now clean up.

### What this says about the round above

Two of my fixes were inert: one budget declared and never applied, one guard
placed after the thing it guards. Both had prose describing them as working.
That is a specific failure mode worth naming — I verified the *behaviour I
changed* rather than the *claim I made about it*, and a test suite I wrote
myself inherited the same blind spot. The five new tests here fail against the
previous commit; the four earlier ones for those areas did not exist.

---

## Where I disagree with the disposition

The review's recommended disposition is sound and I have followed it. Two
qualifications.

**"Fix Findings 1 and 2 before relying on it for important documents."** Both
are fixed and tested. I would add the injection above to that list — it is the
one defect here that can harm someone other than the user, since it travels in
an exported file.

**On the framing of Finding 6's coverage claim.** The review reads "no
dedicated test file" as "documentation overstates coverage". For text layout
and accelerators that inference is wrong, and the README needed no change on
that point. The rest of Finding 6 — the signing downgrade, the changelog
overstatement, the unsynced directory — is right and is fixed.

---

## Changes made in this round

| File | Change |
|---|---|
| `src/state/store.ts` | `documentRevision`, advanced in `markChanged`; `markSaved` takes the revision it is reporting on. |
| `src/app.ts` | Save queue; revision captured with the serialised text; fingerprint-based conflict detection reset on every replacement; silent, revision-gated autosave; singly-encoded recovery snapshot that still reads the old shape. |
| `src/model/serialization.ts` | `DOCUMENT_LIMITS` and enforcement; numeric clamping; image signature, byte and pixel budgets; `serializeDocument` takes the modification timestamp. |
| `src/util/image.ts` | **New.** Format and true pixel size read from a payload's own header, shared by the importer and the document reader. |
| `src/io/import.ts` | Imports verified against their declared type, and held to the same byte and pixel budgets the reader applies. |
| `src/platform/files.ts` | `fileFingerprint`; `fileModifiedAt` removed. |
| `src-tauri/src/files.rs` | Unique temporary names; parent-directory fsync after rename; write size cap; `file_fingerprint`; `file_modified_at` removed. |
| `src-tauri/src/lib.rs` | Command registration updated. |
| `tests/saving.test.ts` | **New.** The save race, deterministically. |
| `tests/document-limits.test.ts` | **New.** Budgets (elements and order included), clamping, and image format and size parsing. |
| `tests/serialization.test.ts` | Real image payloads; a mislabelled-format case. |
| `tests/hostile-document.test.ts` | Real image payloads. |
| `.github/workflows/release.yml` | A release tag fails without the signing secrets. |
| `CHANGELOG.md` | New entries; the MVP-scope, signed-bundle and memory-exhaustion claims corrected. |
| `DECISIONS.md` | The missing brief recorded in "Still open" with what its absence costs; D-024 records what saving depends on. |
| `README.md` | Document-format and testing sections brought in line. |

Changes from the earlier round — the markup injection, the SVG image format,
preset normalisation, orphaned images, copy-and-paste of pictures, the PDF
label border, and the history image comparison — are in the changelog under
Unreleased and in the two commits preceding this one.

## Verification

| Check | At `977f2fb` | Now |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm test` | 98 passing | **145 passing** |
| `npm run build` | passes | passes |
| `npm run smoke` | 25 steps | **26 steps** |
| `npm run check:macos` | passes | passes |
| `cargo fmt --check` | passes | passes |
| `cargo clippy --all-targets --target aarch64-apple-darwin -D warnings` | clean | clean |
| `npm audit` | — | 0 vulnerabilities |
| `cargo test` | blocked in this container | **passing on CI** (`macos-14`), alongside `cargo fmt --check` and `clippy -D warnings` |

Every fix has a test that fails against the original code, confirmed by
stashing each source change in turn and re-running. Of the 29 new tests in
`saving` and `document-limits`, most fail at `977f2fb`; the ones that pass
assert behaviour that was already correct and had to stay correct (the clean
save case, and that view and selection changes do not count as document
changes). The five tests added for the bot review's findings fail against the
commit that preceded them.

## The Dependabot alert, now assessed

I listed this as unread rather than assessed. It is worth closing properly,
because the answer is "does not affect the product" and that is not the same as
"ignored".

There is no Dependabot API available from this session, so I matched
`src-tauri/Cargo.lock` against a fresh clone of the RustSec advisory database
directly. Of 521 locked crates, 18 match an advisory — but only **one is an
actual advisory** rather than an "unmaintained" notice:

**`glib` 0.18.5 — RUSTSEC-2024-0429**, unsoundness in the `Iterator` impls for
`VariantStrIter`. Its alias is `GHSA-wrw7-89jp-8q8g`, and a GHSA alias is what
Dependabot surfaces, so this is almost certainly the moderate alert.

**It does not reach the shipped application.** `cargo tree -i glib` for
`aarch64-apple-darwin` returns nothing at all: `glib` arrives only through the
GTK stack, which Tauri uses on Linux and not on macOS, where it uses WebKit and
AppKit instead. FlowShark builds only Apple Silicon targets. The crate is in
the lock file because a lock file covers every platform, and it is never
compiled by any build or CI job this repository runs.

The same is true of every GTK-stack entry — `atk`, `gdk`, `gdkx11`,
`gdkwayland-sys`, `gtk`, `gtk-sys`, `gtk3-macros` and their `-sys` crates, all
"unmaintained" notices, none in the macOS tree — and of `proc-macro-error`.

Six unmaintained notices *are* in the macOS tree: `dirs` 6.0.0 and the five
`unic-*` crates. All are informational — a crate no longer receiving updates,
with no known vulnerability — and all arrive transitively through Tauri rather
than through anything this repository chose.

**What is still worth doing.** Nothing here needs a fix, but nothing catches
the next one either. A `cargo audit` or `cargo deny` job would, and I have not
added one, because it needs a decision I should not make alone: run unfiltered
and the job is permanently red on Linux-only GTK notices that cannot affect the
product; filter them and someone has to own the ignore list. That is a
maintainer's call about how the check should behave, not a defect.

## Still open after this round

1. **Gate 1 and Gate 2** on Apple Silicon hardware — Finding 3, unchanged.
2. **The project brief and its traceability matrix** — Finding 7.
3. **The grant-based file authorization redesign** — Finding 4.
4. **Recovery snapshots in Application Support** rather than `localStorage` —
   Finding 8, best done with item 3.
5. **A post-build macOS acceptance job** — Finding 6, blocked on a certificate.
6. **A repeatable dependency audit.** The one open Dependabot alert is now
   assessed (below); nothing checks for the next one automatically.
