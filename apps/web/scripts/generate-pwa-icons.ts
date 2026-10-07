/** Regenerate Lume install icons and favicon from the supplied transparent mark. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const mark = await loadImage(await readFile(new URL('../public/lume-mark.png', import.meta.url)));
const imageAt = (size: number) => {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.fillStyle = '#1b1b1a';
  context.beginPath();
  context.roundRect(0, 0, size, size, size * 15 / 64);
  context.fill();
  const symbol = createCanvas(size, size);
  const ink = symbol.getContext('2d');
  ink.drawImage(mark, 221, 216, 818, 818, size * 14 / 64, size * 14 / 64, size * 36 / 64, size * 36 / 64);
  ink.globalCompositeOperation = 'source-in';
  ink.fillStyle = '#fff';
  ink.fillRect(0, 0, size, size);
  context.drawImage(symbol, 0, 0);
  return canvas;
};
const output = new URL("../public/icons/", import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, size, inset] of [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["maskable-512.png", 512, 64],
  ["apple-touch-icon.png", 180, 0],
] as const) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = "#1b1b1a";
  context.fillRect(0, 0, size, size);
  context.drawImage(imageAt(size - inset * 2), inset, inset, size - inset * 2, size - inset * 2);
  await writeFile(new URL(name, output), canvas.toBuffer("image/png"));
}

// ICO accepts an embedded PNG image. Keeping this generated from the mark prevents an old
// favicon from surviving a brand update because browsers prefer /favicon.ico aggressively.
const faviconCanvas = createCanvas(64, 64);
faviconCanvas.getContext("2d").drawImage(imageAt(64), 0, 0, 64, 64);
const png = faviconCanvas.toBuffer("image/png");
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(64, 6);
header.writeUInt8(64, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);
await writeFile(new URL("../src/app/favicon.ico", import.meta.url), Buffer.concat([header, png]));
