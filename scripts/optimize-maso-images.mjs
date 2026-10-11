import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

// Keep the source artwork untouched. The SVGs wrap the same PNG in href and
// xlink:href; extracting it avoids decoding their multi-megabyte XML at runtime.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "public", "maso", "phases-50");
const targetDirectory = path.join(root, "public", "maso", "optimized");
await mkdir(targetDirectory, { recursive: true });

const images = [];
for (let phase = 1; phase <= 50; phase += 1) {
  const name = `phase-${String(phase).padStart(2, "0")}`;
  const source = await readFile(path.join(sourceDirectory, `${name}.svg`), "utf8");
  const embeddedImages = [...source.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  const payloads = [...new Set(embeddedImages.map((match) => match[1]))];
  if (payloads.length !== 1) {
    throw new Error(`${name}: expected one PNG artwork, got ${payloads.length}`);
  }

  const png = Buffer.from(payloads[0], "base64");
  const metadata = await sharp(png).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1536 || !metadata.hasAlpha) {
    throw new Error(`${name}: unexpected artwork dimensions or missing transparency`);
  }

  // Home renders at most 310 CSS px. 640 px retains detail on 2x displays.
  const webp = await sharp(png)
    .resize({ width: 640, withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toBuffer();
  await writeFile(path.join(targetDirectory, `${name}.webp`), webp);
  images.push({ phase, sourceBytes: Buffer.byteLength(source), webpBytes: webp.length });
}

console.log(JSON.stringify({
  width: 640,
  height: 960,
  images,
  sourceBytes: images.reduce((sum, image) => sum + image.sourceBytes, 0),
  webpBytes: images.reduce((sum, image) => sum + image.webpBytes, 0),
}, null, 2));
