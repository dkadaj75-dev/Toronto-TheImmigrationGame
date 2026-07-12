import { defineConfig } from 'vite';

// Game at /, tool constellation at /tools/* (added per-phase).
export default defineConfig({
  build: { target: 'es2022' },
  publicDir: 'public',
});
