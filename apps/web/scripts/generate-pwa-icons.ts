/** Regenerate install icons from the existing K5 vector mark. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const image = await loadImage(Buffer.from(source));
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
  context.drawImage(image, inset, inset, size - inset * 2, size - inset * 2);
  await writeFile(new URL(name, output), canvas.toBuffer("image/png"));
}
