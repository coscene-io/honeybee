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
const streamCycleCompletionById = new Map<string, number>();

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
  // Local connection ID management for this streaming session
  const connectionIdByTopic: Record<string, number> = {};
  let nextConnectionId = 0;

  const requestStartTime = performance.now();
  const previousCycleEnd = streamCycleCompletionById.get(params.id);
  if (previousCycleEnd != undefined) {
    log.debug("streamMessages:sincePreviousRequest", {
      streamId: params.id,
      elapsedMs: requestStartTime - previousCycleEnd,
      topics: params.topics,
      topicsCount: params.topics.length,
    });
  }

  log.debug("streamMessages:requestStart", {
    streamId: params.id,
    range: {
      start: params.start,
      end: params.end,
    },
    topics: params.topics,
    topicsCount: params.topics.length,
  });

  const controller = new AbortController();
  const abortHandler = () => {
    log.debug("Manual abort of streamMessages", params);
    controller.abort();
  };
  signal?.addEventListener("abort", abortHandler);
  const decompressHandlers = await loadDecompressHandlers();

  log.debug("streamMessages", params);
  const startTimer = requestStartTime;

  if (controller.signal.aborted) {
    return;
  }

  let totalMessages = 0;
  let results: IteratorResult[] = [];
  let totalYieldCount = 0;
  let firstProgressTimestamp: number | undefined;
  let firstProgressBatchStats: { messages: number; problems: number } | undefined;
  let lastYieldTimestamp: number | undefined;
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

    log.debug("streamMessages:fetch:start", {
      streamId: params.id,
      topics: params.topics,
      topicsCount: params.topics.length,
    });

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

    log.debug("streamMessages:fetch:complete", {
      streamId: params.id,
      fetchDurationMs: fetchEndTime - fetchStartTime,
      status: response.status,
    });

    if (response.status === 401) {
      throw new Error("Login expired, please login again");
    }
    if (response.status === 404) {
      decodeEndTime = performance.now();
      log.debug("streamMessages:summary", {
        streamId: params.id,
        totalMessages,
        fetchDurationMs: fetchEndTime - fetchStartTime,
        decodeDurationMs: decodeEndTime - fetchEndTime,
        totalDurationMs: decodeEndTime - startTimer,
        firstProgressLatencyMs:
          firstProgressTimestamp != undefined ? firstProgressTimestamp - fetchStartTime : undefined,
        timeFromFirstProgressToCompleteMs:
          firstProgressTimestamp != undefined ? decodeEndTime - firstProgressTimestamp : undefined,
        totalYieldCount,
        firstProgressBatch: firstProgressBatchStats,
        reason: "not_found",
      });
      streamCycleCompletionById.set(params.id, decodeEndTime);
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
        }

        // 统一输出结果，保持时序
        if (results.length > 0) {
          const now = performance.now();
          const messageEvents = results.filter((item) => item.type === "message-event").length;
          const problemEvents = results.filter((item) => item.type === "problem").length;

          totalYieldCount++;

          if (firstProgressTimestamp == undefined) {
            firstProgressTimestamp = now;
            firstProgressBatchStats = {
              messages: messageEvents,
              problems: problemEvents,
            };

            log.debug("streamMessages:firstProgressDispatch", {
              streamId: params.id,
              elapsedSinceFetchStartMs: now - fetchStartTime,
              elapsedSinceRequestStartMs: now - startTimer,
              batchSize: results.length,
              messageEvents,
              problemEvents,
            });
          }

          log.debug("streamMessages:yieldBatch", {
            streamId: params.id,
            batchSize: results.length,
            messageEvents,
            problemEvents,
            elapsedSinceLastYieldMs:
              lastYieldTimestamp != undefined ? now - lastYieldTimestamp : undefined,
            elapsedSinceRequestStartMs: now - startTimer,
          });

          lastYieldTimestamp = now;

          yield results;
          results = [];
        }

        if (normalReturn) {
          break parseLoop;
        }
      }
      if (!reader.done()) {
        throw new Error("Incomplete mcap file");
      }
      normalReturn = true;
    } finally {
      if (!normalReturn) {
        // If the caller called generator.return() in between body chunks, automatically cancel the request.
        log.debug("Automatic abort of streamMessages", params);
      }
      signal?.removeEventListener("abort", abortHandler);
      controller.abort();
    }
  } catch (err) {
    // Capture errors from manually aborting the request via the abort controller.
    if (err instanceof DOMException && err.message === "The user aborted a request.") {
      return;
    }
    throw err;
  }

  decodeEndTime = performance.now();

  log.debug("streamMessages:summary", {
    streamId: params.id,
    totalMessages,
    fetchDurationMs: fetchEndTime - fetchStartTime,
    decodeDurationMs: decodeEndTime - fetchEndTime,
    totalDurationMs: decodeEndTime - startTimer,
    firstProgressLatencyMs:
      firstProgressTimestamp != undefined ? firstProgressTimestamp - fetchStartTime : undefined,
    timeFromFirstProgressToCompleteMs:
      firstProgressTimestamp != undefined ? decodeEndTime - firstProgressTimestamp : undefined,
    totalYieldCount,
    firstProgressBatch: firstProgressBatchStats,
  });

  streamCycleCompletionById.set(params.id, decodeEndTime);
}
