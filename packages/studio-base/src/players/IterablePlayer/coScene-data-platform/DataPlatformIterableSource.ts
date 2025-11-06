// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { captureException } from "@sentry/core";
import * as _ from "lodash-es";

import Logger from "@foxglove/log";
import { parseChannel } from "@foxglove/mcap-support";
import { clampTime, fromRFC3339String, add as addTime, compare, Time } from "@foxglove/rostime";
import {
  PlayerProblem,
  Topic,
  TopicStats,
  type MessageEvent,
} from "@foxglove/studio-base/players/types";
import ConsoleApi, { CoverageResponse } from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { streamMessages, ParsedChannelAndEncodings, StreamParams } from "./streamMessages";
import {
  IIterableSource,
  Initalization,
  MessageIteratorArgs,
  IteratorResult,
  GetBackfillMessagesArgs,
  IterableSourceInitializeArgs,
} from "../IIterableSource";

const log = Logger.getLogger(__filename);

/**
 * The console api methods used by DataPlatformIterableSource.
 *
 * This scopes the required interface to a small subset of ConsoleApi to make it easier to mock/stub
 * for tests.
 */
export type DataPlatformInterableSourceConsoleApi = Pick<ConsoleApi, "topics" | "getStreams">;

type DataPlatformSourceParameters = {
  projectName?: string;
  key: string;
};

type DataPlatformIterableSourceOptions = {
  api: DataPlatformInterableSourceConsoleApi;
  params: DataPlatformSourceParameters;
};

type StreamInstrumentationContext = {
  requestKind: "messageIterator" | "backfill";
  consumptionType: MessageIteratorArgs["consumptionType"] | "backfill";
  streamParams: StreamParams;
};

export class DataPlatformIterableSource implements IIterableSource {
  readonly #consoleApi: DataPlatformInterableSourceConsoleApi;

  #knownTopicNames: string[] = [];
  #params: DataPlatformSourceParameters;
  #start?: Time;
  #end?: Time;
  #streamInvocationCounter = 0;

  /**
   * Cached readers for each schema so we don't have to re-parse definitions on each stream request.
   * Although each topic is usually homogeneous, technically it is possible to have different
   * encoding or schema for each topic, so we store all the ones we've seen.
   */
  #parsedChannelsByTopic = new Map<string, ParsedChannelAndEncodings[]>();

  #coverage: CoverageResponse[] = [];

  public constructor(options: DataPlatformIterableSourceOptions) {
    this.#consoleApi = options.api;
    this.#params = options.params;
  }

