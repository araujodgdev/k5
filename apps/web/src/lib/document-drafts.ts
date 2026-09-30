export type DocumentSaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
type Text = { title: string; content: string; version: number };
export type DocumentDraftSnapshot = Text & { state: DocumentSaveState; error: string; snapshotNeeded: boolean };
export type DocumentWrite = Text & { snapshot: boolean };

export class DocumentConflictError extends Error {}

/** Shared by successive editors of the same document, including their in-flight writes. */
export class DocumentDraft {
  private value: DocumentDraftSnapshot | null = null;
  private pending: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();

  getSnapshot = () => this.value;
  isOpen() { return this.listeners.size > 0; }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(value: DocumentDraftSnapshot) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  replace(text: Text) {
    this.publish({ ...text, state: 'saved', error: '', snapshotNeeded: false });
  }

  open(stored: Text) {
    const current = this.value;
    if (!current || current.state === 'saved' || (current.title.trim() === stored.title && current.content === stored.content)) {
      this.replace(stored);
    } else if (current.version !== stored.version) {
      this.publish({ ...current, state: 'conflict', error: 'Este documento mudou em outro lugar. Suas alterações foram preservadas. Escolha qual versão manter.' });
    }
  }

  edit(change: Partial<Pick<Text, 'title' | 'content'>>) {
    if (!this.value) return;
    this.publish({ ...this.value, ...change, snapshotNeeded: true, state: this.value.state === 'conflict' ? 'conflict' : 'dirty' });
  }

  rebase(version: number) {
    if (this.value) this.publish({ ...this.value, version, state: 'dirty', error: '' });
  }

  async waitForSave() {
    while (this.pending) await this.pending;
  }

  async save(write: (input: DocumentWrite) => Promise<{ version: number }>, snapshot: boolean): Promise<boolean> {
    while (this.pending) await this.pending;
    const current = this.value;
    if (!current) return true;
    if (current.state === 'conflict') return false;
    if (current.state === 'saved' && !(snapshot && current.snapshotNeeded)) return true;
    if (current.state === 'error' && !snapshot) return false;
    const sent = { title: current.title.trim() || 'Documento sem título', content: current.content, version: current.version, snapshot };
    this.publish({ ...current, state: 'saving' });
    // Install the lock before calling the writer, including writers that fail synchronously.
    const run = Promise.resolve().then(async () => {
      try {
        const result = await write(sent);
        const latest = this.value ?? current;
        const changed = latest.content !== sent.content || (latest.title.trim() || 'Documento sem título') !== sent.title;
        this.publish({ ...latest, version: result.version, state: changed ? 'dirty' : 'saved', error: '', snapshotNeeded: !snapshot || changed });
        return !changed;
      } catch (cause) {
        this.publish({ ...(this.value ?? current), state: cause instanceof DocumentConflictError ? 'conflict' : 'error',
          error: cause instanceof Error ? cause.message : 'Não foi possível salvar o documento.' });
        return false;
      } finally { this.pending = null; }
    });
    this.pending = run;
    return run;
  }
}

export class DocumentDrafts {
  private documents = new Map<string, DocumentDraft>();
  get(id: string) {
    for (const [otherId, draft] of this.documents) {
      if (otherId !== id && !draft.isOpen() && draft.getSnapshot()?.state === 'saved') this.documents.delete(otherId);
    }
    let draft = this.documents.get(id);
    if (!draft) { draft = new DocumentDraft(); this.documents.set(id, draft); }
    return draft;
  }
  hasUnsaved() {
    return [...this.documents.values()].some(draft => {
      const value = draft.getSnapshot();
      return value !== null && value.state !== 'saved';
    });
  }
  clear() { this.documents.clear(); }
}
