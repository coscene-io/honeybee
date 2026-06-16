// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { MessageDefinition } from "@foxglove/message-definition";
import { Time } from "@foxglove/rostime";
import type { MessageEvent, ParameterValue } from "@foxglove/studio";
import { Immutable, Metadata } from "@foxglove/studio";
import { Asset } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";
import { Range } from "@foxglove/studio-base/util/ranges";
import { NotificationSeverity } from "@foxglove/studio-base/util/sendNotification";

// re-exported until other import sites are updated from players/types to @foxglove/studio
// 重新导出，直到其他导入站点从 players/types 更新到 @foxglove/studio
export type { MessageEvent };

export type MessageDefinitionsByTopic = {
  [topic: string]: string;
};

export type ParsedMessageDefinitionsByTopic = {
  [topic: string]: MessageDefinition[];
};

export type PlaybackSpeed = 0.01 | 0.02 | 0.05 | 0.1 | 0.2 | 0.5 | 0.8 | 1 | 2 | 3 | 5;

export type TopicSelection = Map<string, SubscribePayload>;

// A `Player` is a class that manages playback state. It manages subscriptions,
// current time, which topics and datatypes are available, and so on.
// For more details, see the types below.
// `Player` 是一个管理播放状态的类。它管理订阅、
// 当前时间、可用的主题和数据类型等等。
// 更多详细信息，请参见下面的类型。

export interface Player {
  // The main way to get information out the player is to set a listener. This listener will be
  // called whenever the PlayerState changes, so that we can render the new state to the UI. Users
  // should return a promise from the listener that resolves when the UI has finished updating, so
  // that we don't get overwhelmed with new state that we can't keep up with. The Player is
  // responsible for appropriately throttling based on when we resolve this promise.
  // 从播放器获取信息的主要方法是设置监听器。每当 PlayerState 发生变化时，
  // 都会调用此监听器，以便我们可以将新状态呈现给 UI。用户应该从监听器返回一个 promise，
  // 该 promise 在 UI 完成更新时解析，这样我们就不会被无法跟上的新状态所淹没。
  // Player 负责根据我们何时解析此 promise 进行适当的节流。
  setListener(listener: (playerState: PlayerState) => Promise<void>): void;
  // Close the player; i.e. terminate any connections it might have open.
  // 关闭播放器；即终止可能打开的任何连接。
  close(): Promise<void>;
  // Reopen the player; i.e. reconnect to the server.
  // 重新打开播放器；即重新连接到服务器。
  reOpen(): void;
  // Set a new set of subscriptions/advertisers. This might trigger fetching
  // new data, which might in turn trigger a backfill of messages.
  // 设置一组新的订阅/广告商。这可能会触发获取新数据，
  // 进而可能触发消息的回填。
  setSubscriptions(subscriptions: Immutable<SubscribePayload[]>): void;
  setPublishers(publishers: AdvertiseOptions[]): void;
  // Modify a remote parameter such as a rosparam.
  // 修改远程参数，例如 rosparam。
  setParameter(key: string, value: ParameterValue): void;
  // If the Player supports publishing (i.e. PlayerState#capabilities contains
  // PlayerCapabilities.advertise), publish a message.
  // 如果 Player 支持发布（即 PlayerState#capabilities 包含
  // PlayerCapabilities.advertise），则发布消息。
  publish(request: PublishPayload): void;
  // If the player support service calls (i.e. PlayerState#capabilities contains PlayerCapabilities.callServices)
  // this will make a service call to the named service with the request payload.
  // 如果播放器支持服务调用（即 PlayerState#capabilities 包含 PlayerCapabilities.callServices）
  // 这将使用请求负载对指定服务进行服务调用。
  callService(service: string, request: unknown): Promise<unknown>;
  // Asset fetching. Available if `capabilities` contains PlayerCapabilities.assets.
  // 资源获取。如果 `capabilities` 包含 PlayerCapabilities.assets，则可用。
  fetchAsset?(uri: string, etag?: string): Promise<Asset>;
  // Basic playback controls. Available if `capabilities` contains PlayerCapabilities.playbackControl.
  // 基本播放控制。如果 `capabilities` 包含 PlayerCapabilities.playbackControl，则可用。
  startPlayback?(): void;
  pausePlayback?(): void;
  seekPlayback?(time: Time): void;
  playUntil?(time: Time): void;
  enableRepeatPlayback?(enable: boolean): void;
  // Seek to a particular time. Might trigger backfilling.
  // If the Player supports non-real-time speeds (i.e. PlayerState#capabilities contains
  // PlayerCapabilities.setSpeed), set that speed. E.g. 1.0 is real time, 0.2 is 20% of real time.
  // 跳转到特定时间。可能会触发回填。
  // 如果 Player 支持非实时速度（即 PlayerState#capabilities 包含
  // PlayerCapabilities.setSpeed），则设置该速度。例如 1.0 是实时，0.2 是实时的 20%。
  setPlaybackSpeed?(speedFraction: PlaybackSpeed): void;
  setGlobalVariables(globalVariables: GlobalVariables): void;
  getMetadata?: () => ReadonlyArray<Readonly<Metadata>>;
}

