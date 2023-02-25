// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "comlink";

import { abortSignalTransferHandler } from "@foxglove/comlink-transfer-handlers";
import { MessageEvent, Time } from "@foxglove/studio";

import type {
  GetBackfillMessagesArgs,
  IIterableSource,
  IMessageCursor,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";
import { IteratorCursor } from "./IteratorCursor";

export class WorkerIterableSourceWorker implements IIterableSource {
  initialize(): Promise<Initalization> {
    throw new Error("Method not implemented.");
  }
  messageIterator(args: MessageIteratorArgs): AsyncIterableIterator<Readonly<IteratorResult>> {
    throw new Error("Method not implemented.");
  }
  getBackfillMessages(args: GetBackfillMessagesArgs): Promise<Readonly<{ topic: string; schemaName: string; receiveTime: Time; publishTime?: Time | undefined; message: unknown; sizeInBytes: number; originalMessageEvent?: Readonly<any> | undefined; }>[]> {
    throw new Error("Method not implemented.");
  }
  getMessageCursor?: ((args: MessageIteratorArgs & { abort?: AbortSignal | undefined; }) => IMessageCursor) | undefined;
  terminate?: (() => Promise<void>) | undefined;
  protected _source: IIterableSource;

const RegisteredSourceModuleLoaders: Record<string, SourceFn> = {
  mcap: async () => await import("./Mcap/McapIterableSource"),
  rosbag: async () => await import("./BagIterableSource"),
  rosdb3: async () => await import("./rosdb3/RosDb3IterableSource"),
  ulog: async () => await import("./ulog/UlogIterableSource"),
  foxgloveDataPlatform: async () =>
    await import("./coScene-data-platform/DataPlatformIterableSource"),
};

export type WorkerIterableSourceWorkerArgs = {
  sourceType: string;
  initArgs: IterableSourceInitializeArgs;
};

export class WorkerIterableSourceWorker {
  private readonly _args: WorkerIterableSourceWorkerArgs;

  private _source?: IIterableSource;

  public constructor(args: WorkerIterableSourceWorkerArgs) {
    this._args = args;
  }

  public async initialize(): Promise<Initalization> {
    return await this._source.initialize();
  }

  public messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> & Comlink.ProxyMarked {
    return Comlink.proxy(this._source.messageIterator(args));
  }

  public async getBackfillMessages(
    args: Omit<GetBackfillMessagesArgs, "abortSignal">,
    // abortSignal is a separate argument so it can be proxied by comlink since AbortSignal is not
    // clonable (and needs to signal across the worker boundary)
    abortSignal?: AbortSignal,
  ): Promise<MessageEvent<unknown>[]> {
    return await this._source.getBackfillMessages({
      ...args,
      abortSignal,
    });
  }

  public getMessageCursor(
    args: Omit<MessageIteratorArgs, "abort">,
    abort?: AbortSignal,
  ): IMessageCursor & Comlink.ProxyMarked {
    const iter = this._source.messageIterator(args);
    const cursor = new IteratorCursor(iter, abort);
    return Comlink.proxy(cursor);
  }
}

Comlink.transferHandlers.set("abortsignal", abortSignalTransferHandler);
