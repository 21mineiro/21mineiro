// Gera a pasta dist/: copia os arquivos estáticos e empacota o app.js
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const f of ['index.html', 'styles.css', 'sw.js', 'manifest.json', 'icon.svg']) cpSync(`src/${f}`, `dist/${f}`);

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
