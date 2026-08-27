/**
 * Entry point.
 *
 * Start-up failures are shown in the page rather than only in the console: in a
 * packaged application there is no console for the user to look at.
 */

import { FlowSharkApp } from './app';

async function boot(): Promise<void> {
  const app = new FlowSharkApp();
  await app.start();
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('FlowShark could not start.', error);
  const shell = document.getElementById('app');
  if (shell) {
    shell.innerHTML = '';
    const panel = document.createElement('div');
    panel.style.cssText =
      'margin:auto;max-width:520px;padding:40px 24px;font:13px -apple-system,system-ui,sans-serif;text-align:center';
    panel.innerHTML =
      '<h1 style="font-size:17px">FlowShark could not start</h1>' +
      `<p style="color:#5a6377">${message.replace(/[<>&]/g, '')}</p>`;
    shell.append(panel);
  }
});
