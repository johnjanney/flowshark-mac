/**
 * A headless smoke test for the FlowShark front end.
 *
 * It drives the built application in Chromium the way a person would: add
 * shapes, connect them, edit text, align, undo, export, and save. Anything that
 * throws in the page, or any console error, fails the run.
 *
 * Run with: npm run smoke
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

const SHOTS = 'screenshots';

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const server = await createServer({ server: { port: 5178, strictPort: true } });
  await server.listen();
  const url = 'http://localhost:5178/';

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

  // The template chooser opens on first launch; suppress it for the test.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'flowshark.preferences',
      JSON.stringify({ showWelcomeOnLaunch: false }),
    );
    window.confirm = () => false;
    window.alert = () => {};
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#canvas-root g[data-id]', { timeout: 15000 });

  const step = async (name, fn) => {
    process.stdout.write(`  ${name} … `);
    await fn();
    console.log('ok');
  };

  const count = () => page.$$eval('#canvas-root g[data-id]', (nodes) => nodes.length);

  console.log('FlowShark smoke test');

  await step('loads the starter diagram', async () => {
    const n = await count();
    if (n < 6) throw new Error(`expected the template to render, saw ${n} elements`);
  });

  await step('shows the shape library', async () => {
    const tiles = await page.$$eval('.shape-tile', (nodes) => nodes.length);
    if (tiles < 40) throw new Error(`expected the full shape library, saw ${tiles} tiles`);
  });

  await page.screenshot({ path: `${SHOTS}/01-launch.png` });

  await step('adds a shape by clicking the canvas with the shape tool', async () => {
    const before = await count();
    await page.fill('.shape-search input', 'hexagon');
    await page.waitForTimeout(150);
    await page.click('.shape-tile[data-shape="hexagon"]');
    await page.fill('.shape-search input', '');
    await page.mouse.click(760, 620);
    await page.waitForTimeout(150);
    const after = await count();
    if (after !== before + 1) throw new Error(`expected one new element, went ${before} -> ${after}`);
  });

  await step('selects the new shape and shows the inspector', async () => {
    const sections = await page.$$eval('#inspector .panel-section', (nodes) =>
      nodes.map((node) => node.querySelector('summary')?.textContent ?? ''),
    );
    for (const wanted of ['Arrange', 'Position and Size', 'Fill', 'Border', 'Text']) {
      if (!sections.includes(wanted)) {
        throw new Error(`inspector is missing the ${wanted} section (saw ${sections.join(', ')})`);
      }
    }
  });

  await step('changes the fill colour from the inspector', async () => {
    await page.$eval('#inspector input[type="color"]', (input) => {
      input.value = '#ff8800';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(100);
    const fills = await page.$$eval('#canvas-root path.fs-shape-path', (nodes) =>
      nodes.map((node) => node.getAttribute('fill')),
    );
    if (!fills.includes('#ff8800')) throw new Error('the fill colour did not reach the canvas');
  });

  await step('edits text with a double-click', async () => {
    const box = await page.$eval('#canvas-root g[data-id]:last-of-type path.fs-shape-path', (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.dblclick(box.x, box.y);
    await page.waitForSelector('.text-editor', { timeout: 4000 });
    await page.keyboard.type('Reviewed');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const text = await page.$eval('#canvas-root', (root) => root.textContent ?? '');
    if (!text.includes('Reviewed')) throw new Error('typed text did not appear on the canvas');
  });

  await step('undoes and redoes the text edit', async () => {
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(150);
    let text = await page.$eval('#canvas-root', (root) => root.textContent ?? '');
    if (text.includes('Reviewed')) throw new Error('undo did not remove the text');
    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(150);
    text = await page.$eval('#canvas-root', (root) => root.textContent ?? '');
    if (!text.includes('Reviewed')) throw new Error('redo did not restore the text');
  });

  await step('drags a shape, and undo puts it back', async () => {
    const before = await page.$eval('#canvas-root g[data-kind="shape"]:last-of-type', (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const from = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 140, from.y - 60, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(220);

    const after = await page.$eval('#canvas-root g[data-kind="shape"]:last-of-type', (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    if (Math.abs(after.x - before.x) < 80) {
      throw new Error(`the drag moved the shape by ${Math.round(after.x - before.x)} px`);
    }

    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(200);
    const undone = await page.$eval('#canvas-root g[data-kind="shape"]:last-of-type', (node) =>
      node.getBoundingClientRect().x,
    );
    if (Math.abs(undone - before.x) > 2) {
      throw new Error(`undo left the shape ${Math.round(undone - before.x)} px away`);
    }
  });

  await step('resizes a shape with a handle', async () => {
    const box = await page.$eval('#canvas-root g[data-kind="shape"]:last-of-type', (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);

    const handle = await page.$eval('#overlay [data-handle="se"]', (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 90, handle.y + 50, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(220);

    const resized = await page.$eval('#canvas-root g[data-kind="shape"]:last-of-type', (node) =>
      node.getBoundingClientRect().width,
    );
    if (resized <= box.width + 20) {
      throw new Error(`the shape went from ${Math.round(box.width)} to ${Math.round(resized)} px`);
    }
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(180);
  });

  await step('selects with a marquee', async () => {
    await page.keyboard.press('Escape');
    const bounds = await page.$eval('#canvas-root', (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.mouse.move(bounds.x - 40, bounds.y - 40);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width + 40, bounds.y + bounds.height + 40, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const status = await page.$eval('#statusbar', (node) => node.textContent ?? '');
    if (!/elements selected/.test(status)) {
      throw new Error(`the marquee selected nothing: ${status}`);
    }
    await page.keyboard.press('Escape');
  });

  await step('draws a connector between two shapes', async () => {
    const before = await page.$$eval('#canvas-root g[data-kind="connector"]', (n) => n.length);
    const points = await page.$$eval('#canvas-root g[data-kind="shape"] path.fs-shape-path', (nodes) =>
      nodes.slice(-2).map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }),
    );
    await page.click('.shape-tile[aria-label], .shape-tile', { position: { x: 1, y: 1 } }).catch(() => {});
    await page.keyboard.press('Meta+3');
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await page.$$eval('#canvas-root g[data-kind="connector"]', (n) => n.length);
    if (after <= before) throw new Error(`no connector was created (${before} -> ${after})`);
  });

  await step('selects everything and aligns it', async () => {
    await page.keyboard.press('Meta+1');
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(120);
    const selected = await page.$eval('#statusbar', (node) => node.textContent ?? '');
    if (!/elements selected/.test(selected)) throw new Error(`selection not reported: ${selected}`);
    await page.click('button[data-command="arrange.alignLeft"]');
    await page.waitForTimeout(150);
    await page.keyboard.press('Meta+z');
  });

  await step('groups and ungroups', async () => {
    await page.keyboard.press('Meta+a');
    await page.click('button[data-command="arrange.group"]');
    await page.waitForTimeout(150);
    await page.click('button[data-command="arrange.ungroup"]');
    await page.waitForTimeout(150);
  });

  await step('zooms to fit', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Shift+0');
    await page.waitForTimeout(200);
    const zoom = await page.$eval('.zoom-value', (node) => node.value);
    if (!/%$/.test(zoom)) throw new Error(`zoom control shows "${zoom}"`);
  });

  await page.screenshot({ path: `${SHOTS}/02-edited.png` });

  await step('opens the template chooser and creates a diagram', async () => {
    await page.keyboard.press('Meta+Shift+n');
    await page.waitForSelector('.dialog .template-grid', { timeout: 4000 });
    const cards = await page.$$eval('.template-card', (nodes) => nodes.length);
    if (cards < 10) throw new Error(`expected at least 10 templates, saw ${cards}`);
    await page.screenshot({ path: `${SHOTS}/03-templates.png` });
    await page.click('.template-card:nth-of-type(5)');
    await page.click('.dialog-footer .button.primary');
    await page.waitForTimeout(400);
    const n = await count();
    if (n < 4) throw new Error(`template produced ${n} elements`);
  });

  await step('shows the keyboard shortcut reference', async () => {
    await page.keyboard.press('Meta+/');
    await page.waitForSelector('.shortcut-columns', { timeout: 4000 });
    const rows = await page.$$eval('.shortcut-group dt', (nodes) => nodes.length);
    if (rows < 20) throw new Error(`expected the full shortcut list, saw ${rows} rows`);
    await page.screenshot({ path: `${SHOTS}/04-shortcuts.png` });
    await page.keyboard.press('Escape');
  });

  await step('exports SVG, PNG, and PDF in the page', async () => {
    const result = await page.evaluate(async () => {
      const svgModule = await import('/src/io/export-svg.ts');
      const rasterModule = await import('/src/io/export-raster.ts');
      const pdfModule = await import('/src/io/export-pdf.ts');
      const exportModule = await import('/src/io/export.ts');
      const templates = await import('/src/templates/index.ts');
      const doc = templates.getTemplate('swimlane').build();
      const options = exportModule.defaultExportOptions();
      const svg = svgModule.buildStandaloneSvg(doc, options, []).svg;
      const png = await rasterModule.exportRaster(doc, options, [], 'png');
      const pdf = await pdfModule.exportPdf(doc, options, [], 'auto');
      return {
        svgLength: svg.length,
        pngLength: png.bytes.length,
        pngHeader: Array.from(png.bytes.slice(0, 4)),
        pngWidth: png.width,
        pdfLength: pdf.bytes.length,
        pdfMode: pdf.mode,
        pdfHeader: new TextDecoder().decode(pdf.bytes.slice(0, 8)),
      };
    });
    if (result.svgLength < 500) throw new Error('the SVG export is suspiciously small');
    if (result.pngHeader.join(',') !== '137,80,78,71') throw new Error('the PNG has no PNG header');
    if (result.pngWidth < 100) throw new Error('the PNG is too small');
    if (!result.pdfHeader.startsWith('%PDF-1.7')) throw new Error('the PDF has no PDF header');
    if (result.pdfMode !== 'vector') throw new Error(`expected a vector PDF, got ${result.pdfMode}`);
    console.log(
      `\n     SVG ${result.svgLength} bytes · PNG ${result.pngLength} bytes at ${result.pngWidth}px · PDF ${result.pdfLength} bytes (${result.pdfMode})`,
    );
    process.stdout.write('  ');
  });

  await step('round-trips a saved document', async () => {
    const ok = await page.evaluate(async () => {
      const serialization = await import('/src/model/serialization.ts');
      const templates = await import('/src/templates/index.ts');
      const original = templates.getTemplate('incident-response').build();
      const restored = serialization.parseDocument(serialization.serializeDocument(original));
      return (
        Object.keys(restored.elements).length === Object.keys(original.elements).length &&
        restored.order.join() === original.order.join()
      );
    });
    if (!ok) throw new Error('a saved document did not come back identical');
  });

  await step('renders in dark appearance', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    const background = await page.$eval('body', (node) => getComputedStyle(node).backgroundColor);
    if (background === 'rgb(242, 243, 246)') throw new Error('the dark palette did not apply');
    await page.screenshot({ path: `${SHOTS}/05-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await step('shows rulers when they are switched on', async () => {
    await page.evaluate(() => {
      const grid = [...document.querySelectorAll('#inspector .row-inline')];
      void grid;
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const menu = [...document.querySelectorAll('.fallback-menubar .menu-root > button')];
      menu.find((node) => node.textContent === 'View')?.click();
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.menu-popup button')];
      items.find((node) => node.textContent?.includes('Show Rulers'))?.click();
    });
    await page.waitForTimeout(250);
    const ticks = await page.$$eval('#overlay .ruler-tick', (nodes) => nodes.length);
    if (ticks < 2) throw new Error(`expected ruler ticks, saw ${ticks}`);
    await page.screenshot({ path: `${SHOTS}/06-rulers.png` });
  });

  await step('places an image dropped onto the canvas', async () => {
    const dataTransfer = await page.evaluateHandle(() => {
      // A 4x4 red PNG: the smallest thing that proves the import path works.
      const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR42mO4Y2PzHxkzkC4AAO2YJTHTor4nAAAAAElFTkSuQmCC';
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'red.png', { type: 'image/png' }));
      return transfer;
    });
    const before = await count();
    await page.dispatchEvent('#canvas-scroll', 'drop', { dataTransfer });
    await page.waitForTimeout(600);
    const after = await count();
    if (after !== before + 1) throw new Error(`dropping an image added ${after - before} elements`);
    const drawn = await page.$$eval('#canvas-root image', (nodes) => nodes.length);
    if (drawn === 0) throw new Error('the dropped image was not drawn');
  });

  await step('exposes an accessible outline of the diagram', async () => {
    const items = await page.$$eval('#diagram-outline [role="treeitem"]', (nodes) =>
      nodes.map((node) => node.textContent ?? ''),
    );
    if (items.length === 0) throw new Error('the accessible outline is empty');
    if (!items.some((text) => /Connects/.test(text))) {
      throw new Error('the outline does not describe connections');
    }
  });

  await step('keeps the canvas reachable from the keyboard', async () => {
    await page.click('#canvas-scroll', { position: { x: 20, y: 20 } });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(120);
    const selected = await page.$eval('#statusbar', (node) => node.textContent ?? '');
    if (!/1 element selected/.test(selected)) {
      throw new Error(`Tab did not move the selection: ${selected}`);
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
  });

  await step('handles a large diagram', async () => {
    const timing = await page.evaluate(async () => {
      const defaults = await import('/src/model/defaults.ts');
      const documentModule = await import('/src/model/document.ts');
      const scene = await import('/src/canvas/scene.ts');
      const doc = defaults.createEmptyDocument('Large');
      for (let i = 0; i < 500; i++) {
        documentModule.addElement(
          doc,
          defaults.createShapeElement({
            shape: i % 3 === 0 ? 'decision' : 'process',
            frame: { x: (i % 25) * 170, y: Math.floor(i / 25) * 110, width: 140, height: 64 },
            text: `Step ${i + 1}`,
          }),
        );
      }
      const start = performance.now();
      const built = scene.buildScene(doc, {
        theme: { background: null, gridLine: '#eee', gridLineStrong: '#ddd', pageBoundary: '#ccc' },
        showGrid: false,
        showPageBoundaries: false,
        interactive: true,
        accessible: false,
      });
      return { ms: performance.now() - start, length: built.body.length };
    });
    if (timing.ms > 1500) throw new Error(`building 500 elements took ${timing.ms.toFixed(0)} ms`);
    console.log(`\n     500 elements built in ${timing.ms.toFixed(0)} ms`);
    process.stdout.write('  ');
  });

  await browser.close();
  await server.close();

  if (failures.length > 0) {
    console.error('\nPage errors:');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed.');
}

main().catch(async (error) => {
  console.error('\nSmoke test failed:', error.message);
  process.exit(1);
});
