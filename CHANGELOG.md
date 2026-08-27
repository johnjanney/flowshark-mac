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

Nothing yet.

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

The first release. FlowShark is a complete single-user diagram editor: it
covers everything in the MVP scope of the project brief.

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
  accepts a drag onto the Dock icon.
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
- A signed, notarised, hardened-runtime bundle in a drag-to-install DMG, with
  the single `com.apple.security.cs.allow-jit` entitlement the WebView needs.

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
- Embedded images are restricted to formats the renderer can draw, and their
  payloads are checked before use.
- All user text is escaped where it is rendered, so a document cannot inject
  markup into the canvas or into an exported SVG.
- Documents are limited to 256 MB and imported images to 64 MB, so a malformed
  file cannot exhaust memory.

[Unreleased]: https://github.com/johnjanney/flowshark-mac/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/johnjanney/flowshark-mac/releases/tag/v0.1.0
