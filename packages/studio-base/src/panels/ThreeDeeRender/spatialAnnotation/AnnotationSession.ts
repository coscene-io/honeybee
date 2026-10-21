// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  AnnotationDocument,
  AnnotationService,
  AnnotationSnapshot,
  Revision,
  cloneDocument,
  emptyDocument,
  validateDocument,
} from "./model";

export type SubmitJob = {
  id: string;
  document: AnnotationDocument;
  status: "queued" | "submitting" | "succeeded" | "failed";
  error?: string;
};
type SessionState = {
  document: AnnotationDocument;
  saved: AnnotationSnapshot;
  history: Revision[];
  jobs: SubmitJob[];
  ready: boolean;
  busy: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error?: string;
};

/** UI-independent editing state, with one serialized writer per scope. */
export class AnnotationSession {
  #service: AnnotationService;
  #scope: string;
  #listeners = new Set<() => void>();
  #undo: AnnotationDocument[] = [];
  #redo: AnnotationDocument[] = [];
  #processing = false;
  #loading: Promise<void> | undefined;
  #state: SessionState = {
    document: emptyDocument(),
    saved: { revision: 0, document: emptyDocument(), message: "Initial version" },
    history: [],
    jobs: [],
    ready: false,
    busy: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
  };

  public constructor(service: AnnotationService, scope: string) {
    this.#service = service;
    this.#scope = scope;
  }

  public getSnapshot = (): SessionState => this.#state;
  public subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #update(patch: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#state.dirty =
      JSON.stringify(this.#state.document) !== JSON.stringify(this.#state.saved.document);
    this.#state.canUndo = this.#undo.length > 0;
    this.#state.canRedo = this.#redo.length > 0;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  public async load(): Promise<void> {
    this.#loading ??= this.#load();
    await this.#loading;
  }

  async #load(): Promise<void> {
    try {
      const [saved, history] = await Promise.all([
        this.#service.read(this.#scope),
        this.#service.history(this.#scope),
      ]);
      this.#update({ saved, document: saved.document, history, ready: true, error: undefined });
    } catch (error) {
      this.#loading = undefined;
      this.#update({ error: String(error) });
    }
  }

  public edit(change: (document: AnnotationDocument) => void): void {
    if (!this.#state.ready || this.#state.busy) {
      return;
    }
    const document = cloneDocument(this.#state.document);
    change(document);
    validateDocument(document);
    if (JSON.stringify(document) === JSON.stringify(this.#state.document)) {
      return;
    }
    this.#undo.push(this.#state.document);
    // Bounded for the prototype; production should use per-frame patches.
    if (this.#undo.length > 100) {
      this.#undo.shift();
    }
    this.#redo = [];
    this.#update({ document, error: undefined });
  }

  public undo(): void {
    if (this.#state.busy) {
      return;
    }
    const document = this.#undo.pop();
    if (document != undefined) {
      this.#redo.push(this.#state.document);
      this.#update({ document });
    }
  }

  public redo(): void {
    if (this.#state.busy) {
      return;
    }
    const document = this.#redo.pop();
    if (document != undefined) {
      this.#undo.push(this.#state.document);
      this.#update({ document });
    }
  }

  public submit(): void {
    if (!this.#state.ready || this.#state.busy || !this.#state.dirty) {
      return;
    }
    const document = cloneDocument(this.#state.document);
    const previous = this.#state.jobs.at(-1);
    if (
      previous != undefined &&
      (previous.status === "queued" || previous.status === "submitting") &&
      JSON.stringify(previous.document) === JSON.stringify(document)
    ) {
      return;
    }
    this.#update({
      jobs: [...this.#state.jobs, { id: crypto.randomUUID(), document, status: "queued" }],
    });
    void this.#drain();
  }

  async #drain(): Promise<void> {
    if (this.#processing || this.#state.jobs.some((job) => job.status === "failed")) {
      return;
    }
    this.#processing = true;
    try {
      let job = this.#state.jobs.find((item) => item.status === "queued");
      while (job != undefined) {
        this.#job(job.id, { status: "submitting", error: undefined });
        try {
          const saved = await this.#service.commit({
            scope: this.#scope,
            expectedRevision: this.#state.saved.revision,
            requestId: job.id,
            document: job.document,
            message: `Submit ${Object.keys(job.document.frames).length} annotated frames`,
          });
          this.#job(job.id, { status: "succeeded" });
          // Never overwrite newer edits made while this immutable snapshot was in flight.
          this.#update({
            saved,
            history: [...this.#state.history, { revision: saved.revision, message: saved.message }],
            error: undefined,
          });
        } catch (error) {
          this.#job(job.id, { status: "failed", error: String(error) });
          this.#update({ error: String(error) });
          break;
        }
        job = this.#state.jobs.find((item) => item.status === "queued");
      }
    } finally {
      this.#processing = false;
    }
  }

  #job(id: string, patch: Partial<SubmitJob>): void {
    this.#update({
      jobs: this.#state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    });
  }

  public retry(): void {
    const failed = this.#state.jobs.find((job) => job.status === "failed");
    if (failed == undefined) {
      return;
    }
    this.#job(failed.id, { status: "queued", error: undefined });
    void this.#drain();
  }

  /** Explicit discard/reload, never an implicit consequence of a conflict. */
  public async discard(): Promise<void> {
    if (this.#processing || this.#state.busy) {
      return;
    }
    this.#update({ busy: true });
    try {
      const [saved, history] = await Promise.all([
        this.#service.read(this.#scope),
        this.#service.history(this.#scope),
      ]);
      this.#undo = [];
      this.#redo = [];
      this.#update({ saved, document: saved.document, history, jobs: [], error: undefined });
    } catch (error) {
      this.#update({ error: String(error) });
    } finally {
      this.#update({ busy: false });
    }
  }

  public async rollback(targetRevision: number): Promise<void> {
    if (
      this.#processing ||
      this.#state.busy ||
      this.#state.dirty ||
      this.#state.jobs.some((job) => job.status !== "succeeded")
    ) {
      return;
    }
    this.#update({ busy: true });
    try {
      const saved = await this.#service.rollback({
        scope: this.#scope,
        expectedRevision: this.#state.saved.revision,
        requestId: crypto.randomUUID(),
        targetRevision,
      });
      this.#undo = [];
      this.#redo = [];
      this.#update({
        saved,
        document: saved.document,
        history: [...this.#state.history, { revision: saved.revision, message: saved.message }],
        error: undefined,
      });
    } catch (error) {
      this.#update({ error: String(error) });
    } finally {
      this.#update({ busy: false });
    }
  }
}
