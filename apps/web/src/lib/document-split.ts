// How much of the width the conversation keeps while a document is open beside it. A per-browser
// convenience, like the conversation list: storage may be unavailable and the default still works.
const KEY = 'k5.document_split';
const EVENT = 'k5:document-split';

export const DEFAULT_CHAT_SHARE = 42;
export const MIN_CHAT_SHARE = 25;
export const MAX_CHAT_SHARE = 70;

export const clampChatShare = (value: number) => Math.min(MAX_CHAT_SHARE, Math.max(MIN_CHAT_SHARE, Math.round(value * 10) / 10));

export function readChatShare() {
  try {
    const saved = Number(localStorage.getItem(KEY));
    return saved > 0 ? clampChatShare(saved) : DEFAULT_CHAT_SHARE;
  } catch { return DEFAULT_CHAT_SHARE; }
}

export function subscribeChatShare(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => { window.removeEventListener('storage', onChange); window.removeEventListener(EVENT, onChange); };
}

export function writeChatShare(value: number) {
  try { localStorage.setItem(KEY, String(clampChatShare(value))); } catch { /* The divider still works for this visit. */ }
  window.dispatchEvent(new Event(EVENT));
}

export function serverChatShare() { return DEFAULT_CHAT_SHARE; }
