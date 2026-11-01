#!/usr/bin/env node
// Regenerates e2e/assets/cartoon-squat.webm: a 3 s, 360x640, 15 fps front-view cartoon
// figure that stands for 0.8 s, does one squat and stands again. Drawn on a canvas, so
// there is no real person in the repo (SPEC §8), yet MediaPipe finds the pose in every
// frame and the app reports a rep. Needs Chromium (Playwright) and ffmpeg.
//
// Usage: node e2e/make-test-video.mjs

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'cartoon-squat.webm');
const W = 360;
const H = 640;
const FPS = 15;
const SECONDS = 3;

/* global document -- drawFrame runs in the browser page. */

/** Runs in the page: draws frame `t` (seconds) and returns it as a PNG data URL. */
function drawFrame({ t, W, H, SECONDS }) {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  // Still for 0.8 s (calibration), one smooth squat, still for 0.8 s.
  const move = Math.max(0, Math.min(1, (t - 0.8) / (SECONDS - 1.6)));
  const d = (110 * (1 - Math.cos(2 * Math.PI * move))) / 2; // hip drop, px
  const cx = W / 2;
  const skin = '#e0ac69';
  const hipY = 330 + d;
  const shY = 190 + d * 0.95;
  const headY = 135 + d * 0.95;
  const kneeSpread = 30 + d * 0.35;
  const kneeY = 455 + d * 0.25;
  const ankY = 575;
  const limb = (pts, w, col) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(...pts[0]);
    for (const p of pts.slice(1)) g.lineTo(...p);
    g.stroke();
  };
  const ellipse = (x, y, rx, ry, col, start = 0, end = 2 * Math.PI) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, start, end);
    g.fill();
  };

  g.fillStyle = '#cfd8dc';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#9e9e9e';
  g.fillRect(0, 590, W, 50);
  for (const s of [-1, 1]) {
    limb(
      [
        [cx + s * 26, hipY],
        [cx + s * kneeSpread, kneeY],
        [cx + s * 30, ankY],
      ],
      34,
      '#283593',
    );
    ellipse(cx + s * 34, ankY + 10, 24, 11, '#212121');
  }
  g.fillStyle = '#c62828';
  g.beginPath();
  g.moveTo(cx - 52, shY);
  g.lineTo(cx + 52, shY);
  g.lineTo(cx + 40, hipY + 10);
  g.lineTo(cx - 40, hipY + 10);
  g.closePath();
  g.fill();
  const handX = 55 - d * 0.2;
  const handY = shY + 110 - d * 0.6;
  for (const s of [-1, 1]) {
    limb(
      [
        [cx + s * 50, shY + 12],
        [cx + s * 62, shY + 70],
        [cx + s * handX, handY],
      ],
      22,
      '#c62828',
    );
    limb(
      [
        [cx + s * handX, handY],
        [cx + s * handX, handY + 2],
      ],
      22,
      skin,
    );
  }
  limb(
    [
      [cx, shY],
      [cx, headY + 30],
    ],
    22,
    skin,
  );
  ellipse(cx, headY, 30, 38, skin);
  ellipse(cx, headY - 22, 32, 20, '#3e2723', Math.PI, 2 * Math.PI);
  for (const s of [-1, 1]) {
    ellipse(cx + s * 12, headY - 4, 7, 5, '#fff');
    ellipse(cx + s * 12, headY - 4, 3, 3, '#000');
    ellipse(cx + s * 30, headY, 6, 10, skin);
  }
  g.lineWidth = 3;
  g.strokeStyle = '#8d5524';
  g.beginPath();
  g.moveTo(cx, headY);
  g.lineTo(cx - 3, headY + 10);
  g.lineTo(cx + 2, headY + 11);
  g.stroke();
  g.strokeStyle = '#6d1b1b';
  g.beginPath();
  g.arc(cx, headY + 16, 9, 0.2, Math.PI - 0.2);
  g.stroke();
  return c.toDataURL('image/png');
}

const dir = await mkdtemp(join(tmpdir(), 'squatlens-video-'));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  const page = await browser.newPage();
  await page.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas>`);
  for (let i = 0; i < FPS * SECONDS; i++) {
    const url = await page.evaluate(drawFrame, { t: i / FPS, W, H, SECONDS });
    const name = `f${String(i).padStart(3, '0')}.png`;
    await writeFile(join(dir, name), Buffer.from(url.split(',')[1], 'base64'));
  }
  // VP9 WebM with a real duration header (MediaRecorder output would lack one).
  // prettier-ignore
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS),
    '-i', join(dir, 'f%03d.png'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40',
    '-pix_fmt', 'yuv420p', OUT]);
  console.log(`wrote ${OUT}`);
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
