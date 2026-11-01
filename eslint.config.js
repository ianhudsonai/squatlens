import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Pure-core paths (SPEC §0 rule 4): no DOM, no React, no MediaPipe.
const PURE_CORE = ['src/core/**/*.{ts,tsx}', 'test/synthetic/**/*.{ts,tsx}'];

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'public/models',
    'public/wasm',
    'playwright-report',
    'test-results',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023 },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: PURE_CORE,
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite()],
    languageOptions: { globals: globals.browser },
  },
  {
    files: PURE_CORE,
    languageOptions: { globals: globals.es2021 },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'src/core must stay framework-free (SPEC §0.4).',
            },
            {
              group: ['@mediapipe/*'],
              message: 'src/core must not import MediaPipe; consume a PoseTrack (SPEC §0.4).',
            },
            {
              group: ['**/pose', '**/pose/**', '**/ui', '**/ui/**'],
              message: 'src/core must not depend on src/pose or src/ui (SPEC §0.4).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'location',
          'localStorage',
          'sessionStorage',
          'self',
          'fetch',
          'performance',
          'requestAnimationFrame',
          'HTMLElement',
          'HTMLVideoElement',
          'HTMLCanvasElement',
          'OffscreenCanvas',
          'ImageData',
          'ImageBitmap',
          'createImageBitmap',
          'Image',
          'crypto',
          'globalThis',
        ].map((name) => ({
          name,
          message: `src/core must not touch DOM/browser globals ("${name}"); keep it pure (SPEC §0.4).`,
        })),
      ],
      // Determinism (SPEC §0.4): no wall clock, no unseeded randomness.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use a seeded RNG; core must be deterministic.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Use PoseFrame.t; core must be deterministic.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Use PoseFrame.t; core must be deterministic.',
        },
      ],
    },
  },
  {
    files: ['*.{js,mjs,ts}', 'scripts/**/*.{js,mjs}', 'eval/**/*.ts', 'e2e/**/*.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
  },
  prettier,
]);
