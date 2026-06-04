#!/usr/bin/env node

import { build, context } from 'esbuild';
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const EXT_DIR = __dirname;
const SRC_DIR = join(EXT_DIR, 'src');
const DIST_DIR = join(EXT_DIR, 'dist');
const isWatch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production';

// Ensure dist directory exists
if (!existsSync(DIST_DIR)) {
  mkdirSync(DIST_DIR, { recursive: true });
}

/** Copy static assets (HTML, CSS, manifest.json, icons) to dist/ */
function copyAssets() {
  // manifest.json
  const manifest = join(EXT_DIR, 'manifest.json');
  if (existsSync(manifest)) {
    cpSync(manifest, join(DIST_DIR, 'manifest.json'));
  }

  // HTML files from src/ subdirectories (override any legacy root-level copies)
  const htmlSources = [
    { src: join(SRC_DIR, 'popup', 'popup.html'), dest: join(DIST_DIR, 'popup.html') },
    { src: join(SRC_DIR, 'offscreen', 'offscreen.html'), dest: join(DIST_DIR, 'offscreen.html') },
  ];
  for (const { src, dest } of htmlSources) {
    if (existsSync(src)) {
      cpSync(src, dest);
    }
  }

  // CSS files from src/popup/
  const popupCss = join(SRC_DIR, 'popup', 'popup.css');
  if (existsSync(popupCss)) {
    cpSync(popupCss, join(DIST_DIR, 'popup.css'));
  }

  // Icons directory
  const iconsDir = join(EXT_DIR, 'icons');
  if (existsSync(iconsDir)) {
    cpSync(iconsDir, join(DIST_DIR, 'icons'), { recursive: true });
  }
}

/** Print file sizes in dist/ */
function printSizes() {
  if (!existsSync(DIST_DIR)) return;
  const entries = readdirSync(DIST_DIR);
  console.log('\n  Output files:');
  const printFile = (dir, prefix = '') => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        printFile(fullPath, `${prefix}${entry}/`);
      } else {
        const kb = (stat.size / 1024).toFixed(1);
        const rel = prefix + entry;
        console.log(`    ${rel.padEnd(35)} ${kb.padStart(7)} KB`);
      }
    }
  };
  printFile(DIST_DIR);
  console.log();
}

/** Shared esbuild config base */
function baseConfig(entryPoint, outfile, extra = {}) {
  return {
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'browser',
    target: 'chrome116',
    sourcemap: true,
    minify: isProd,
    ...extra,
  };
}

async function main() {
  const startTime = Date.now();

  try {
    // Build background script (ESM — service worker)
    const bgPromise = build(
      baseConfig(join(SRC_DIR, 'background/index.ts'), join(DIST_DIR, 'background.js'), {
        format: 'esm',
      })
    );

    // Build content script (IIFE — injected into pages)
    const contentPromise = build(
      baseConfig(join(SRC_DIR, 'content/index.ts'), join(DIST_DIR, 'content.js'), {
        format: 'iife',
      })
    );

    // Build popup script (IIFE — popup page)
    const popupPromise = build(
      baseConfig(join(SRC_DIR, 'popup/popup.ts'), join(DIST_DIR, 'popup.js'), {
        format: 'iife',
      })
    );

    // Build offscreen script (IIFE — offscreen document)
    const offscreenPromise = build(
      baseConfig(join(SRC_DIR, 'offscreen/offscreen.ts'), join(DIST_DIR, 'offscreen.js'), {
        format: 'iife',
      })
    );

    await Promise.all([bgPromise, contentPromise, popupPromise, offscreenPromise]);

    // Copy static assets
    copyAssets();

    const elapsed = Date.now() - startTime;
    const mode = isProd ? 'production' : 'development';
    console.log(`\n  Extension built (${mode}) in ${elapsed}ms`);
    printSizes();

    if (isWatch) {
      console.log('  Watching for changes...\n');
    }
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

// Watch mode: rebuild on changes
if (isWatch) {
  const ctxs = [];

  async function watchBuild(entryPoint, outfile, extra = {}) {
    const ctx = await context(baseConfig(entryPoint, outfile, extra));
    await ctx.watch();
    ctxs.push(ctx);
  }

  async function watch() {
    const startTime = Date.now();
    try {
      await Promise.all([
        watchBuild(join(SRC_DIR, 'background/index.ts'), join(DIST_DIR, 'background.js'), {
          format: 'esm',
        }),
        watchBuild(join(SRC_DIR, 'content/index.ts'), join(DIST_DIR, 'content.js'), {
          format: 'iife',
        }),
        watchBuild(join(SRC_DIR, 'popup/popup.ts'), join(DIST_DIR, 'popup.js'), {
          format: 'iife',
        }),
        watchBuild(join(SRC_DIR, 'offscreen/offscreen.ts'), join(DIST_DIR, 'offscreen.js'), {
          format: 'iife',
        }),
      ]);

      copyAssets();

      const elapsed = Date.now() - startTime;
      console.log(`\n  Extension built (watch) in ${elapsed}ms`);
      printSizes();
      console.log('  Watching for changes...\n');
    } catch (err) {
      console.error('Initial build failed:', err);
      process.exit(1);
    }
  }

  watch();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n  Stopping watchers...');
    for (const ctx of ctxs) {
      await ctx.dispose();
    }
    process.exit(0);
  });
} else {
  main();
}
