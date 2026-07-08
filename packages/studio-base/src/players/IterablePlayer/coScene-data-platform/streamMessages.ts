// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapStreamReader, McapTypes } from "@mcap/core";
import { captureException } from "@sentry/core";
import * as _ from "lodash-es";

import Logger from "@foxglove/log";
import { loadDecompressHandlers, parseChannel, ParsedChannel } from "@foxglove/mcap-support";
import { fromNanoSec, Time, toMillis } from "@foxglove/rostime";
import CoSceneConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

import { IteratorResult } from "../IIterableSource";

const log = Logger.getLogger(__filename);

/**
 * Information necessary to match a Channel & Schema record in the MCAP data to one that we received
 * from the /topics endpoint.
 */
export type ParsedChannelAndEncodings = {
  messageEncoding: string;
  schemaEncoding: string;
  schema: Uint8Array;
  parsedChannel: ParsedChannel;
};

/**
 * Parameters for stream requests
 */
export type StreamParams = {
  start: Time;
  end: Time;
  id: string;
  projectName?: string;
  replayPolicy?: "lastPerChannel" | "";
  replayLookbackSeconds?: number;
  topics: string[];
  fetchCompleteTopicState?: "complete" | "incremental";
};

/**
 * The console api methods used by streamMessages. This scopes the required interface to a small
 * subset of CoSceneConsoleApi to make it easier to mock/stub for tests.
 */
interface StreamMessageApi {
  getStreams: CoSceneConsoleApi["getStreams"];
}

