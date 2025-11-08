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
  requestId?: string;
  id: string;
  projectName?: string;
  replayPolicy?: "lastPerChannel" | "";
  replayLookbackSeconds?: number;
  topics: string[];
  fetchCompleteTopicState?: "complete" | "incremental";
};

export type StreamTimingSummary = {
  requestId: string;
  fetchMs: number;
  decodeMs: number;
  totalMs: number;
  yieldedBlocks: number;
  yieldedResults: number;
  yieldedMessages: number;
  // Detailed breakdown of decode phase
  breakdown?: {
    chunkWaitMs: number; // Time waiting for network chunks
    appendMs: number; // Time appending chunks to reader
    parseMs: number; // Time parsing records
    deserializeMs: number; // Time deserializing messages
    yieldMs: number; // Time yielding results
    totalChunks: number; // Number of chunks received
    avgChunkBytes: number; // Average chunk size
    totalBytes: number; // Total bytes received
  };
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
  onSummary,
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
  onSummary?: (summary: StreamTimingSummary) => void;
}): AsyncGenerator<IteratorResult[]> {
  const requestId = params.requestId ?? "stream";

  // Local connection ID management for this streaming session
  const connectionIdByTopic: Record<string, number> = {};
  let nextConnectionId = 0;

  const controller = new AbortController();
  const abortHandler = () => {
    log.debug(`Manual abort of streamMessages (${requestId})`, params);
    controller.abort();
  };
  signal?.addEventListener("abort", abortHandler);
  const decompressHandlers = await loadDecompressHandlers();

  const startTimer = performance.now();

  if (controller.signal.aborted) {
    return;
  }

  let totalMessages = 0;
  let yieldedBlocks = 0;
  let yieldedResults = 0;

  let results: IteratorResult[] = [];

  // Limit batch size to avoid blocking consumer too long
  const MAX_BATCH_SIZE = 100; // Yield every 100 messages
  const MAX_BATCH_TIME_MS = 50; // Or every 50ms, whichever comes first
  let lastYieldTime = performance.now();
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
          const deserializeStart = performance.now();
          const deserializedMessage = info.parsedChannel.deserialize(record.data);
          deserializeMs += performance.now() - deserializeStart;

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
  let summarySent = false;

  // Detailed breakdown timing
  let chunkWaitMs = 0;
  let appendMs = 0;
  let parseMs = 0;
  let deserializeMs = 0;
  let yieldMs = 0;
  let totalChunks = 0;
  let totalBytes = 0;

  const sendSummary = () => {
    if (summarySent) {
      return;
    }
    summarySent = true;
    const fetchMs = Math.max(0, fetchEndTime - fetchStartTime);
    const decodeMs = Math.max(0, decodeEndTime - fetchEndTime);
    const totalMs = Math.max(0, decodeEndTime - startTimer);
    onSummary?.({
      requestId,
      fetchMs,
      decodeMs,
      totalMs,
      yieldedBlocks,
      yieldedResults,
      yieldedMessages: totalMessages,
      breakdown: {
        chunkWaitMs,
        appendMs,
        parseMs,
        deserializeMs,
        yieldMs,
        totalChunks,
        avgChunkBytes: totalChunks > 0 ? totalBytes / totalChunks : 0,
        totalBytes,
      },
    });
  };

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
      decodeEndTime = fetchEndTime;
      sendSummary();
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
      let chunkReadStart = performance.now();

      for (let result; (result = await streamReader.read()), !result.done; ) {
        const chunkReadEnd = performance.now();
        chunkWaitMs += chunkReadEnd - chunkReadStart;
        totalChunks++;
        totalBytes += result.value.byteLength;

        const appendStart = performance.now();
        reader.append(result.value);
        appendMs += performance.now() - appendStart;

        const parseStart = performance.now();
        for (let record; (record = reader.nextRecord()); ) {
          if (record.type === "DataEnd") {
            normalReturn = true;
            break;
          }
          processRecord(record);

          // Yield early if batch is too large or too much time has passed
          const now = performance.now();
          const timeSinceLastYield = now - lastYieldTime;
          if (results.length >= MAX_BATCH_SIZE || timeSinceLastYield >= MAX_BATCH_TIME_MS) {
            if (results.length > 0) {
              parseMs += now - parseStart;
              const yieldStart = performance.now();
              yieldedBlocks++;
              yieldedResults += results.length;
              yield results;
              yieldMs += performance.now() - yieldStart;
              results = [];
              lastYieldTime = performance.now();
              continue;
            }
          }
        }
        parseMs += performance.now() - parseStart;

        // Yield remaining results after processing all records in chunk
        if (results.length > 0) {
          const yieldStart = performance.now();
          yieldedBlocks++;
          yieldedResults += results.length;
          yield results;
          yieldMs += performance.now() - yieldStart;
          results = [];
          lastYieldTime = performance.now();
        }

        if (normalReturn) {
          break parseLoop;
        }

        // Start timing next chunk read
        chunkReadStart = performance.now();
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
      decodeEndTime = performance.now();
      sendSummary();
      return;
    }
    throw err;
  }

  decodeEndTime = performance.now();
  sendSummary();
}
