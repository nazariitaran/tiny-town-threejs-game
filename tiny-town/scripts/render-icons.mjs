#!/usr/bin/env node
/**
 * Re-render the dock/tool icons (public/assets/icons/tool-<id>.png) from the real in-game models and
 * materials (src/render/IconStudio.ts: ModelLibrary + TownRenderer, MODEL_STYLES, warmed atlas,
 * procedural walkway/lawn). Owned by WP-03. Icons follow their model's licence: CC0, except the church, swing and
 * barbecue icons, which show CC-BY 3.0 Poly Pizza models (docs/assets/CREDITS.md).
 *
 * Needs a running dev server:  PORT=5203 npm run dev   then   PORT=5203 node scripts/render-icons.mjs [--size 128]
 * Only the icons referenced by catalog/tools.ts are written; other icons are left untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5188);
const sizeArg = process.argv.indexOf('--size');
const size = sizeArg >= 0 ? Number(process.argv[sizeArg + 1]) : 128;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'networkidle' });
  const icons = await page.evaluate(async (size) => {
    const studio = await import('/src/render/IconStudio.ts');
    return studio.renderToolIcons(size);
  }, size);
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  for (const [iconPath, dataUrl] of Object.entries(icons)) {
    const file = path.join(root, 'public', iconPath.replace(/^\//, ''));
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote ${path.relative(root, file)} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
