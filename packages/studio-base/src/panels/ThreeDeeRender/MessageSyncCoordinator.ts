// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AVLTree } from "@foxglove/avl";
import { Time, compare, isLessThan } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";

import { MessageSyncResult } from "./IRenderer";

const MAX_TIMESTAMP_BUCKETS = 250;

/** Collects exact-timestamp message sets for the topics selected for 3D synchronization. */
export class MessageSyncCoordinator {
  readonly #tree = new AVLTree<Time, Map<string, MessageEvent>>(compare);
  #topics = new Set<string>();
  readonly #lastTimestampByTopic = new Map<string, Time>();
  readonly #topicsAwaitingEpochTransition = new Set<string>();
  readonly #topicsInCurrentEpoch = new Set<string>();
  #epochTransitionActive = false;
  #regressionCount = 0;

  public setRegistrations(topics: ReadonlySet<string>): boolean {
    if (setsEqual(this.#topics, topics)) {
      return false;
    }
    this.#topics = new Set(topics);
    this.clear();
    return true;
  }

  public isRegistered(topic: string): boolean {
    return this.#topics.has(topic);
  }

  public push(timestamp: Time, messageEvent: MessageEvent): void {
    if (!this.#topics.has(messageEvent.topic)) {
      return;
    }

    const previousTimestamp = this.#lastTimestampByTopic.get(messageEvent.topic);
    if (this.#topicsAwaitingEpochTransition.has(messageEvent.topic)) {
      if (previousTimestamp != undefined && !isLessThan(timestamp, previousTimestamp)) {
        return;
      }
      this.#topicsAwaitingEpochTransition.delete(messageEvent.topic);
      this.#topicsInCurrentEpoch.add(messageEvent.topic);
    } else if (previousTimestamp != undefined && isLessThan(timestamp, previousTimestamp)) {
      if (this.#epochTransitionActive) {
        // A topic can emit more than one decreasing old-epoch packet before it reaches the new
        // epoch. Replace that topic's provisional transition data without discarding topics that
        // have already crossed the boundary.
        this.#removeTopicMessages(messageEvent.topic);
        this.#topicsInCurrentEpoch.add(messageEvent.topic);
      } else {
        this.#startEpochTransition(messageEvent.topic);
      }
    }
    this.#lastTimestampByTopic.set(messageEvent.topic, timestamp);

    let messages = this.#tree.get(timestamp);
    if (messages == undefined) {
      messages = new Map();
      this.#tree.set(timestamp, messages);
    }
    messages.set(messageEvent.topic, messageEvent);

    while (this.#tree.size > MAX_TIMESTAMP_BUCKETS) {
      this.#tree.shift();
    }
  }

  public resolve(): MessageSyncResult | undefined {
    if (this.#topics.size === 0) {
      return undefined;
    }

    let newestEntry: [Time, Map<string, MessageEvent>] | undefined;
    let latestCompleteEntry: [Time, Map<string, MessageEvent>] | undefined;
    for (const entry of this.#tree.entries()) {
      newestEntry = entry;
      if (containsAllTopics(entry[1], this.#topics)) {
        latestCompleteEntry = entry;
      }
    }

    if (latestCompleteEntry != undefined) {
      this.#epochTransitionActive = false;
      this.#topicsAwaitingEpochTransition.clear();
      this.#topicsInCurrentEpoch.clear();

      let minKey = this.#tree.minKey();
      while (minKey != undefined && isLessThan(minKey, latestCompleteEntry[0])) {
        this.#tree.shift();
        minKey = this.#tree.minKey();
      }

      const newestMessages = newestEntry?.[1];
      const waiting =
        newestEntry != undefined &&
        isLessThan(latestCompleteEntry[0], newestEntry[0]) &&
        !containsAllTopics(newestEntry[1], this.#topics)
          ? {
              timestamp: newestEntry[0],
              presentTopics: Array.from(newestMessages?.keys() ?? []),
              missingTopics: Array.from(this.#topics).filter(
                (topic) => newestMessages?.has(topic) !== true,
              ),
            }
          : undefined;
      return {
        found: true,
        timestamp: latestCompleteEntry[0],
        messages: new Map(latestCompleteEntry[1]),
        ...(waiting != undefined ? { waiting } : {}),
      };
    }

    const messages = newestEntry?.[1];
    const presentTopics = messages != undefined ? Array.from(messages.keys()) : [];
    const missingTopics = Array.from(this.#topics).filter((topic) => messages?.has(topic) !== true);
    return { found: false, presentTopics, missingTopics };
  }

  public clear(): void {
    this.#tree.clear();
    this.#lastTimestampByTopic.clear();
    this.#topicsAwaitingEpochTransition.clear();
    this.#topicsInCurrentEpoch.clear();
    this.#epochTransitionActive = false;
  }

  public regressionCount(): number {
    return this.#regressionCount;
  }

  #startEpochTransition(topic: string): void {
    this.#tree.clear();
    this.#topicsAwaitingEpochTransition.clear();
    this.#topicsInCurrentEpoch.clear();
    this.#topicsInCurrentEpoch.add(topic);
    this.#epochTransitionActive = true;
    for (const registeredTopic of this.#topics) {
      if (registeredTopic !== topic && this.#lastTimestampByTopic.has(registeredTopic)) {
        this.#topicsAwaitingEpochTransition.add(registeredTopic);
      }
    }
    this.#regressionCount++;
  }

  #removeTopicMessages(topic: string): void {
    const emptyTimestamps: Time[] = [];
    for (const [timestamp, messages] of this.#tree.entries()) {
      messages.delete(topic);
      if (messages.size === 0) {
        emptyTimestamps.push(timestamp);
      }
    }
    for (const timestamp of emptyTimestamps) {
      this.#tree.delete(timestamp);
    }
  }
}

function containsAllTopics(
  messages: ReadonlyMap<string, MessageEvent>,
  topics: ReadonlySet<string>,
): boolean {
  for (const topic of topics) {
    if (!messages.has(topic)) {
      return false;
    }
  }
  return true;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
