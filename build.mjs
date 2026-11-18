import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['auth.js', 'dashboard.js'], bundle: true, splitting: true, format: 'esm', outdir: 'dist', minify: true, target: ['es2022'], define: { 'import.meta.env.VITE_NEON_AUTH_URL': JSON.stringify(process.env.VITE_NEON_AUTH_URL || process.env.NEON_AUTH_BASE_URL || '') } });
for (const file of ['index.html', 'kitchen.html', 'site.css', 'app-styles.css']) await copyFile(file, `dist/${file}`);
console.log('Built Planted & Plated.');
