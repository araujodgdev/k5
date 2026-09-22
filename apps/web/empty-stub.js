// Stand-in for modules that cannot exist inside workerd.
//
// @napi-rs/canvas is a native addon: pdfjs-dist and tesseract.js reach for it to rasterise a page
// and recognise it, which is what OCR needs and what a Worker cannot do. Aliasing them here keeps
// the bundle buildable; any code path that genuinely rasterises must run outside Workers, so it
// should fail loudly rather than return a silent empty canvas that makes a blank page look like a
// page with no text.
//
// Loudly means a named export per entry point the application actually calls. A module namespace
// object cannot be a Proxy, so an unexported name reads back as `undefined` and the call site dies
// with "(intermediate value).getDocument is not a function" — the caller sees a bug in Lume instead
// of a step that belongs on the Node worker.
const unavailable = () => {
  throw new Error(
    "Renderização de canvas não está disponível em Cloudflare Workers. " +
    "Esta etapa (OCR/rasterização de PDF) precisa rodar no worker Node.",
  );
};

export const createCanvas = unavailable;
export const loadImage = unavailable;
export const Image = unavailable;
export const Path2D = unavailable;
export const DOMMatrix = unavailable;
// pdfjs-dist: PDF text extraction goes through unpdf's serverless build instead, so reaching this
// one means a caller wanted the rasterising build.
export const getDocument = unavailable;
// tesseract.js
export const createWorker = unavailable;
const canvas = new Proxy({}, { get: unavailable, apply: unavailable });
export default canvas;
