/**
 * Privacy proof (SPEC §8): a full analysis of a video makes no request to any origin other
 * than the page's own. Runs against the production build (`vite preview`).
 *
 * Two independent checks:
 *  - every request the browser issues (page, workers, preloads) must be same-origin, or a
 *    local blob:/data: URL;
 *  - no Content-Security-Policy violation may fire in the page (the listener is installed
 *    in page frames only; pose inference runs on the main thread today). The CSP blocks a cross-origin fetch
 *    before it reaches the network (so it never shows up as a request); a violation means
 *    something tried, which is a regression even if the CSP caught it. MediaPipe's usage
 *    logger (odml.pa.googleapis.com) is the known offender, stopped by sameOriginFetch.ts.
 */
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const VIDEO = fileURLToPath(new URL('./assets/cartoon-squat.webm', import.meta.url));

function isLocal(url: string, origin: string): boolean {
  const u = new URL(url);
  if (u.protocol === 'data:') return true;
  if (u.protocol === 'blob:') return new URL(u.pathname).origin === origin;
  return u.origin === origin;
}

test('a full analysis makes no cross-origin requests', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  context.on('request', (req) => requests.push(req.url()));
  context.on('serviceworker', (sw) => requests.push(`service worker: ${sw.url()}`));

  // Record CSP violations in the page before any app code runs.
  await context.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = log;
    window.addEventListener('securitypolicyviolation', (e) => {
      log.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  // CPU delegate and the lite model keep the run fast and deterministic on CI runners.
  await page.goto('./?delegate=cpu');
  await page.getByRole('combobox').selectOption('lite');
  await page.locator('input[type="file"]').setInputFiles(VIDEO);

  // The report (with its export buttons) only renders once the whole pipeline has run:
  // model download, WASM start-up, per-frame inference and analyzeSet.
  await expect(page.getByRole('button', { name: 'Exportar análise (JSON)' })).toBeVisible({
    timeout: 90_000,
  });
  // The analysis really ran on a detected pose (calibration, view, reps, metrics, overlay),
  // not just the "no person found" path: the cartoon clip gives one front-view rep.
  await expect(page.getByRole('status')).toHaveText(/Pose detectada em [1-9]\d* de \d+ quadros/);
  await expect(page.getByText('Rep 1', { exact: true })).toBeVisible();

  const external = requests.filter(
    (url) => !url.startsWith('service worker') && !isLocal(url, origin),
  );
  expect(external, 'cross-origin requests').toEqual([]);
  expect(requests.filter((r) => r.startsWith('service worker'))).toEqual([]);
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations, 'CSP violations').toEqual([]);

  // Sanity: the run really loaded the model and the WASM runtime from this origin.
  expect(requests.some((u) => u.includes('/models/pose_landmarker_lite.task'))).toBe(true);
  expect(requests.some((u) => u.includes('/wasm/vision_wasm'))).toBe(true);
});