export enum PlayerPresence {
  NOT_PRESENT = "NOT_PRESENT",
  INITIALIZING = "INITIALIZING",
  RECONNECTING = "RECONNECTING",
  BUFFERING = "BUFFERING",
  PRESENT = "PRESENT",
  ERROR = "ERROR",
}

export type PlayerProblem = {
  severity: NotificationSeverity;
  message: string;
  error?: Error;
  tip?: React.ReactNode;
};

export type PlayerURLState = Immutable<{
  sourceId: string;
  parameters?: Record<string, string>;
}>;

export type PlayerState = {
  // Information about the player's presence or connection status, for the UI to show a loading indicator.
  // 关于播放器存在或连接状态的信息，供 UI 显示加载指示器。
  presence: PlayerPresence;

  // Show some sort of progress indication in the playback bar; see `type Progress` for more details.
  // 在播放栏中显示某种进度指示；更多详细信息请参见 `type Progress`。
  progress: Progress;

  // Capabilities of this particular `Player`, which are not shared across all players.
  // See `const PlayerCapabilities` for more details.
  // 此特定 `Player` 的功能，并不在所有播放器之间共享。
  // 更多详细信息请参见 `const PlayerCapabilities`。
  capabilities: (typeof PlayerCapabilities)[keyof typeof PlayerCapabilities][];

  /**
   * Identifies the semantics of the data being played back, such as which topics or parameters are
   * semantically meaningful or normalization conventions to use. This typically maps to a shorthand
   * identifier for a robotics framework such as "ros1", "ros2", or "ulog". See the MCAP profiles
   * concept at <https://github.com/foxglove/mcap/blob/main/docs/specification/appendix.md#well-known-profiles>.
   *
   * 标识正在播放的数据的语义，例如哪些主题或参数在语义上有意义，
   * 或使用的规范化约定。这通常映射到机器人框架的缩写标识符，
   * 例如 "ros1"、"ros2" 或 "ulog"。请参见 MCAP 配置文件概念。
   */
  profile: string | undefined;

  // A unique id for this player (typically a UUID generated on construction). This is used to clear
  // out any data when switching to a new player.
  // 此播放器的唯一 ID（通常是在构造时生成的 UUID）。用于在切换到新播放器时清除任何数据。
  playerId: string;

  // String name for the player
  // The player could set this value to represent the current connection, name, ports, etc.
  // 播放器的字符串名称
  // 播放器可以设置此值来表示当前连接、名称、端口等。
  name?: string;

  // Surface issues during playback or player initialization
  // 在播放或播放器初始化期间暴露问题
  problems?: PlayerProblem[];

  // The actual data to render panels with. Can be empty during initialization, until all this data
  // is known. See `type PlayerStateActiveData` for more details.
  // 用于渲染面板的实际数据。在初始化期间可以为空，直到所有这些数据都已知。
  // 更多详细信息请参见 `type PlayerStateActiveData`。
  activeData?: PlayerStateActiveData;

  /** State to serialize into the active URL. */
  /** 要序列化到活动 URL 中的状态。 */
  urlState?: PlayerURLState;
};

