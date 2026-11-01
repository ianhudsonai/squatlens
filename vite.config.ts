/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  // Served from GitHub Pages at https://<user>.github.io/squatlens/
  base: '/squatlens/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts', 'eval/**/*.test.ts'],
    environment: 'node',
  },
});
