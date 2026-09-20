// Stand-in for modules that cannot exist inside workerd.
//
// @napi-rs/canvas is a native addon: pdfjs-dist reaches for it to rasterise a page, which is what
// OCR needs and what a Worker cannot do. Aliasing it here keeps the bundle buildable; any code
// path that genuinely rasterises must run outside Workers, so it should fail loudly rather than
// return a silent empty canvas that makes a blank page look like a page with no text.
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
const canvas = new Proxy({}, { get: unavailable, apply: unavailable });
export default canvas;
