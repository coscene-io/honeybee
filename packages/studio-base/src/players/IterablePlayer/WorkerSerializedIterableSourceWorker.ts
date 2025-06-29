// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { abortSignalTransferHandler } from "@foxglove/comlink-transfer-handlers";
import { Immutable, MessageEvent } from "@foxglove/studio";

import { ComlinkTransferIteratorCursor } from "./ComlinkTransferIteratorCursor";
import type {
  GetBackfillMessagesArgs,
  IMessageCursor,
  IteratorResult,
  MessageIteratorArgs,
  ISerializedIterableSource,
  Initalization,
} from "./IIterableSource";
import { IteratorCursor } from "./IteratorCursor";

const pickTransferableBuffer = (msg: MessageEvent<Uint8Array>) => msg.message.buffer;

export class WorkerSerializedIterableSourceWorker implements ISerializedIterableSource {
  #source: ISerializedIterableSource;

  public constructor(source: ISerializedIterableSource) {
    this.#source = source;
  }

  public readonly sourceType = "serialized";

  public async initialize(): Promise<Initalization> {
    return await this.#source.initialize();
  }

  public messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> & Comlink.ProxyMarked {
    return Comlink.proxy(this.#source.messageIterator(args));
  }

  public async getBackfillMessages(
    args: Omit<GetBackfillMessagesArgs, "abortSignal">,
    // abortSignal is a separate argument so it can be proxied by comlink since AbortSignal is not
    // clonable (and needs to signal across the worker boundary)
    abortSignal?: AbortSignal,
  ): Promise<MessageEvent<Uint8Array>[]> {
    const messages = await this.#source.getBackfillMessages({
      ...args,
      abortSignal,
    });
    return Comlink.transfer(messages, messages.map(pickTransferableBuffer));
  }

  public getMessageCursor(
    args: Omit<Immutable<MessageIteratorArgs>, "abort">,
    abort?: AbortSignal,
  ): IMessageCursor<Uint8Array> & Comlink.ProxyMarked {
    const iter = this.#source.messageIterator(args);
    const cursor = new ComlinkTransferIteratorCursor(new IteratorCursor<Uint8Array>(iter, abort));
    return Comlink.proxy(cursor);
  }
}

Comlink.transferHandlers.set("abortsignal", abortSignalTransferHandler);
