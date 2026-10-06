#!/usr/bin/env node
/**
 * Re-renders the tool icons (public/assets/icons/tool-<id>.png, plus tool-<id>-v<n>.png per extra model)
 * from the in-game models via src/render/IconStudio.ts. Icons follow their model's licence.
 *
 * Needs a running dev server:  PORT=5203 npm run dev   then   PORT=5203 node scripts/render-icons.mjs [--size 128] [--only pond,reeds]
 * `--only` writes just those tools' icons (and their variant icons); a full run nudges unchanged icons by a few pixels.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5188);
const sizeArg = process.argv.indexOf('--size');
const size = sizeArg >= 0 ? Number(process.argv[sizeArg + 1]) : 128;
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
const wanted = (iconPath) => !only || only.has(iconPath.match(/tool-(.+?)(?:-v\d+)?\.png$/)?.[1]);
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
    if (!wanted(iconPath)) continue;
    const file = path.join(root, 'public', iconPath.replace(/^\//, ''));
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`wrote ${path.relative(root, file)} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
