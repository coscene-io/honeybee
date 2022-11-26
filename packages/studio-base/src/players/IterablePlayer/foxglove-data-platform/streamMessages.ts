// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Mcap0StreamReader, Mcap0Types } from "@mcap/core";
import { captureException } from "@sentry/core";
import { isEqual } from "lodash";

import Logger from "@foxglove/log";
import { loadDecompressHandlers, parseChannel, ParsedChannel } from "@foxglove/mcap-support";
import { fromNanoSec, toRFC3339String, Time } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio-base/players/types";

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
  replayPolicy?: "lastPerChannel" | "";
  replayLookbackSeconds?: number;
};

/**
 * The console api methods used by streamMessages. This scopes the required interface to a small
 * subset of ConsoleApi to make it easier to mock/stub for tests.
 */

export async function* streamMessages({
  signal,
  parsedChannelsByTopic,
  params,
}: {
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
}): AsyncGenerator<MessageEvent<unknown>[]> {
  const controller = new AbortController();
  const abortHandler = () => {
    log.debug("Manual abort of streamMessages", params);
    controller.abort();
  };
  signal?.addEventListener("abort", abortHandler);
  const decompressHandlers = await loadDecompressHandlers();

  log.debug("streamMessages", params);
  const startTimer = performance.now();

  if (controller.signal.aborted) {
    return;
  }

  let totalMessages = 0;
  let messages: MessageEvent<unknown>[] = [];
  const schemasById = new Map<number, Mcap0Types.TypedMcapRecords["Schema"]>();
  const channelInfoById = new Map<
    number,
    {
      channel: Mcap0Types.TypedMcapRecords["Channel"];
      parsedChannel: ParsedChannel;
      schemaName: string;
    }
  >();

  function processRecord(record: Mcap0Types.TypedMcapRecord) {
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
            isEqual(info.schema, schema.data)
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
        messages.push({
          topic: info.channel.topic,
          receiveTime,
          message: info.parsedChannel.deserializer(record.data),
          sizeInBytes: record.data.byteLength,
          schemaName: info.schemaName,
        });
        return;
      }
    }
  }

  try {
    // Since every request is signed with a new token, there's no benefit to caching.
    const response = await fetch(
      `/v1/data/getStreams?start=${toRFC3339String(params.start)}&end=${toRFC3339String(
        params.end,
      )}&recordId=warehouses%2F7d58a141-3cdd-457e-bef2-cac3556b70fd%2Fprojects%2F1b864a55-47d7-4e30-8a24-770ec022c8ec%2Frecords%2F82e6b158-d77f-43a6-98c5-6bf15a96c296&revisionName=warehouses%2F7d58a141-3cdd-457e-bef2-cac3556b70fd%2Fprojects%2F1b864a55-47d7-4e30-8a24-770ec022c8ec%2Frecords%2F82e6b158-d77f-43a6-98c5-6bf15a96c296%2Frevisions%2F78ca39accb7d201ba3e296e76a7e910f09c5bf07a8634827b4a68e6190bb7986`,
      {
        signal: controller.signal,
        cache: "no-cache",
        headers: {
          // Include the version of studio in the request Useful when scraping logs to determine what
          // versions of the app are making requests.
          "fg-user-agent": FOXGLOVE_USER_AGENT,
          Authorization: `Bearer eyJraWQiOiI2YmE0N2Y0My02MWZkLTRlOGYtODhjMy05MTZjZTU3YjZlY2IiLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI4OTNmNDdkNy0wMDFhLTQ1YjctOWFmZS03NWVkZWE5MTM4M2UiLCJpc3MiOiJodHRwczovL2FwaS5jb3NjZW5lLmRldi9zdXBlcnRva2Vucy1zZXJ2ZXIvYXV0aCIsImV4cCI6MTY2OTQ3NDQwNSwiaWF0IjoxNjY5NDUyNzc0LCJvcmdJZCI6IjNkZDc2ZmYyLTgzOWQtNDlhMy04MmFmLTY2MzQyMmI2OWIwMSJ9.BdU5WUSo48pYg46GXubeOT2mtedqeZ34UHF8POcrcihKogDnVTqce7SpWJbNqJzbNtYyFc8TW0m8p0RY6ofa699EYVc5cilH_OnHV_g1ShardctSJSsVfnkH2z-h4iIzqX8SSk4Ob8P3bqWpsrmTx1nXosW13r3qXiOlT6sT0f5JwEBRBmw993taduk8a12OVkNBrCn-Rgz_HT7Wao8NS9lLSpf3knr1xGCqpEE5zY5DgASqTRccHSSy5kq6NdzxIzNHY2NtDCt0DPXJivW8WgjknNx-cgIAEIbHk-l571NG_CNGnNGk8YUDVZwmj9thAoVnvPbkxjKv95Nv2ueGHA`,
        },
      },
    );
    if (response.status === 404) {
      return;
    } else if (response.status !== 200) {
      log.error(`${response.status} response for`, response);
      throw new Error(`Unexpected response status ${response.status}`);
    }
    if (!response.body) {
      throw new Error("Unable to stream response body");
    }
    const streamReader = response.body.getReader();

    let normalReturn = false;
    parseLoop: try {
      const reader = new Mcap0StreamReader({ decompressHandlers });
      for (let result; (result = await streamReader.read()), !result.done; ) {
        reader.append(result.value);
        for (let record; (record = reader.nextRecord()); ) {
          if (record.type === "DataEnd") {
            normalReturn = true;
            break;
          }
          processRecord(record);
        }
        if (messages.length > 0) {
          yield messages;
          messages = [];
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

  log.debug(
    "Streamed",
    totalMessages,
    "messages",
    messages,
    "in",
    `${performance.now() - startTimer}ms`,
  );
}
