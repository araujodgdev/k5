export type DocumentSaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
type Text = { title: string; content: string; version: number };
export type DocumentDraftSnapshot = Text & { state: DocumentSaveState; error: string; snapshotNeeded: boolean };
export type DocumentWrite = Text & { snapshot: boolean };
export type DocumentDraftRevision = { generation: number; revision: number };

export class DocumentConflictError extends Error {}
const conflictMessage = 'Este documento mudou em outro lugar. Suas alterações foram preservadas. Escolha qual versão manter.';

/** Shared by successive editors of the same document, including their in-flight writes. */
export class DocumentDraft {
  private value: DocumentDraftSnapshot | null = null;
  private pending: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private revision = 0;
  private invalidated = false;
  private invalidation = new AbortController();

  getSnapshot = () => this.value;
  captureRevision = (): DocumentDraftRevision => ({ generation: this.generation, revision: this.revision });
  isValid = (read: DocumentDraftRevision) => !this.invalidated && read.generation === this.generation;
  isOpen() { return this.listeners.size > 0; }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(value: DocumentDraftSnapshot | null) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  invalidate() {
    this.invalidated = true;
    this.generation++;
    this.invalidation.abort();
    this.publish(null);
  }

  replace(text: Text, read?: DocumentDraftRevision): boolean {
    if (this.invalidated || read && !this.isValid(read)) return false;
    if (read && read.revision !== this.revision) {
      this.conflict();
      return false;
    }
    this.revision++;
    this.publish({ ...text, state: 'saved', error: '', snapshotNeeded: false });
    return true;
  }

  open(stored: Text, read?: DocumentDraftRevision) {
    if (this.invalidated || read && !this.isValid(read)) return;
    if (read && read.revision !== this.revision) { this.replace(stored, read); return; }
    const current = this.value;
    if (!current || current.state === 'saved' || (current.title.trim() === stored.title && current.content === stored.content)) {
      this.replace(stored);
    } else if (current.version !== stored.version) {
      this.conflict();
    }
  }

  conflict() {
    if (this.value) this.publish({ ...this.value, state: 'conflict', error: conflictMessage });
  }

  edit(change: Partial<Pick<Text, 'title' | 'content'>>) {
    if (!this.value) return;
    if ((change.title === undefined || change.title === this.value.title) && (change.content === undefined || change.content === this.value.content)) return;
    this.revision++;
    this.publish({ ...this.value, ...change, snapshotNeeded: true, state: this.value.state === 'conflict' ? 'conflict' : 'dirty' });
  }

  rebase(version: number) {
    if (this.value) this.publish({ ...this.value, version, state: 'dirty', error: '' });
  }

  private waitForResponse(pending: Promise<boolean>): Promise<boolean> {
    if (this.invalidated) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const cancel = () => resolve(false);
      this.invalidation.signal.addEventListener('abort', cancel, { once: true });
      void pending.then(resolve, reject).finally(() => this.invalidation.signal.removeEventListener('abort', cancel));
    });
  }

  async waitForSave() {
    while (this.pending && !this.invalidated) await this.waitForResponse(this.pending);
  }

  async save(write: (input: DocumentWrite) => Promise<{ version: number }>, snapshot: boolean): Promise<boolean> {
    while (this.pending && !this.invalidated) await this.waitForResponse(this.pending);
    const current = this.value;
    if (!current) return true;
    if (current.state === 'conflict') return false;
    if (current.state === 'saved' && !(snapshot && current.snapshotNeeded)) return true;
    if (current.state === 'error' && !snapshot) return false;
    const sent = { title: current.title.trim() || 'Documento sem título', content: current.content, version: current.version, snapshot };
    const generation = this.generation;
    this.publish({ ...current, state: 'saving' });
    // Install the lock before calling the writer, including writers that fail synchronously.
    const run = Promise.resolve().then(async () => {
      try {
        if (this.generation !== generation) return false;
        const result = await write(sent);
        if (this.generation !== generation) return false;
        const latest = this.value ?? current;
        const changed = latest.content !== sent.content || (latest.title.trim() || 'Documento sem título') !== sent.title;
        this.publish({ ...latest, version: result.version, state: latest.state === 'conflict' ? 'conflict' : changed ? 'dirty' : 'saved', error: latest.state === 'conflict' ? latest.error : '', snapshotNeeded: !snapshot || changed });
        return latest.state !== 'conflict' && !changed;
      } catch (cause) {
        if (this.generation !== generation) return false;
        const latest = this.value ?? current;
        this.publish({ ...latest, state: latest.state === 'conflict' || cause instanceof DocumentConflictError ? 'conflict' : 'error',
          error: latest.state === 'conflict' ? latest.error : cause instanceof Error ? cause.message : 'Não foi possível salvar o documento.' });
        return false;
      } finally { this.pending = null; }
    });
    this.pending = run;
    return this.waitForResponse(run);
  }
}

export class DocumentDrafts {
  private documents = new Map<string, DocumentDraft>();
  get(id: string) {
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
  invalidate(id: string) {
    this.documents.get(id)?.invalidate();
    this.documents.delete(id);
  }
  clear() { for (const draft of this.documents.values()) draft.invalidate(); this.documents.clear(); }
}