export type PlayerStateActiveData = {
  // An array of (ROS-like) messages that should be rendered. Should be ordered by `receiveTime`,
  // and should be immediately following the previous array of messages that was emitted as part of
  // this state. If there is a discontinuity in messages, `lastSeekTime` should be different than
  // the previous state. Panels collect these messages using the `PanelAPI`.
  // 应该渲染的（类 ROS）消息数组。应该按 `receiveTime` 排序，
  // 并且应该紧接在作为此状态的一部分发出的前一个消息数组之后。
  // 如果消息中存在不连续性，`lastSeekTime` 应该与前一个状态不同。
  // 面板使用 `PanelAPI` 收集这些消息。
  messages: readonly MessageEvent[];
  totalBytesReceived: number; // always-increasing 始终递增

  // The current playback position, which will be shown in the playback bar. This time should be
  // equal to or later than the latest `receiveTime` in `messages`. Why not just use
  // `last(messages).receiveTime`? The reason is that the data source (e.g. ROS bag) might have
  // empty sections, i.e. `messages` can be empty, but we still want to be able to show a playback
  // cursor moving forward during these regions.
  // 当前播放位置，将在播放栏中显示。此时间应该等于或晚于
  // `messages` 中的最新 `receiveTime`。为什么不只使用 `last(messages).receiveTime`？
  // 原因是数据源（例如 ROS 包）可能有空部分，即 `messages` 可以为空，
  // 但我们仍然希望能够在这些区域中显示播放光标向前移动。
  currentTime: Time;

  // The start time to show in the playback bar. Every `message.receiveTime` (and therefore
  // `currentTime`) has to later than or equal to `startTime`.
  // 在播放栏中显示的开始时间。每个 `message.receiveTime`（因此也包括 `currentTime`）
  // 都必须晚于或等于 `startTime`。
  startTime: Time;

  // The end time to show in the playback bar. Every `message.receiveTime` (and therefore
  // `currentTime`) has to before than or equal to `endTime`.
  // 在播放栏中显示的结束时间。每个 `message.receiveTime`（因此也包括 `currentTime`）
  // 都必须早于或等于 `endTime`。
  endTime: Time;

  // Whether or not we're currently playing back. Controls the play/pause icon in the playback bar.
  // It's still allowed to emit `messages` even when not playing (e.g. when doing a backfill after
  // a seek).
  // 我们是否正在播放。控制播放栏中的播放/暂停图标。
  // 即使在不播放时也允许发出 `messages`（例如，在跳转后进行回填时）。
  isPlaying: boolean;

  // Whether or not playback will repeat when it reaches the end
  // 播放到达末尾时是否会重复
  repeatEnabled: boolean;

  // If the Player supports non-real-time speeds (i.e. PlayerState#capabilities contains
  // PlayerCapabilities.setSpeed), this represents that speed as a fraction of real time.
  // E.g. 1.0 is real time, 0.2 is 20% of real time.
  // 如果 Player 支持非实时速度（即 PlayerState#capabilities 包含
  // PlayerCapabilities.setSpeed），这表示该速度作为实时的一个分数。
  // 例如 1.0 是实时，0.2 是实时的 20%。
  speed: PlaybackSpeed;

  // The last time a seek / discontinuity in messages happened. This will clear out data within
  // `PanelAPI` so we're not looking at stale data.
  // 上次跳转/消息不连续发生的时间。这将清除 `PanelAPI` 内的数据，
  // 这样我们就不会查看过时的数据。
  lastSeekTime: number;

  // A list of topics that panels can subscribe to. This list may change across states,
  // but when a topic is removed from the list we should treat it as a seek (i.e. lastSeekTime
  // should be bumped). Also, no messages are allowed to be emitted which have a `topic` field that
  // isn't represented in this list. Finally, every topic must have a `datatype` which is actually
  // present in the `datatypes` field (see below).
  // 面板可以订阅的主题列表。此列表可能在状态之间发生变化，
  // 但当从列表中删除主题时，我们应该将其视为跳转（即应该增加 lastSeekTime）。
  // 另外，不允许发出具有未在此列表中表示的 `topic` 字段的消息。
  // 最后，每个主题都必须有一个实际存在于 `datatypes` 字段中的 `datatype`（见下文）。
  topics: Topic[];

  // A map of topic names to topic statistics, such as message count. This should be treated as a
  // sparse list that may be missing some or all topics, depending on the active data source and its
  // current state.
  // 主题名称到主题统计信息（如消息计数）的映射。应该将其视为稀疏列表，
  // 根据活动数据源及其当前状态，可能缺少某些或所有主题。
  topicStats: Map<string, TopicStats>;

  // A complete list of ROS datatypes. Allowed to change. But it must always be "complete" (every
  // topic must refer to a datatype that is present in this list, every datatypes that refers to
  // another datatype must refer to a datatype that is present in this list).
  // 完整的 ROS 数据类型列表。允许变更。但必须始终保持“完整”（每个主题都必须引用
  // 此列表中存在的数据类型，每个引用其他数据类型的数据类型都必须引用此列表中存在的数据类型）。
  datatypes: RosDatatypes;

  // A map of topic names to the set of publisher IDs publishing each topic.
  // 主题名称到发布每个主题的发布者 ID 集合的映射。
  publishedTopics?: Map<string, Set<string>>;

  // A map of topic names to the set of subscriber IDs subscribed to each topic.
  // 主题名称到订阅每个主题的订阅者 ID 集合的映射。
  subscribedTopics?: Map<string, Set<string>>;

  // A map of service names to service provider IDs that provide each service.
  // 服务名称到提供每个服务的服务提供者 ID 的映射。
  services?: Map<string, Set<string>>;

  // A map of parameter names to parameter values, used to describe remote parameters such as
  // rosparams.
  // 参数名称到参数值的映射，用于描述远程参数（如 rosparams）。
  parameters?: Map<string, ParameterValue>;

  // Network status information for real-time connections
  // 实时连接的网络状态信息
  networkStatus?: {
    /** Network delay between client and server */
    /** 客户端和服务器之间的网络延迟 */
    networkDelay?: number;
    /** Current network speed in KiB/s */
    /** 当前网络速度（KiB/s） */
    curSpeed?: number;
    /** Number of dropped messages */
    /** 丢失的消息数量 */
    droppedMsgs?: number;
    /** rate of package, caculated by bytes, not message count */
    /** 数据包速率，按字节计算，而非消息数量 */
    packageLoss?: number;
  };
};