  public async initialize(): Promise<Initalization> {
    // get topics
    const originalTopics = await this.#consoleApi.topics(this.#params.key);

    const rawTopics = originalTopics.metaData;

    const coverageStart = originalTopics.start;
    const coverageEnd = originalTopics.end;

    const coverageStartTime = fromRFC3339String(coverageStart)!;
    const coverageEndTime = fromRFC3339String(coverageEnd)!;

    this.#start = coverageStartTime;
    this.#end = coverageEndTime;

    const params = {
      ...this.#params,
      start: coverageStartTime,
      end: coverageEndTime,
    };

    const topics: Topic[] = [];
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    const problems: PlayerProblem[] = [];
    rawTopics: for (const rawTopic of rawTopics) {
      const {
        topic,
        encoding: messageEncoding,
        schemaEncoding,
        schema,
        schemaName,
        messageCount,
        messageFrequency,
      } = rawTopic;
      if (schema == undefined) {
        problems.push({ message: `Missing schema for ${topic}`, severity: "error" });
        continue;
      }

      let parsedChannels = this.#parsedChannelsByTopic.get(topic);
      if (!parsedChannels) {
        parsedChannels = [];
        this.#parsedChannelsByTopic.set(topic, parsedChannels);
      }
      for (const info of parsedChannels) {
        if (
          info.messageEncoding === messageEncoding &&
          info.schemaEncoding === schemaEncoding &&
          _.isEqual(info.schema, schema)
        ) {
          continue rawTopics;
        }
      }

      try {
        const parsedChannel = parseChannel({
          messageEncoding,
          schema: { name: schemaName, data: schema, encoding: schemaEncoding },
        });

        topics.push({ name: topic, schemaName, messageCount, messageFrequency });
        parsedChannels.push({ messageEncoding, schemaEncoding, schema, parsedChannel });

        // Final datatypes is an unholy union of schemas across all channels
        for (const [name, datatype] of parsedChannel.datatypes) {
          datatypes.set(name, datatype);
        }
      } catch (err) {
        captureException(err, { extra: { rawTopic } });
        problems.push({
          message: `Failed to parse schema for topic ${topic}`,
          severity: "error",
          error: err,
        });
      }
    }

    let profile: string | undefined;

    // Workaround for https://github.com/foxglove/studio/issues/4690.
    // If all topics use ros1/2 schemas and message encodings, assume we are working with the ros1/2 profile data.
    if (
      rawTopics.length > 0 &&
      rawTopics.every((topic) => topic.encoding === "ros1" && topic.schemaEncoding === "ros1msg")
    ) {
      profile = "ros1";
    } else if (
      rawTopics.length > 0 &&
      rawTopics.every(
        (topic) =>
          topic.encoding === "cdr" &&
          (topic.schemaEncoding === "ros2msg" || topic.schemaEncoding === "ros2idl"),
      )
    ) {
      profile = "ros2";
    }

    this.#knownTopicNames = topics.map((topic) => topic.name);
    return {
      topics,
      topicStats,
      datatypes,
      start: params.start,
      end: params.end,
      profile,
      problems,
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    log.debug("message iterator", args);

    const topics = args.topics;
    const topicNames = Array.from(topics.keys());

    // only firest req need fetch complete topic state
    let fetchCompleteTopicState = args.fetchCompleteTopicState;

    if (!this.#start || !this.#end) {
      throw new Error("DataPlatformIterableSource not initialized");
    }

    const parsedChannelsByTopic = this.#parsedChannelsByTopic;

    // Data platform treats topic array length 0 as "all topics". Until that is changed, we filter out
    // empty topic requests
    if (topics.size === 0) {
      return;
    }

    // If the topics available to us don't overlap with the topics we know about then we avoid
    // making any requests since there's no data to return
    const matchingTopics = topicNames.reduce((count, topicName) => {
      return this.#knownTopicNames.includes(topicName) ? count + 1 : count;
    }, 0);
    if (matchingTopics === 0) {
      log.debug("no matching topics to stream");
      return;
    }

    const streamStart = args.start ?? this.#start;
    const streamEnd = clampTime(args.end ?? this.#end, this.#start, this.#end);

    if (args.consumptionType === "full") {
      const streamByParams: StreamParams = {
        start: streamStart,
        end: streamEnd,
        id: this.#params.key,
        projectName: this.#params.projectName,
        topics: topicNames,
        fetchCompleteTopicState,
      };

      const stream = streamMessages({
        api: this.#consoleApi,
        parsedChannelsByTopic,
        params: streamByParams,
      });

      const instrumentedStream = this.#iterateStreamWithDiagnostics(stream, {
        requestKind: "messageIterator",
        consumptionType: args.consumptionType,
        streamParams: streamByParams,
      });

      for await (const message of instrumentedStream) {
        yield message;
      }

      if (fetchCompleteTopicState === "complete") {
        fetchCompleteTopicState = "incremental";
      }

      return;
    }

    let localStart = streamStart;
    let localEnd = clampTime(addTime(localStart, { sec: 5, nsec: 0 }), streamStart, streamEnd);

    for (;;) {
      const streamByParams: StreamParams = {
        start: localStart,
        end: localEnd,
        id: this.#params.key,
        projectName: this.#params.projectName,
        topics: topicNames,
        fetchCompleteTopicState,
      };

      const stream = streamMessages({
        api: this.#consoleApi,
        parsedChannelsByTopic,
        params: streamByParams,
      });

      const instrumentedStream = this.#iterateStreamWithDiagnostics(stream, {
        requestKind: "messageIterator",
        consumptionType: args.consumptionType,
        streamParams: streamByParams,
      });

