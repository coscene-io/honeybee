// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/* eslint-disable @typescript-eslint/no-deprecated */

import * as base64 from "@protobufjs/base64";
import { t } from "i18next";
import * as _ from "lodash-es";
import race from "race-as-promised";
import { Trans } from "react-i18next";
import { v4 as uuidv4 } from "uuid";

import { debouncePromise } from "@foxglove/den/async";
import Log from "@foxglove/log";
import { parseChannel, ParsedChannel } from "@foxglove/mcap-support";
import { MessageDefinition, isMsgDefEqual } from "@foxglove/message-definition";
import CommonRosTypes from "@foxglove/rosmsg-msgs-common";
import { MessageWriter as Ros1MessageWriter } from "@foxglove/rosmsg-serialization";
import { MessageWriter as Ros2MessageWriter } from "@foxglove/rosmsg2-serialization";
import {
  fromMillis,
  fromNanoSec,
  isGreaterThan,
  isLessThan,
  Time,
  toMillis,
} from "@foxglove/rostime";
import { ParameterValue } from "@foxglove/studio";
import { Asset } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import { IndexedDbMessageStore } from "@foxglove/studio-base/persistence/IndexedDbMessageStore";
import type { PersistentMessageCache } from "@foxglove/studio-base/persistence/PersistentMessageCache";
import PlayerProblemManager from "@foxglove/studio-base/players/PlayerProblemManager";
import { estimateObjectSize } from "@foxglove/studio-base/players/messageMemoryEstimation";
import {
  AdvertiseOptions,
  MessageEvent,
  Player,
  PlayerCapabilities,
  PlayerMetricsCollectorInterface,
  PlayerPresence,
  PlayerProblem,
  PlayerState,
  PublishPayload,
  SubscribePayload,
  Topic,
  TopicStats,
} from "@foxglove/studio-base/players/types";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";
import rosDatatypesToMessageDefinition from "@foxglove/studio-base/util/rosDatatypesToMessageDefinition";
import {
  Channel,
  ChannelId,
  ClientChannel,
  FoxgloveClient,
  ServerCapability,
  SubscriptionId,
  Service,
  ServiceCallPayload,
  ServiceCallRequest,
  ServiceCallResponse,
  Parameter,
  StatusLevel,
  FetchAssetStatus,
  FetchAssetResponse,
  BinaryOpcode,
  PreFetchAssetResponse,
} from "@foxglove/ws-protocol";

import { JsonMessageWriter } from "./JsonMessageWriter";
import { MessageWriter } from "./MessageWriter";
import WorkerSocketAdapter from "./WorkerSocketAdapter";
import { CloseEventMessage } from "./worker";

const log = Log.getLogger(__dirname);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Suppress warnings about messages on unknown subscriptions if the susbscription was recently canceled. */
const SUBSCRIPTION_WARNING_SUPPRESSION_MS = 2000;

const ZERO_TIME = Object.freeze({ sec: 0, nsec: 0 });
const GET_ALL_PARAMS_REQUEST_ID = "get-all-params";
const GET_ALL_PARAMS_PERIOD_MS = 15000;
const ROS_ENCODINGS = ["ros1", "cdr"];
const SUPPORTED_PUBLICATION_ENCODINGS = ["json", ...ROS_ENCODINGS];
const FALLBACK_PUBLICATION_ENCODING = "json";
const SUPPORTED_SERVICE_ENCODINGS = ["json", ...ROS_ENCODINGS];

type ResolvedChannel = {
  channel: Channel;
  parsedChannel: ParsedChannel;
};
type Publication = ClientChannel & { messageWriter?: Ros1MessageWriter | Ros2MessageWriter };
type ResolvedService = {
  service: Service;
  parsedResponse: ParsedChannel;
  requestMessageWriter: MessageWriter;
};
type MessageDefinitionMap = Map<string, MessageDefinition>;
interface DeviceInfo {
  macAddr: string;
}

/**
 * When the tab is inactive setTimeout's are throttled to at most once per second.
 * Because the MessagePipeline listener uses timeouts to resolve its promises, it throttles our ability to
 * emit a frame more than once per second. In the websocket player this was causing
 * an accumulation of messages that were waiting to be emitted, this could keep growing
 * indefinitely if the rate at which we emit a frame is low enough.
 * 400MB
 */
const CURRENT_FRAME_MAXIMUM_SIZE_BYTES = 400 * 1024 * 1024;

const WEBSOCKET_KICKED_CODE = 4001;

type KickedReason = {
  username: string;
};

export default class FoxgloveWebSocketPlayer implements Player {
  readonly #sourceId: string;

  #url: string; // WebSocket URL.
  #name: string;
  #client?: FoxgloveClient; // The client when we're connected.
  #id: string = uuidv4(); // Unique ID for this player session.
  #serverCapabilities: string[] = [];
  #playerCapabilities: (typeof PlayerCapabilities)[keyof typeof PlayerCapabilities][] = [];
  #supportedEncodings?: string[];
  #listener?: (arg0: PlayerState) => Promise<void>; // Listener for _emitState().
  #closed: boolean = false; // Whether the player has been completely closed using close().
  #topics?: Topic[]; // Topics as published by the WebSocket.
  #topicsStats = new Map<string, TopicStats>(); // Topic names to topic statistics.
  #datatypes: MessageDefinitionMap = new Map(); // Datatypes as published by the WebSocket.
  #parsedMessages: MessageEvent[] = []; // Queue of messages that we'll send in next _emitState() call.
  #parsedMessagesBytes: number = 0;
  #receivedBytes: number = 0;
  #metricsCollector: PlayerMetricsCollectorInterface;
  #presence: PlayerPresence = PlayerPresence.INITIALIZING;
  #problems = new PlayerProblemManager();
  #numTimeSeeks = 0;
  #profile?: string;
  #urlState: PlayerState["urlState"];

  /** Earliest time seen */
  #startTime?: Time;
  /** Latest time seen */
  #endTime?: Time;
  /* The most recent published time, if available */
  #clockTime?: Time;
  /* Flag indicating if the server publishes time messages */
  #serverPublishesTime = false;

  #unresolvedSubscriptions = new Set<string>();
  #resolvedSubscriptionsByTopic = new Map<string, SubscriptionId>();
  #resolvedSubscriptionsById = new Map<SubscriptionId, ResolvedChannel>();
  #channelsByTopic = new Map<string, ResolvedChannel>();

