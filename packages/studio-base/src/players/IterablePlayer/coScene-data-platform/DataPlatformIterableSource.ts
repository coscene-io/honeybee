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
  MessageEvent,
  TopicStats,
} from "@foxglove/studio-base/players/types";
import CoSceneConsoleApi, {
  CoverageResponse,
} from "@foxglove/studio-base/services/CoSceneConsoleApi";
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
export type DataPlatformInterableSourceConsoleApi = Pick<
  CoSceneConsoleApi,
  "topics" | "getDevice" | "getAuthHeader" | "getStreamUrl"
>;

type DataPlatformSourceParameters = {
  projectName?: string;
  revisionName?: string;
  jobRunId?: string;
  singleRequestTime: number;
};

type DataPlatformIterableSourceOptions = {
  api: DataPlatformInterableSourceConsoleApi;
  params: DataPlatformSourceParameters;
};

export class DataPlatformIterableSource implements IIterableSource {
  readonly #consoleApi: DataPlatformInterableSourceConsoleApi;

  #knownTopicNames: string[] = [];
  #params: DataPlatformSourceParameters;
  #start?: Time;
  #end?: Time;

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
    const apiParams = {
      revisionName: this.#params.revisionName,
      jobRunId: this.#params.jobRunId,
      projectName: this.#params.projectName,
    };

    // get topics
    const originalTopics = await this.#consoleApi.topics({ ...apiParams, includeSchemas: true });

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
        authHeader: this.#consoleApi.getAuthHeader(),
        revisionName: this.#params.revisionName,
        jobRunId: this.#params.jobRunId,
        projectName: this.#params.projectName,
        topics: topicNames,
        playbackQualityLevel: args.playbackQualityLevel ?? "ORIGINAL",
      };

      const stream = streamMessages({
        api: this.#consoleApi,
        parsedChannelsByTopic,
        params: streamByParams,
      });

      for await (const messages of stream) {
        for (const message of messages) {
          yield { type: "message-event", msgEvent: message };
        }
      }

      return;
    }

    let localStart = streamStart;
    let localEnd = clampTime(
      addTime(localStart, { sec: this.#params.singleRequestTime, nsec: 0 }),
      streamStart,
      streamEnd,
    );

    for (;;) {
      const streamByParams: StreamParams = {
        start: localStart,
        end: localEnd,
        authHeader: this.#consoleApi.getAuthHeader(),
        revisionName: this.#params.revisionName,
        jobRunId: this.#params.jobRunId,
        projectName: this.#params.projectName,
        topics: topicNames,
        playbackQualityLevel: args.playbackQualityLevel ?? "ORIGINAL",
      };

      const stream = streamMessages({
        api: this.#consoleApi,
        parsedChannelsByTopic,
        params: streamByParams,
      });

      for await (const messages of stream) {
        for (const message of messages) {
          yield { type: "message-event", msgEvent: message };
        }
      }

      if (compare(localEnd, streamEnd) >= 0) {
        return;
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
      localEnd = clampTime(
        addTime(localStart, { sec: this.#params.singleRequestTime, nsec: 0 }),
        streamStart,
        streamEnd,
      );
    }
  }

  public async getBackfillMessages({
    topics,
    time,
    abortSignal,
    playbackQualityLevel,
  }: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    // Data platform treats topic array length 0 as "all topics". Until that is changed, we filter out
    // empty topic requests
    if (topics.size === 0) {
      return [];
    }

    const streamByParams: StreamParams = {
      start: time,
      end: time,
      authHeader: this.#consoleApi.getAuthHeader(),
      revisionName: this.#params.revisionName,
      jobRunId: this.#params.jobRunId,
      projectName: this.#params.projectName,
      playbackQualityLevel,
      topics: Array.from(topics.keys()),
    };

    streamByParams.replayPolicy = "lastPerChannel";
    streamByParams.replayLookbackSeconds = 30 * 60;

    const messages: MessageEvent[] = [];
    for await (const block of streamMessages({
      api: this.#consoleApi,
      parsedChannelsByTopic: this.#parsedChannelsByTopic,
      signal: abortSignal,
      params: streamByParams,
    })) {
      messages.push(...block);
    }
    return messages;
  }
}

export function initialize(args: IterableSourceInitializeArgs): DataPlatformIterableSource {
  const { api, params, coSceneContext, singleRequestTime } = args;
  if (!params) {
    throw new Error("params is required for data platform source");
  }

  if (!api) {
    throw new Error("api is required for data platform");
  }

  const projectId = params.projectId ?? "";
  const projectSlug = params.projectSlug ?? "";
  const warehouseId = params.warehouseId ?? "";
  const warehouseSlug = params.warehouseSlug ?? "";
  const recordId = params.recordId ?? "";
  const revisionId = params.revisionId ?? "";
  const workflowRunsId = params.workflowRunsId ?? "";
  const jobRunsId = params.jobRunsId ?? "";

  if (!projectId) {
    throw new Error("projectId is required for data platform source");
  }

  if (!projectSlug) {
    throw new Error("projectSlug is required for data platform source");
  }

  if (!warehouseId) {
    throw new Error("warehouseId is required for data platform source");
  }

  if (!warehouseSlug) {
    throw new Error("warehouseSlug is required for data platform source");
  }

  const dpSourceParams: DataPlatformSourceParameters = {
    revisionName:
      recordId &&
      revisionId &&
      `warehouses/${warehouseId}/projects/${projectId}/records/${recordId}/revisions/${revisionId}`,
    jobRunId:
      workflowRunsId &&
      jobRunsId &&
      `warehouses/${warehouseId}/projects/${projectId}/workflowRuns/${workflowRunsId}/jobRuns/${jobRunsId}`,
    projectName: `warehouses/${warehouseId}/projects/${projectId}`,
    singleRequestTime: singleRequestTime ?? 5,
  };

  const consoleApi = new CoSceneConsoleApi(api.baseUrl, coSceneContext);

  if (api.auth) {
    consoleApi.setAuthHeader(api.auth);
  }

  return new DataPlatformIterableSource({
    api: consoleApi,
    params: dpSourceParams,
  });
}
