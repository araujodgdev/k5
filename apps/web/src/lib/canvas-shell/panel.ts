import type { PanelState } from '@/components/shell/shell-context';

const KEY = 'lume:panel';
const EVENT = 'lume:panel';
const DESKTOP = '(min-width: 768px)';

/**
 * Runs in the document head, so the Lume paints in its place before the first frame. On a computer
 * the panel keeps the person's last choice. On a phone the Lume comes first, unless the address
 * already points at a view (a notification, a shared link), which opens over it.
 */
export const panelScript = `try{var d=document.documentElement,p=location.pathname;if(matchMedia('${DESKTOP}').matches?localStorage.getItem('${KEY}')==='collapsed':!/^\\/app(\\/command-center|\\/agents)?\\/?$/.test(p))d.dataset.lumePanel='collapsed'}catch(e){}`;

export function readPanel(): PanelState {
  return document.documentElement.dataset.lumePanel === 'collapsed' ? 'collapsed' : 'open';
}

export function subscribePanel(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function writePanel(state: PanelState) {
  if (state === 'collapsed') document.documentElement.dataset.lumePanel = 'collapsed';
  else delete document.documentElement.dataset.lumePanel;
  // A phone's choice lasts for the visit; the computer's choice is remembered.
  if (matchMedia(DESKTOP).matches) {
    try { localStorage.setItem(KEY, state); } catch { /* Works without persistence. */ }
  }
  window.dispatchEvent(new Event(EVENT));
}
