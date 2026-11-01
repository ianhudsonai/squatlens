#!/usr/bin/env node
// Downloads the MediaPipe pose models into public/models/ (SHA-256 pinned) and copies the
// tasks-vision WASM runtime into public/wasm/, so the app serves everything from its own
// origin (SPEC §0 rule 2, §4). Runs as `predev`/`prebuild` and in CI. Idempotent: files
// already present with the right hash are left alone.
//
// Usage: node scripts/fetch-models.mjs [--models lite,full,heavy]

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = join(ROOT, 'public', 'models');
const WASM_DIR = join(ROOT, 'public', 'wasm');
const WASM_SRC = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');

// Versioned URLs (`/float16/1/`) so the bytes never change under us. Hashes recorded on
// 2026-11-01. If Google ever republishes a version, the hash check fails loudly instead
// of silently shipping a different model. When the hashes change, also bump CACHE_NAME in
// src/pose/modelCache.ts so returning visitors drop the old model from Cache Storage.
const MODELS = {
  lite: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  full: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
  heavy: '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b',
};

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

function modelUrl(variant) {
  return `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function hashOf(path) {
  try {
    return sha256(await readFile(path));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function download(url, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

async function ensureModel(variant) {
  const expected = MODELS[variant];
  const dest = join(MODELS_DIR, `pose_landmarker_${variant}.task`);
  if ((await hashOf(dest)) === expected) {
    console.log(`  ${variant}: ok (cached)`);
    return;
  }
  const url = modelUrl(variant);
  console.log(`  ${variant}: downloading ${url}`);
  const buf = await download(url);
  const actual = sha256(buf);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${variant}: expected ${expected}, got ${actual}. ` +
        'Refusing to install an unverified model.',
    );
  }
  // Write-then-rename so an interrupted run never leaves a truncated file behind.
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, dest);
  console.log(`  ${variant}: ok (${(buf.length / 1e6).toFixed(1)} MB)`);
}

async function copyWasm() {
  for (const name of WASM_FILES) {
    const src = join(WASM_SRC, name);
    const dest = join(WASM_DIR, name);
    const [a, b] = await Promise.all([hashOf(src), hashOf(dest)]);
    if (a === null) {
      throw new Error(`Missing ${src}. Run \`npm ci\` first.`);
    }
    if (a !== b) await copyFile(src, dest);
  }
  console.log(`  wasm: ok (${WASM_FILES.length} files)`);
}

function parseArgs(argv) {
  const i = argv.indexOf('--models');
  if (i === -1) return Object.keys(MODELS);
  const list = (argv[i + 1] ?? '').split(',').filter(Boolean);
  if (list.length === 0) throw new Error('--models needs a list, e.g. --models lite,full');
  for (const v of list) {
    if (!(v in MODELS)) throw new Error(`Unknown model "${v}" (expected lite, full or heavy)`);
  }
  return list;
}

async function main() {
  const variants = parseArgs(process.argv.slice(2));
  await mkdir(MODELS_DIR, { recursive: true });
  await mkdir(WASM_DIR, { recursive: true });
  console.log('fetch-models:');
  await copyWasm();
  for (const v of variants) {
    try {
      await ensureModel(v);
    } catch (err) {
      await rm(join(MODELS_DIR, `pose_landmarker_${v}.task.tmp`), { force: true });
      throw err;
    }
  }
}

main().catch((err) => {
  console.error(`fetch-models failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
