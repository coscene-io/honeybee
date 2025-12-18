// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "immer";

import { pickFields } from "@foxglove/den/records";
import { MessageEvent } from "@foxglove/studio";
import { estimateObjectSize } from "@foxglove/studio-base/players/messageMemoryEstimation";

import {
  IDeserializedIterableSource,
  Initalization,
  MessageIteratorArgs,
  GetBackfillMessagesArgs,
  IteratorResult,
  IIterableSource,
} from "./IIterableSource";

// Local type for subscription with hash, using readonly fields to match Immutable<TopicSelection>
type SubscriptionWithHash = {
  readonly topic: string;
  readonly fields?: readonly string[];
  readonly subscriptionHash: string;
};

// Computes the subscription hash for a given topic & subscription payload pair.
// In the simplest case, when there are no message slicing fields, the subscription hash is just
// the topic name. If there are slicing fields, the hash is computed as the topic name appended
// by "+" separated message slicing fields.
function computeSubscriptionHash(topic: string, fields?: readonly string[]): string {
  return fields ? topic + "+" + fields.join("+") : topic;
}

/**
 * Wraps an iterable source to produce a deserialized iterable source.
 * Supports field slicing via the `fields` parameter in subscriptions.
 */
export class DeserializedSourceWrapper implements IDeserializedIterableSource {
  #source: IIterableSource;
  #messageSizeEstimateBySubHash: Record<string, number> = {};

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
    // Compute the unique subscription hash for every topic + subscription payload pair which will
    // be used to lookup message size estimates. This is done here to avoid having to compute the
    // subscription hash for every new message event.
    const subscribePayloadWithHashByTopic = new Map<string, SubscriptionWithHash>(
      Array.from(args.topics, ([topic, subscribePayload]) => [
        topic,
        {
          topic: subscribePayload.topic,
          fields: subscribePayload.fields,
          subscriptionHash: computeSubscriptionHash(topic, subscribePayload.fields),
        },
      ]),
    );

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const rawIterator = self.#source.messageIterator(args);

    return (async function* slicedIterableGenerator() {
      try {
        for await (const iterResult of rawIterator) {
          if (iterResult.type !== "message-event") {
            yield iterResult;
            continue;
          }

          const subscription = subscribePayloadWithHashByTopic.get(iterResult.msgEvent.topic);
          if (!subscription) {
            // If no subscription found, yield the original message
            yield iterResult;
            continue;
          }

          const slicedMsgEvent = self.#sliceMessage(iterResult.msgEvent, subscription);
          yield {
            type: iterResult.type,
            msgEvent: slicedMsgEvent,
          };
        }
      } finally {
        await rawIterator.return?.();
      }
    })();
  }

  public async getBackfillMessages(
    args: Immutable<GetBackfillMessagesArgs>,
  ): Promise<MessageEvent[]> {
    // Compute the unique subscription hash for every topic + subscription payload pair which will
    // be used to lookup message size estimates. This is done here to avoid having to compute the
    // subscription hash for every new message event.
    const subscribePayloadWithHashByTopic = new Map<string, SubscriptionWithHash>(
      Array.from(args.topics, ([topic, subscribePayload]) => [
        topic,
        {
          topic: subscribePayload.topic,
          fields: subscribePayload.fields,
          subscriptionHash: computeSubscriptionHash(topic, subscribePayload.fields),
        },
      ]),
    );

    const rawMessages = await this.#source.getBackfillMessages(args);
    const slicedMsgs: MessageEvent[] = [];

    for (const rawMsg of rawMessages) {
      const subscription = subscribePayloadWithHashByTopic.get(rawMsg.topic);
      if (!subscription) {
        // If no subscription found, keep the original message
        slicedMsgs.push(rawMsg);
        continue;
      }
      slicedMsgs.push(this.#sliceMessage(rawMsg, subscription));
    }

    return slicedMsgs;
  }

  public async terminate(): Promise<void> {
    await this.#source.terminate?.();
  }

  #sliceMessage(msgEvent: MessageEvent, subscription: SubscriptionWithHash): MessageEvent {
    const message = msgEvent.message as Record<string, unknown>;

    // Apply field slicing if fields are specified
    const slicedMessage = subscription.fields
      ? pickFields(message, subscription.fields as string[])
      : message;

    // Lookup the size estimate for this subscription hash or compute it if not found in the cache.
    let msgSizeEstimate = this.#messageSizeEstimateBySubHash[subscription.subscriptionHash];
    if (msgSizeEstimate == undefined) {
      msgSizeEstimate = estimateObjectSize(slicedMessage);
      this.#messageSizeEstimateBySubHash[subscription.subscriptionHash] = msgSizeEstimate;
    }

    // For sliced messages we use the estimated message size whereas for non-sliced messages
    // take whatever size is bigger.
    const sizeInBytes = subscription.fields
      ? msgSizeEstimate
      : Math.max(msgEvent.sizeInBytes, msgSizeEstimate);

    return {
      ...msgEvent,
      message: slicedMessage,
      sizeInBytes,
    };
  }
}
