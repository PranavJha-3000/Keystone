import { defineConfig } from 'vite';

// base: './' ensures all asset paths are relative so the built output
// runs by opening dist/index.html directly — no server required.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
