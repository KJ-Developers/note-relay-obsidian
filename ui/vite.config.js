import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'NoteRelayUI',
      fileName: () => 'ui-bundle.js',
      formats: ['iife']
    },
    rollupOptions: {
      output: {
        entryFileNames: 'ui-bundle.js',
        inlineDynamicImports: true,
      }
    },
    minify: 'esbuild',
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: true
  }
});
