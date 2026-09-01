# Changelog

All notable changes to FlowShark are recorded here.

---

## How versions work

This section is the short version of the rules. The full contributor guide is
in **[VERSIONING.md](VERSIONING.md)**.

### The format of this file

This changelog follows **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)**.

- The newest release is at the top. **Unreleased** sits above it and collects
  work that has landed but not yet shipped.
- Every release heading carries its version and its date in `YYYY-MM-DD` form,
  and links to the comparison against the previous tag.
- Changes are grouped under **Added**, **Changed**, **Deprecated**,
  **Removed**, **Fixed**, and **Security**, in that order. Empty groups are
  left out.
- Entries describe what changed *for the person using FlowShark*, in plain
  language. "Connectors now stay attached when you resize a shape" belongs
  here; "refactored `routeConnector`" does not.
- Anything that changes behaviour a user can see gets an entry. Internal
  refactoring, test changes, and dependency bumps that change nothing visible
  do not.

### The version number

FlowShark uses **[Semantic Versioning 2.0.0](https://semver.org/)** —
`MAJOR.MINOR.PATCH`.

| Part | Increase it when |
|---|---|
| **MAJOR** | A change breaks something people relied on: a document that older versions can no longer open, a command that is gone, a shortcut that now does something else. |
| **MINOR** | A release adds a capability and everything that worked before still works. |
| **PATCH** | A release only fixes defects. |

While FlowShark is at `0.x`, `MINOR` carries the breaking changes — `0.x` is
the pre-release series, and the interface is not yet promised to be stable.
`1.0.0` marks the point where it is.

### Where the version lives

One number appears in four places, and they must always agree:

| File | Field |
|---|---|
| `package.json` | `version` — the source of truth |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src/model/defaults.ts` | `APP_VERSION` |

`npm run version:sync` copies the version from `package.json` into the other
three. `npm run version:check` fails if they disagree, and CI runs it on every
push, so a release cannot ship three different numbers.

In the built application the semantic version becomes
`CFBundleShortVersionString`, and `CFBundleVersion` takes a build number that
only ever increases.

### The document format has its own version

A `.flowshark` file carries an integer `schemaVersion` that is **independent of
the application version**. It changes only when the on-disk shape of a document
changes, and it goes up by one when it does.

- FlowShark migrates older documents forward when it opens them.
- FlowShark refuses a document written by a newer format, with a message that
  says so, rather than loading part of it.
- A schema change is recorded in this file under **Changed**, naming the old
  and new numbers.

### Releasing

1. Update this file: rename **Unreleased** to the new version with today's
   date, and start a fresh empty **Unreleased**.
2. Set the new version in `package.json` and run `npm run version:sync`.
3. Commit, then tag: `git tag -a v0.2.0 -m "FlowShark 0.2.0"`.
4. Push the tag. CI builds on a macOS runner, signs with the Developer ID
   certificate, notarises, staples the ticket, builds the DMG, and attaches it
   to a draft GitHub release.
5. Check the draft, paste in this file's section for the release, and publish.

---

## [Unreleased]

### Changed
- **Route around shapes now works on step and curved connectors**, not only on
  elbows. A curved connector only takes the long way round when the direct
  curve would cut through something, so ticking the box leaves a clear curve
  exactly as it was.
- **Automatic saving is quiet.** It no longer shows a "Saved" notice on every
  interval, and it no longer puts a modal question on screen when the file has
  changed underneath — with nobody there to answer it, that stopped the save
  and sat there. It now says so in a passing notice and leaves the document
  unsaved for the next explicit save to resolve. It also does no work at all
  when the document has not changed since the last snapshot.
- The recovery snapshot for an unsaved document is stored without being encoded
  twice, which roughly halves what has to fit in the browser storage quota.
  Snapshots written by the previous version are still recovered.
- **A release tag cannot produce an unsigned build.** The release workflow used
  to warn and finish successfully when the Developer ID secrets were missing.
  It now stops. Unsigned builds still come from the CI bundle job, which labels
  them as such.

### Fixed
- **A curved connector is curved again.** With no bend points on it the spline
  had only its two ends to work with, and drew the straight line between them —
  choosing **Curved** appeared to do nothing. A curve now leaves each shape
  square to the edge it is attached to and bends between them, so it looks like
  the curve in the sidebar before you place a single bend point.
- **A step connector stays at right angles.** Putting a bend point on one
  turned every leg into a diagonal, and the corner rounding was then applied to
  the diagonal joins. A step connector now steps between each pair of points,
  and it arrives at the far shape along that shape's edge instead of from
  whichever direction it happened to be travelling.
- **Route around shapes does something when the two shapes line up.** The
  option could only slide the middle of the route sideways, which is no help
  when both ends sit on the same line with the obstacle between them — the
  commonest way to have something in the way. The route now steps over or under
  the obstacle instead.
- **An exported PDF keeps a connector's curves and rounded corners.** To stop
  the line showing through an endpoint marker the exporter drew the bare
  polyline instead of the path, so a rounded elbow came out with square
  corners. Since a new connector has an arrowhead by default this affected
  almost every connector exported. It now shortens the real path.
- **An edit made while a save was running could be lost.** Saving serialises
  the document and then waits for the write; the editor stays usable for that
  whole time. When the write finished it cleared the "unsaved changes" flag
  without asking whether the document was still the one that had been written,
  so anything typed or drawn in between looked saved. Closing the window did
  not warn, automatic saving saw nothing to do, and the work went. Saving now
  records which version of the document reached disk and leaves the document
  marked unsaved when it has moved on since.
- **Two saves can no longer run at once.** Automatic saving runs on a timer and
  Command-S can be pressed at any moment. Both wrote through a temporary file
  named after the document, so two overlapping saves filled one file and then
  renamed the mixture over the document. Saves now run one at a time, and each
  temporary file has its own name.
- **A document replaced on disk is noticed however its timestamp looks.** The
  overwrite warning only appeared when the file's modification time was more
  than a second newer than the one FlowShark had read. A sync service resolving
  a conflict, a restore from a backup, or a filesystem with coarse timestamps
  produces an equal or older time, and none of those were caught. FlowShark now
  compares a fingerprint of the file — its length, its modification time, and
  the filesystem's own identity for it — and treats any difference as a
  conflict.
- **Opening or creating a document no longer leaves the previous one's
  timestamp behind**, which could have a save compare against the wrong file.
- The modification time written into a saved file is now the one the open
  document carries, rather than a moment that only ever existed on disk.
- **Saving is durable across power loss.** The temporary file's contents were
  flushed before the rename, but the rename that publishes them was not, so on
  most filesystems an ill-timed power cut could leave the previous version in
  place.
- Copying a shape that shows a picture and pasting it into another document or
  another window now brings the picture with it. The pasteboard carried the
  shape but not the image it referred to, so the paste arrived blank.
- Saving no longer keeps pictures nothing is showing any more. Deleting an
  image left its data in the file, so a document grew every time a picture was
  placed and removed and never shrank again. Undo still restores both the
  shape and its picture.
- A connector label with a border is drawn in the border's own colour in an
  exported PDF. It used to inherit the connector's line colour.
- Editing a document that contains photographs is responsive again. Every edit
  that was not restricted to a few elements copied and compared the whole of
  the embedded image data, so adding a shape to a document with pictures in it
  stalled for as long as the copy took.
- The window can be moved again. FlowShark hides the system title bar and uses
  the toolbar in its place, but the strip was marked draggable with
  `-webkit-app-region`, a Chromium property that WKWebView ignores — so the
  window had no drag region at all and could not be picked up by its top edge.
  The toolbar now carries `data-tauri-drag-region`, and the capability file
  grants `core:window:allow-start-dragging`, which the drag handler needs.
  Double-clicking the strip zooms the window, as it should. (D-026)
- Text boxes can be selected and edited. A text box is drawn with no fill and
  no border, and hit testing runs against the drawn geometry, so there was
  nothing under the pointer to click: the box could not be selected, dragged,
  or double-clicked to edit. Every shape now carries a transparent hit area
  the size of its outline, which also makes unfilled shapes and thin lines
  easier to grab. Placing a text box with the text tool no longer loses the
  keyboard focus the moment the field opens, so you can type straight away.

### Security
- **A malformed or hostile document can no longer exhaust memory or hang the
  application.** The 256 MB file cap bounded the file and nothing else: a
  document within it could still declare millions of elements, connectors with
  millions of waypoints, text fields megabytes long, or coordinates like 1e300,
  and each of those went on to become an object graph, SVG markup, a history
  snapshot, and a serialised copy. Documents are now held to explicit budgets
  and refused, with a message naming what was over, rather than opened and left
  to stall. Geometry and styling numbers are clamped to ranges a renderer can
  actually draw.
- **An embedded image has to be what it says it is.** Both importing a file and
  reading a document trusted the declared type — which came from a filename
  extension or from a string in the file. The first bytes are now checked
  against the signature for the format claimed, so a payload that is something
  else is refused before it reaches the renderer, a canvas, or an export.
- Writes through the application's file commands are size-capped, and the
  now-unused modification-time command has been removed from the interface the
  web layer can reach.
- A document can no longer smuggle markup into the canvas or into an export.
  Element identifiers and connector colours read out of a `.flowshark` file
  were written straight into the generated SVG — into a gradient's `id`, into
  the `fill="url(…)"` that points at it, into a clip path, and into an
  arrowhead definition. A file crafted with a quotation mark in the right
  place could close the attribute it was sitting in and add an attribute of
  its own, which meant an event handler on a drawn element. The application's
  content security policy stopped that handler from running inside FlowShark,
  but an exported `.svg` carries no such policy, so a diagram sent to someone
  else could have run script when they opened it in a browser. Generated
  definitions are now named by the scene rather than by the document, and
  every value that comes from a document is escaped on the way into markup.
- A document can no longer embed an SVG image. The reader accepted
  `image/svg+xml` even though FlowShark does not import SVG and has no
  sanitiser for it, so a hand-written file could carry arbitrary SVG through
  to the renderer and into every export. The accepted formats are now the same
  bitmap formats the importer takes: PNG, JPEG, WebP, and GIF. (D-010)

### Known gaps

These are known and deliberate, not defects. Each is explained in
[DECISIONS.md](DECISIONS.md).

- No Quick Look preview or thumbnail extension for `.flowshark` files, and no
  Spotlight importer. These need separate Xcode app-extension targets inside
  the bundle, which Tauri does not create (D-009).
- No SVG import (D-010).
- Layers exist in the document model, and documents round-trip them, but there
  is no layers panel and every new element goes on one layer (D-012).
- Text is styled per element rather than per character, and there are no bullet
  or numbered lists (D-007).
- The toolbar has a fixed set of items and cannot be customised the way an
  `NSToolbar` can (D-025).
- No minimap or page overview.
- No built-in update mechanism (D-013).
- Right-to-left text is not specifically handled.

---

## [0.1.0] — 2026-08-27

The first release. FlowShark is a complete single-user diagram editor covering
the MVP feature set described in this repository's documentation.

> The project brief those features were drawn from is **not in this
> repository**, so "covers the MVP scope" cannot be checked against the source
> requirements from here. The two Milestone 0 acceptance gates in
> [DECISIONS.md](DECISIONS.md#milestone-0-gates) — performance on Apple
> Silicon and VoiceOver in practice — are also still open, and both need a Mac.

### Added

**Drawing**

- An unbounded canvas with an optional grid, rulers, and page boundaries.
- A shape library of 42 shapes: all 27 standard flowchart shapes — process,
  decision, terminator, input/output, document, multiple documents, manual
  input, manual operation, preparation, predefined process, database, internal
  storage, direct access storage, sequential access storage, display, delay,
  connector, off-page connector, merge, extract, sort, collate, stored data,
  annotation, callout, swimlane, and phase — plus rectangle, rounded
  rectangle, ellipse, circle, triangle, diamond, hexagon, cylinder, cloud,
  star, line, arrow, text box, image, and icon.
- Shape search across names and meanings, so "diamond" finds Decision.
- Recently used shapes at the top of the sidebar.
- Place a shape by dragging it, by clicking, or by double-clicking it in the
  sidebar.

**Connectors**

- Straight, elbow, curved, step, and freeform routes.
- Connectors attach to fixed connection points or float, re-picking the point
  that faces the other end whenever a shape moves.
- Automatic re-routing when connected shapes move, with optional routing
  around other shapes.
- Bend points you can add, move, and clear.
- Eleven endpoint styles at each end: none, standard arrow, open arrow, filled
  arrow, diamond, filled diamond, circle, filled circle, square, filled
  square, and bar.
- Any number of labels per connector, positioned along the line, offset from
  it, and optionally backed by a solid fill.
- Deleting a connector leaves its shapes alone; deleting a shape leaves its
  connectors with a loose end.

**Text**

- Inline editing in a real macOS text field, so input methods, press-and-hold
  accents, the Emoji and Symbols picker, system spelling and grammar checking,
  text substitutions, and the standard editing key bindings all work.
- Font family, size, weight, italic, underline, colour, horizontal and
  vertical alignment, line spacing, wrapping, and padding.
- Auto-size, which grows a shape to fit its text.
- Standalone text boxes.

**Style**

- Fill colour and opacity, two-colour gradients, and drop shadows.
- Border colour, thickness, style, corner radius, and element opacity.
- Six style presets, plus Reset to default style.
- Copy Style and Paste Style between shapes and connectors.
- A default palette that stays legible in light and dark appearance and under
  the common forms of colour vision deficiency.

**Layout**

- Snap to grid with an adjustable spacing.
- Snap to the edges, centres, and connection points of other elements, with
  alignment guides.
- Equal-spacing detection: drag a third element near two that are evenly
  spaced and it snaps to repeat the gap.
- Align by left, centre, right, top, middle, and bottom.
- Distribute by equal gaps or by equal centre-to-centre spacing.
- Make same width, height, or size.
- Group and ungroup, including nested groups.
- Bring Forward, Bring to Front, Send Backward, Send to Back.
- Lock, unlock, hide, and show.

**Editing**

- Undo and redo covering every change, including styling and reordering, 200
  steps deep. Rapid nudges and repeated slider drags merge into one step.
- Cut, copy, paste, Paste and Match Style, duplicate, and delete.
- Copy and paste elements between FlowShark windows, with connectors between
  copied shapes preserved.
- Marquee selection, Shift-click, Select All, Deselect All, and Select
  Connected Elements.
- Find text in shapes and connector labels.

**Files**

- The `.flowshark` document format: JSON with an integer `schemaVersion`,
  forward migration for older documents, and a clear message when a document
  comes from a newer version.
- Atomic saves, so a failed save never damages the file already on disk.
- A warning before overwriting a file that changed on disk since it was
  opened.
- Automatic saving, and recovery of an unsaved document after an unexpected
  quit.
- Open Recent.
- Document type registration, so the Finder shows a FlowShark document icon,
  opens documents on a double-click, offers FlowShark under Open With, and
  accepts a drag onto the Dock icon. The document icon is bundled as a resource
  so it is actually present: only the application icon is copied from the icon
  list, and a document icon referenced but not bundled leaves the Finder
  showing a blank page.
- Import PNG, JPEG, WebP, and GIF images by dropping, pasting, or choosing
  them. Images are embedded so a document stays self-contained.
- Dropping a `.flowshark` file onto a window opens it.

**Export**

- PNG, JPEG, WebP, SVG, and PDF.
- Vector PDF with selectable, searchable text, written directly rather than
  through a third-party library. Diagrams that vector output cannot reproduce
  faithfully — an embedded picture, or text outside the Western European
  character set — fall back to a picture-based PDF, and FlowShark says when it
  has done so.
- Export the whole diagram, the selection, or the page area, with a margin,
  transparency, an optional grid, and 1x, 2x, or 3x resolution.
- Self-contained SVG with no scripts and no external references.
- Printing through the standard macOS Print panel, which offers Save as PDF.
  The panel is opened through the webview's own print method rather than
  JavaScript's `window.print()`, which WKWebView leaves to the host
  application and would otherwise do nothing.
- Copy as Image (`⇧⌘C`), which writes one pasteboard item carrying
  `com.adobe.pdf`, `public.png`, `public.svg-image`, and
  `public.utf8-plain-text`, so Keynote and Pages take the vector PDF, a browser
  takes the SVG, Mail takes the PNG, and a text editor gets a readable outline
  of the diagram.
- Share, through the system share sheet.
- Dragging the diagram out of the window into the Finder, Mail, or Keynote by
  dragging from the Export button in the toolbar.
- Exports are drawn from the same geometry as the screen, so what you see is
  what you get.

**Templates**

- Ten starter diagrams — Basic Flowchart, Decision Tree, Process Map,
  Cross-functional Flowchart, Software Logic Flow, Customer Journey Flow,
  Approval Workflow, Incident Response Workflow, Sales Funnel Workflow, and
  Project Workflow — plus Blank, each shown as a live preview in the chooser.

**macOS integration**

- A complete menu bar: FlowShark, File, Edit, Insert, Format, Arrange, View,
  Window, and Help, using the system's own items for Quit, Hide, Services,
  Full Screen, and window management.
- Apple-standard keyboard shortcuts throughout, and a shortcut reference in
  Help.
- Standard Open and Save panels, and the system share sheet.
- Light and dark appearance, following the system and switching live, with a
  manual override in Settings.
- Support for Increase Contrast, Reduce Motion, and system text size. The
  interface is opaque, so Reduce Transparency has nothing to strip.
- Trackpad gestures: two-finger scroll to pan, pinch to zoom.
- More than one document window, native window tabs through the Window menu,
  Full Screen, Stage Manager, and Spaces.
- Context menus on Control-click and right-click.
- A hardened-runtime bundle in a drag-to-install DMG, with the single
  `com.apple.security.cs.allow-jit` entitlement the WebView needs. The release
  workflow signs it with a Developer ID and notarises it, and now refuses to
  build a release tag at all without those secrets — but the signing identity
  itself is still listed as open in
  [DECISIONS.md](DECISIONS.md#still-open), so no signed build has been produced
  yet. Builds from the CI bundle job are unsigned and say so.

**Accessibility**

- A VoiceOver-readable description of the diagram that stays in step with the
  canvas, naming each element and what it connects to.
- Tab and Shift-Tab step through elements, selecting each one and scrolling it
  into view.
- Every command has a menu item; nothing is mouse-only.
- Visible focus rings throughout.
- Per-element alt text, used by VoiceOver and written into exported SVG.

**Settings**

- Appearance, motion, the default connector type, automatic saving and its
  interval, and whether the template chooser opens at launch.
- No analytics, no account, and nothing sent off the Mac.

### Security

- A strict Content Security Policy with no remote origins, no `eval`, and no
  inline scripts.
- The front end is given the smallest workable set of application
  capabilities.
- Imported documents are validated field by field and normalised against the
  current defaults; nothing in a document is ever executed.
- Embedded images are restricted to the bitmap formats the renderer can draw,
  and each payload is checked against the file signature for the type it
  claims to be.
- All user text is escaped where it is rendered, so a document cannot inject
  markup into the canvas or into an exported SVG.
- Documents are limited to 256 MB and imported images to 64 MB on the way in.
  A file within those caps is then held to explicit budgets — element, layer,
  preset, waypoint, label, and image counts, text length, decoded image bytes,
  and image pixels — and geometry and styling numbers are clamped to ranges a
  renderer can draw. A document over budget is refused with a message naming
  what was over, rather than being opened and left to stall.

[Unreleased]: https://github.com/johnjanney/flowshark-mac/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/johnjanney/flowshark-mac/releases/tag/v0.1.0