      for await (const message of instrumentedStream) {
        yield message;
      }

      if (compare(localEnd, streamEnd) >= 0) {
        return;
      }

      if (fetchCompleteTopicState === "complete") {
        fetchCompleteTopicState = "incremental";
      }

      yield { type: "stamp", stamp: localEnd };

      localStart = addTime(localEnd, { sec: 0, nsec: 1 });

      // Assumes coverage regions are sorted by start time
      for (const coverage of this.#coverage) {
        const end = fromRFC3339String(coverage.end);
        const start = fromRFC3339String(coverage.start);
        if (!start || !end) {
          continue;
        }

        // if localStart is in a coverage region, then allow this localStart to be used
        if (compare(localStart, start) >= 0 && compare(localStart, end) <= 0) {
          break;
        }

        // if localStart is completely before a coverage region then we reset the localStart to the
        // start of the coverage region. Since coverage regions are sorted by start time, if we get
        // here we know that localStart did not fall into a previous coverage region
        if (compare(localStart, end) <= 0 && compare(localStart, start) < 0) {
          localStart = start;
          log.debug("start is in a coverage gap, adjusting start to next coverage range", start);
          break;
        }
      }

      localStart = clampTime(localStart, streamStart, streamEnd);
      localEnd = clampTime(addTime(localStart, { sec: 5, nsec: 0 }), streamStart, streamEnd);
    }
  }

  public async getBackfillMessages({
    topics,
    time,
    abortSignal,
  }: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    // Data platform treats topic array length 0 as "all topics". Until that is changed, we filter out
    // empty topic requests
    if (topics.size === 0) {
      return [];
    }

    const streamByParams: StreamParams = {
      start: time,
      end: time,
      id: this.#params.key,
      projectName: this.#params.projectName,
      topics: Array.from(topics.keys()),
      fetchCompleteTopicState: "complete",
    };

    streamByParams.replayPolicy = "lastPerChannel";
    streamByParams.replayLookbackSeconds = 30 * 60;

    const messages: MessageEvent[] = [];
    const backfillStream = this.#iterateStreamWithDiagnostics(
      streamMessages({
        api: this.#consoleApi,
        parsedChannelsByTopic: this.#parsedChannelsByTopic,
        signal: abortSignal,
        params: streamByParams,
      }),
      {
        requestKind: "backfill",
        consumptionType: "backfill",
        streamParams: streamByParams,
      },
    );

    for await (const item of backfillStream) {
      if (item.type === "message-event") {
        messages.push(item.msgEvent);
      }

      if (item.type === "problem") {
        log.warn(`Problem during backfill: ${item.problem.message}`, {
          severity: item.problem.severity,
          tip: item.problem.tip,
          topics: Array.from(topics.keys()),
          time,
        });
      }
    }

    return messages;
  }

  #iterateStreamWithDiagnostics(
    stream: AsyncGenerator<IteratorResult[]>,
    context: StreamInstrumentationContext,
  ): AsyncGenerator<IteratorResult> {
    const invocationId = `${context.streamParams.id}:${++this.#streamInvocationCounter}`;
    const { streamParams } = context;
    const metadata = {
      requestKind: context.requestKind,
      consumptionType: context.consumptionType,
      streamId: streamParams.id,
      topics: streamParams.topics,
      topicsCount: streamParams.topics.length,
      fetchCompleteTopicState: streamParams.fetchCompleteTopicState,
      start: streamParams.start,
      end: streamParams.end,
    };

    const perfNow = () => performance.now();

    return (async function* (): AsyncGenerator<IteratorResult> {
      const streamStart = perfNow();
      let lastBatchEnd = streamStart;
      let totalMessages = 0;
      let totalProblems = 0;
      let totalBatches = 0;
      let totalYieldWaitMs = 0;
      let totalActiveDispatchMs = 0;
      let totalDispatchDurationMs = 0;
      let maxBatchYieldWaitMs = 0;
      let firstBatchLatencyMs: number | undefined;
      let streamStatus: "success" | "error" = "success";
      let caughtError: unknown;

      try {
        for await (const batch of stream) {
          const batchReceiveTime = perfNow();
          const elapsedSinceStreamStartMs = batchReceiveTime - streamStart;
          const elapsedSincePreviousBatchMs = batchReceiveTime - lastBatchEnd;

          let batchMessageCount = 0;
          let batchProblemCount = 0;
          for (const item of batch) {
            if (item.type === "message-event") {
              batchMessageCount++;
            } else if (item.type === "problem") {
              batchProblemCount++;
            }
          }

          if (firstBatchLatencyMs == undefined) {
            firstBatchLatencyMs = elapsedSinceStreamStartMs;
          }

          log.debug("DataPlatformIterableSource:batchReceived", {
            ...metadata,
            invocationId,
            batchIndex: totalBatches,
            batchSize: batch.length,
            messageEvents: batchMessageCount,
            problemEvents: batchProblemCount,
            elapsedSinceStreamStartMs,
            elapsedSincePreviousBatchMs:
              totalBatches === 0 ? undefined : elapsedSincePreviousBatchMs,
          });

          const dispatchStart = perfNow();
          let batchYieldWaitMs = 0;
          let batchMaxYieldWaitMs = 0;

          for (const item of batch) {
            const yieldStart = perfNow();
            yield item;
            const afterYield = perfNow();
            const yieldWait = afterYield - yieldStart;
            batchYieldWaitMs += yieldWait;
            if (yieldWait > batchMaxYieldWaitMs) {
              batchMaxYieldWaitMs = yieldWait;
            }
          }

          const dispatchEnd = perfNow();
          const dispatchDurationMs = dispatchEnd - dispatchStart;
          const batchActiveProcessingMs = Math.max(dispatchDurationMs - batchYieldWaitMs, 0);

          totalMessages += batchMessageCount;
          totalProblems += batchProblemCount;
          totalYieldWaitMs += batchYieldWaitMs;
          totalActiveDispatchMs += batchActiveProcessingMs;
          totalDispatchDurationMs += dispatchDurationMs;
          maxBatchYieldWaitMs = Math.max(maxBatchYieldWaitMs, batchMaxYieldWaitMs);
          totalBatches++;
          lastBatchEnd = dispatchEnd;

          log.debug("DataPlatformIterableSource:batchDispatched", {
            ...metadata,
            invocationId,
            batchIndex: totalBatches - 1,
            batchSize: batch.length,
            messageEvents: batchMessageCount,
            problemEvents: batchProblemCount,
            dispatchDurationMs,
            batchYieldWaitMs,
            batchActiveProcessingMs,
            batchMaxYieldWaitMs,
            elapsedSinceStreamStartMs: dispatchEnd - streamStart,
          });
        }
      } catch (err) {
        streamStatus = "error";
        caughtError = err;
        throw err;
      } finally {
        const streamEnd = perfNow();
        const totalDurationMs = streamEnd - streamStart;
        const residualDurationMs = totalDurationMs - totalDispatchDurationMs;

        log.debug("DataPlatformIterableSource:streamComplete", {
          ...metadata,
          invocationId,
          status: streamStatus,
          totalDurationMs,
          totalBatches,
          totalMessages,
          totalProblems,
          totalYieldWaitMs,
          totalActiveDispatchMs,
          totalDispatchDurationMs,
          residualDurationMs,
          maxBatchYieldWaitMs,
          averageDispatchDurationPerBatchMs:
            totalBatches > 0 ? totalDispatchDurationMs / totalBatches : undefined,
          averageYieldWaitPerBatchMs:
            totalBatches > 0 ? totalYieldWaitMs / totalBatches : undefined,
          firstBatchLatencyMs,
          elapsedSinceLastBatchMs: totalBatches > 0 ? streamEnd - lastBatchEnd : undefined,
          errorMessage:
            streamStatus === "error"
              ? caughtError instanceof Error
                ? caughtError.message
                : String(caughtError)
              : undefined,
        });

        //   {
        //     "requestKind": "messageIterator",
        //     "consumptionType": "partial",
        //     "streamId": "gtgXwDFmwN468Z1dSsktA",
        //     "topics": [
        //         "/tf",
        //         "/agivslam/reloc_image",
        //         "/aima/hal/camera/interactive/color/h264",
        //         "/aima/hal/fish_eye_camera/chest_left/color/h264",
        //         "/aima/hal/fish_eye_camera/chest_right/color/h264",
        //         "/aima/hal/lidar/neck/pointcloud",
        //         "/aima/hal/rgbd_camera/head_front/color/h264",
        //         "/aima/hal/rgbd_camera/waist_front/color/h264",
        //         "/costmap_update_map",
        //         "/dbg_collision_check_path",
        //         "/dbg_polygon_visualize",
        //         "/dbg_static_map",
        //         "/map",
        //         "/path",
        //         "/path_local",
        //         "/perception/env_obbs",
        //         "/root/ros2_bridge_node/controller_server_ros_node/MPPIController/dbg_path",
        //         "/root/ros2_bridge_node/controller_server_ros_node/MPPIController/dbg_trajectories",
        //         "/root/ros2_bridge_node/planner_server_ros_node/GridBased/potential"
        //     ],
        //     "topicsCount": 19,
        //     "start": {
        //         "sec": 1761140632,
        //         "nsec": 253835025
        //     },
        //     "end": {
        //         "sec": 1761140637,
        //         "nsec": 253835025
        //     },
        //     "invocationId": "gtgXwDFmwN468Z1dSsktA:6",
        //     "status": "success",
        //     "totalDurationMs": 3152.3299999833107,
        //     "totalBatches": 5,
        //     "totalMessages": 1976,
        //     "totalProblems": 0,
        //     "totalYieldWaitMs": 708.4750000834465,
        //     "totalActiveDispatchMs": 0.36999988555908203,
        //     "totalDispatchDurationMs": 708.8449999690056,
        //     "residualDurationMs": 2443.485000014305,
        //     "maxBatchYieldWaitMs": 53.514999985694885,
        //     "averageDispatchDurationPerBatchMs": 141.76899999380112,
        //     "averageYieldWaitPerBatchMs": 141.6950000166893,
        //     "firstBatchLatencyMs": 736.9099999666214,
        //     "elapsedSinceLastBatchMs": 0.19499999284744263
        // }
      }
    })();
  }
}

export function initialize(args: IterableSourceInitializeArgs): DataPlatformIterableSource {
  const { api, params } = args;
  if (!params) {
    throw new Error("params is required for data platform source");
  }

  if (!api) {
    throw new Error("api is required for data platform");
  }

  const projectId = params.projectId;
  const warehouseId = params.warehouseId;
  const key = params.key;

  if (!projectId) {
    throw new Error("projectId is required for data platform source");
  }

  if (!warehouseId) {
    throw new Error("warehouseId is required for data platform source");
  }

  if (!key) {
    throw new Error("key is undefined");
  }

  const dpSourceParams: DataPlatformSourceParameters = {
    key,
    projectName: `warehouses/${warehouseId}/projects/${projectId}`,
  };

  const consoleApi = new ConsoleApi(api.baseUrl, api.bffUrl, api.auth ?? "");

  return new DataPlatformIterableSource({
    api: consoleApi,
    params: dpSourceParams,
  });
}
