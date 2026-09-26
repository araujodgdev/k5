'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Elements that never render in the reader. The frame's sandbox already stops scripts, forms and
 * navigation; removing them as well keeps the markup inert if the sandbox is ever loosened.
 */
const dropped = 'script,noscript,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,base,meta,link,audio,video,source,track,portal,template,foreignObject';
const urlAttributes = ['href', 'src', 'srcset', 'background', 'poster', 'action', 'formaction', 'xlink:href', 'cite', 'longdesc'];
const remoteUrl = /url\(\s*['"]?\s*(?:https?:)?\/\//i;

/** Parses the message with an inert DOMParser and keeps only passive markup and safe links. */
export function sanitizeEmailHtml(html: string, showImages: boolean): { document: string; remote: boolean } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll(dropped).forEach(element => element.remove());
  let remote = false;
  for (const element of parsed.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'http-equiv') { element.removeAttribute(attribute.name); continue; }
      if (name === 'style' && remoteUrl.test(value)) remote = true;
      if (!urlAttributes.includes(name)) continue;
      if (name === 'href') {
        if (/^(https?:|mailto:|tel:)/i.test(value)) continue;
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === 'src' || name === 'srcset' || name === 'background') && /^(https?:)?\/\//i.test(value)) {
        remote = true;
        if (!showImages) element.removeAttribute(attribute.name);
        continue;
      }
      if (name === 'src' && /^data:image\/(png|gif|jpe?g|webp);/i.test(value)) continue;
      element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'A') { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); }
  }
  for (const style of parsed.querySelectorAll('style')) if (remoteUrl.test(style.textContent ?? '')) remote = true;
  const remoteSources = showImages ? ' https:' : '';
  // The frame's own policy: nothing loads except inline styles, embedded images and, once the
  // person allows it, images and fonts over HTTPS.
  const policy = `default-src 'none'; script-src 'none'; img-src data:${remoteSources}; style-src 'unsafe-inline'${remoteSources}; font-src data:${remoteSources}; form-action 'none'; frame-src 'none'`;
  const styles = [...parsed.querySelectorAll('style')].map(style => style.outerHTML).join('');
  parsed.querySelectorAll('style').forEach(style => style.remove());
  return { remote, document: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><base target="_blank">`
    + `<style>html{background:#fff;color:#232323;color-scheme:light}body{margin:0;padding:16px;font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`
    + `${styles}</head><body>${parsed.body.innerHTML}</body></html>` };
}

/**
 * The message as its sender designed it, in a sandboxed frame: no scripts, no forms, links open
 * in a new tab, and remote images stay blocked (they can report that the message was read) until
 * the person asks to see them. The frame grows to its content, so the pane scrolls as one.
 */
export function EmailFrame({ html, title }: { html: string; title: string }) {
  const [showImages, setShowImages] = useState(false);
  const [height, setHeight] = useState(120);
  const frame = useRef<HTMLIFrameElement>(null);
  const { document: source, remote } = useMemo(() => sanitizeEmailHtml(html, showImages), [html, showImages]);

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) setHeight(Math.max(60, Math.ceil(doc.documentElement.scrollHeight)));
  }, []);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | undefined;
    const onLoad = () => {
      measure();
      observer?.disconnect();
      const body = element.contentDocument?.body;
      if (body) { observer = new ResizeObserver(measure); observer.observe(body); }
    };
    element.addEventListener('load', onLoad);
    return () => { element.removeEventListener('load', onLoad); observer?.disconnect(); };
  }, [measure, source]);

  return <div className="mt-5">
    {remote && !showImages && <p className="mb-3 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      Imagens externas bloqueadas para proteger sua privacidade.
      <button type="button" onClick={() => setShowImages(true)} className="font-medium text-foreground underline underline-offset-4 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Mostrar imagens</button>
    </p>}
    {/* allow-same-origin without allow-scripts lets the page measure the frame; nothing inside can run. */}
    <iframe ref={frame} title={title} srcDoc={source} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer" style={{ height }} className="block w-full border-0 bg-white" />
  </div>;
}
