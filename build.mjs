// Gera a pasta dist/: copia os arquivos estáticos e empacota o app.js
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const f of ['index.html', 'styles.css', 'sw.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'og.png']) cpSync(`src/${f}`, `dist/${f}`);
// Fonte própria (sem depender do Google Fonts)
mkdirSync('dist/fonts');
cpSync('node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', 'dist/fonts/space-grotesk.woff2');

await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  splitting: true, // PDF e Excel só carregam quando alguém baixa a planilha
  chunkNames: 'chunks/[name]-[hash]',
  target: ['safari15', 'chrome100'],
  outdir: 'dist',
});
console.log('build ok');