// Represents a ROS topic, though the actual data does not need to come from a ROS system.
// 表示 ROS 主题，尽管实际数据不需要来自 ROS 系统。
export type Topic = {
  // Of ROS topic format, i.e. "/some/topic". We currently depend on this slashes format a bit in
  // `<MessageHistroy>`, though we could relax this and support arbitrary strings. It's nice to have
  // a consistent representation for topics that people recognize though.
  // ROS 主题格式，即 "/some/topic"。我们目前在 `<MessageHistroy>` 中一定程度上依赖于这种斜杠格式，
  // 尽管我们可以放宽这一点并支持任意字符串。不过，对于人们认识的主题来说，有一个一致的表示是很好的。
  name: string;
  // Name of the datatype (see `type PlayerStateActiveData` for details).
  // 数据类型的名称（详细信息请参见 `type PlayerStateActiveData`）。
  schemaName: string | undefined;
  // coScene custom
  // coScene 自定义
  messageCount?: number;
  messageFrequency?: number;
  // Name of the topic before topic aliasing, if any.
  // 主题别名之前的主题名称（如果有的话）。
  aliasedFromName?: string;
};

export type TopicWithSchemaName = Topic & { schemaName: string };

export type TopicStats = {
  // The number of messages observed on the topic.
  // 在主题上观察到的消息数量。
  numMessages: number;
  // Timestamp of the first observed message on this topic. Only set for static data sources such as
  // local files or servers that provide a fixed set of data.
  // 此主题上第一个观察到的消息的时间戳。仅对静态数据源（如本地文件或提供固定数据集的服务器）设置。
  firstMessageTime?: Time;
  // Timestamp of the last observed message on this topic. Only set for static data sources such as
  // local files or servers that provide a fixed set of data.
  // 此主题上最后一个观察到的消息的时间戳。仅对静态数据源（如本地文件或提供固定数据集的服务器）设置。
  lastMessageTime?: Time;
};

type RosTypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

type RosSingularField = number | string | boolean | RosObject | undefined; // No time -- consider it a message.
export type RosValue =
  | RosSingularField
  | readonly RosSingularField[]
  | RosTypedArray
  // eslint-disable-next-line no-restricted-syntax
  | null;

export type RosObject = Readonly<{
  [property: string]: RosValue;
}>;

// For each memory block we store the actual messages (grouped by topic), and a total byte size of
// the underlying ArrayBuffers.
// 对于每个内存块，我们存储实际消息（按主题分组），以及底层 ArrayBuffer 的总字节大小。
export type MessageBlock = {
  readonly messagesByTopic: {
    readonly [topic: string]: MessageEvent[];
  };
  /**
   * Indicates which topics are yet to be fully loaded for this block. Can be used to track the
   * progress of block loading. For a fully loaded block this will be empty or undefined.
   *
   * 指示此块中尚未完全加载的主题。可用于跟踪块加载的进度。
   * 对于完全加载的块，这将为空或 undefined。
   */
  needTopics?: TopicSelection;
  readonly sizeInBytes: number;
};