  // Network status tracking
  #networkStatus: {
    networkDelay?: number;
    curSpeed?: number;
    droppedMsgs?: number;
    packageLoss?: number;
  } = {};
  #timeOffset?: number;
  #channelsById = new Map<ChannelId, ResolvedChannel>();
  #unsupportedChannelIds = new Set<ChannelId>();
  #recentlyCanceledSubscriptions = new Set<SubscriptionId>();
  #parameters = new Map<string, ParameterValue>();
  #getParameterInterval?: ReturnType<typeof setInterval>;
  #openTimeout?: ReturnType<typeof setInterval>;
  #connectionAttemptTimeout?: ReturnType<typeof setInterval>;
  #unresolvedPublications: AdvertiseOptions[] = [];
  #publicationsByTopic = new Map<string, Publication>();
  #serviceCallEncoding?: string;
  #servicesByName = new Map<string, ResolvedService>();
  #serviceResponseCbs = new Map<
    ServiceCallRequest["callId"],
    (response: ServiceCallResponse) => void
  >();
  #publishedTopics?: Map<string, Set<string>>;
  #subscribedTopics?: Map<string, Set<string>>;
  #advertisedServices?: Map<string, Set<string>>;
  #nextServiceCallId = 0;
  #nextAssetRequestId = 0;
  #nextPreFetchAssetRequestId = 0;
  #fetchAssetRequests = new Map<number, (response: FetchAssetResponse) => void>();
  #fetchedAssets = new Map<string, Promise<Asset>>();
  #preFetchAssetRequests = new Map<number, (response: PreFetchAssetResponse) => void>();
  #preFetchedAssets = new Map<string, Promise<string>>();
  #parameterTypeByName = new Map<string, Parameter["type"]>();
  #messageSizeEstimateByTopic: Record<string, number> = {};
  #confirm: confirmTypes;

  #userId: string;
  #username: string;
  #deviceName: string;
  #isReconnect: boolean = false;
  #authHeader: string;

  /** Persistent message cache for 5-minute historical data */
  #persistentCache?: PersistentMessageCache;
  /** Whether to enable persistent caching */
  #enablePersistentCache: boolean = true;
  #retentionWindowMs?: number;
  #sessionId?: string;
  #serverTime?: Time;

  public constructor({
    url,
    metricsCollector,
    sourceId,
    params,
    confirm,
    userId,
    username,
    deviceName,
    authHeader,
    sessionId,
    enablePersistentCache,
    retentionWindowMs,
  }: {
    url: string;
    metricsCollector: PlayerMetricsCollectorInterface;
    sourceId: string;
    params: Record<string, string | undefined>;
    confirm: confirmTypes;
    userId: string;
    username: string;
    deviceName: string;
    authHeader: string;
    sessionId?: string;
    enablePersistentCache?: boolean;
    retentionWindowMs?: number;
  }) {
    this.#metricsCollector = metricsCollector;
    this.#url = url;
    this.#name = url;
    this.#metricsCollector.playerConstructed();
    this.#sourceId = sourceId;
    this.#urlState = {
      sourceId: this.#sourceId,
      parameters: { ...params, url: this.#url, linkType: "unknown" },
    };
    this.#confirm = confirm;
    this.#userId = userId;
    this.#username = username;
    this.#deviceName = deviceName;
    this.#authHeader = authHeader;
    this.#enablePersistentCache = enablePersistentCache ?? true;
    this.#retentionWindowMs = retentionWindowMs;
    this.#sessionId = sessionId;

    // Initialize persistent cache if enabled
    if (
      this.#enablePersistentCache &&
      this.#retentionWindowMs != undefined &&
      this.#retentionWindowMs > 0
    ) {
      try {
        this.#persistentCache = new IndexedDbMessageStore({
          retentionWindowMs: this.#retentionWindowMs,
          sessionId: this.#sessionId ?? `websocket-${this.#id}`,
        });
        void this.#persistentCache.init().catch((error: unknown) => {
          log.warn("Failed to initialize persistent cache:", error);
          this.#persistentCache = undefined;
        });
      } catch (error) {
        log.warn("Failed to create persistent cache:", error);
        this.#persistentCache = undefined;
      }
    }

    this.#open();
  }
  #open = (): void => {
    if (this.#closed) {
      return;
    }
    if (this.#client != undefined) {
      throw new Error(`Attempted to open a second coScene WebSocket connection`);
    }
    log.info(`Opening connection to ${this.#url}`);

    // Set a timeout to abort the connection if we are still not connected by then.
    // This will abort hanging connection attempts that can for whatever reason not
    // establish a connection with the server.
    this.#connectionAttemptTimeout = setTimeout(() => {
      this.#client?.close();
    }, 10000);

    this.#client = new FoxgloveClient({
      ws:
        typeof Worker !== "undefined"
          ? new WorkerSocketAdapter(
              `${this.#url}${this.#url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(
                this.#authHeader,
              )}`,
              [FoxgloveClient.SUPPORTED_SUBPROTOCOL],
            )
          : new WebSocket(
              `${this.#url}${this.#url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(
                this.#authHeader,
              )}`,
              [FoxgloveClient.SUPPORTED_SUBPROTOCOL],
            ),
    });

    this.#client.on("open", () => {
      if (this.#closed || !this.#client) {
        return;
      }
      if (this.#connectionAttemptTimeout != undefined) {
        clearTimeout(this.#connectionAttemptTimeout);
      }
      this.#presence = PlayerPresence.PRESENT;
      this.#resetSessionState();
      this.#problems.clear();
      this.#channelsById.clear();
      this.#channelsByTopic.clear();
      this.#servicesByName.clear();
      this.#serviceResponseCbs.clear();
      this.#publicationsByTopic.clear();
      for (const topic of this.#resolvedSubscriptionsByTopic.keys()) {
        this.#unresolvedSubscriptions.add(topic);
      }
      this.#resolvedSubscriptionsById.clear();
      this.#resolvedSubscriptionsByTopic.clear();

      // Re-assign members that are emitted as player state
      this.#profile = undefined;
      this.#publishedTopics = undefined;
      this.#subscribedTopics = undefined;
      this.#advertisedServices = undefined;
      this.#datatypes = new Map();
      this.#parameters = new Map();
    });

    this.#client.on("login", (message) => {
      if (this.#isReconnect) {
        this.#isReconnect = false;
        this.#client?.login(this.#userId, this.#username);
        return;
      }

      this.#urlState = {
        sourceId: this.#sourceId,
        parameters: {
          ...this.#urlState?.parameters,
          linkType: message.linkType ?? "unknown",
        },
      };

      this.#emitState();

      // if message.userId is not undefined, is some one connecting to the same device
      if (message.userId) {
        void this.#confirm({
          title: t("cosWebsocket:note"),
          prompt: (
            <Trans
              t={t}
              i18nKey="cosWebsocket:connectionOccupied"
              values={{
                deviceName: this.#deviceName,
                username: message.username,
              }}
              components={{
                strong: <strong />,
              }}
            />
          ),
          disableEscapeKeyDown: true,
          disableBackdropClick: true,
          ok: t("cosWebsocket:confirm"),
          cancel: t("cosWebsocket:exitAndClosePage"),
          variant: "danger",
        }).then((result) => {
          if (result === "ok") {
            void this.#checkLanReachable(
              message.lanCandidates,
              message.infoPort,
              message.macAddr,
              message.linkType ?? "unknown",
            );
          }
          if (result === "cancel") {
            window.close();
          }
        });
      } else {
        void this.#checkLanReachable(
          message.lanCandidates,
          message.infoPort,
          message.macAddr,
          message.linkType ?? "unknown",
        );
      }
    });

    this.#client.on("kicked", (message) => {
      void this.close();
      void this.#confirm({
        title: t("cosWebsocket:notification"),
        prompt: (
          <Trans
            t={t}
            i18nKey="cosWebsocket:vizIsTkenNow"
            values={{
              deviceName: this.#deviceName,
              username: message.username,
            }}
            components={{
              strong: <strong />,
            }}
          />
        ),
        disableEscapeKeyDown: true,
        disableBackdropClick: true,
        ok: t("cosWebsocket:reconnect"),
        cancel: t("cosWebsocket:exitAndClosePage"),
        variant: "danger",
      }).then((result) => {
        if (result === "ok") {
          this.#isReconnect = true;
          this.reOpen();
        }
        if (result === "cancel") {
          window.close();
        }
      });
    });

    this.#client.on("error", (err) => {
      log.error(err);

      if (
        (err as unknown as undefined | { message?: string })?.message != undefined &&
        err.message.includes("insecure WebSocket connection")
      ) {
        this.#problems.addProblem("ws:connection-failed", {
          severity: "error",
          message: "Insecure WebSocket connection",
          tip: `Check that the WebSocket server at ${
            this.#url
          } is reachable and supports protocol version coscene.websocket.protocol.`,
        });
        this.#emitState();
      }
    });

    // Note: We've observed closed being called not only when an already open connection is closed
    // but also when a new connection fails to open
    //
    // Note: We explicitly avoid clearing state like start/end times, datatypes, etc to preserve
    // this during a disconnect event. Any necessary state clearing is handled once a new connection
    // is established
    this.#client.on("close", (event) => {
      if (this.#closed) {
        return;
      }

      // Foxglove type description is incorrect, we need to cast to the correct type
      const realCloseEventMessage: { type: "close"; data: CloseEventMessage } =
        event as unknown as {
          type: "close";
          data: CloseEventMessage;
        };

      if (realCloseEventMessage.data.code === WEBSOCKET_KICKED_CODE) {
        const message = JSON.parse(realCloseEventMessage.data.reason) as KickedReason;

        void this.close();
        void this.#confirm({
          title: t("cosWebsocket:notification"),
          prompt: (
            <Trans
              t={t}
              i18nKey="cosWebsocket:vizIsTkenNow"
              values={{
                deviceName: this.#deviceName,
                username: message.username,
              }}
              components={{
                strong: <strong />,
              }}
            />
          ),
          disableEscapeKeyDown: true,
          disableBackdropClick: true,
          ok: t("cosWebsocket:reconnect"),
          cancel: t("cosWebsocket:exitAndClosePage"),
          variant: "danger",
        }).then((result) => {
          if (result === "ok") {
            this.#isReconnect = true;
            this.reOpen();
          }
          if (result === "cancel") {
            window.close();
          }
        });
      } else {
        log.info("Connection closed:", realCloseEventMessage);
        this.#presence = PlayerPresence.RECONNECTING;

        if (this.#getParameterInterval != undefined) {
          clearInterval(this.#getParameterInterval);
          this.#getParameterInterval = undefined;
        }
        if (this.#connectionAttemptTimeout != undefined) {
          clearTimeout(this.#connectionAttemptTimeout);
        }

        this.#client?.close();
        this.#client = undefined;

        if (realCloseEventMessage.data.code !== 1000) {
          this.#problems.addProblem("ws:connection-failed", {
            severity: "error",
            message: t("cosError:connectionFailed"),
            tip: (
              <span>
                {t("cosError:insecureWebSocketConnectionMessage", {
                  url: this.#url,
                  version: "coscene.websocket.protocol",
                })}
                <br />
                1. {t("cosError:checkNetworkConnection")}
                <br />
                2.{" "}
                <Trans
                  t={t}
                  i18nKey="cosError:checkFoxgloveBridge"
                  components={{
                    docLink: (
                      <a
                        style={{ color: "#2563eb" }}
                        target="_blank"
                        href="https://github.com/coscene-io/coBridge"
                        rel="noopener"
                      />
                    ),
                  }}
                />
                <br />
                3. {t("cosError:contactUs")}
              </span>
            ),
          });
        }

        this.#emitState();
        this.#openTimeout = setTimeout(this.#open, 3000);
      }
    });

    this.#client.on("serverInfo", (event) => {
      if (!Array.isArray(event.capabilities)) {
        this.#problems.addProblem("ws:invalid-capabilities", {
          severity: "warn",
          message: `Server sent an invalid or missing capabilities field: '${event.capabilities}'`,
        });
      }

      const newSessionId = event.sessionId ?? uuidv4();
      if (this.#id !== newSessionId) {
        this.#resetSessionState();
      }

      this.#id = newSessionId;
      this.#name = `${this.#url}\n${event.name}`;
      this.#serverCapabilities = Array.isArray(event.capabilities) ? event.capabilities : [];
      this.#serverPublishesTime = this.#serverCapabilities.includes(ServerCapability.time);
      this.#supportedEncodings = event.supportedEncodings;
      this.#datatypes = new Map();

      // If the server publishes the time we clear any existing clockTime we might have and let the
      // server override
      if (this.#serverPublishesTime) {
        this.#clockTime = undefined;
      }

      const maybeRosDistro = event.metadata?.["ROS_DISTRO"];
      if (maybeRosDistro) {
        const rosDistro = maybeRosDistro;
        const isRos1 = ["melodic", "noetic"].includes(rosDistro);
        this.#profile = isRos1 ? "ros1" : "ros2";

        // Add common ROS message definitions
        const rosDataTypes = isRos1
          ? CommonRosTypes.ros1
          : ["foxy", "galactic"].includes(rosDistro)
          ? CommonRosTypes.ros2galactic
          : CommonRosTypes.ros2humble;

        const dataTypes: MessageDefinitionMap = new Map();
        for (const dataType in rosDataTypes) {
          const msgDef = (rosDataTypes as Record<string, MessageDefinition>)[dataType]!;
          dataTypes.set(dataType, msgDef);
        }
        this.#updateDataTypes(dataTypes);
      }

      if (event.capabilities.includes(ServerCapability.clientPublish)) {
        this.#playerCapabilities = this.#playerCapabilities.concat(PlayerCapabilities.advertise);
        this.#setupPublishers();
      }
      if (event.capabilities.includes(ServerCapability.services)) {
        this.#serviceCallEncoding = event.supportedEncodings?.find((e) =>
          SUPPORTED_SERVICE_ENCODINGS.includes(e),
        );

        const problemId = "callService:unsupportedEncoding";
        if (this.#serviceCallEncoding) {
          this.#playerCapabilities = this.#playerCapabilities.concat(
            PlayerCapabilities.callServices,
          );
          this.#problems.removeProblem(problemId);
        } else {
          this.#problems.addProblem(problemId, {
            severity: "warn",
            message: `Calling services is disabled as no compatible encoding could be found. \
            The server supports [${event.supportedEncodings?.join(", ")}], \
            but Studio only supports [${SUPPORTED_SERVICE_ENCODINGS.join(", ")}]`,
          });
        }
      }

      if (event.capabilities.includes(ServerCapability.parameters)) {
        this.#playerCapabilities = this.#playerCapabilities.concat(
          PlayerCapabilities.getParameters,
          PlayerCapabilities.setParameters,
        );

        // Periodically request all available parameters.
        this.#getParameterInterval = setInterval(() => {
          this.#client?.getParameters([], GET_ALL_PARAMS_REQUEST_ID);
        }, GET_ALL_PARAMS_PERIOD_MS);

        this.#client?.getParameters([], GET_ALL_PARAMS_REQUEST_ID);
      }

      if (event.capabilities.includes(ServerCapability.connectionGraph)) {
        this.#client?.subscribeConnectionGraph();
      }

      if (event.capabilities.includes(ServerCapability.assets)) {
        this.#playerCapabilities = this.#playerCapabilities.concat(PlayerCapabilities.assets);
      }

      this.#emitState();
    });

    this.#client.on("status", (event) => {
      const msg = `FoxgloveWebSocket: ${event.message}`;
      if (event.level === StatusLevel.INFO) {
        log.info(msg);
      } else if (event.level === StatusLevel.WARNING) {
        log.warn(msg);
      } else {
        log.error(msg);
      }

      const problem: PlayerProblem = {
        message: event.message,
        severity: statusLevelToProblemSeverity(event.level),
      };

      if (event.message === "Send buffer limit reached") {
        problem.tip =
          "Server is dropping messages to the client. Check if you are subscribing to large or frequent topics or adjust your server send buffer limit.";
      }

      this.#problems.addProblem(event.message, problem);
      this.#emitState();
    });

    this.#client.on("advertise", (newChannels) => {
      for (const channel of newChannels) {
        let parsedChannel;
        try {
          let schemaEncoding;
          let schemaData;
          if (
            channel.encoding === "json" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "jsonschema")
          ) {
            schemaEncoding = "jsonschema";
            schemaData = textEncoder.encode(channel.schema);
          } else if (
            channel.encoding === "protobuf" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "protobuf")
          ) {
            schemaEncoding = "protobuf";
            schemaData = new Uint8Array(base64.length(channel.schema));
            if (base64.decode(channel.schema, schemaData, 0) !== schemaData.byteLength) {
              throw new Error(`Failed to decode base64 schema on channel ${channel.id}`);
            }
          } else if (
            channel.encoding === "flatbuffer" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "flatbuffer")
          ) {
            schemaEncoding = "flatbuffer";
            schemaData = new Uint8Array(base64.length(channel.schema));
            if (base64.decode(channel.schema, schemaData, 0) !== schemaData.byteLength) {
              throw new Error(`Failed to decode base64 schema on channel ${channel.id}`);
            }
          } else if (
            channel.encoding === "ros1" &&
            (channel.schemaEncoding == undefined || channel.schemaEncoding === "ros1msg")
          ) {
            schemaEncoding = "ros1msg";
            schemaData = textEncoder.encode(channel.schema);
          } else if (
            channel.encoding === "cdr" &&
            (channel.schemaEncoding == undefined ||
              ["ros2idl", "ros2msg", "omgidl"].includes(channel.schemaEncoding))
          ) {
            schemaEncoding = channel.schemaEncoding ?? "ros2msg";
            schemaData = textEncoder.encode(channel.schema);
          } else {
            const msg = channel.schemaEncoding
              ? `Unsupported combination of message / schema encoding: (${channel.encoding} / ${channel.schemaEncoding})`
              : `Unsupported message encoding ${channel.encoding}`;
            throw new Error(msg);
          }
          parsedChannel = parseChannel({
            messageEncoding: channel.encoding,
            schema: { name: channel.schemaName, encoding: schemaEncoding, data: schemaData },
          });
        } catch (error) {
          this.#unsupportedChannelIds.add(channel.id);
          this.#problems.addProblem(`schema:${channel.topic}`, {
            severity: "error",
            message: `Failed to parse channel schema on ${channel.topic}`,
            error,
          });
          this.#emitState();
          continue;
        }
        const existingChannel = this.#channelsByTopic.get(channel.topic);
        if (existingChannel && !_.isEqual(channel, existingChannel.channel)) {
          this.#problems.addProblem(`duplicate-topic:${channel.topic}`, {
            severity: "error",
            message: `Multiple channels advertise the same topic: ${channel.topic} (${existingChannel.channel.id} and ${channel.id})`,
          });
          this.#emitState();
          continue;
        }
        const resolvedChannel = { channel, parsedChannel };
        this.#channelsById.set(channel.id, resolvedChannel);
        this.#channelsByTopic.set(channel.topic, resolvedChannel);
      }
      this.#updateTopicsAndDatatypes();
      this.#emitState();
      this.#processUnresolvedSubscriptions();
    });

    this.#client.on("unadvertise", (removedChannels) => {
      for (const id of removedChannels) {
        const chanInfo = this.#channelsById.get(id);
        if (!chanInfo) {
          if (!this.#unsupportedChannelIds.delete(id)) {
            this.#problems.addProblem(`unadvertise:${id}`, {
              severity: "error",
              message: `Server unadvertised channel ${id} that was not advertised`,
            });
            this.#emitState();
          }
          continue;
        }
        for (const [subId, { channel }] of this.#resolvedSubscriptionsById) {
          if (channel.id === id) {
            this.#resolvedSubscriptionsById.delete(subId);
            this.#resolvedSubscriptionsByTopic.delete(channel.topic);
            this.#client?.unsubscribe(subId);
            this.#unresolvedSubscriptions.add(channel.topic);
          }
        }
        this.#channelsById.delete(id);
        this.#channelsByTopic.delete(chanInfo.channel.topic);
      }
      this.#updateTopicsAndDatatypes();
      this.#emitState();
    });

    this.#client.on("message", ({ subscriptionId, data, timestamp }) => {
      const chanInfo = this.#resolvedSubscriptionsById.get(subscriptionId);
      if (!chanInfo) {
        const wasRecentlyCanceled = this.#recentlyCanceledSubscriptions.has(subscriptionId);
        if (!wasRecentlyCanceled) {
          this.#problems.addProblem(`message-missing-subscription:${subscriptionId}`, {
            severity: "warn",
            message: `Received message on unknown subscription id: ${subscriptionId}. This might be a WebSocket server bug.`,
          });
          this.#emitState();
        }
        return;
      }

      this.#serverTime = fromNanoSec(timestamp);

      try {
        this.#receivedBytes += data.byteLength;
        const receiveTime = this.#getCurrentTime();
        const topic = chanInfo.channel.topic;
        const deserializedMessage = chanInfo.parsedChannel.deserialize(data);

        // Lookup the size estimate for this topic or compute it if not found in the cache.
        let msgSizeEstimate = this.#messageSizeEstimateByTopic[topic];
        if (msgSizeEstimate == undefined) {
          msgSizeEstimate = estimateObjectSize(deserializedMessage);
          this.#messageSizeEstimateByTopic[topic] = msgSizeEstimate;
        }

        const sizeInBytes = Math.max(data.byteLength, msgSizeEstimate);
        const messageEvent: MessageEvent = {
          topic,
          receiveTime,
          message: deserializedMessage,
          sizeInBytes,
          schemaName: chanInfo.channel.schemaName,
        };

        this.#parsedMessages.push(messageEvent);

        // Persist message to cache asynchronously (non-blocking)
        if (this.#persistentCache) {
          void this.#persistentCache.append([messageEvent]).catch((error: unknown) => {
            // Don't let cache errors affect real-time visualization
            log.debug("Failed to persist message to cache:", error);
          });
        }
        this.#parsedMessagesBytes += sizeInBytes;
        if (this.#parsedMessagesBytes > CURRENT_FRAME_MAXIMUM_SIZE_BYTES) {
          this.#problems.addProblem(`webSocketPlayer:parsedMessageCacheFull`, {
            severity: "error",
            message: `WebSocketPlayer maximum frame size (${(
              CURRENT_FRAME_MAXIMUM_SIZE_BYTES / 1_000_000
            ).toFixed(
              2,
            )}MB) reached. Dropping old messages. This accumulation can occur if the browser tab has been inactive.`,
          });
          // Amortize cost of dropping messages by dropping parsedMessages size to
          // 80% so that it doesn't happen for every message after reaching the limit
          const evictUntilSize = 0.8 * CURRENT_FRAME_MAXIMUM_SIZE_BYTES;
          let droppedBytes = 0;
          let indexToCutBefore = 0;
          while (this.#parsedMessagesBytes - droppedBytes > evictUntilSize) {
            droppedBytes += this.#parsedMessages[indexToCutBefore]!.sizeInBytes;
            indexToCutBefore++;
          }
          this.#parsedMessages.splice(0, indexToCutBefore);
          this.#parsedMessagesBytes -= droppedBytes;
        }

        // Update the message count for this topic
        const topicStats = new Map(this.#topicsStats);
        let stats = topicStats.get(topic);
        if (!stats) {
          stats = { numMessages: 0 };
          topicStats.set(topic, stats);
        }
        stats.numMessages++;
        this.#topicsStats = topicStats;

        const timeOffset = this.#timeOffset;
        if (typeof timeOffset === "number") {
          const serverTimeMs = toMillis(fromNanoSec(timestamp));
          this.#networkStatus = {
            ...this.#networkStatus,
            networkDelay: Date.now() - timeOffset - serverTimeMs,
          };
        }
      } catch (error) {
        this.#problems.addProblem(`message:${chanInfo.channel.topic}`, {
          severity: "error",
          message: `Failed to parse message on ${chanInfo.channel.topic}`,
          error,
        });
      }
      this.#emitState();
    });

    this.#client.on("time", ({ timestamp }) => {
      if (!this.#serverPublishesTime) {
        return;
      }

      const time = fromNanoSec(timestamp);
      if (this.#clockTime != undefined && isLessThan(time, this.#clockTime)) {
        this.#numTimeSeeks++;
        this.#parsedMessages = [];
        this.#parsedMessagesBytes = 0;
      }

      // Override any previous start/end time when we set a clockTime for the first time which means
      // we've received the first "time" event and know the server controlled time.
      if (!this.#clockTime) {
        this.#startTime = time;
        this.#endTime = time;
      }

      this.#clockTime = time;
      this.#emitState();
    });

    this.#client.on("parameterValues", ({ parameters, id }) => {
      const mappedParameters = parameters.map((param) => {
        return param.type === "byte_array"
          ? {
              ...param,
              value: Uint8Array.from(atob(param.value as string), (c) => c.charCodeAt(0)),
            }
          : param;
      });
      const parameterTypes = parameters.map((p) => [p.name, p.type] as [string, Parameter["type"]]);
      const parameterTypesMap = new Map<string, Parameter["type"]>(parameterTypes);

      const newParameters = mappedParameters.filter((param) => !this.#parameters.has(param.name));

      if (id === GET_ALL_PARAMS_REQUEST_ID) {
        // Reset params
        this.#parameters = new Map(mappedParameters.map((param) => [param.name, param.value]));
        this.#parameterTypeByName = parameterTypesMap;
      } else {
        // Update params
        const updatedParameters = new Map(this.#parameters);
        mappedParameters.forEach((param) => updatedParameters.set(param.name, param.value));
        this.#parameters = updatedParameters;
        for (const [paramName, paramType] of parameterTypesMap) {
          this.#parameterTypeByName.set(paramName, paramType);
        }
      }

      this.#emitState();

      if (
        newParameters.length > 0 &&
        this.#serverCapabilities.includes(ServerCapability.parametersSubscribe)
      ) {
        // Subscribe to value updates of new parameters
        this.#client?.subscribeParameterUpdates(newParameters.map((p) => p.name));
      }
    });

    this.#client.on("advertiseServices", (services) => {
      if (!this.#serviceCallEncoding) {
        return;
      }

      let defaultSchemaEncoding = "";
      if (this.#serviceCallEncoding === "json") {
        defaultSchemaEncoding = "jsonschema";
      } else if (this.#serviceCallEncoding === "ros1") {
        defaultSchemaEncoding = "ros1msg";
      } else if (this.#serviceCallEncoding === "cdr") {
        defaultSchemaEncoding = "ros2msg";
      }

      for (const service of services) {
        const serviceProblemId = `service:${service.id}`;
        // If not explicitly given, derive request / response type name from the service type
        // (according to ROS convention).
        const requestType = service.request?.schemaName ?? `${service.type}_Request`;
        const responseType = service.response?.schemaName ?? `${service.type}_Response`;
        const requestMsgEncoding = service.request?.encoding ?? this.#serviceCallEncoding;
        const responseMsgEncoding = service.response?.encoding ?? this.#serviceCallEncoding;

        try {
          if (
            (service.request == undefined && service.requestSchema == undefined) ||
            (service.response == undefined && service.responseSchema == undefined)
          ) {
            throw new Error("Invalid service definition, at least one required field is missing");
          } else if (
            !defaultSchemaEncoding &&
            (service.request == undefined || service.response == undefined)
          ) {
            throw new Error("Cannot determine service request or response schema encoding");
          } else if (!SUPPORTED_SERVICE_ENCODINGS.includes(requestMsgEncoding)) {
            const supportedEncodingsStr = SUPPORTED_SERVICE_ENCODINGS.join(", ");
            throw new Error(
              `Unsupported service request message encoding. ${requestMsgEncoding} not in list of supported encodings [${supportedEncodingsStr}]`,
            );
          }

          const parseChannelOptions = { allowEmptySchema: true };
          const parsedRequest = parseChannel(
            {
              messageEncoding: requestMsgEncoding,
              schema: {
                name: requestType,
                encoding: service.request?.schemaEncoding ?? defaultSchemaEncoding,
                data: textEncoder.encode(service.request?.schema ?? service.requestSchema),
              },
            },
            parseChannelOptions,
          );
          const parsedResponse = parseChannel(
            {
              messageEncoding: responseMsgEncoding,
              schema: {
                name: responseType,
                encoding: service.response?.schemaEncoding ?? defaultSchemaEncoding,
                data: textEncoder.encode(service.response?.schema ?? service.responseSchema),
              },
            },
            parseChannelOptions,
          );
          const requestMsgDef = rosDatatypesToMessageDefinition(
            parsedRequest.datatypes,
            requestType,
          );
          let requestMessageWriter: MessageWriter | undefined;
          if (requestMsgEncoding === "ros1") {
            requestMessageWriter = new Ros1MessageWriter(requestMsgDef);
          } else if (requestMsgEncoding === "cdr") {
            requestMessageWriter = new Ros2MessageWriter(requestMsgDef);
          } else if (requestMsgEncoding === "json") {
            requestMessageWriter = new JsonMessageWriter();
          }
          if (!requestMessageWriter) {
            // Should never go here as we sanity-checked the encoding already above
            throw new Error(`Unsupported service request message encoding ${requestMsgEncoding}`);
          }

          // Add type definitions for service response and request
          this.#updateDataTypes(parsedRequest.datatypes);
          this.#updateDataTypes(parsedResponse.datatypes);

          const resolvedService: ResolvedService = {
            service,
            parsedResponse,
            requestMessageWriter,
          };
          this.#servicesByName.set(service.name, resolvedService);
          this.#problems.removeProblem(serviceProblemId);
        } catch (error) {
          this.#problems.addProblem(serviceProblemId, {
            severity: "error",
            message: `Failed to parse service ${service.name}`,
            error,
          });
        }
      }
      this.#emitState();
    });

    this.#client.on("unadvertiseServices", (serviceIds) => {
      let needsStateUpdate = false;
      for (const serviceId of serviceIds) {
        const service: ResolvedService | undefined = Object.values(this.#servicesByName).find(
          (srv) => srv.service.id === serviceId,
        );
        if (service) {
          this.#servicesByName.delete(service.service.name);
        }
        const serviceProblemId = `service:${serviceId}`;
        needsStateUpdate = this.#problems.removeProblem(serviceProblemId) || needsStateUpdate;
      }
      if (needsStateUpdate) {
        this.#emitState();
      }
    });

    this.#client.on("serviceCallResponse", (response) => {
      const responseCallback = this.#serviceResponseCbs.get(response.callId);
      if (!responseCallback) {
        this.#problems.addProblem(`callService:${response.callId}`, {
          severity: "error",
          message: `Received a response for a service for which no callback was registered`,
        });
        return;
      }
      responseCallback(response);
      this.#serviceResponseCbs.delete(response.callId);
    });

    this.#client.on("connectionGraphUpdate", (event) => {
      if (event.publishedTopics.length > 0 || event.removedTopics.length > 0) {
        const newMap = new Map<string, Set<string>>(this.#publishedTopics ?? new Map());
        for (const { name, publisherIds } of event.publishedTopics) {
          newMap.set(name, new Set(publisherIds));
        }
        event.removedTopics.forEach((topic) => newMap.delete(topic));
        this.#publishedTopics = newMap;
      }
      if (event.subscribedTopics.length > 0 || event.removedTopics.length > 0) {
        const newMap = new Map<string, Set<string>>(this.#subscribedTopics ?? new Map());
        for (const { name, subscriberIds } of event.subscribedTopics) {
          newMap.set(name, new Set(subscriberIds));
        }
        event.removedTopics.forEach((topic) => newMap.delete(topic));
        this.#subscribedTopics = newMap;
      }
      if (event.advertisedServices.length > 0 || event.removedServices.length > 0) {
        const newMap = new Map<string, Set<string>>(this.#advertisedServices ?? new Map());
        for (const { name, providerIds } of event.advertisedServices) {
          newMap.set(name, new Set(providerIds));
        }
        event.removedServices.forEach((service) => newMap.delete(service));
        this.#advertisedServices = newMap;
      }

      this.#emitState();
    });

    this.#client.on("fetchAssetResponse", (response) => {
      const responseCallback = this.#fetchAssetRequests.get(response.requestId);
      if (!responseCallback) {
        throw Error(
          `Received a response for a fetch asset request for which no callback was registered`,
        );
      }
      responseCallback(response);
      this.#fetchAssetRequests.delete(response.requestId);
    });

    this.#client.on("preFetchAssetResponse", (response) => {
      const responseCallback = this.#preFetchAssetRequests.get(response.requestId);
      if (!responseCallback) {
        throw Error(
          `Received a response for a pre-fetch asset request for which no callback was registered`,
        );
      }
      responseCallback(response);
      this.#preFetchAssetRequests.delete(response.requestId);
    });

    this.#client.on("syncTime", ({ serverTime, receiveTime }) => {
      this.#client?.clientSyncTime(serverTime, receiveTime, Date.now() - receiveTime);
    });

    // delay of client to server
    this.#client.on("timeOffset", ({ timeOffset }) => {
      this.#timeOffset = timeOffset;
    });

    this.#client.on("networkStatistics", ({ droppedMsgs, packageLoss, curSpeed }) => {
      this.#networkStatus = {
        ...this.#networkStatus,
        droppedMsgs,
        packageLoss,
        curSpeed,
      };

      this.#emitState();
    });
  };

  #updateTopicsAndDatatypes() {
    // Build a new topics array from this._channelsById
    const topics: Topic[] = Array.from(this.#channelsById.values(), (chanInfo) => ({
      name: chanInfo.channel.topic,
      schemaName: chanInfo.channel.schemaName,
    }));

    // Remove stats entries for removed topics
    const topicsSet = new Set<string>(topics.map((topic) => topic.name));
    const topicStats = new Map(this.#topicsStats);
    for (const topic of topicStats.keys()) {
      if (!topicsSet.has(topic)) {
        topicStats.delete(topic);
      }
    }

    this.#topicsStats = topicStats;
    this.#topics = topics;

    // Update the _datatypes map;
    for (const { parsedChannel } of this.#channelsById.values()) {
      this.#updateDataTypes(parsedChannel.datatypes);
    }

    this.#emitState();
  }

  // Potentially performance-sensitive; await can be expensive
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  #emitState = debouncePromise(() => {
    if (!this.#listener || this.#closed) {
      return Promise.resolve();
    }

    if (!this.#topics) {
      return this.#listener({
        name: this.#name,
        presence: this.#presence,
        progress: {},
        capabilities: this.#playerCapabilities,
        profile: undefined,
        playerId: this.#id,
        activeData: undefined,
        problems: this.#problems.problems(),
        urlState: this.#urlState,
      });
    }

    const currentTime = this.#getCurrentTime();
    if (!this.#startTime || isLessThan(currentTime, this.#startTime)) {
      this.#startTime = currentTime;
    }
    if (!this.#endTime || isGreaterThan(currentTime, this.#endTime)) {
      this.#endTime = currentTime;
    }

    const messages = this.#parsedMessages;
    this.#parsedMessages = [];
    this.#parsedMessagesBytes = 0;

    return this.#listener({
      name: this.#name,
      presence: this.#presence,
      progress: {},
      capabilities: this.#playerCapabilities,
      profile: this.#profile,
      playerId: this.#id,
      problems: this.#problems.problems(),
      urlState: this.#urlState,

      activeData: {
        messages,
        totalBytesReceived: this.#receivedBytes,
        startTime: this.#startTime,
        endTime: this.#endTime,
        currentTime,
        isPlaying: true,
        repeatEnabled: false,
        speed: 1,
        lastSeekTime: this.#numTimeSeeks,
        topics: this.#topics,
        topicStats: this.#topicsStats,
        datatypes: this.#datatypes,
        parameters: this.#parameters,
        publishedTopics: this.#publishedTopics,
        subscribedTopics: this.#subscribedTopics,
        services: this.#advertisedServices,
        networkStatus: this.#networkStatus,
      },
    });
  });

  public setListener(listener: (arg0: PlayerState) => Promise<void>): void {
    this.#listener = listener;
    this.#emitState();
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;

    // If a client exists, wait for its "close" event so we know
    // the websocket is fully closed before resolving.
    const client = this.#client;
    let waitForClose: Promise<void> | undefined;
    if (client) {
      waitForClose = new Promise<void>((resolve) => {
        const onClose = () => {
          client.off("close", onClose);
          resolve();
        };
        client.on("close", onClose);
      });

      try {
        client.close();
      } catch {
        // ignore; we'll still proceed to cleanup
      }
    }

    // Clean up timers/intervals immediately while we wait for ws to close
    if (this.#openTimeout != undefined) {
      clearTimeout(this.#openTimeout);
      this.#openTimeout = undefined;
    }
    if (this.#getParameterInterval != undefined) {
      clearInterval(this.#getParameterInterval);
      this.#getParameterInterval = undefined;
    }
    if (this.#connectionAttemptTimeout != undefined) {
      clearTimeout(this.#connectionAttemptTimeout);
      this.#connectionAttemptTimeout = undefined;
    }

    // Await the close event with a timeout safeguard to avoid hanging
    if (waitForClose) {
      const timeoutMs = 5000;
      await race([waitForClose, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
    }

    // Release client reference after we have observed the close (or timed out)
    this.#client = undefined;

    try {
      // Clean up persistent cache
      await this.#persistentCache?.clear();
      await this.#persistentCache?.close();
      this.#persistentCache = undefined;
    } catch (error) {
      log.debug("Error closing persistent cache:", error);
    }
  }

  public reOpen(): void {
    if (!this.#closed) {
      return;
    }

    // Initialize persistent cache if enabled
    if (
      this.#enablePersistentCache &&
      this.#retentionWindowMs != undefined &&
      this.#retentionWindowMs > 0
    ) {
      try {
        this.#persistentCache = new IndexedDbMessageStore({
          retentionWindowMs: this.#retentionWindowMs,
          sessionId: this.#sessionId ?? `websocket-${this.#id}`,
        });
        void this.#persistentCache.init().catch((error: unknown) => {
          log.warn("Failed to initialize persistent cache:", error);
          this.#persistentCache = undefined;
        });
      } catch (error) {
        log.warn("Failed to create persistent cache:", error);
        this.#persistentCache = undefined;
      }
    }
    this.#closed = false;
    this.#open();
  }

  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    const newTopics = new Set(subscriptions.map(({ topic }) => topic));

    if (!this.#client || this.#closed) {
      // Remember requested subscriptions so we can retry subscribing when
      // the client is available.
      this.#unresolvedSubscriptions = newTopics;
      return;
    }

    for (const topic of newTopics) {
      if (!this.#resolvedSubscriptionsByTopic.has(topic)) {
        this.#unresolvedSubscriptions.add(topic);
      }
    }

    const topicStats = new Map(this.#topicsStats);
    for (const [topic, subId] of this.#resolvedSubscriptionsByTopic) {
      if (!newTopics.has(topic)) {
        this.#client.unsubscribe(subId);
        this.#resolvedSubscriptionsByTopic.delete(topic);
        this.#resolvedSubscriptionsById.delete(subId);
        this.#recentlyCanceledSubscriptions.add(subId);

        // Reset the message count for this topic
        topicStats.delete(topic);

        setTimeout(
          () => this.#recentlyCanceledSubscriptions.delete(subId),
          SUBSCRIPTION_WARNING_SUPPRESSION_MS,
        );
      }
    }
    this.#topicsStats = topicStats;

    for (const topic of this.#unresolvedSubscriptions) {
      if (!newTopics.has(topic)) {
        this.#unresolvedSubscriptions.delete(topic);
      }
    }

    this.#processUnresolvedSubscriptions();
  }

  #processUnresolvedSubscriptions() {
    if (!this.#client) {
      return;
    }

    for (const topic of this.#unresolvedSubscriptions) {
      const chanInfo = this.#channelsByTopic.get(topic);
      if (chanInfo) {
        const subId = this.#client.subscribe(chanInfo.channel.id);
        this.#unresolvedSubscriptions.delete(topic);
        this.#resolvedSubscriptionsByTopic.set(topic, subId);
        this.#resolvedSubscriptionsById.set(subId, chanInfo);
      }
    }
  }

  public setPublishers(publishers: AdvertiseOptions[]): void {
    // Filter out duplicates.
    const uniquePublications = _.uniqWith(publishers, _.isEqual);

    // Save publications and return early if we are not connected or the advertise capability is missing.
    if (
      !this.#client ||
      this.#closed ||
      !this.#playerCapabilities.includes(PlayerCapabilities.advertise)
    ) {
      this.#unresolvedPublications = uniquePublications;
      return;
    }

    // Determine new & removed publications.
    const currentPublications = Array.from(this.#publicationsByTopic.values());
    const removedPublications = currentPublications.filter((channel) => {
      return (
        uniquePublications.find(
          ({ topic, schemaName }) => channel.topic === topic && channel.schemaName === schemaName,
        ) == undefined
      );
    });
    const newPublications = uniquePublications.filter(({ topic, schemaName }) => {
      return (
        currentPublications.find(
          (publication) => publication.topic === topic && publication.schemaName === schemaName,
        ) == undefined
      );
    });

    // Unadvertise removed channels.
    for (const channel of removedPublications) {
      this.#unadvertiseChannel(channel);
    }

    // Advertise new channels.
    for (const publication of newPublications) {
      this.#advertiseChannel(publication);
    }

    if (removedPublications.length > 0 || newPublications.length > 0) {
      this.#emitState();
    }
  }

  public setParameter(key: string, value: ParameterValue): void {
    if (!this.#client) {
      throw new Error(`Attempted to set parameters without a valid coScene WebSocket connection`);
    }

    log.debug(`FoxgloveWebSocketPlayer.setParameter(key=${key}, value=${JSON.stringify(value)})`);
    const isByteArray = value instanceof Uint8Array;
    const paramValueToSent = isByteArray ? btoa(textDecoder.decode(value)) : value;
    this.#client.setParameters(
      [
        {
          name: key,
          value: paramValueToSent as Parameter["value"],
          type: isByteArray ? "byte_array" : this.#parameterTypeByName.get(key),
        },
      ],
      uuidv4(),
    );

    // Pre-actively update our parameter map, such that a change is detected if our update failed
    this.#parameters.set(key, value);
    this.#emitState();
  }

  public publish({ topic, msg }: PublishPayload): void {
    if (!this.#client) {
      throw new Error(t("dataCollection:attemptedToPublishWithoutValidCoSceneWebSocketConnection"));
    }

    const clientChannel = this.#publicationsByTopic.get(topic);
    if (!clientChannel) {
      throw new Error(
        t("dataCollection:triedToPublishOnTopicThatHasNotBeenAdvertisedBefore", { topic }),
      );
    }

    if (clientChannel.encoding === "json") {
      // Ensure that typed arrays are encoded as arrays and not objects.
      const replacer = (_key: string, value: unknown) => {
        return ArrayBuffer.isView(value)
          ? Array.from(value as unknown as ArrayLike<unknown>)
          : value;
      };
      const message = new Uint8Array(textEncoder.encode(JSON.stringify(msg, replacer) ?? ""));
      this.#client.sendMessage(clientChannel.id, message);
    } else if (
      ROS_ENCODINGS.includes(clientChannel.encoding) &&
      clientChannel.messageWriter != undefined
    ) {
      const message = clientChannel.messageWriter.writeMessage(msg);
      this.#client.sendMessage(clientChannel.id, message);
    }
  }

  public async callService(serviceName: string, request: unknown): Promise<unknown> {
    if (!this.#client) {
      throw new Error(
        `Attempted to call service ${serviceName} without a valid coScene WebSocket connection.`,
      );
    }

    if (request == undefined || typeof request !== "object") {
      throw new Error("coSceneWebSocketPlayer#callService request must be an object.");
    }

    const resolvedService = this.#servicesByName.get(serviceName);
    if (!resolvedService) {
      throw new Error(
        `Tried to call service '${serviceName}' that has not been advertised before.`,
      );
    }

    const { service, parsedResponse, requestMessageWriter } = resolvedService;

    const requestMsgEncoding = service.request?.encoding ?? this.#serviceCallEncoding!;
    const serviceCallRequest: ServiceCallPayload = {
      serviceId: service.id,
      callId: ++this.#nextServiceCallId,
      encoding: requestMsgEncoding,
      data: new DataView(new Uint8Array().buffer),
    };

    const message = requestMessageWriter.writeMessage(request);
    serviceCallRequest.data = new DataView(message.buffer);
    this.#client.sendServiceCallRequest(serviceCallRequest);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.#serviceResponseCbs.set(serviceCallRequest.callId, (response: ServiceCallResponse) => {
        try {
          const data = parsedResponse.deserialize(response.data);
          resolve(data as Record<string, unknown>);
        } catch (error: unknown) {
          reject(error as Error);
        }
      });
    });
  }

  async #preFetchAsset(uri: string): Promise<string> {
    let promise = this.#preFetchedAssets.get(uri);
    if (promise) {
      return await promise;
    }

    const nextPreFetchAssetRequestId = ++this.#nextPreFetchAssetRequestId;

    promise = race([
      new Promise<string>((resolve, reject) => {
        this.#preFetchAssetRequests.set(nextPreFetchAssetRequestId, (response) => {
          if (response.status === FetchAssetStatus.SUCCESS) {
            resolve(response.etag ?? "");
          } else {
            reject(new Error(`Failed to pre-fetch asset: ${response.error}`));
          }
        });

        this.#client?.preFetchAsset(uri, nextPreFetchAssetRequestId);
      }),
      new Promise<string>((resolve) => setTimeout(resolve, 2000)),
    ]);

    this.#preFetchedAssets.set(uri, promise);
    return await promise;
  }

  async #fetchAssetContent(uri: string): Promise<Asset> {
    let promise = this.#fetchedAssets.get(uri);
    if (promise) {
      return await promise;
    }

    promise = new Promise<Asset>((resolve, reject) => {
      const fetchedAsset = this.#fetchedAssets.get(uri);
      if (fetchedAsset) {
        resolve(fetchedAsset);
        return;
      }

      const assetRequestId = ++this.#nextAssetRequestId;
      this.#fetchAssetRequests.set(assetRequestId, (response) => {
        if (response.status === FetchAssetStatus.SUCCESS) {
          const newAsset: Asset = {
            uri,
            data: new Uint8Array(
              response.data.buffer,
              response.data.byteOffset,
              response.data.byteLength,
            ),
          };
          resolve(newAsset);
        } else {
          reject(new Error(`Failed to fetch asset: ${response.error}`));
        }
      });

      this.#client?.fetchAsset(uri, assetRequestId);
    });

    this.#fetchedAssets.set(uri, promise);
    return await promise;
  }

  /**
   * get target file by ws, if has cached file, will take etag,
   * if parameter has etag, we will send a preFetchAsset request to ws,
   * if ws return etag is same as parameter etag, we will not return asset data
   */
  public async fetchAsset(uri: string, etag?: string): Promise<Asset> {
    if (!this.#client) {
      throw new Error(
        `Attempted to fetch assset ${uri} without a valid coScene WebSocket connection.`,
      );
    } else if (!this.#serverCapabilities.includes(ServerCapability.assets)) {
      throw new Error(`Fetching assets (${uri}) is not supported for coSceneWebSocketPlayer`);
    }

    let assetEtag = undefined;

    if (etag) {
      try {
        assetEtag = await this.#preFetchAsset(uri);
        if (etag === assetEtag) {
          return {
            uri,
            data: new Uint8Array(),
            etag,
          };
        }
      } catch (err) {
        log.debug("Failed to pre-fetch asset:", err);
      }
    }

    const assetContent = await this.#fetchAssetContent(uri);

    return { ...assetContent, etag: assetEtag };
  }

  public setGlobalVariables(): void {}

  // Return the current time
  //
  // For servers which publish a clock, we return that time. If the server disconnects we continue
  // to return the last known time. For servers which do not publish a clock, we use wall time.
  #getCurrentTime(): Time {
    // If the server does not publish the time, then we set the clock time to realtime as long as
    // the server is connected. When the server is not connected, time stops.
    if (!this.#serverPublishesTime) {
      if (this.#presence === PlayerPresence.PRESENT) {
        this.#clockTime = this.#serverTime ?? fromMillis(Date.now());
      }
    }

    return this.#clockTime ?? ZERO_TIME;
  }

  #setupPublishers(): void {
    // This function will be called again once a connection is established
    if (!this.#client || this.#closed) {
      return;
    }

    if (this.#unresolvedPublications.length === 0) {
      return;
    }

    this.#problems.removeProblems((id) => id.startsWith("pub:"));

    for (const publication of this.#unresolvedPublications) {
      this.#advertiseChannel(publication);
    }

    this.#unresolvedPublications = [];
    this.#emitState();
  }

  #advertiseChannel(publication: AdvertiseOptions) {
    if (!this.#client) {
      return;
    }

    const encoding = this.#supportedEncodings
      ? this.#supportedEncodings.find((e) => SUPPORTED_PUBLICATION_ENCODINGS.includes(e))
      : FALLBACK_PUBLICATION_ENCODING;

    const { topic, schemaName, options } = publication;

    const encodingProblemId = `pub:encoding:${topic}`;
    const msgdefProblemId = `pub:msgdef:${topic}`;

    if (!encoding) {
      this.#problems.addProblem(encodingProblemId, {
        severity: "warn",
        message: `Cannot advertise topic '${topic}': Server does not support one of the following encodings for client-side publishing: ${SUPPORTED_PUBLICATION_ENCODINGS}`,
      });
      return;
    }

    let messageWriter: Publication["messageWriter"] = undefined;
    if (ROS_ENCODINGS.includes(encoding)) {
      // Try to retrieve the ROS message definition for this topic
      let msgdef: MessageDefinition[];
      try {
        const datatypes =
          (options?.["datatypes"] as MessageDefinitionMap | undefined) ?? this.#datatypes;
        if (!(datatypes instanceof Map)) {
          throw new Error("Datatypes option must be a map");
        }
        msgdef = rosDatatypesToMessageDefinition(datatypes, schemaName);
      } catch (error) {
        log.debug(error);
        this.#problems.addProblem(msgdefProblemId, {
          severity: "warn",
          message: `Unknown message definition for "${topic}"`,
          tip: `Try subscribing to the topic "${topic}" before publishing to it`,
        });
        return;
      }

      messageWriter =
        encoding === "ros1" ? new Ros1MessageWriter(msgdef) : new Ros2MessageWriter(msgdef);
    }

    const channelId = this.#client.advertise({ topic, encoding, schemaName });
    this.#publicationsByTopic.set(topic, {
      id: channelId,
      topic,
      encoding,
      schemaName,
      messageWriter,
    });

    for (const problemId of [encodingProblemId, msgdefProblemId]) {
      if (this.#problems.hasProblem(problemId)) {
        this.#problems.removeProblem(problemId);
      }
    }
  }

  #unadvertiseChannel(channel: Publication) {
    if (!this.#client) {
      return;
    }

    this.#client.unadvertise(channel.id);
    this.#publicationsByTopic.delete(channel.topic);
    const problemIds = [`pub:encoding:${channel.topic}`, `pub:msgdef:${channel.topic}`];
    for (const problemId of problemIds) {
      if (this.#problems.hasProblem(problemId)) {
        this.#problems.removeProblem(problemId);
      }
    }
  }

  #resetSessionState(): void {
    log.debug("Reset session state");
    this.#startTime = undefined;
    this.#endTime = undefined;
    this.#clockTime = undefined;
    this.#topicsStats = new Map();
    this.#parsedMessages = [];
    this.#receivedBytes = 0;
    this.#problems.clear();
    this.#parameters = new Map();
    this.#fetchedAssets.clear();
    this.#preFetchedAssets.clear();
    for (const [requestId, callback] of this.#fetchAssetRequests) {
      callback({
        op: BinaryOpcode.FETCH_ASSET_RESPONSE,
        receiveTime: Date.now(),
        status: FetchAssetStatus.ERROR,
        requestId,
        error: "WebSocket connection reset",
      });
    }
    for (const [requestId, callback] of this.#preFetchAssetRequests) {
      callback({
        op: BinaryOpcode.PRE_FETCH_ASSET_RESPONSE,
        receiveTime: Date.now(),
        status: FetchAssetStatus.ERROR,
        requestId,
        error: "WebSocket connection reset",
      });
    }
    this.#fetchAssetRequests.clear();
    this.#preFetchAssetRequests.clear();
    this.#parameterTypeByName.clear();
    this.#messageSizeEstimateByTopic = {};
  }

  #updateDataTypes(datatypes: MessageDefinitionMap): void {
    let updatedDatatypes: MessageDefinitionMap | undefined = undefined;
    const maybeRos = ["ros1", "ros2"].includes(this.#profile ?? "");
    for (const [name, types] of datatypes) {
      const knownTypes = this.#datatypes.get(name);
      if (
        knownTypes &&
        !isMsgDefEqual(types, knownTypes) &&
        // foxglove 暂不支持 fox 格式 前端暂时放过当前的问题
        name !== "rcl_interfaces/ParameterDescriptor"
      ) {
        // this.#problems.addProblem(`schema-changed-${name}`, {
        //   message: `Definition of schema '${name}' has changed during the server's runtime`,
        //   severity: "error",
        // });
      } else {
        if (updatedDatatypes == undefined) {
          updatedDatatypes = new Map(this.#datatypes);
        }
        updatedDatatypes.set(name, types);

        const fullTypeName = dataTypeToFullName(name);
        if (maybeRos && fullTypeName !== name) {
          updatedDatatypes.set(fullTypeName, {
            ...types,
            name: types.name ? dataTypeToFullName(types.name) : undefined,
          });
        }
      }
    }
    if (updatedDatatypes != undefined) {
      this.#datatypes = updatedDatatypes; // Signal that datatypes changed.

      // Store updated datatypes to persistent cache
      if (
        this.#persistentCache != undefined &&
        "storeDatatypes" in this.#persistentCache &&
        this.#persistentCache.storeDatatypes != undefined
      ) {
        void this.#persistentCache.storeDatatypes(updatedDatatypes).catch((error: unknown) => {
          log.debug("Failed to store datatypes to cache:", error);
        });
      }
    }
  }

  // check lan reachable, only desktop app can do this
  async #checkLanReachable(
    lanCandidates: string[],
    infoPort: string,
    targetMacAddr: string,
    linkType: string,
  ): Promise<void> {
    if (this.#client == undefined) {
      throw new Error("FoxgloveWebSocketPlayer: client is undefined");
    }

    // only desktop app can check lan reachable
    if (!isDesktopApp() || linkType !== "colink") {
      this.#client.login(this.#userId, this.#username);
      return;
    }

    // 检查当前URL是否已经包含lanCandidates中的某个IP
    const currentUrl = new URL(this.#url);
    const currentHost = currentUrl.hostname;
    if (lanCandidates.some((candidate) => candidate === currentHost)) {
      this.#client.login(this.#userId, this.#username);
      return;
    }

    if (lanCandidates.length > 0 && targetMacAddr !== "") {
      // 创建 AbortController 用于取消其他请求
      const abortController = new AbortController();

      // 并发检查所有候选地址的可达性，一旦有可达地址就终止其他请求
      const checkPromises = lanCandidates.map(async (candidate) => {
        try {
          const reachable = await this.#checkDeviceMacAddress(
            candidate,
            infoPort,
            targetMacAddr,
            abortController.signal,
          );
          if (reachable) {
            // 找到可达地址，立即取消其他请求
            abortController.abort();
          }
          return { candidate, reachable };
        } catch (error) {
          // 检查是否因为 abort 而失败
          if (error instanceof Error && error.name === "AbortError") {
            return { candidate, reachable: false };
          }
          log.debug(`Failed to check candidate ${candidate}:`, error);
          return { candidate, reachable: false };
        }
      });

      try {
        // 使用 Promise.allSettled 等待所有 promise 完成或被取消
        const results = await Promise.allSettled(checkPromises);

        // 找到第一个成功且可达的地址
        let reachableResult: { candidate: string; reachable: boolean } | undefined;
        for (const result of results) {
          if (result.status === "fulfilled" && result.value.reachable) {
            reachableResult = result.value;
            break;
          }
        }

        if (reachableResult) {
          // 找到匹配的IP地址，重新连接WebSocket
          // 弹窗询问用户是否使用局域网连接
          const result = await this.#confirm({
            title: t("cosWebsocket:lanAvailable"),
            prompt: t("cosWebsocket:lanConnectionPrompt"),
            ok: t("cosWebsocket:switchNow"),
            cancel: t("cosWebsocket:keepCurrent"),
            variant: "toast",
          });

          if (result === "ok") {
            await this.#reconnectWithNewUrl(reachableResult.candidate);
            return;
          }
        }
      } catch (error) {
        log.debug("Error during concurrent address checking:", error);
      }
    }

    // 如果所有候选地址都无法连接或MAC地址不匹配，则使用原始连接
    this.#client.login(this.#userId, this.#username);
  }

  // 检查指定IP和端口的设备MAC地址
  async #checkDeviceMacAddress(
    ip: string,
    port: string,
    targetMacAddr: string,
    externalSignal?: AbortSignal,
  ): Promise<boolean> {
    try {
      // 使用 AbortController 实现超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 3000); // 3秒超时

      // 如果有外部信号，监听外部取消
      if (externalSignal) {
        externalSignal.addEventListener("abort", () => {
          controller.abort();
        });
      }

      const response = await fetch(`http://${ip}:${port}/device-info`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as DeviceInfo;
      const deviceMacAddr = data.macAddr;

      if (typeof deviceMacAddr === "string") {
        // 比较MAC地址（忽略大小写和分隔符）
        const normalizedDeviceMac = deviceMacAddr.replace(/[:-]/g, "").toLowerCase();
        const normalizedTargetMac = targetMacAddr.replace(/[:-]/g, "").toLowerCase();
        return normalizedDeviceMac === normalizedTargetMac;
      }

      return false;
    } catch (error) {
      log.debug(`Error checking device MAC for ${ip}:${port}:`, error);
      return false;
    }
  }

  // 使用新的IP地址重新连接WebSocket
  async #reconnectWithNewUrl(newIp: string): Promise<void> {
    try {
      // 关闭当前连接
      this.#client?.close();

      // 更新URL为局域网地址
      const newUrl = `ws://${newIp}:21274`;
      this.#url = newUrl;

      this.#urlState = {
        sourceId: this.#sourceId,
        parameters: { ...this.#urlState?.parameters, url: newUrl, linkType: "unknown" },
      };

      log.info(`Reconnecting with LAN address: ${this.#url}`);
      // 重新开始连接
      this.#open();
    } catch (error) {
      log.error("Failed to reconnect with new URL:", error);
      // 如果重连失败，回退到原始登录流程
      if (this.#client) {
        this.#client.login(this.#userId, this.#username);
      }
    }
  }
}

function dataTypeToFullName(dataType: string): string {
  const parts = dataType.split("/");
  if (parts.length === 2) {
    return `${parts[0]}/msg/${parts[1]}`;
  }
  return dataType;
}

function statusLevelToProblemSeverity(level: StatusLevel): PlayerProblem["severity"] {
  if (level === StatusLevel.INFO) {
    return "info";
  } else if (level === StatusLevel.WARNING) {
    return "warn";
  } else {
    return "error";
  }
}
