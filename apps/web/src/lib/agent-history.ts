const KEY = 'k5.agent_list_open';
const EVENT = 'k5:agent-list-open';

// Runs in the document head so CSS reserves the saved geometry before the first paint.
export const agentHistoryScript = `try{var h=localStorage.getItem('${KEY}');if(h==='0'||h==='1')document.documentElement.dataset.agentListOpen=h}catch{}`;

export function readListOpen() {
  const saved = document.documentElement.dataset.agentListOpen;
  return saved === '1' || (saved !== '0' && window.matchMedia('(min-width: 768px)').matches);
}

export function subscribeListOpen(onChange: () => void) {
  const media = window.matchMedia('(min-width: 768px)');
  const synchronize = () => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === '0' || saved === '1') document.documentElement.dataset.agentListOpen = saved;
      else delete document.documentElement.dataset.agentListOpen;
    } catch { /* Keep the current in-memory choice when storage is unavailable. */ }
    onChange();
  };
  synchronize();
  window.addEventListener('storage', synchronize);
  window.addEventListener(EVENT, onChange);
  media.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('storage', synchronize);
    window.removeEventListener(EVENT, onChange);
    media.removeEventListener('change', onChange);
  };
}

export function writeListOpen(open: boolean) {
  const value = open ? '1' : '0';
  document.documentElement.dataset.agentListOpen = value;
  try { localStorage.setItem(KEY, value); } catch { /* The control still works without persistence. */ }
  window.dispatchEvent(new Event(EVENT));
}

export function serverListOpen() { return false; }
