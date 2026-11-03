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
  target: ['safari15', 'chrome100'],
  outfile: 'dist/app.js',
});
console.log('build ok');