export type BlockCache = {
  blocks: readonly (MessageBlock | undefined)[];
  startTime: Time;
};

// Contains different kinds of progress indications
// 包含不同类型的进度指示
export type Progress = Readonly<{
  // Indicate which ranges are loaded
  // 指示加载了哪些范围
  fullyLoadedFractionRanges?: Range[];

  // A raw view into the cached binary data stored by the MemoryCacheDataProvider. Only present when
  // using the RandomAccessPlayer.
  // 对 MemoryCacheDataProvider 存储的缓存二进制数据的原始视图。仅在使用 RandomAccessPlayer 时存在。
  readonly messageCache?: BlockCache;

  /** Memory usage information, e.g. the memory size occupied by preloaded or buffered messages. */
  /** 内存使用信息，例如预加载或缓冲消息占用的内存大小。 */
  readonly memoryInfo?: Record<string, number>;
}>;

export type SubscriptionPreloadType =
  | "full" // Fetch messages for the entire content range. 获取整个内容范围的消息
  | "partial"; // Fetch messages as needed. 按需获取消息

/**
 * Represents a subscription to a single topic, for use in `setSubscriptions`.
 *
 * 表示对单个主题的订阅，用于 `setSubscriptions` 中。
 */
export type SubscribePayload = {
  /**
   * The name of the topic to subscribe to.
   *
   * 要订阅的主题名称。
   */
  topic: string;
  /**
   * If defined the source will return only these fields from messages.
   * Otherwise entire messages will be returned.
   *
   * 如果定义，源将仅从消息中返回这些字段。
   * 否则将返回完整的消息。
   */
  fields?: string[];
  /**
   * Defines the range of messages to subscribe to.
   *
   * 定义要订阅的消息范围。
   */
  preloadType?: SubscriptionPreloadType;
};

// Represents a single topic publisher, for use in `setPublishers`.
// 表示单个主题发布者，用于 `setPublishers` 中。
export type AdvertiseOptions = {
  /** The topic name */
  /** 主题名称 */
  topic: string;

  /** The schema name */
  /** 架构名称 */
  schemaName: string;

  /** Additional player-specific advertise options */
  /** 额外的播放器特定的广告选项 */
  options?: Record<string, unknown>;
};

// The actual message to publish.
// 要发布的实际消息。
export type PublishPayload = { topic: string; msg: Record<string, unknown> };

// Capabilities that are not shared by all players.
// 不是所有播放器共享的功能。
export const PlayerCapabilities = {
  // Publishing messages. Need to be connected to some sort of live robotics system (e.g. ROS).
  // 发布消息。需要连接到某种实时机器人系统（如 ROS）。
  advertise: "advertise",

  // Fetching assets.
  // 获取资源。
  assets: "assets",

  // Calling services
  // 调用服务
  callServices: "callServices",

  // Setting speed to something that is not real time.
  // 将速度设置为非实时。
  setSpeed: "setSpeed",

  // Ability to play, pause, and seek in time.
  // 播放、暂停和在时间中跳转的能力。
  playbackControl: "playbackControl",

  // List and retrieve values for configuration key/value pairs
  // 列出并检索配置键/值对的值
  getParameters: "getParameters",

  // Set values for configuration key/value pairs
  // 为配置键/值对设置值
  setParameters: "setParameters",
};

// A metrics collector is an interface passed into a `Player`, which will get called when certain
// events happen, so we can track those events in some metrics system.
// 指标收集器是传递给 `Player` 的接口，当特定事件发生时会被调用，
// 以便我们可以在某些指标系统中跟踪这些事件。
export interface PlayerMetricsCollectorInterface {
  setProperty(key: string, value: string | number | boolean): void;
  // Statistics on the number of visits
  // 访问次数统计
  playerConstructed(): void;
  // Statistical playback time
  // 统计播放时间
  play(speed: number): void;
  seek(time: Time): void;
  setSpeed(speed: number): void;
  // Statistical playback time
  // 统计播放时间
  pause(): void;
  close(): void;
  setSubscriptions(subscriptions: SubscribePayload[]): void;
  recordBytesReceived(bytes: number): void;
  recordPlaybackTime(time: Time, params: { stillLoadingData: boolean }): void;
  recordUncachedRangeRequest(): void;
  recordTimeToFirstMsgs(): void;
  recordSeekLatency(latencyMs: number): void;
  recordStallDuration(durationMs: number): void;
}
