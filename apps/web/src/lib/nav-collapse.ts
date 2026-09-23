const KEY = 'k5.nav_collapsed';
const EVENT = 'k5:nav-collapsed';

// Runs in the document head with the chat-list script, so the menu paints at its saved width.
export const navCollapseScript = `try{if(localStorage.getItem('${KEY}')==='1')document.documentElement.dataset.nav='collapsed'}catch{}`;

export function readNavCollapsed() { return document.documentElement.dataset.nav === 'collapsed'; }

export function subscribeNavCollapsed(onChange: () => void) {
  const synchronize = () => {
    try {
      if (localStorage.getItem(KEY) === '1') document.documentElement.dataset.nav = 'collapsed';
      else delete document.documentElement.dataset.nav;
    } catch { /* Keep the in-memory choice when storage is unavailable. */ }
    onChange();
  };
  window.addEventListener('storage', synchronize);
  window.addEventListener(EVENT, onChange);
  return () => { window.removeEventListener('storage', synchronize); window.removeEventListener(EVENT, onChange); };
}

export function writeNavCollapsed(collapsed: boolean) {
  if (collapsed) document.documentElement.dataset.nav = 'collapsed';
  else delete document.documentElement.dataset.nav;
  try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* Works without persistence. */ }
  window.dispatchEvent(new Event(EVENT));
}
