# Decisions

The choices made while building FlowShark, why they were made, and what would
change them. Decisions are numbered so other documents and code comments can
point at them; numbers are never reused.

Each entry records the **context**, the **decision**, the **consequences** —
including the ones that cost something — and **what would reverse it**.

**Contents**

- [Platform and distribution](#platform-and-distribution)
  — [D-001](#d-001-apple-silicon-only) · [D-002](#d-002-keep-tauri-v2)
  · [D-003](#d-003-bundle-identifier-and-document-type)
  · [D-004](#d-004-developer-id-and-a-dmg-with-no-app-sandbox)
- [Rendering and architecture](#rendering-and-architecture)
  — [D-005](#d-005-render-with-svg-not-a-2d-canvas)
  · [D-006](#d-006-one-scene-builder-for-the-screen-and-every-export)
  · [D-017](#d-017-no-ui-framework)
  · [D-022](#d-022-keep-the-browser-build-working)
- [The document model](#the-document-model)
  — [D-014](#d-014-undo-by-diffing-snapshots)
  · [D-015](#d-015-z-order-is-a-position-not-a-field)
  · [D-023](#d-023-store-colours-as-srgb-hex)
  · [D-024](#d-024-two-kinds-of-automatic-saving)
- [Text](#text)
  — [D-007](#d-007-plain-text-styled-per-element)
  · [D-008](#d-008-in-app-font-and-colour-controls)
- [Connectors](#connectors)
  — [D-019](#d-019-floating-anchors-pick-a-declared-connection-point)
  · [D-020](#d-020-simple-orthogonal-routing-first)
- [Export and system integration](#export-and-system-integration)
  — [D-016](#d-016-write-pdf-directly-with-a-raster-fallback)
  · [D-009](#d-009-build-the-macos-integrations-directly-against-appkit)
- [Scope deliberately left out](#scope-deliberately-left-out)
  — [D-010](#d-010-no-svg-import-yet)
  · [D-012](#d-012-layers-in-the-model-no-layers-panel)
  · [D-013](#d-013-no-updater-yet)
  · [D-025](#d-025-a-fixed-toolbar)
- [Other](#other)
  — [D-011](#d-011-a-colour-blind-safe-default-palette)
  · [D-018](#d-018-keep-the-name-flowshark)
  · [D-021](#d-021-generate-the-icons-from-a-script)
- [Milestone 0 gates](#milestone-0-gates)
- [Still open](#still-open)

---

## Platform and distribution

### D-001: Apple Silicon only

**Context.** macOS 26 Tahoe is the last release that supports Intel Macs;
macOS 27 is Apple Silicon only. A universal binary roughly doubles Rust build
time and doubles the test matrix, and the value of that work falls every month.

**Decision.** Build for `aarch64-apple-darwin` only. `minimumSystemVersion` is
`14.0` — the version the app is actually tested against — not Tauri's default
of `10.13`, which would let the app start on systems nobody has tried.

**Consequences.** Intel Macs cannot run FlowShark. Builds and CI runs are
faster and there is one architecture to reason about.

**What would reverse it.** A concrete user on an Intel Mac who needs the app
before that hardware is retired. The change is small:
`npm run tauri:build:universal` already exists, and CI would need
`x86_64-apple-darwin` added to the toolchain step.

### D-002: Keep Tauri v2

**Context.** The brief (§9.1) selects Tauri v2 and asks that the decision be
revisited against four conditions in §9.4. Nothing in this codebase was tied to
Windows.

**Decision.** Keep Tauri v2, retargeted to macOS. Windows targets, `Ctrl`
shortcuts, and the ribbon layout are gone.

**Consequences.** The costs the brief lists are real and are addressed
individually: Liquid Glass materials (see below), the AppKit Font and Colors
panels (D-008), VoiceOver on the canvas (D-005), and app extensions (D-009).
The bundle is larger than a Swift application's and smaller than an Electron
one's.

On the **native look**: the brief is explicit that a poor imitation of macOS 26
Liquid Glass would look worse than a clean design of its own. FlowShark takes
that advice. The interface is flat and opaque, sits comfortably next to system
windows, and does not pretend to be made of glass. It uses the real menu bar,
the real Open and Save panels, the real Print panel, and the system font, which
is where "feels like a Mac app" actually comes from.

**What would reverse it.** Any of the four conditions in §9.4 — the canvas
failing the performance targets on Apple Silicon with the WebView shown to be
the cause; App Review rejecting the WebView entitlements; VoiceOver failing an
accessibility review; or an iPad version entering the roadmap. See
[Milestone 0 gates](#milestone-0-gates).

### D-003: Bundle identifier and document type

**Context.** The brief uses `com.example.flowshark` as a placeholder and asks
for the real reverse-domain identifier before Milestone 0 ends. The project has
no product domain, and FlowShark exists as two repositories:
`johnjanney/flowshark` for the Windows version and `johnjanney/flowshark-mac`
for this one.

**Decision.** Use `io.github.johnjanney.flowshark-mac` for the bundle and
`io.github.johnjanney.flowshark-mac.document` for the exported UTI. The
document type conforms to `public.data`, `public.content`, and `public.json`,
and claims the `flowshark` extension and the `application/vnd.flowshark+json`
MIME type.

**Reasoning.** A reverse-DNS identifier must come from a domain the project
controls. There is no product domain, but the GitHub account owns
`johnjanney.github.io`, and each repository owns a path beneath it. The
authority for `io.github.johnjanney.<name>` therefore comes from
`johnjanney.github.io/<name>`, which means `<name>` is the *repository* name —
so this app is `flowshark-mac`, not `flowshark`. That namespace already belongs
to the Windows repository. This is the same derivation Flathub and other
package systems use for projects hosted on GitHub without a domain.

Two earlier drafts were wrong and are recorded so the reasoning is not
repeated: `com.flowshark.app` assumed control of `flowshark.com`, which the
project does not have; `io.github.johnjanney.flowshark` took the project name
rather than the repository name, and so claimed the Windows repository's
namespace.

Hyphens are permitted: Tauri documents the identifier as "alphanumeric
characters (A-Z, a-z, and 0-9), hyphens (-), and periods (.)", and Apple allows
the same set in `CFBundleIdentifier`.

**Consequences.** These strings appear in `src-tauri/tauri.conf.json` and
`src-tauri/Info.plist`. Changing the identifier later would mean macOS treats
the app as a different application — preferences are lost and the Finder's
document type registration has to be rebuilt — and changing the *UTI* later
would additionally orphan the file association on machines that had already
seen the old one. Settling both before the first release is what avoids that.

The bundle identifier is macOS-only, so the Windows app cannot collide with it
whatever it is called; the point of matching the repository is that the
identifier's authority is derived from the repository path, not that the two
apps would otherwise clash.

**One thing to watch.** The UTI names a *file format*, and a format outlives a
port. If the iPad companion in §16 is ever built, it must declare **this same
UTI**, `io.github.johnjanney.flowshark-mac.document`, rather than minting a new
one from its own repository — otherwise the two apps would not recognise each
other's documents. The `-mac` in a UTI shared with an iPad app reads oddly; that
is a cosmetic cost, and it is much cheaper than a split file format.

**What would reverse it.** Registering a product domain before the first public
release, when changing it is still free. Afterwards it is not, and the better
course would be to keep this identifier and use the new domain for the website.

### D-004: Developer ID and a DMG, with no App Sandbox

**Context.** The brief leaves the distribution channel open. Developer ID plus
a DMG makes the sandbox optional; the Mac App Store makes it mandatory, and
the brief notes that Apple's position on WebView entitlements for App Store
submissions is unverified.

**Decision.** Ship with a Developer ID certificate in a DMG. Turn on the
Hardened Runtime. Do not enable the App Sandbox. Request exactly one
entitlement, `com.apple.security.cs.allow-jit`, which WKWebView's JavaScript
engine needs.

FlowShark is built for personal and in-company use rather than public sale
(D-018), which settles this rather than merely starting here: the App Store
would add the sandbox, a review cycle, and an unverified entitlement question,
in exchange for a distribution channel the project does not need. Signing and
notarising still matter, because colleagues installing it should not meet a
Gatekeeper warning.

**Consequences.** Open and Save work without security-scoped bookmarks, so
Open Recent survives a restart with no extra machinery. The entitlement list is
as short as it can be. FlowShark is not on the Mac App Store.

**What would reverse it.** A decision to sell the app or list it publicly.
That means
adding `com.apple.security.app-sandbox` and
`com.apple.security.files.user-selected.read-write`, adding security-scoped
bookmarks to the recent-files list, and testing the JIT entitlement against App
Review early, because that combination is unverified. `Entitlements.plist`
carries a comment saying exactly this.

---

### D-027: File access by capability, not by pathname

**Context.** The Rust shell exposed a handful of commands — read a document,
write a document, write an export, fingerprint a file — and every one took a
pathname from the web layer. The web layer got that pathname by presenting the
Open or Save panel itself. Nothing on the Rust side checked where it came from,
so a pathname the user chose and a pathname a script made up were
indistinguishable. Because the app is deliberately not sandboxed (D-004), that
meant any code running in the web view could read or write anywhere the user
could.

That was tolerable only for as long as nothing could run in the web view.
A document could inject a live event handler into the canvas until this was
fixed, which is the case the design should have assumed all along.

**Decision.** The panels are presented from Rust, and what crosses the boundary
is a capability rather than a pathname. `src-tauri/src/grants.rs` issues an
opaque token for a file the user chose, recording whether it may be read,
written, or both, and whether it survives one use or the session. Every file
command takes a token. The pathname still travels back for the title bar and
the recent-documents menu, because showing a path the user just chose grants
nothing.

Grants are created at exactly three points, and all three are the user acting:
choosing a file in a panel, opening a document from the Finder or dropping one
on the window, and re-opening from the recent-documents menu.

**Consequences.** Two things had to move to the Rust side to keep that true.
Drops are handled there, because Tauri's own drag-drop event hands the web view
the dropped pathnames. And the list of documents the user has chosen is kept
and persisted there, because "the user picked this once" is precisely the claim
the web layer must not be able to make for itself; the menu in the web layer is
seeded from it at start-up.

The capability file is shorter as a result: `dialog:allow-open`,
`dialog:allow-save` and `opener:allow-reveal-item-in-dir` are gone, because the
web layer no longer does any of those things.

A renderer compromise now reaches the files the user opened in that window,
rather than the whole file system. That is a smaller blast radius, not none.

**What this does not do.** It does not verify that a token corresponds to a
real `NSOpenPanel` result — it verifies that this process issued the token for
a path a user action produced, which is the same guarantee reached a different
way. And it is not the sandbox: without the App Sandbox entitlement, a
compromise that escapes the web view entirely is unaffected by any of this.

**What would reverse it.** Adopting the App Sandbox (see D-004), which enforces
the same property in the kernel and makes the grant table redundant for
user-selected files — though the security-scoped bookmarks it needs for Open
Recent are close to what `grants.rs` already keeps.

---

## Rendering and architecture

### D-005: Render with SVG, not a 2D canvas

**Context.** The brief names the canvas as the main accessibility risk: a
`<canvas>` element has no structure a screen reader can read, and the team
would have to build an ARIA tree or a parallel object list by hand (§8.14,
§15).

**Decision.** Draw the diagram as SVG in the DOM rather than into a 2D canvas.

**Consequences.**

- *Accessibility.* Every element is a real node that can carry a role, a
  label, and a `<title>`. FlowShark still maintains a separate outline for
  navigation (see the Milestone 0 gates below), but the drawing itself is not
  an opaque rectangle.
- *Hit testing.* The browser does it, exactly, against the real shape outline.
  A click inside the notch of a hexagon misses the hexagon, which is correct
  and would have been a page of code otherwise.
- *Retina and ProMotion.* Vector rendering is resolution-independent, so 2x
  displays are free and there is no bitmap to re-rasterise on a zoom.
- *SVG export.* Effectively free, and guaranteed to match the screen.
- *Cost: performance.* A DOM node per element is heavier than a draw call.
  Measured in Chromium, building and inserting a document of 750 elements
  takes about 55 ms, and 3,000 elements about 180 ms. That happens once per
  committed edit, not once per frame: pan and zoom are a single transform, and
  a drag moves the affected nodes and re-routes only the connectors that
  touch them.

**What would reverse it.** Editing feeling sluggish on Apple Silicon at the
recommended 2,000-object target. The first fix is not a rewrite: it is
incremental per-element DOM patching instead of rebuilding the scene, which
would confine the cost to the elements that actually changed.

### D-006: One scene builder for the screen and every export

**Context.** The brief calls out export fidelity as a risk: SVG and PDF must
match what is on screen (§15).

**Decision.** `src/canvas/scene.ts` turns a document into SVG, and it is the
only place that decides how anything is drawn. The screen renders its output.
The SVG exporter wraps it. The PNG, JPEG, and WebP exporters rasterise it. The
PDF exporter draws from the same geometry, routing, and text-layout functions
and reuses the same path data.

**Consequences.** An export cannot drift away from the screen, because there is
no second drawing path to drift. Adding a shape means writing its geometry
once. The cost is that the screen renderer builds strings rather than mutating
nodes, which is what makes D-005's numbers what they are.

**What would reverse it.** Nothing foreseeable. If the screen renderer ever
needs incremental patching, it would patch the output of this same builder
element by element rather than growing its own drawing code.

### D-017: No UI framework

**Context.** The interface is a toolbar, two panels, a few sheets, and a
canvas. The canvas — the part that has to be fast — is not built from
components at all.

**Decision.** Build the interface with plain DOM calls and a small `el()` /
`svg()` helper. No React, no Vue, no Svelte.

**Consequences.** The production bundle is about 67 kB gzipped, all of it
FlowShark's own code, which is straightforward to audit before signing.
There is no framework version to keep up with. The cost is that panels are
re-rendered by hand: the inspector rebuilds only when the *kind* of selection
changes and otherwise refreshes values in place through registered updaters,
so a field keeps focus and its insertion point while you type in it.

**What would reverse it.** The interface growing enough that manual updates
start producing bugs. The store already emits which slices changed, so a
framework could be adopted panel by panel.

### D-022: Keep the browser build working

**Context.** Tauri applications are usually developed with the native shell
running. That makes automated testing awkward and slows the edit-and-look
cycle.

**Decision.** Every platform capability goes through `src/platform/`, which has
a working browser implementation as well as a macOS one. In a browser,
FlowShark uses a file input in place of the Open panel, a download in place of
Save, and an in-app menu bar in place of the system one.

**Consequences.** `npm run smoke` can drive the whole application in headless
Chromium — adding shapes, editing text, connecting, undoing, exporting — and
CI catches interface regressions without a Mac in the loop. The browser path is
a genuine second implementation, so it has to be kept working.

**What would reverse it.** Nothing. The cost is small and the testing benefit
is large. It is also the boundary a Swift rewrite would cut along.

---

## The document model

### D-014: Undo by diffing snapshots

**Context.** The brief requires undo across every common edit and at least 100
steps (§8.15). The usual approach — each command supplying its own inverse — is
where undo bugs come from: a new command forgets one, and undo silently
corrupts the document.

**Decision.** Every edit runs in a transaction. The transaction deep-copies the
parts of the document the action is allowed to touch, lets the action mutate
the document freely, then diffs the two states and stores the difference as a
pair of patches. Undo applies one, redo applies the other. Commands that touch
a few elements declare a `scope`, which limits both the copy and the diff.

**Consequences.** A new command cannot break undo by omission — that is the
whole point. Selection is part of the entry, so undo restores what was
selected. Rapid nudges and slider drags merge into one step through a coalesce
key. The cost is a copy-and-compare per edit, which is imperceptible for a
scoped edit and a few milliseconds for a document-wide one.

**What would reverse it.** A document-wide operation on a very large diagram
feeling slow. The fix is to give it a scope, not to change the mechanism.

### D-015: Z-order is a position, not a field

**Context.** The brief lists a `zIndex` field on shapes and connectors (§8.16).

**Decision.** Keep a single `order` array on the document, bottom-most first.
Position in that array *is* the z-index. Elements do not carry a separate
number.

**Consequences.** Two elements cannot claim the same z-index, and reordering
cannot leave a stale field behind — a class of bug that simply does not exist.
Bring Forward and Send Backward are array operations. The saved file is
slightly smaller. The one cost is that "what is the z-index of this element"
is an array lookup rather than a field read, which no code path needs to do
often.

**What would reverse it.** Nothing. If an external format needs explicit
indices, they are derived at export time.

### D-023: Store colours as sRGB hex

**Context.** The brief asks for colours in a colour space that gives the same
result on wide-gamut displays (§8.5).

**Decision.** Store colours as `#rrggbb` sRGB, with opacity as a separate
0–1 number rather than an alpha channel. Exported SVG declares
`color-interpolation="sRGB"`; exported PDF uses DeviceRGB.

**Consequences.** A colour looks the same on a P3 display as on an sRGB one,
and the same in the app as in an export. Keeping opacity separate means a
colour can be reused at a different opacity without editing the value. Colours
outside sRGB cannot be expressed.

**What would reverse it.** A user need for Display P3 colours. The stored form
would become a tagged value, which is a document schema change (see
[VERSIONING.md](VERSIONING.md#4-document-schema-versions)).

### D-024: Two kinds of automatic saving

**Context.** The brief recommends both automatic saving and crash recovery
(§8.10) but they are not the same thing.

**Decision.** A document that has a file writes back to that file on the
automatic-save interval. A document that has never been saved keeps a private
recovery snapshot instead, which the next launch offers to restore. Successfully
saving clears the snapshot.

**Consequences.** Work is never silently written to a file the user did not
choose, and unsaved work still survives a crash. The cost is that recovery for
an untitled document depends on browser-local storage inside the app's
container, which is cleared if the user removes the app's support data.

**What this depends on.** Saving is asynchronous and the editor stays live
across it, so "has this been saved" is a question about a *revision*, not a
boolean. The store carries a counter that advances on every document change; a
write captures it alongside the serialised text and clears the dirty flag only
if the document has not moved since. Writes also run one at a time — automatic
saving and Command-S can otherwise meet, and the atomic write publishes a
temporary file whose name must then be unique per write. Without those three
things, an edit made while a save is in flight is marked saved and lost.

**What would reverse it.** Adopting `NSDocument`-style autosave-in-place and
Versions, which is a much larger piece of work and would probably arrive with a
Swift rewrite.

---

## Text

### D-007: Plain text, styled per element

**Context.** The brief warns that inline rich text in arbitrary shapes creates
unexpected problems and advises starting with plain text and basic formats
(§15).

**Decision.** A shape holds a plain string plus one text style. Bold, italic,
underline, font, size, colour, and alignment apply to the whole label. No
bullet or numbered lists.

Editing happens in a real `<textarea>` positioned over the shape rather than in
a custom text engine. That is what buys the whole macOS text stack for free:
input methods for Chinese, Japanese, and Korean; press-and-hold accents and
dead keys; the Emoji and Symbols picker; system spelling and grammar checking;
text substitutions; and the standard editing key bindings.

**Consequences.** Labels are simple to lay out, to measure, to export, and to
serialise. The line-breaking code is small enough to test properly. You cannot
put one word of a label in bold.

**What would reverse it.** Users asking for mixed formatting inside one label.
That means a run-based text model, a caret and selection model on top of it,
and matching work in all three exporters — a substantial piece of work, and the
reason it is not in 0.1.0.

### D-008: In-app font and colour controls

**Context.** The AppKit Font panel and Colors panel are native components. A
WebView cannot open them, and the brief asks for either in-app equivalents or a
plugin, with the decision recorded (§8.4).

**Decision.** Build in-app controls: a font list of ten families that ship with
macOS, a numeric size field, weight and style controls, the system colour input
(`<input type="color">`, which on macOS opens the real system colour picker),
and a palette of colours chosen to work in both appearances.

**Consequences.** No plugin, no extra Rust surface, and the controls sit in the
inspector next to everything else rather than in a floating panel. The cost is
that the font list is fixed rather than enumerating every installed font, and
there is no Typography sheet for ligatures or small caps.

**What would reverse it.** Users needing a font that is not on the list. The
next step would be a Tauri command that enumerates installed families, which is
much less work than bridging the whole Font panel.

---

## Connectors

### D-019: Floating anchors pick a declared connection point

**Context.** The brief asks for a floating connector that "attaches to the
nearest logical point" (§8.3). The obvious reading — intersect a line from
centre to centre with the shape outline — gives connectors that land at
arbitrary angles on a diamond or a cylinder and look untidy.

**Decision.** A floating anchor chooses, from the shape's own declared
connection points, the one closest to the other end of the connector, and
re-chooses whenever either shape moves.

**Consequences.** Routes stay tidy and orthogonal without an obstacle-avoidance
pass. The choice is deterministic, so a document looks identical every time it
is opened. The cost is that a connector cannot meet a shape at an arbitrary
point unless the user drags its end there, which pins it as a ratio anchor.

**What would reverse it.** A shape with too few connection points for a dense
diagram. The fix is to give that shape more points in the library, not to
change the rule.

### D-020: Simple orthogonal routing first

**Context.** The brief is explicit: dynamic routes get complex, so build a
simple and reliable version first and add automatic routing later (§15).

**Decision.** Elbow and step connectors leave each end along a short stub in
the direction of its edge, then join with a shared middle line. When both stubs
face the same way, the middle line goes past the further one instead of
splitting the difference, which is what stops routes doubling back.
Obstacle avoidance is opt-in per connector and only shifts that middle line to
a clear position.

**Consequences.** Routing is a few dozen lines, it is fast, and it is
predictable — the same inputs always give the same route. It will not find a
clever path through a crowded diagram; for that, users place bend points, and
placing one switches the connector to keeping the user's route.

**What would reverse it.** Diagrams dense enough that manual bend points become
tedious. That means a real routing pass — an A\* search over a visibility grid —
which is a self-contained addition behind the same interface.

---

## Export and system integration

### D-016: Write PDF directly, with a raster fallback

**Context.** The brief requires PDF export and warns that exports must match
the screen (§8.11, §15). The options were a third-party library, rasterising
into a PDF wrapper, or writing the PDF directly.

**Decision.** Write the PDF directly. `src/io/pdf-writer.ts` is a focused PDF
1.7 writer — objects, streams, a cross-reference table — and
`src/io/export-pdf.ts` turns the document into drawing operators using the same
geometry, routing, and text-layout functions the screen uses. Text uses the PDF
base-14 fonts with WinAnsi encoding, so it stays selectable and searchable.
Gradients become real axial shadings.

When vector output cannot be faithful — text outside the Western European
character set, or an embedded picture — FlowShark rasterises the diagram and
embeds it instead, and tells the user it has done so.

**Consequences.** No third-party code inside a signed bundle, and no
dependency to keep current. PDFs are small: a full template exports in about
6 kB. Text is real text. The costs are honest ones:

- *Font metrics.* Line positions are measured with the system font and drawn
  with Helvetica, Times, or Courier. Centred text can sit a point or two off
  where the screen put it. Left-aligned text is unaffected.
- *Shadows* are not reproduced in vector output.
- *The raster fallback* embeds a JPEG, so its text is not selectable.

**What would reverse it.** Users needing exact typography in PDF. That means
embedding a subset of the actual font, which needs a TrueType parser and a
subsetting pass — a well-understood but substantial addition to the same
writer.

### D-009: Build the macOS integrations directly against AppKit

**Context.** Several items in the brief need AppKit calls that Tauri does not
expose: writing `com.adobe.pdf` and `public.svg-image` to `NSPasteboard`
(§8.11), the system share sheet through `NSSharingServicePicker` (§8.11), and a
drag session that hands a real file to the Finder (§8.11).

**A wrong turn, recorded because it shaped the code.** The first version of
this decision deferred all of it, on the grounds that the code compiles only on
macOS and the automated development environment runs Linux, so it could not be
compiled even once. That reasoning was wrong: `cargo check` does not link, so
compiling for `aarch64-apple-darwin` from another platform needs only the
target's standard library, not the Apple SDK. The one obstacle —
`objc2-exception-helper` building a small Objective-C file in its build script
— has a documented `DOCS_RS` escape hatch, and skipping it is safe when
nothing is linked. What looked like a hard constraint was two commands.

**Decision.** Implement all three in `src-tauri/src/macos.rs`, using the same
`objc2` and `objc2-app-kit` crates Tauri's own macOS backend already depends
on, so they cost no extra compile time. Verify them with
`npm run check:macos`, which is also a CI job.

**What this gives:**

| Wanted | Implemented as |
|---|---|
| Multi-type pasteboard | One `NSPasteboardItem` carrying `com.adobe.pdf`, `public.png`, `public.svg-image`, and `public.utf8-plain-text`. Keynote and Pages take the vector PDF, a browser takes the SVG, Mail takes the PNG, and a text editor gets a readable outline of the diagram. |
| Share sheet | `NSSharingServicePicker`, anchored under the Share command, sharing a PNG of the diagram or the selection. |
| Drag out to the Finder | `beginDraggingSessionWithItems:event:source:` from the Export toolbar button, dragging a PDF with the file's own Finder icon. |

**Consequences and the care they needed.**

- *Threading.* AppKit is main-thread-only and Tauri commands are not. Every
  call goes through a helper that runs the work inline when it is already on
  the main thread and posts it to the event loop otherwise — never blocking the
  main thread waiting on itself.
- *Lifetime.* Neither `NSSharingServicePicker` nor a dragging source is
  retained by AppKit, and both outlive the call that creates them. Both are
  held in Tauri managed state until they are replaced.
- *Dragging is the fragile one.* macOS starts a drag session only while it is
  handling a mouse event. The file is therefore written on `pointerdown`, so it
  is ready by the time the pointer has moved far enough to begin the drag, and
  the Rust side falls back to synthesising a matching event when
  `NSApp.currentEvent` is not a mouse event. PDF rather than PNG is dragged
  because it exports in a few milliseconds rather than a hundred.
- *Verified, but not exercised.* The code type-checks against the real Apple
  frameworks. It has not been run on macOS. Compiling is not the same as
  working, and dragging out is the one most likely to need adjustment on
  hardware.

**Still deferred.** Quick Look preview and thumbnail extensions, and a
Spotlight importer, need separate Xcode app-extension targets inside the
bundle. Tauri does not create those, and the brief itself suggests treating
them as post-MVP.

**The lesson worth keeping.** "The build environment cannot do this" deserves
one experiment before it becomes a decision.

---

## Scope deliberately left out

### D-010: No SVG import yet

**Context.** SVG import is listed as recommended (§8.11), and the security
requirements are specific: sanitise imports, strip `<script>` elements, event
attributes, and external references (§13).

**Decision.** Do not import SVG in 0.1.0. Bitmap import — PNG, JPEG, WebP, GIF
— is implemented, by dropping, pasting, or choosing a file, with images
embedded so a document stays self-contained.

**Reasoning.** Importing SVG safely is not a parsing job, it is a sanitising
job: element and attribute allow-lists, `href` scheme checks, `use` reference
resolution, entity-expansion limits, and a decision about what to do with
features FlowShark cannot represent. Half of that is worse than none of it,
because a half-sanitised import is a security hole in an application that
otherwise never executes anything from a document.

**Where it is enforced.** In two places, which have to agree: the importer
(`IMPORTABLE_IMAGE_TYPES` in `src/io/import.ts`) and the document reader
(`IMAGE_MIME_TYPES` in `src/model/serialization.ts`). The importer alone is
not enough — a `.flowshark` file can be written by hand, so refusing SVG at
the file dialog while accepting it out of a document would leave exactly the
hole this decision refuses.

**What would reverse it.** Users needing to bring artwork in from Illustrator
or Figma. The work is a sanitising parser producing FlowShark shapes, with
tests built from a corpus of hostile SVG.

### D-012: Layers in the model, no layers panel

**Context.** The brief requires the four ordering commands and lists a layers
panel as recommended (§8.7).

**Decision.** The document model has layers — identity, name, visibility, lock
— and documents round-trip them. Every new element goes on the default layer,
and there is no panel to manage them. The ordering commands, plus per-element
lock and hide, are fully implemented.

**Consequences.** No feature had to be designed around a missing model, and a
future panel needs no format change. Users who expect a layers list will not
find one.

**What would reverse it.** Diagrams complex enough that per-element lock and
hide stop being enough.

### D-013: No updater yet

**Context.** The brief asks for Sparkle or the Tauri updater for builds
distributed outside the App Store (§8.17).

**Decision.** No updater in 0.1.0. Updating means downloading a newer DMG, and
[INSTALLATION.md](INSTALLATION.md#updating) says so.

**Reasoning.** An updater needs a signing key pair, a hosted update manifest,
and a place to serve builds from — infrastructure decisions that have not been
made. Shipping a half-configured updater risks the worst failure mode an
updater has: replacing a working application with something that will not
launch.

**What would reverse it.** The first release that people other than the team
install. `tauri-plugin-updater` is then the least work: add the plugin,
generate a key pair, publish `latest.json` alongside each release, and keep the
private key in the same secret store as the signing certificate.

### D-025: A fixed toolbar

**Context.** The brief asks for an `NSToolbar` equivalent that the user can
customise (§8.13).

**Decision.** Ship a fixed toolbar carrying the default item set the brief
lists — tools, undo and redo, align, distribute, group, ungroup, export,
print, and the two panel toggles — with no customisation sheet.

**Reasoning.** Customisation is only worth having once there are more items
than fit, and it needs a persisted per-user arrangement, a drag-and-drop
configuration sheet, and a migration path for when the default set changes.
The rule that matters more is already kept: everything in the toolbar is also
in the menu bar, so nothing is lost by the toolbar not showing it.

**What would reverse it.** The toolbar growing past what fits at a common
window width. Every item is already a registered command with an icon and a
title, so a customisation sheet would be presentation work rather than
plumbing.

---

## Other

### D-011: A colour-blind-safe default palette

**Context.** The brief recommends colour-blind-safe default palettes and
requires WCAG 2.1 AA contrast for interface controls (§8.14).

**Decision.** The six presets — Blue, Slate, Green, Amber, Rose, Outline — pair
a light fill with a much darker border and dark text rather than relying on hue
alone. The templates use them for meaning: green for start states, amber for
exception paths, rose for terminal states.

**Consequences.** A diagram stays readable in greyscale, printed, and under
deuteranopia and protanopia, because the fills differ in lightness as well as
hue. Nothing stops a user choosing an unreadable colour of their own; the
palette in the inspector is the safe path, not a fence.

**What would reverse it.** Nothing. If a diagram accessibility checker is added
later, this palette is what it would check against.

### D-018: Keep the name FlowShark

**Context.** The brief uses "FlowShark", derived from the `.flowshark`
extension, and asks for confirmation before shipping (§0.3).

**Decision.** Keep it. It is short, it is easy to say, and it is already the
file extension, the UTI, and the bundle identifier.

**On the name being taken.** A search found several companies already using
"FlowShark" — an SDN product, an email triage tool, a stock trading service,
and a wastewater management company among them. The name is therefore not
distinctive and would not be defensible.

That does not block this project. FlowShark is built for personal and
in-company use and is not distributed to the public, so there is no trade in
the name to infringe and nothing to defend. The question is closed on that
basis rather than on the name being free.

**What would reverse it.** A decision to release publicly or sell the app. At
that point the name needs a proper clearance search and, on the evidence above,
would very likely have to change — which also means changing the bundle
identifier and the UTI, with the consequences set out in D-003. Renaming is
cheap now and expensive after the first release, so that decision should be
made before it, not after.

### D-021: Generate the icons from a script

**Context.** The bundle needs PNGs at four sizes, an application `.icns` with
eight variants, and a document `.icns` for the `.flowshark` type.

**Decision.** `scripts/generate-icons.py` draws them and writes the PNG and
ICNS containers itself, with no image library. The icons are checked in so a
build does not depend on Python, and regenerating them is one command.

**Consequences.** The icon is reviewable as source, a change is a diff rather
than a binary blob, and every size is rendered from the same master rather than
scaled from a small original. The cost is a few hundred lines of drawing code
that a designer cannot open in a graphics application.

**What would reverse it.** A designer joining the project. Replace the script's
output with exported PNGs; nothing else changes.

### D-026: Move the window with `data-tauri-drag-region`, not CSS

**Context.** FlowShark uses `titleBarStyle: "Overlay"` with `hiddenTitle: true`
so the toolbar *is* the title bar (§8.2). Something then has to tell the window
that dragging that strip should move it. The first implementation used
`-webkit-app-region: drag` on the toolbar and `no-drag` on its children.

That was wrong, and shipped wrong. `-webkit-app-region` is a Chromium
extension. It carries a `-webkit-` prefix, so it reads like a Safari property,
but WebKit never implemented it — it exists because Electron needed it and
Chromium added it. WKWebView parses the declaration and discards it. The result
was a window with no system title bar and no drag region either: it could not
be moved by its top edge at all. The browser smoke test could not catch this,
because it runs in Chromium, where the property works.

**Decision.** Use Tauri's mechanism. The toolbar carries
`data-tauri-drag-region="deep"`, and `src-tauri/capabilities/default.json`
grants `core:window:allow-start-dragging`.

Tauri injects a document-level `mousedown` handler that walks the event's
composed path looking for that attribute and then invokes
`plugin:window|start_dragging`. `"deep"` means the whole subtree drags, which
matters because the strip is nearly all children — button groups, two spacers,
the document title. The walk stops at anything clickable (`<button>`, `<a>`,
form controls, anything with a `tabindex` or an interactive ARIA role), so the
toolbar's buttons keep working without being opted out one at a time. The same
handler maps a double-click to `internal_toggle_maximize`, which `core:default`
already grants, so zooming the window works too.

**Consequences.** Adding an interactive control to the toolbar cannot
accidentally break dragging, and adding a decorative one cannot accidentally
swallow it. The cost is that the rule now lives in an HTML attribute rather
than the stylesheet, which is a less obvious place to look — hence the comment
in `index.html` and the one left behind in `app.css` explaining why the CSS
property is not there.

`tests/titlebar.test.ts` ports the attribute walk from the pinned Tauri
version and asserts the outcomes that matter: the strip, its spacers and its
title drag the window; every toolbar button and every icon inside one does not;
the capability is granted; and no stylesheet declares `app-region` again. The
port is a copy, so a Tauri upgrade that changes those rules should update it —
that is the intended trigger to re-read the injected script.

**What would reverse it.** Restoring a real system title bar, which would make
the whole question moot. Short of that, nothing: this is Tauri's supported
mechanism.

**The general lesson.** This is the same failure as D-009 in a different
costume, and the second time in this project: a vendor-prefixed property, a
`window.print()` call, a `/opt` path — each looked right, none was tested
against the environment that would actually run it. The pattern is assuming
that because something is standard *somewhere*, it is standard *here*.
WKWebView is not Chromium, and a smoke test in Chromium is evidence about
Chromium. Where a feature depends on the shell, the check belongs against the
shell's own documentation or source — reading Tauri's `drag.js` is what
settled this one, and reading its permission tables is what showed
`allow-start-dragging` was missing from the default set.

---

## Milestone 0 gates

The brief sets two gates that must be run before the technology decision is
final (§14), and asks that the results be recorded.

### Gate 1 — Performance

Measured in headless Chromium, building a document and inserting it into the
DOM:

| Document | Build | Insert | Save | Open | File size |
|---|---|---|---|---|---|
| 750 elements (500 shapes, 250 connectors) | 24 ms | 31 ms | 4 ms | 8 ms | 0.8 MB |
| 3,000 elements (2,000 shapes, 1,000 connectors) | 65 ms | 115 ms | 14 ms | 17 ms | 3.3 MB |

That is a full rebuild, which happens once per committed edit. Pan and zoom
are a single transform and cost nothing; a drag transforms the affected nodes
and re-routes only the connectors attached to them; save and open are
comfortably within "fast" at both sizes.

**These numbers are not the gate.** They were taken in headless Chromium in the
automated build environment, not in WKWebView on Apple Silicon, and they measure
scene construction rather than sustained frame rate. **Gate 1 must be re-run on Apple Silicon
hardware, on battery as well as mains, before the technology decision is
closed** (§8.15). What to measure: sustained frames per second while dragging a
selection in a 2,000-object document at 100% and at 50% zoom; the same on a
ProMotion display; and idle CPU with a document open and untouched.

The numbers above are good enough to say the approach is not obviously wrong,
and to identify the first optimisation if it turns out to be: incremental
per-element DOM patching (D-005).

### Gate 2 — VoiceOver on the canvas

**What was built.** The canvas SVG is hidden from assistive technology, and a
parallel outline is maintained beside it and kept in step with the document.
Each entry names an element and the connections leaving it — "Process, Approve
invoice. Connects Yes to Decision, Over £10,000?; No to Terminator, Pay." —
which is the structure the brief asks for (§8.14). Tab and Shift-Tab step
through it, selecting each element and scrolling it into view. Every element
also carries a role, a label, and a `<title>` for exported SVG, and per-element
alt text can override the generated description.

**What was verified.** The smoke test confirms the outline exists, has an entry
per element, and describes connections. Every command is reachable from the
menu bar, and the shortcut reference is generated from the same registry, so
the "no mouse-only commands" rule is structural rather than a promise.

**What was not verified.** VoiceOver itself has not been run against this
build — that needs macOS. **Gate 2 must be completed with real VoiceOver on
Apple Silicon before the technology decision is closed.** What to check:
whether the outline is announced usefully in practice or merely present;
whether rotor navigation lands somewhere sensible; whether selection changes
are announced at the right moment; and whether the live region used for drag
feedback is too chatty during a drag.

---

## Still open

Decisions the brief asks to be closed (§0.3), and where each one stands:

| Question | Status |
|---|---|
| Intel support | Settled: Apple Silicon only (D-001) |
| Bundle identifier | Settled: `io.github.johnjanney.flowshark-mac` (D-003) |
| Distribution channel | Settled: Developer ID and DMG (D-004) |
| Product name | Settled: FlowShark, for personal and in-company use (D-018) |
| Gate 1, on Apple Silicon | **Open.** Must be run on real hardware |
| Gate 2, with VoiceOver | **Open.** Must be run on real hardware |
| Signing identity | **Open.** CI is wired for it, and the release workflow now refuses a release tag without the secrets; the certificate is not in place |
| The project brief itself | **Open.** Not in this repository — see below |

### The brief is not in the repository

This file, the README, and comments throughout the source cite numbered brief
sections — §8.14, §8.15, §13, §14 — but the brief itself is not tracked here
and is not in the commit history. Anyone reviewing this repository on its own
therefore cannot map an original requirement to the code that implements it,
the test that covers it, or the decision that defers it. Claims about covering
the MVP scope are not auditable from here.

Adding a reconstructed brief would be worse than having none: it would read as
the source of truth while actually being inferred from the implementation it is
supposed to check. The brief needs to be added from wherever it actually lives,
after which a traceability table — requirement, status, implementing files,
evidence, decision reference — can be built against it.

The gates and the brief are the questions this repository cannot answer for
itself: both gates need a Mac, and the brief needs whoever holds it. What to
measure is in [Milestone 0 gates](#milestone-0-gates) above.