export async function* streamMessages({
  api,
  signal,
  parsedChannelsByTopic,
  params,
}: {
  api: StreamMessageApi;
  /**
   * An AbortSignal allowing the stream request to be canceled. When the signal is aborted, the
   * function may return successfully (possibly after yielding any remaining messages), or it may
   * raise an AbortError.
   */
  signal?: AbortSignal;

  params: StreamParams;

  /**
   * Message readers are initialized out of band so we can parse message definitions only once.
   *
   * NOTE: If we encounter a channel/schema pair that is not pre-initialized, we will add it to
   * parsedChannelsByTopic (thus mutating parsedChannelsByTopic).
   */
  parsedChannelsByTopic: Map<string, ParsedChannelAndEncodings[]>;
}): AsyncGenerator<IteratorResult[]> {
  if (signal?.aborted === true) {
    return;
  }

  // Local connection ID management for this streaming session
  const connectionIdByTopic: Record<string, number> = {};
  let nextConnectionId = 0;

  const controller = new AbortController();
  const abortHandler = () => {
    log.debug("Manual abort of streamMessages", params);
    controller.abort();
  };
  let abortHandlerInstalled = false;
  const removeAbortHandler = () => {
    if (abortHandlerInstalled) {
      signal?.removeEventListener("abort", abortHandler);
      abortHandlerInstalled = false;
    }
  };
  if (signal != undefined) {
    signal.addEventListener("abort", abortHandler);
    abortHandlerInstalled = true;
  }

  let decompressHandlers: Awaited<ReturnType<typeof loadDecompressHandlers>>;
  let decompressHandlersLoaded = false;
  try {
    decompressHandlers = await loadDecompressHandlers();
    decompressHandlersLoaded = true;
  } finally {
    if (!decompressHandlersLoaded || controller.signal.aborted) {
      removeAbortHandler();
    }
  }

  try {
    log.debug("streamMessages", params);
    const startTimer = performance.now();

    if (controller.signal.aborted) {
      return;
    }

    let totalMessages = 0;
    let results: IteratorResult[] = [];

    const MAX_BATCH_SIZE = 128;
    const MAX_BATCH_TIME_MS = 16;
    const YIELD_TIME_CHECK_RECORDS = 32;
    let lastYieldTime = performance.now();
    let recordsSinceYieldCheck = 0;

    const schemasById = new Map<number, McapTypes.TypedMcapRecords["Schema"]>();
    const channelInfoById = new Map<
      number,
      {
        channel: McapTypes.TypedMcapRecords["Channel"];
        parsedChannel: ParsedChannel;
        schemaName: string;
      }
    >();

    function processRecord(record: McapTypes.TypedMcapRecord) {
      switch (record.type) {
        default:
          return;

        case "Schema":
          schemasById.set(record.id, record);
          return;

        case "Channel": {
          if (channelInfoById.has(record.id)) {
            return;
          }
          if (record.schemaId === 0) {
            throw new Error(
              `Channel ${record.id} (topic ${record.topic}) has no schema; channels without schemas are not supported`,
            );
          }
          const schema = schemasById.get(record.schemaId);
          if (!schema) {
            throw new Error(
              `Missing schema info for schema id ${record.schemaId} (channel ${record.id}, topic ${record.topic})`,
            );
          }
          const parsedChannels = parsedChannelsByTopic.get(record.topic) ?? [];
          for (const info of parsedChannels) {
            if (
              info.messageEncoding === record.messageEncoding &&
              info.schemaEncoding === schema.encoding &&
              _.isEqual(info.schema, schema.data)
            ) {
              channelInfoById.set(record.id, {
                channel: record,
                parsedChannel: info.parsedChannel,
                schemaName: schema.name,
              });
              return;
            }
          }

          // We've not found a previously parsed channel with matching schema
          // Create one here just-in-time
          const parsedChannel = parseChannel({
            messageEncoding: record.messageEncoding,
            schema,
          });

          parsedChannels.push({
            messageEncoding: record.messageEncoding,
            schemaEncoding: schema.encoding,
            schema: schema.data,
            parsedChannel,
          });

          parsedChannelsByTopic.set(record.topic, parsedChannels);

          channelInfoById.set(record.id, {
            channel: record,
            parsedChannel,
            schemaName: schema.name,
          });

          const err = new Error(
            `No pre-initialized reader for ${record.topic} (message encoding ${record.messageEncoding}, schema encoding ${schema.encoding}, schema name ${schema.name})`,
          );
          captureException(err);
          return;
        }

        case "Message": {
          const info = channelInfoById.get(record.channelId);
          if (!info) {
            throw new Error(`message for channel ${record.channelId} with no prior channel/schema`);
          }
          const receiveTime = fromNanoSec(record.logTime);
          totalMessages++;

          try {
            const deserializedMessage = info.parsedChannel.deserialize(record.data);
            results.push({
              type: "message-event",
              msgEvent: {
                topic: info.channel.topic,
                receiveTime,
                message: deserializedMessage,
                sizeInBytes: record.data.byteLength,
                schemaName: info.schemaName,
              },
            });
          } catch (err) {
            // Similar to DeserializingIterableSource error handling - create a problem for the main thread
            console.error(`Failed to deserialize message on topic ${info.channel.topic}:`, err);
            captureException(err, {
              extra: {
                topic: info.channel.topic,
                channelId: record.channelId,
                messageSize: record.data.byteLength,
                schemaName: info.schemaName,
              },
            });

            // Assign a unique connection ID for each topic in this streaming session
            if (connectionIdByTopic[info.channel.topic] == undefined) {
              connectionIdByTopic[info.channel.topic] = nextConnectionId++;
            }
            const connectionId = connectionIdByTopic[info.channel.topic]!;

            results.push({
              type: "problem",
              connectionId,
              problem: {
                severity: "error",
                message: `Failed to deserialize message on topic ${
                  info.channel.topic
                }. ${err.toString()}`,
                tip: `Check that your input file is not corrupted.`,
              },
            });
          }
          return;
        }
      }
    }

    let fetchStartTime = 0;
    let fetchEndTime = 0;
    let decodeEndTime = 0;

    try {
      // Since every request is signed with a new token, there's no benefit to caching.
      fetchStartTime = performance.now();

      const response = await api.getStreams({
        start: toMillis(params.start),
        end: toMillis(params.end),
        topics: params.topics,
        id: params.id,
        signal: controller.signal,
        projectName: params.projectName ?? "",
        fetchCompleteTopicState: params.fetchCompleteTopicState,
      });

      fetchEndTime = performance.now();

      if (response.status === 401) {
        throw new Error("Login expired, please login again");
      }
      if (response.status === 404) {
        return;
      } else if (response.status !== 200) {
        const errorBody = (await response.json()) as { message?: string };
        if (errorBody.message) {
          throw new Error(errorBody.message);
        }
        throw new Error(`Unexpected response status ${response.status}`);
      }
      if (!response.body) {
        throw new Error("Unable to stream response body");
      }
      const streamReader = response.body.getReader();

      let normalReturn = false;
      parseLoop: try {
        const reader = new McapStreamReader({ decompressHandlers });
        for (let result; (result = await streamReader.read()), !result.done; ) {
          reader.append(result.value);
          for (let record; (record = reader.nextRecord()); ) {
            if (record.type === "DataEnd") {
              normalReturn = true;
              break;
            }
            processRecord(record);

            recordsSinceYieldCheck++;
            if (results.length >= MAX_BATCH_SIZE) {
              yield results;
              results = [];
              lastYieldTime = performance.now();
              recordsSinceYieldCheck = 0;
              continue;
            }

            if (recordsSinceYieldCheck >= YIELD_TIME_CHECK_RECORDS) {
              recordsSinceYieldCheck = 0;
              const now = performance.now();
              if (results.length > 0 && now - lastYieldTime >= MAX_BATCH_TIME_MS) {
                yield results;
                results = [];
                lastYieldTime = performance.now();
              }
            }
          }

          const now = performance.now();
          const timeSinceLastYield = now - lastYieldTime;
          if (results.length > 0 && timeSinceLastYield >= MAX_BATCH_TIME_MS) {
            yield results;
            results = [];
            lastYieldTime = performance.now();
            recordsSinceYieldCheck = 0;
          }

          if (normalReturn) {
            break parseLoop;
          }
        }
        if (!reader.done()) {
          throw new Error("Incomplete mcap file");
        }

        // Yield any remaining messages
        if (results.length > 0) {
          yield results;
          results = [];
        }

        normalReturn = true;
      } finally {
        // Flush any remaining buffered messages before cleanup, even if aborted/errored
        if (results.length > 0) {
          yield results;
          results = [];
        }

        if (!normalReturn) {
          // If the caller called generator.return() in between body chunks, automatically cancel the request.
          log.debug("Automatic abort of streamMessages", params);
        }
        controller.abort();
      }
    } catch (err) {
      // Capture errors from manually aborting the request via the abort controller.
      const errorName =
        typeof err === "object" && err != undefined && "name" in err ? err.name : undefined;
      const errorMessage =
        typeof err === "object" && err != undefined && "message" in err ? err.message : undefined;
      if (errorName === "AbortError" || errorMessage === "The user aborted a request.") {
        return;
      }
      throw err;
    }

    decodeEndTime = performance.now();

    log.debug(
      "message",
      results,
      "total message",
      totalMessages,
      "fetch time",
      `${(fetchEndTime - fetchStartTime) / 1000}s`,
      "decode time",
      `${(decodeEndTime - fetchEndTime) / 1000}s`,
      "total time",
      `${(decodeEndTime - startTimer) / 1000}s`,
    );
  } finally {
    removeAbortHandler();
  }
}
