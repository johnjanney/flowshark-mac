/**
 * The menu bar structure.
 *
 * This is the single source of truth for the macOS menu bar, the in-app
 * fallback menu used when FlowShark runs in a browser during development, and
 * the keyboard-shortcut reference sheet in Help.
 */

export interface MenuEntry {
  /** Command id from the registry. */
  command?: string;
  separator?: boolean;
  /** A macOS predefined item handled by the system (Quit, Services, and so on). */
  predefined?:
    | 'about'
    | 'services'
    | 'hide'
    | 'hideOthers'
    | 'showAll'
    | 'quit'
    | 'separator'
    | 'undo'
    | 'redo'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'selectAll'
    | 'minimize'
    | 'maximize'
    | 'fullscreen'
    | 'closeWindow';
  title?: string;
  submenu?: MenuEntry[];
}

export interface MenuDefinition {
  title: string;
  items: MenuEntry[];
}

export const MENU_BAR: readonly MenuDefinition[] = [
  {
    title: 'FlowShark',
    items: [
      { command: 'app.about' },
      { separator: true },
      { command: 'app.settings' },
      { separator: true },
      { predefined: 'services', title: 'Services' },
      { separator: true },
      { predefined: 'hide' },
      { predefined: 'hideOthers' },
      { predefined: 'showAll' },
      { separator: true },
      { predefined: 'quit' },
    ],
  },
  {
    title: 'File',
    items: [
      { command: 'file.new' },
      { command: 'file.newFromTemplate' },
      { command: 'file.open' },
      { title: 'Open Recent', submenu: [{ command: 'file.clearRecent' }] },
      { separator: true },
      { command: 'file.close' },
      { command: 'file.save' },
      { command: 'file.saveAs' },
      { command: 'file.revert' },
      { separator: true },
      { command: 'file.export' },
      { command: 'file.exportPng' },
      { command: 'file.exportSvg' },
      { command: 'file.exportPdf' },
      { separator: true },
      { command: 'file.share' },
      { command: 'file.copyAsImage' },
      { command: 'file.print' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { command: 'edit.undo' },
      { command: 'edit.redo' },
      { separator: true },
      { command: 'edit.cut' },
      { command: 'edit.copy' },
      { command: 'edit.paste' },
      { command: 'edit.pasteMatchStyle' },
      { command: 'edit.duplicate' },
      { command: 'edit.delete' },
      { separator: true },
      { command: 'edit.selectAll' },
      { command: 'edit.deselectAll' },
      { command: 'edit.selectConnected' },
      { separator: true },
      { command: 'edit.find' },
      { separator: true },
      { command: 'edit.copyStyle' },
      { command: 'edit.pasteStyle' },
      { separator: true },
      {
        title: 'Spelling and Grammar',
        submenu: [{ command: 'edit.spelling' }],
      },
      { command: 'edit.emoji' },
    ],
  },
  {
    title: 'Insert',
    items: [
      { command: 'insert.process' },
      { command: 'insert.decision' },
      { command: 'insert.terminator' },
      { command: 'insert.data' },
      { separator: true },
      { command: 'insert.connector' },
      { command: 'insert.textBox' },
      { command: 'insert.image' },
      { command: 'insert.imagePlaceholder' },
      { separator: true },
      { command: 'insert.connectorLabel' },
    ],
  },
  {
    title: 'Format',
    items: [
      {
        title: 'Fill',
        submenu: [
          { command: 'format.fillNone' },
          { command: 'format.fillWhite' },
          { command: 'format.fillAccent' },
        ],
      },
      {
        title: 'Border',
        submenu: [
          { command: 'format.borderNone' },
          { command: 'format.borderSolid' },
          { command: 'format.borderDashed' },
          { command: 'format.borderDotted' },
          { separator: true },
          { command: 'format.borderThinner' },
          { command: 'format.borderThicker' },
        ],
      },
      {
        title: 'Text',
        submenu: [
          { command: 'format.bold' },
          { command: 'format.italic' },
          { command: 'format.underline' },
          { separator: true },
          { command: 'format.alignTextLeft' },
          { command: 'format.alignTextCenter' },
          { command: 'format.alignTextRight' },
          { separator: true },
          { command: 'format.biggerText' },
          { command: 'format.smallerText' },
        ],
      },
      { separator: true },
      { command: 'format.stylePresets' },
      { command: 'edit.copyStyle' },
      { command: 'edit.pasteStyle' },
      { command: 'format.resetStyle' },
    ],
  },
  {
    title: 'Arrange',
    items: [
      {
        title: 'Align',
        submenu: [
          { command: 'arrange.alignLeft' },
          { command: 'arrange.alignCenterH' },
          { command: 'arrange.alignRight' },
          { separator: true },
          { command: 'arrange.alignTop' },
          { command: 'arrange.alignCenterV' },
          { command: 'arrange.alignBottom' },
        ],
      },
      {
        title: 'Distribute',
        submenu: [
          { command: 'arrange.distributeH' },
          { command: 'arrange.distributeV' },
          { separator: true },
          { command: 'arrange.distributeCentersH' },
          { command: 'arrange.distributeCentersV' },
        ],
      },
      {
        title: 'Size',
        submenu: [
          { command: 'arrange.sameWidth' },
          { command: 'arrange.sameHeight' },
          { command: 'arrange.sameSize' },
        ],
      },
      { separator: true },
      { command: 'arrange.group' },
      { command: 'arrange.ungroup' },
      { separator: true },
      { command: 'arrange.lock' },
      { command: 'arrange.unlock' },
      { command: 'arrange.hide' },
      { command: 'arrange.show' },
      { separator: true },
      { command: 'arrange.bringForward' },
      { command: 'arrange.bringToFront' },
      { command: 'arrange.sendBackward' },
      { command: 'arrange.sendToBack' },
    ],
  },
  {
    title: 'View',
    items: [
      { command: 'view.zoomIn' },
      { command: 'view.zoomOut' },
      { command: 'view.actualSize' },
      { command: 'view.zoomToFit' },
      { command: 'view.zoomToSelection' },
      { separator: true },
      { command: 'view.toggleGrid' },
      { command: 'view.toggleSnapGrid' },
      { command: 'view.toggleSnapElement' },
      { command: 'view.toggleGuides' },
      { command: 'view.toggleRulers' },
      { command: 'view.togglePageBoundaries' },
      { separator: true },
      { command: 'view.toggleSidebar' },
      { command: 'view.toggleInspector' },
      { command: 'view.toggleStatusBar' },
      { separator: true },
      { predefined: 'fullscreen' },
    ],
  },
  {
    title: 'Window',
    items: [
      { predefined: 'minimize' },
      { predefined: 'maximize', title: 'Zoom' },
      { separator: true },
      { command: 'window.new' },
      { predefined: 'closeWindow' },
    ],
  },
  {
    title: 'Help',
    items: [
      { command: 'help.instructions' },
      { command: 'help.shortcuts' },
      { separator: true },
      { command: 'help.about' },
    ],
  },
];

/** Grouping used by the keyboard-shortcut reference sheet. */
export const SHORTCUT_GROUPS: ReadonlyArray<{ title: string; commands: string[] }> = [
  {
    title: 'File',
    commands: [
      'file.new',
      'file.newFromTemplate',
      'file.open',
      'file.close',
      'file.save',
      'file.saveAs',
      'file.export',
      'file.copyAsImage',
      'file.print',
    ],
  },
  {
    title: 'Edit',
    commands: [
      'edit.undo',
      'edit.redo',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.pasteMatchStyle',
      'edit.duplicate',
      'edit.delete',
      'edit.selectAll',
      'edit.deselectAll',
      'edit.find',
      'edit.copyStyle',
      'edit.pasteStyle',
    ],
  },
  {
    title: 'Arrange',
    commands: [
      'arrange.group',
      'arrange.ungroup',
      'arrange.lock',
      'arrange.unlock',
      'arrange.bringForward',
      'arrange.bringToFront',
      'arrange.sendBackward',
      'arrange.sendToBack',
    ],
  },
  {
    title: 'View',
    commands: [
      'view.zoomIn',
      'view.zoomOut',
      'view.actualSize',
      'view.zoomToFit',
      'view.zoomToSelection',
      'view.toggleSidebar',
      'view.toggleInspector',
      'view.toggleGrid',
    ],
  },
];

/** Canvas gestures, listed in Help. They are not commands. */
export const CANVAS_MODIFIERS: ReadonlyArray<{ action: string; keys: string }> = [
  { action: 'Nudge 1 point', keys: 'Arrow keys' },
  { action: 'Nudge 10 points', keys: '⇧ and arrow keys' },
  { action: 'Pan', keys: 'Space and drag' },
  { action: 'Duplicate while dragging', keys: '⌥ and drag' },
  { action: 'Constrain to one axis', keys: '⇧ and drag' },
  { action: 'Resize from the centre', keys: '⌥ and drag a handle' },
  { action: 'Keep proportions while resizing', keys: '⇧ and drag a handle' },
  { action: 'Zoom', keys: '⌘ and scroll, or pinch' },
  { action: 'Edit text', keys: 'Double-click, or Return' },
  { action: 'Step through elements', keys: 'Tab' },
  { action: 'Add to the selection', keys: '⇧-click' },
];
