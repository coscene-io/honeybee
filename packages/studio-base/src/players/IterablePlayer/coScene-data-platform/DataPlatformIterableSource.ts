// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { captureException } from "@sentry/core";
import { isEqual } from "lodash";

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

import {
  IIterableSource,
  Initalization,
  MessageIteratorArgs,
  IteratorResult,
  GetBackfillMessagesArgs,
  IterableSourceInitializeArgs,
} from "../IIterableSource";
import { streamMessages, ParsedChannelAndEncodings, StreamParams } from "./streamMessages";

const log = Logger.getLogger(__filename);

/**
 * The console api methods used by DataPlatformIterableSource.
 *
 * This scopes the required interface to a small subset of ConsoleApi to make it easier to mock/stub
 * for tests.
 */
export type DataPlatformInterableSourceConsoleApi = Pick<
  CoSceneConsoleApi,
  "topics" | "getDevice" | "getAuthHeader"
>;

type DataPlatformSourceParameters = {
  revisionName: string;
  filename: string;
  recordName: string;
};

type DataPlatformIterableSourceOptions = {
  api: DataPlatformInterableSourceConsoleApi;
  params: DataPlatformSourceParameters;
};

export class DataPlatformIterableSource implements IIterableSource {
  private readonly _consoleApi: DataPlatformInterableSourceConsoleApi;

  private _knownTopicNames: string[] = [];
  private _params: DataPlatformSourceParameters;
  private _start?: Time;
  private _end?: Time;

  /**
   * Cached readers for each schema so we don't have to re-parse definitions on each stream request.
   * Although each topic is usually homogeneous, technically it is possible to have different
   * encoding or schema for each topic, so we store all the ones we've seen.
   */
  private _parsedChannelsByTopic = new Map<string, ParsedChannelAndEncodings[]>();

  private _coverage: CoverageResponse[] = [];

  public constructor(options: DataPlatformIterableSourceOptions) {
    this._consoleApi = options.api;
    this._params = options.params;
  }

