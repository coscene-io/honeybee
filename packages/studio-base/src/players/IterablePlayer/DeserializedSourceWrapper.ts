// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "immer";

import { MessageEvent } from "@foxglove/studio";

import {
  IDeserializedIterableSource,
  Initalization,
  MessageIteratorArgs,
  GetBackfillMessagesArgs,
  IteratorResult,
  IIterableSource,
} from "./IIterableSource";

/**
 * Wraps an iterable source to produce a deserialized iterable source.
 */
export class DeserializedSourceWrapper implements IDeserializedIterableSource {
  #source: IIterableSource;

  public readonly sourceType = "deserialized";

  public constructor(source: IIterableSource) {
    this.#source = source;
  }

  public async initialize(): Promise<Initalization> {
    return await this.#source.initialize();
  }
  public messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    return this.#source.messageIterator(args);
  }

  public async getBackfillMessages(
    args: Immutable<GetBackfillMessagesArgs>,
  ): Promise<MessageEvent[]> {
    return await this.#source.getBackfillMessages(args);
  }

  public async terminate(): Promise<void> {
    await this.#source.terminate?.();
  }
}
