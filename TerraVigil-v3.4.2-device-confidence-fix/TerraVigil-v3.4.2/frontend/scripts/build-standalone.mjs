import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.standalone-build');
const target = path.resolve(root, process.argv[2] || 'TerraVigil-preview.html');
process.chdir(root);
const require = createRequire(path.join(root, 'package.json'));
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const autoprefixer = require('autoprefixer');
const { default: tailwindConfig } = await import(new URL('../tailwind.config.js', import.meta.url));
await fs.mkdir(outdir, { recursive: true });
await fs.mkdir(path.dirname(target), { recursive: true });
let routerAdapted = false;
const output = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outdir,
  entryNames: 'app',
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  metafile: true,
  define: {
    'import.meta.env': JSON.stringify({
      MODE: 'production',
      DEV: false,
      PROD: true,
      VITE_DATA_MODE: 'demo',
    }),
    'process.env.NODE_ENV': '"production"',
  },
  alias: { '@': path.join(root, 'src') },
  loader: {
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.svg': 'dataurl',
    '.webp': 'dataurl',
  },
  plugins: [
    {
      name: 'standalone-preview-hash-router',
      setup(build) {
        build.onLoad({ filter: /[\\/]src[\\/]AppRouter\.tsx$/ }, async (args) => {
          routerAdapted = true;
          return {
            contents: (await fs.readFile(args.path, 'utf8')).replaceAll(
              'BrowserRouter',
              'HashRouter',
            ),
            loader: 'tsx',
          };
        });
      },
    },
  ],
  logLevel: 'warning',
});
if (!routerAdapted)
  throw new Error('Standalone build could not adapt AppRouter to file navigation.');
const favicon = encodeURIComponent(
  await fs.readFile(path.join(root, 'public/favicon.svg'), 'utf8'),
);
const raw = await fs.readFile(path.join(outdir, 'app.css'), 'utf8');
const result = await postcss([tailwind(tailwindConfig), autoprefixer]).process(raw, {
  from: path.join(root, 'src/styles/index.css'),
});
const css = (await esbuild.transform(result.css, { loader: 'css', minify: true })).code;
const js = (await fs.readFile(path.join(outdir, 'app.js'), 'utf8')).replaceAll(
  '</script',
  '<\\/script',
);
const html = `<!doctype html>\n<html lang="en" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TerraVigil — Interactive demo</title><meta name="description" content="Self-contained TerraVigil interface demonstration. All survey records are synthetic. No backend or live aircraft connection."><meta name="theme-color" content="#0f1312"><meta name="color-scheme" content="dark"><link rel="icon" href="data:image/svg+xml,${favicon}"><style>${css}</style></head><body class="bg-background text-text-primary"><div id="root"></div><script>if (!location.hash || location.hash === "#") location.replace(location.href.split("#")[0] + "#/");</script><script>${js}</script></body></html>\n`;
await fs.writeFile(target, html);
console.log(
  JSON.stringify(
    {
      success: true,
      target,
      bytes: Buffer.byteLength(html),
      bundledOutputs: Object.keys(output.metafile.outputs).length,
      routeAdapter: 'HashRouter for standalone preview only',
      dataMode: 'demo',
      assets: 'embedded',
    },
    null,
    2,
  ),
);
await fs.rm(outdir, { recursive: true, force: true });