  public async initialize(): Promise<Initalization> {
    const apiParams = {
      revisionName: this._params.revisionName,
      filename: this._params.filename,
    };

    // get topics
    const originalTopics = await this._consoleApi.topics({ ...apiParams, includeSchemas: true });

    const rawTopics = originalTopics.metaData;

    const coverageStart = originalTopics.start;
    const coverageEnd = originalTopics.end;

    const coverageStartTime = fromRFC3339String(coverageStart)!;
    const coverageEndTime = fromRFC3339String(coverageEnd)!;

    const device = {
      id: "dev_CJGWd2UaK1MFq3yF",
      name: "Robo Arm 1",
      serialNumber: undefined,
      orgId: "94912def-10f3-4b04-873c-e984dacb5baa",
      createdAt: "2022-04-24T05:50:31.960Z",
      updatedAt: "2022-04-24T05:50:31.960Z",
      deletedAt: undefined,
    };

    this._start = coverageStartTime;
    this._end = coverageEndTime;

    const params = {
      ...this._params,
      start: coverageStartTime,
      end: coverageEndTime,
    };

    const topics: Topic[] = [];
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    const problems: PlayerProblem[] = [];
    rawTopics: for (const rawTopic of rawTopics) {
      const { topic, encoding: messageEncoding, schemaEncoding, schema, schemaName } = rawTopic;
      if (schema == undefined) {
        problems.push({ message: `Missing schema for ${topic}`, severity: "error" });
        continue;
      }

      let parsedChannels = this._parsedChannelsByTopic.get(topic);
      if (!parsedChannels) {
        parsedChannels = [];
        this._parsedChannelsByTopic.set(topic, parsedChannels);
      }
      for (const info of parsedChannels) {
        if (
          info.messageEncoding === messageEncoding &&
          info.schemaEncoding === schemaEncoding &&
          isEqual(info.schema, schema)
        ) {
          continue rawTopics;
        }
      }

      try {
        const parsedChannel = parseChannel({
          messageEncoding,
          schema: { name: schemaName, data: schema, encoding: schemaEncoding },
        });

        topics.push({ name: topic, schemaName: parsedChannel.fullSchemaName });
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

    this._knownTopicNames = topics.map((topic) => topic.name);
    return {
      topics,
      topicStats,
      datatypes,
      start: params.start,
      end: params.end,
      profile,
      problems,
      publishersByTopic: new Map(),
      name: `${device.name} (${device.id})`,
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    log.debug("message iterator", args);

    if (!this._start || !this._end) {
      throw new Error("DataPlatformIterableSource not initialized");
    }

    const parsedChannelsByTopic = this._parsedChannelsByTopic;

    // Data platform treats topic array length 0 as "all topics". Until that is changed, we filter out
    // empty topic requests
    if (args.topics.length === 0) {
      return;
    }

    // If the topics available to us don't overlap with the topics we know about then we avoid
    // making any requests since there's no data to return
    const matchingTopics = args.topics.reduce((count, topicName) => {
      return this._knownTopicNames.includes(topicName) ? count + 1 : count;
    }, 0);
    if (matchingTopics === 0) {
      log.debug("no matching topics to stream");
      return;
    }

    // console.log("this._consoleApi", this._consoleApi.getAuthHeader());

    const streamStart = args.start ?? this._start;
    const streamEnd = clampTime(args.end ?? this._end, this._start, this._end);

    if (args.consumptionType === "full") {
      const streamByParams: StreamParams = {
        start: streamStart,
        end: streamEnd,
        authHeader: this._consoleApi.getAuthHeader(),
        revisionName: this._params.revisionName,
        filename: this._params.filename,
      };

      const stream = streamMessages({
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
    let localEnd = clampTime(addTime(localStart, { sec: 5, nsec: 0 }), streamStart, streamEnd);

    for (;;) {
      const streamByParams: StreamParams = {
        start: localStart,
        end: localEnd,
        authHeader: this._consoleApi.getAuthHeader(),
        revisionName: this._params.revisionName,
        filename: this._params.filename,
      };

      const stream = streamMessages({
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
      for (const coverage of this._coverage) {
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
  }: GetBackfillMessagesArgs): Promise<MessageEvent<unknown>[]> {
    // Data platform treats topic array length 0 as "all topics". Until that is changed, we filter out
    // empty topic requests
    if (topics.length === 0) {
      return [];
    }

    const streamByParams: StreamParams = {
      start: time,
      end: time,
      authHeader: this._consoleApi.getAuthHeader(),
      revisionName: this._params.revisionName,
      filename: this._params.filename,
    };

    streamByParams.replayPolicy = "lastPerChannel";
    streamByParams.replayLookbackSeconds = 30 * 60;

    const messages: MessageEvent<unknown>[] = [];
    for await (const block of streamMessages({
      parsedChannelsByTopic: this._parsedChannelsByTopic,
      signal: abortSignal,
      params: streamByParams,
    })) {
      messages.push(...block);
    }
    return messages;
  }
}

export function initialize(args: IterableSourceInitializeArgs): DataPlatformIterableSource {
  const { api, params } = args;
  if (!params) {
    throw new Error("params is required for data platform source");
  }

  if (!api) {
    throw new Error("api is required for data platfomr");
  }

  const revisionName = params.revisionName ?? "";
  const filename = params.filename ?? "";
  const recordName = params.recordName ?? "";

  if (!revisionName) {
    throw new Error("revisionName is required for data platform source");
  }

  if (!filename) {
    throw new Error("filename is required for data platform source");
  }

  if (!recordName) {
    throw new Error("recordName is required for data platform source");
  }

  const dpSourceParams: DataPlatformSourceParameters = {
    revisionName,
    filename,
    recordName,
  };

  const consoleApi = new CoSceneConsoleApi(api.baseUrl);
  if (api.auth) {
    consoleApi.setAuthHeader(api.auth);
  }

  return new DataPlatformIterableSource({
    api: consoleApi,
    params: dpSourceParams,
  });
}
