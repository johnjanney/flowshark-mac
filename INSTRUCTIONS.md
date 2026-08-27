# Using FlowShark

A guide to everything FlowShark does, from the first shape to a finished
export.

**Contents**

1. [The window](#1-the-window)
2. [Your first flowchart in two minutes](#2-your-first-flowchart-in-two-minutes)
3. [Working with shapes](#3-working-with-shapes)
4. [Text](#4-text)
5. [Connectors](#5-connectors)
6. [Styling](#6-styling)
7. [Precise layout](#7-precise-layout)
8. [Organising a diagram](#8-organising-a-diagram)
9. [Moving around the canvas](#9-moving-around-the-canvas)
10. [Templates](#10-templates)
11. [Files](#11-files)
12. [Exporting, printing, and sharing](#12-exporting-printing-and-sharing)
13. [Settings](#13-settings)
14. [Accessibility](#14-accessibility)
15. [Keyboard shortcuts](#15-keyboard-shortcuts)
16. [If something goes wrong](#16-if-something-goes-wrong)

---

## 1. The window

| Area | What it is for |
|---|---|
| **Toolbar** | Tools on the left, undo and redo, the document name in the middle, alignment and export on the right. |
| **Shape library** (left) | Every shape, grouped by category, with a search field. Hide it with `⌥⌘S`. |
| **Canvas** (middle) | Where the diagram lives. It extends in every direction; there is no edge to run into. |
| **Inspector** (right) | Settings for whatever is selected. With nothing selected it shows document and canvas settings. Hide it with `⌥⌘I`. |
| **Status bar** (bottom) | The current file, what is selected, and the grid setting. |
| **Zoom controls** (bottom right) | Zoom out, the current percentage, zoom in, and zoom to fit. |

Every command in the toolbar and the inspector is also in the menu bar, so you
never have to reach for the mouse to do something.

FlowShark has no separate title bar: the toolbar is the title bar. Drag any
empty part of that strip — beside the traffic lights, either side of the
document name, or the name itself — to move the window. Double-click the same
area to zoom the window, as you would any other Mac app.

### The four tools

Switch tools from the toolbar or with `⌘1` to `⌘4`.

| Tool | Shortcut | What it does |
|---|---|---|
| **Select** | `⌘1` | Select, move, resize, and rotate. The tool you spend most time in. |
| **Shape** | `⌘2` | Click the canvas to place the shape currently highlighted in the sidebar. |
| **Connector** | `⌘3` | Drag from one shape to another to connect them. |
| **Text** | `⌘4` | Click the canvas to place a text box and start typing. |

After you place a shape, a connector, or a text box, FlowShark returns to the
Select tool so you can keep working. Press `Escape` at any time to go back to
Select.

---

## 2. Your first flowchart in two minutes

1. **Start a diagram.** FlowShark opens with a starter flowchart. To begin
   from nothing, press `⌘N`. To begin from a template, press `⇧⌘N`.
2. **Add a shape.** Drag **Start / End** from the sidebar onto the canvas.
3. **Name it.** Double-click it and type `Start`, then press `Escape`.
4. **Add a second shape.** Drag **Process** onto the canvas below the first
   one. Guide lines appear as you drag so you can line it up.
5. **Connect them.** Press `⌘3`, then drag from the bottom of the first shape
   to the top of the second. Small dots show where a connector can attach.
6. **Label the connector.** Select it, then in the inspector open **Labels**
   and click **Add label**. Type `Yes`.
7. **Tidy up.** Select both shapes (drag a box around them, or `⌘A`) and click
   **Align Centre** in the toolbar.
8. **Save it.** Press `⌘S`, choose a name and place, and click **Save**.
9. **Share it.** Press `⇧⌘E`, choose **PNG image**, and click **Export…**.

---

## 3. Working with shapes

### Finding a shape

The sidebar groups shapes into **Flowchart**, **General**, **Containers**, and
**Annotation**. Click a heading to open or close a group. Shapes you have used
recently appear at the top.

Search matches names *and* meanings: typing `diamond` finds **Decision**,
`data store` finds **Database**, and `note` finds **Annotation**.

### Placing a shape

There are three ways, and they all end up in the same place:

- **Drag** the shape from the sidebar onto the canvas.
- **Click** the shape in the sidebar, then click where you want it. The shape
  is centred on your click.
- **Double-click** the shape in the sidebar to drop it in the middle of the
  view.

The Insert menu also has the four shapes you reach for most — Process,
Decision, Start/End, and Input/Output.

### Selecting

| To do this | Do this |
|---|---|
| Select one thing | Click it |
| Add to or remove from the selection | `⇧`-click |
| Select several at once | Drag a box across empty canvas |
| Select everything | `⌘A` |
| Select nothing | `⇧⌘A`, or `Escape`, or click empty canvas |
| Step through elements one at a time | `Tab`, or `⇧Tab` to go back |
| Select a shape and everything it connects to | **Edit > Select Connected Elements** |

A selection box only picks up elements it *completely* encloses, so you can
start a box inside a crowded area without dragging half the diagram with you.

### Moving, resizing, rotating

- **Move:** drag it, or nudge with the arrow keys (`⇧` and an arrow moves 10
  points at a time).
- **Resize:** drag one of the eight handles.
  - Hold `⇧` to keep the proportions.
  - Hold `⌥` to resize around the centre.
- **Rotate:** drag the round handle above the shape. Hold `⇧` to snap to 15°
  steps. The inspector also has a **Rotation** field for exact angles.
- **Duplicate while dragging:** hold `⌥` as you start the drag.
- **Constrain to one axis:** hold `⇧` while dragging.
- **Duplicate in place:** `⌘D`.
- **Delete:** `Delete`.

The inspector's **Position and Size** section takes exact numbers for X, Y,
width, height, and rotation.

### Auto-size

Switch on **Auto-size to text** in the inspector and a shape grows taller as
you type so the text always fits.

---

## 4. Text

### Text in a shape

Double-click a shape and type. Press `Escape` or click elsewhere to finish.
With a shape selected, `Return` starts editing without reaching for the mouse.

You are typing in a real macOS text field, so everything you expect works:

- Input methods for Chinese, Japanese, Korean, and other languages
- Press-and-hold for accents, and dead keys
- The Emoji and Symbols picker (`⌃⌘Space`)
- System spelling and grammar checking, with the usual Control-click
  corrections
- Text substitutions, if you have them switched on in System Settings
- All the standard text editing key bindings

Press `Return` for a new line inside a shape. Press `⌘Return`, `Escape`, or
`Tab` to finish editing.

### Styling text

Select one or more elements and use the inspector's **Text** section: font,
size, weight, italic, underline, colour, horizontal and vertical alignment,
line spacing, wrapping, and the padding between the text and the shape edge.

The Format menu has the common ones: `⌘B` for bold, `⌘I` for italic, `⌘U` for
underline, and `⇧⌘+` / `⇧⌘-` to step the size.

> Styling applies to the whole element. A single shape cannot mix two fonts or
> two colours in one label.

### Text boxes

Press `⌘4` and click the canvas for a standalone text box — useful for titles
and notes. It has no fill or border by default; add either from the inspector.

Pasting plain text onto the canvas creates a text box containing it.

---

## 5. Connectors

### Drawing one

1. Press `⌘3`, or click a connector style in the sidebar.
2. Move the pointer over a shape. Its connection points appear as small dots.
3. Drag from a connection point to the other shape and release.

Dropping on the second shape's own connection point pins the connector there.
Dropping anywhere else on the shape leaves the connector **floating**: it picks
whichever point faces the other end and re-picks it whenever either shape
moves, which keeps routes tidy without any work from you.

Releasing over empty canvas leaves that end loose, which is handy for a
connector that leads off the page.

### Connector shapes

Choose in the sidebar before you draw, or in the inspector afterwards.

| Type | Looks like |
|---|---|
| **Straight** | A direct line |
| **Elbow** | Right-angled, with optionally rounded corners. The default |
| **Curved** | A smooth spline through the ends and any bend points |
| **Step** | A single right-angled step |
| **Freeform** | A plain line through every bend point you place |

### Ends and lines

The inspector's **Connector** section sets the line colour, thickness, and
style (solid, dashed, dotted), the opacity, and the corner rounding on elbow
routes.

**Start** and **End** each offer eleven terminators: none, standard arrow,
open arrow, filled arrow, diamond, filled diamond, circle, filled circle,
square, filled square, and bar. A connector with an arrow at each end shows a
two-way relationship; a connector with none at either end is a plain
association.

### Bend points

Select a connector and drag any of the round handles along it. To add one,
Control-click the connector and choose **Add Bend Point**; to go back to the
automatic route, choose **Clear Bend Points**.

Once you move a bend point FlowShark stops re-routing that connector
automatically, so your shape survives later edits. The inspector's **Keep my
bend points** switch controls this directly.

**Route around shapes** makes an elbow connector try to step around anything
in the way. It works well for isolated obstacles; a dense diagram may still
need a bend point or two placed by hand.

### Labels

Select a connector and open the inspector's **Labels** section, or
Control-click and choose **Label on Connector**. A connector can carry several
labels.

For each one you can set:

- The text — double-click a label on the canvas to edit it in place
- **Along**: where it sits, from the source end to the target end
- **Offset**: how far it sits from the line
- **Background**: a solid backing so the text stays readable over a busy area

Labels move with the connector and stay in place when it reroutes.

### What happens when you delete

Deleting a connector leaves its shapes alone. Deleting a shape leaves its
connectors in place with the affected end loose, so you can reattach them
rather than redraw them.

---

## 6. Styling

### Fill and border

The inspector's **Fill** section sets the colour, its opacity, an optional
two-colour gradient, and a drop shadow. Click **No fill** for an outline-only
shape. The palette underneath is a quick way to pick a colour that works in
both light and dark appearance.

**Border** sets the colour, thickness, style, corner radius, and the opacity
of the element as a whole.

Colours are stored as sRGB, so a diagram looks the same on a wide-gamut
display as it does in an exported file.

### Presets

**Style Presets** in the inspector holds six schemes — Blue, Slate, Green,
Amber, Rose, and Outline. Click one to apply it to everything selected.
**Reset to default style** puts a shape back to how it was created.

### Copying a style

1. Select the element whose look you want.
2. Press `⌥⌘C` (**Edit > Copy Style**).
3. Select the elements to change.
4. Press `⌥⌘V` (**Edit > Paste Style**).

This copies fill, border, and text style, and works between shapes and
connectors.

---

## 7. Precise layout

### The grid

The grid is on by default at 10 points. **View > Show Grid** hides it, and
**Snap to Grid** controls whether things land on it. Change the spacing in the
inspector with nothing selected.

### Snapping to other elements

With **Snap to Elements** on, dragging a shape snaps it to the edges and
centres of its neighbours, and pink guide lines show what it lined up with.

FlowShark also spots **equal spacing**: drag a third shape near two that are
already evenly spaced and it snaps to repeat that gap, with a dashed guide
showing the measurement.

**Snap range** in the inspector sets how close is close enough. The distance
is measured on screen, so it feels the same at every zoom level.

### Aligning

Select two or more elements and use the toolbar, the inspector's **Arrange**
section, or the **Arrange > Align** menu:

- Left, horizontal centres, right
- Top, vertical centres, bottom

Everything aligns to the outer bounds of the whole selection.

### Distributing

Select three or more elements, then **Arrange > Distribute**:

- **Horizontally** / **Vertically** — equal *gaps* between elements, whatever
  their sizes
- **Centres Horizontally** / **Centres Vertically** — equal centre-to-centre
  spacing

The outermost two stay put; the rest move between them.

### Matching sizes

**Arrange > Size** makes everything selected the same width, the same height,
or both. The **last** element you selected is the one everything else matches.

### Rulers and page boundaries

**View > Show Rulers** adds rulers along the top and left, with the selection
shaded on both so you can read off its position and size.

**View > Show Page Boundaries** outlines a printable page. Set portrait or
landscape in the inspector with nothing selected.

---

## 8. Organising a diagram

### Grouping

Select several elements and press `⌥⌘G`. The group moves as one. `⌥⇧⌘G`
takes it apart again. Groups can contain groups.

### Stacking order

New elements go on top. To change that:

| Command | Shortcut |
|---|---|
| Bring Forward | `⌥⌘F` |
| Bring to Front | `⌥⇧⌘F` |
| Send Backward | `⌥⌘B` |
| Send to Back | `⌥⇧⌘B` |

Containers such as **Swimlane** and **Phase** are sent to the back
automatically when you place them, so the shapes inside stay clickable.

### Locking and hiding

`⌘L` locks the selection so it cannot be moved, resized, or edited; a small
padlock appears at its corner. `⌥⌘L` unlocks it. Lock a swimlane background
and you can work inside it without nudging it by accident.

**Arrange > Hide** takes elements out of view without deleting them;
**Show Hidden Elements** brings them all back.

### Finding something

`⌘F` searches the text in shapes and on connector labels. Click a result to
select it and zoom to it.

---

## 9. Moving around the canvas

| Action | How |
|---|---|
| Pan | Two-finger scroll on a trackpad, or hold `Space` and drag |
| Zoom | Pinch on a trackpad, or hold `⌘` and scroll |
| Zoom in / out | `⌘+` / `⌘-` |
| Actual size | `⌘0` |
| Fit the whole diagram | `⇧⌘0` |
| Fit the selection | `⌥⌘0` |
| Type an exact zoom | Click the percentage at the bottom right and type one |
| Full Screen | `⌃⌘F` |

FlowShark opens documents zoomed to fit, so you always start seeing the whole
diagram.

---

## 10. Templates

Press `⇧⌘N` for the template chooser. Each template shows a live preview drawn
by FlowShark itself.

| Template | Good for |
|---|---|
| **Blank** | Starting from nothing |
| **Basic Flowchart** | Any simple process |
| **Decision Tree** | A choice and its consequences |
| **Process Map** | A business process end to end |
| **Cross-functional Flowchart** | Showing who does what, in swimlanes |
| **Software Logic Flow** | Request handling, with validation and errors |
| **Customer Journey Flow** | Stages and touch points |
| **Approval Workflow** | Sign-offs and rejection paths |
| **Incident Response Workflow** | An on-call runbook |
| **Sales Funnel Workflow** | Conversion and drop-off |
| **Project Workflow** | Phases with gates between them |

A template opens as an ordinary untitled document. Change anything in it.

---

## 11. Files

### The format

FlowShark saves `.flowshark` files. They are plain JSON with a version number,
so they are easy to keep in version control and to read years later. Images
you place are embedded in the file, which means a `.flowshark` document is
always self-contained.

### Commands

| Command | Shortcut |
|---|---|
| New | `⌘N` |
| New from Template | `⇧⌘N` |
| Open | `⌘O` |
| Open Recent | **File > Open Recent** |
| Save | `⌘S` |
| Save As | `⇧⌘S` |
| Revert to Saved | **File > Revert to Saved** |
| Close Window | `⌘W` |

You can also open a document by double-clicking it in the Finder, dragging it
onto the FlowShark icon in the Dock, or dropping it onto an open FlowShark
window.

### Saving safely

Saves are **atomic**: FlowShark writes to a temporary file beside yours and
then renames it into place. If a save fails part-way through — the disk fills
up, the app is force-quit — the version already on disk is untouched.

If the file changed on disk since you opened it, which happens with iCloud
Drive, Dropbox, and shared volumes, FlowShark asks before overwriting.

### Automatic saving and recovery

Automatic saving is on by default and runs every 30 seconds.

- A document that has been saved once is written back to its own file.
- A document that has never been saved is kept as a private recovery snapshot.
  If FlowShark quits unexpectedly, the next launch offers to restore it.

Both behaviours can be changed in Settings.

### Images

Place an image with **Insert > Image…**, by dragging a PNG, JPEG, WebP, or GIF
onto the canvas, or by pasting one. It arrives as a shape you can move, resize,
and put a border on. Very large images are scaled to fit on the canvas; the
full-resolution original is kept in the file.

---

## 12. Exporting, printing, and sharing

### Exporting

Press `⇧⌘E` for the export sheet.

**Format**

| Format | Use it for |
|---|---|
| **PNG** | Slides, documents, chat. Supports transparency |
| **SVG** | Websites, and anywhere the diagram must scale |
| **PDF** | Print, and documents where the text should stay selectable |
| **JPEG** | Where a small file matters more than sharp edges |
| **WebP** | Websites that prefer it |

**Include** — the whole diagram, just what is selected, or the page area.

**Resolution** — 1x, 2x (matching a Retina display), or 3x, for the image
formats.

**Margin**, **Transparent background**, **Include the grid**, and
**Background colour** do what they say.

**File > Export as PNG / SVG / PDF** skips the sheet and uses sensible
defaults, exporting the selection if there is one.

Exports are drawn from the same geometry as the screen, so an exported file
matches what you were looking at. FlowShark reveals the finished file in the
Finder.

**About PDF.** FlowShark writes real vector PDF with selectable, searchable
text. If a diagram contains an embedded picture, or text outside the Western
European character set — Chinese, Japanese, Korean, Cyrillic, Greek — the
vector path cannot reproduce it faithfully, so FlowShark exports a
picture-based PDF instead and tells you it has done so.

### Printing

`⌘P` opens the standard macOS Print panel, with **PDF > Save as PDF** in the
bottom-left corner. Only the diagram is printed, not the FlowShark interface.

### Copying to other applications

**File > Copy as Image** (`⇧⌘C`) copies the diagram, or the selection, in four
forms at once. Each application then takes the one it handles best:

| You paste into | You get |
|---|---|
| Keynote, Pages, Numbers | Vector PDF, which stays sharp at any size |
| Mail, Messages, Notes | A PNG image |
| A browser or design tool | SVG |
| A text editor | A written outline of the diagram |

`⌘C` is different: it copies FlowShark *elements*, so you can paste them into
another FlowShark window and keep editing them.

### Sharing

**File > Share…** opens the system share sheet with a picture of the diagram —
AirDrop, Mail, Messages, Notes, and anything else you have installed.

### Dragging a diagram out

Press and hold the **Export** button in the toolbar, then drag. A PDF of the
diagram follows the pointer, and you can drop it into a Finder window, onto the
Desktop, into a Mail message, or straight onto a Keynote slide. Clicking the
button as usual still opens the export sheet.

If something is selected, only the selection is dragged out.

---

## 13. Settings

`⌘,` opens Settings.

| Setting | What it does |
|---|---|
| **Appearance** | Match the system, or force light or dark |
| **Motion** | Match the system, or always reduce motion |
| **Connector** | The connector type new connectors use |
| **Save automatically while I work** | Turns automatic saving on or off |
| **Every (seconds)** | How often it runs |
| **Show the template chooser at launch** | Whether the chooser opens on start-up |

FlowShark collects no analytics, has no account, and sends nothing off your
Mac.

---

## 14. Accessibility

### VoiceOver

A drawing canvas has no structure a screen reader can read, so FlowShark keeps
a parallel description of the diagram in step with it. VoiceOver reads entries
such as:

> Process, Approve invoice. Connects Yes to Decision, Over £10,000?; No to
> Terminator, Pay.

Press `Tab` to step through the diagram. Each step selects the element, scrolls
it into view, and reads its description together with everything it connects
to.

### Keyboard only

Every command in FlowShark has a menu item, and everything you can do with the
mouse you can do from the keyboard. Turn on **Full Keyboard Access** in System
Settings > Keyboard to move between the sidebar, the canvas, and the
inspector with `Tab`. Focus is always shown with a visible ring.

### System settings FlowShark follows

- **Dark and light appearance**, including switching while the app is running
- **Increase Contrast** — stronger borders and text
- **Reduce Motion** — no animations or transitions
- **Reduce Transparency** — FlowShark's interface is opaque already, so there
  is nothing to strip away
- **Text size** — the interface uses relative sizes and follows the system
  setting

### Colours

The default palette is chosen so shapes stay distinguishable under the common
forms of colour vision deficiency, and so text meets WCAG 2.1 AA contrast
against its fill. If you change colours yourself, check that the result still
reads clearly.

Give a shape an **alt text** description and exported SVG carries it as an
accessible label.

---

## 15. Keyboard shortcuts

**Help > Keyboard Shortcuts** (`⌘/`) shows this list inside the app.

### File

| Command | Shortcut |
|---|---|
| New | `⌘N` |
| New from Template | `⇧⌘N` |
| Open | `⌘O` |
| Close Window | `⌘W` |
| Save | `⌘S` |
| Save As | `⇧⌘S` |
| Export | `⇧⌘E` |
| Copy as Image | `⇧⌘C` |
| Print | `⌘P` |

### Edit

| Command | Shortcut |
|---|---|
| Undo | `⌘Z` |
| Redo | `⇧⌘Z` |
| Cut | `⌘X` |
| Copy | `⌘C` |
| Paste | `⌘V` |
| Paste and Match Style | `⌥⇧⌘V` |
| Duplicate | `⌘D` |
| Delete | `Delete` |
| Select All | `⌘A` |
| Deselect All | `⇧⌘A` |
| Find | `⌘F` |
| Copy Style | `⌥⌘C` |
| Paste Style | `⌥⌘V` |

### Format

| Command | Shortcut |
|---|---|
| Bold | `⌘B` |
| Italic | `⌘I` |
| Underline | `⌘U` |
| Bigger Text | `⇧⌘+` |
| Smaller Text | `⇧⌘-` |

### Arrange

| Command | Shortcut |
|---|---|
| Group | `⌥⌘G` |
| Ungroup | `⌥⇧⌘G` |
| Lock | `⌘L` |
| Unlock | `⌥⌘L` |
| Bring Forward | `⌥⌘F` |
| Bring to Front | `⌥⇧⌘F` |
| Send Backward | `⌥⌘B` |
| Send to Back | `⌥⇧⌘B` |

### View

| Command | Shortcut |
|---|---|
| Zoom In | `⌘+` |
| Zoom Out | `⌘-` |
| Actual Size | `⌘0` |
| Zoom to Fit | `⇧⌘0` |
| Zoom to Selection | `⌥⌘0` |
| Show Shape Library | `⌥⌘S` |
| Show Inspector | `⌥⌘I` |
| Enter Full Screen | `⌃⌘F` |

### Tools and application

| Command | Shortcut |
|---|---|
| Selection Tool | `⌘1` |
| Shape Tool | `⌘2` |
| Connector Tool | `⌘3` |
| Text Tool | `⌘4` |
| Settings | `⌘,` |
| Keyboard Shortcuts | `⌘/` |
| Hide FlowShark | `⌘H` |
| Quit | `⌘Q` |
| Emoji and Symbols | `⌃⌘Space` (handled by macOS) |

### On the canvas

| Action | Keys |
|---|---|
| Nudge 1 point | Arrow keys |
| Nudge 10 points | `⇧` and arrow keys |
| Pan | `Space` and drag, or two-finger scroll |
| Zoom | `⌘` and scroll, or pinch |
| Duplicate while dragging | `⌥` and drag |
| Constrain to one axis | `⇧` and drag |
| Resize from the centre | `⌥` and drag a handle |
| Keep proportions while resizing | `⇧` and drag a handle |
| Rotate in 15° steps | `⇧` and drag the rotation handle |
| Add to the selection | `⇧`-click |
| Edit text | Double-click, or `Return` |
| Finish editing text | `Escape`, `⌘Return`, or `Tab` |
| Step through elements | `Tab` / `⇧Tab` |
| Context menu | Control-click or right-click |

---

## 16. If something goes wrong

**I made a mistake.** `⌘Z`. FlowShark keeps 200 steps of history and covers
every edit, including style changes and reordering. `⇧⌘Z` redoes.

**A connector is taking an odd route.** Try a different connector type, or
drag its endpoints onto specific connection points instead of leaving them
floating. Adding one bend point usually settles a stubborn route.

**Two shapes overlap and I keep selecting the wrong one.** Send the one on top
backwards (`⌥⌘B`), or press `Tab` to step through them, or lock the one you
are not editing (`⌘L`).

**Something will not move.** It is probably locked. Select it and press `⌥⌘L`.

**The diagram scrolled off screen.** `⇧⌘0` fits everything in the window.

**FlowShark says a document was created by a newer version.** The file uses a
document format this copy does not know how to read. Update FlowShark.

**FlowShark says a file is not a valid document.** The file is not a
`.flowshark` document, or it was damaged in transit. Because the format is
plain JSON you can open it in a text editor to check.

**The app quit and I lost work.** Reopen it. If the document had never been
saved, FlowShark offers to recover the last automatic snapshot.

**An export does not look right.** Check the **Include** setting in the export
sheet — it may be exporting only the selection. For PDF, read the note about
picture-based export in [section 12](#12-exporting-printing-and-sharing).

Anything else: <https://github.com/johnjanney/flowshark-mac/issues>.
