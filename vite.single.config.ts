// Baut das Test-Tool als EINE HTML-Datei (dist-single/index.html), die man ohne npm im Browser öffnen kann.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: 'dist-single', emptyOutDir: true },
});
