// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  AnnotationService,
  AnnotationSnapshot,
  Revision,
  emptyDocument,
  validateDocument,
} from "./model";

export class AnnotationConflict extends Error {
  public constructor(public readonly actualRevision: number) {
    super(
      `Revision conflict: server is at r${actualRevision}. Drafts and queued snapshots are preserved.`,
    );
  }
}

/** In-memory fake server: isolated by source/topic, CAS writes, idempotent retries, immutable history. */
export class MockAnnotationService implements AnnotationService {
  #records = new Map<string, AnnotationSnapshot[]>();
  #receipts = new Map<string, { request: string; snapshot: AnnotationSnapshot }>();
  #delayMs: number;
  public failNextWrite = false;

  public constructor(delayMs = 300) {
    this.#delayMs = delayMs;
  }

  #versions(scope: string): AnnotationSnapshot[] {
    let versions = this.#records.get(scope);
    if (versions == undefined) {
      versions = [{ revision: 0, document: emptyDocument(), message: "Initial version" }];
      this.#records.set(scope, versions);
    }
    return versions;
  }

  public async read(scope: string): Promise<AnnotationSnapshot> {
    return structuredClone(this.#versions(scope).at(-1)!);
  }

  public async history(scope: string): Promise<Revision[]> {
    return this.#versions(scope).map(({ revision, message }) => ({ revision, message }));
  }

  async #write(
    request:
      | Parameters<AnnotationService["commit"]>[0]
      | Parameters<AnnotationService["rollback"]>[0],
  ): Promise<AnnotationSnapshot> {
    // Capture before waiting, just as an HTTP request serializes its payload before transmission.
    const captured = structuredClone(request);
    await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
    const receiptKey = JSON.stringify([captured.scope, captured.requestId])!;
    const fingerprint = JSON.stringify(captured)!;
    const receipt = this.#receipts.get(receiptKey);
    if (receipt != undefined) {
      if (receipt.request !== fingerprint) {
        throw new Error("Request ID reused with a different payload");
      }
      return structuredClone(receipt.snapshot);
    }
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("Simulated service failure. Drafts and queued snapshots are preserved.");
    }
    const versions = this.#versions(captured.scope);
    const head = versions.at(-1)!;
    if (captured.expectedRevision !== head.revision) {
      throw new AnnotationConflict(head.revision);
    }
    const target =
      "targetRevision" in captured
        ? versions.find((item) => item.revision === captured.targetRevision)
        : undefined;
    if ("targetRevision" in captured && target == undefined) {
      throw new Error("Unknown rollback revision");
    }
    const document = "document" in captured ? captured.document : target!.document;
    validateDocument(document);
    const snapshot: AnnotationSnapshot = {
      revision: head.revision + 1,
      document: structuredClone(document),
      message: "message" in captured ? captured.message : `Restore r${captured.targetRevision}`,
    };
    versions.push(snapshot);
    this.#receipts.set(receiptKey, { request: fingerprint, snapshot });
    return structuredClone(snapshot);
  }

  public async commit(
    request: Parameters<AnnotationService["commit"]>[0],
  ): Promise<AnnotationSnapshot> {
    return await this.#write(request);
  }

  public async rollback(
    request: Parameters<AnnotationService["rollback"]>[0],
  ): Promise<AnnotationSnapshot> {
    return await this.#write(request);
  }
}

/** Deliberately session-local; a future remote adapter replaces this without changing editor code. */
export const mockAnnotationService = new MockAnnotationService();
