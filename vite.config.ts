import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade: Die App läuft so auch unter einem Unterpfad
  // (GitHub Pages: https://<name>.github.io/Kombi_Prototyp/).
  base: './',
  // JSX ohne zusätzliches React-Plugin übersetzen.
  esbuild: { jsx: 'automatic' },
});
