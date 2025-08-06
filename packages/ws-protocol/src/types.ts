// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export enum BinaryOpcode {
  MESSAGE_DATA = 1,
  TIME = 2,
  SERVICE_CALL_RESPONSE = 3,
  FETCH_ASSET_RESPONSE = 4,
}
export enum ClientBinaryOpcode {
  MESSAGE_DATA = 1,
  SERVICE_CALL_REQUEST = 2,
}
export enum StatusLevel {
  INFO = 0,
  WARNING = 1,
  ERROR = 2,
}
export enum ServerCapability {
  clientPublish = "clientPublish",
  time = "time",
  parameters = "parameters",
  parametersSubscribe = "parametersSubscribe",
  services = "services",
  connectionGraph = "connectionGraph",
  assets = "assets",
  // if the server supports messageTime, the client can use timestamp in message header to control the clock time
  messageTime = "messageTime",
}
export enum FetchAssetStatus {
  SUCCESS = 0,
  ERROR = 1,
}

export type ChannelId = number;
export type ClientChannelId = number;
export type SubscriptionId = number;
export type ServiceId = number;

export type Channel = {
  id: ChannelId;
  topic: string;
  encoding: string;
  schemaName: string;
  schema: string;
  schemaEncoding?: string;
};

type ServiceRequestDefinition = {
  encoding: string;
  schemaName: string;
  schemaEncoding: string;
  schema: string;
};
type ServiceResponseDefinition = ServiceRequestDefinition;
export type Service = {
  id: number;
  name: string;
  type: string;
  request?: ServiceRequestDefinition; // Must be given if requestSchema is not given.
  response?: ServiceResponseDefinition; // Must be given if responseSchema is not given.
  /**
   * Must be given if request is not given.
   * @deprecated Use request instead.
   */
  requestSchema?: string;
  /**
   * Must be given if response is not given.
   * @deprecated Use response instead.
   */
  responseSchema?: string;
};

export type Subscribe = {
  op: "subscribe";
  subscriptions: Array<{
    id: SubscriptionId;
    channelId: ChannelId;
  }>;
};
export type Unsubscribe = {
  op: "unsubscribe";
  subscriptionIds: SubscriptionId[];
};
type ClientChannelSchemaInfo =
  | { schema: string; schemaEncoding: string }
  | { schema?: undefined; schemaEncoding?: undefined };
type ClientChannelBase = {
  id: ClientChannelId;
  topic: string;
  encoding: string;
  schemaName: string;
};
export type ClientChannel = ClientChannelBase & ClientChannelSchemaInfo;
export type ClientChannelWithoutId = Omit<ClientChannelBase, "id"> & ClientChannelSchemaInfo;
export type ClientAdvertise = {
  op: "advertise";
  channels: ClientChannel[];
};
export type ClientUnadvertise = {
  op: "unadvertise";
  channelIds: ClientChannelId[];
};

export type ClientMessageData = {
  op: ClientBinaryOpcode.MESSAGE_DATA;
  channelId: ClientChannelId;
  data: DataView;
};

export type ServiceCallPayload = {
  serviceId: ServiceId;
  callId: number;
  encoding: string;
  data: DataView;
};

export type ServiceCallRequest = ServiceCallPayload & {
  op: ClientBinaryOpcode.SERVICE_CALL_REQUEST;
};
export type ServerInfo = {
  op: "serverInfo";
  name: string;
  capabilities: string[];
  supportedEncodings?: string[];
  metadata?: Record<string, string>;
  sessionId?: string;
};
export type StatusMessage = {
  op: "status";
  level: StatusLevel;
  message: string;
  id?: string;
};
export type RemoveStatusMessages = {
  op: "removeStatus";
  statusIds: string[];
};
export type Advertise = {
  op: "advertise";
  channels: Channel[];
};
export type Unadvertise = {
  op: "unadvertise";
  channelIds: ChannelId[];
};
export type ParameterValues = {
  op: "parameterValues";
  parameters: Parameter[];
  id?: string;
};
export type GetParameters = {
  op: "getParameters";
  parameterNames: string[];
  id?: string;
};
export type SetParameters = {
  op: "setParameters";
  parameters: Parameter[];
  id?: string;
};
export type SubscribeParameterUpdates = {
  op: "subscribeParameterUpdates";
  parameterNames: string[];
};
export type UnsubscribeParameterUpdates = {
  op: "unsubscribeParameterUpdates";
  parameterNames: string[];
};
export type AdvertiseServices = {
  op: "advertiseServices";
  services: Service[];
};
export type UnadvertiseServices = {
  op: "unadvertiseServices";
  serviceIds: ServiceId[];
};
export type SubscribeConnectionGraph = {
  op: "subscribeConnectionGraph";
};
export type UnsubscribeConnectionGraph = {
  op: "unsubscribeConnectionGraph";
};
export type FetchAsset = {
  op: "fetchAsset";
  uri: string;
  requestId: number;
};
export type ConnectionGraphUpdate = {
  op: "connectionGraphUpdate";
  publishedTopics: {
    name: string;
    publisherIds: string[];
  }[];
  subscribedTopics: {
    name: string;
    subscriberIds: string[];
  }[];
  advertisedServices: {
    name: string;
    providerIds: string[];
  }[];
  removedTopics: string[];
  removedServices: string[];
};
export type MessageData = {
  op: BinaryOpcode.MESSAGE_DATA;
  subscriptionId: SubscriptionId;
  timestamp: bigint;
  data: DataView;
};
export type Time = {
  op: BinaryOpcode.TIME;
  timestamp: bigint;
};
export type ServiceCallResponse = ServiceCallPayload & {
  op: BinaryOpcode.SERVICE_CALL_RESPONSE;
};
export type FetchAssetSuccessResponse = {
  op: BinaryOpcode.FETCH_ASSET_RESPONSE;
  requestId: number;
  status: FetchAssetStatus.SUCCESS;
  data: DataView;
};
export type FetchAssetErrorResponse = {
  op: BinaryOpcode.FETCH_ASSET_RESPONSE;
  requestId: number;
  status: FetchAssetStatus.ERROR;
  error: string;
};
export type FetchAssetResponse = FetchAssetSuccessResponse | FetchAssetErrorResponse;
export type ServiceCallFailure = {
  op: "serviceCallFailure";
  serviceId: number;
  callId: number;
  message: string;
};
export type ClientPublish = {
  channel: ClientChannel;
  data: DataView;
};
export type ParameterValue =
  | undefined
  | number
  | boolean
  | string
  | { [key: string]: ParameterValue }
  | ParameterValue[];
export type Parameter = {
  name: string;
  value: ParameterValue;
  type?: "byte_array" | "float64" | "float64_array";
};

export type ServerLogin = {
  op: "login";
  userId: string;
  username: string;
  infoPort: string;
  macAddr: string;
  lanCandidates: string[];
  linkType: "other" | "colink";
};

export type ClientLogin = {
  op: "login";
  userId: string;
  username: string;
};
export type Kicked = {
  op: "kicked";
  userId: string;
  username: string;
  message: string;
};

export type ServerSyncTime = {
  op: "syncTime";
  serverTime: number;
};

export type ClientSyncTime = {
  op: "syncTime";
  serverTime: number;
  clientTime: number;
};

export type NetworkStatus = {
  op: "networkStatus";
  cur_speed: number; // KiB/s
  dropped_msgs: number; // count of messages dropped by server
  package_loss: string; // rate of package, caculated by bytes, not message count
};

export type TimeOffset = {
  op: "timeOffset";
  timeOffset: number;
};

export type ServerMessage =
  | ServerInfo
  | StatusMessage
  | RemoveStatusMessages
  | Advertise
  | Unadvertise
  | AdvertiseServices
  | UnadvertiseServices
  | MessageData
  | Time
  | ServiceCallResponse
  | ParameterValues
  | ConnectionGraphUpdate
  | FetchAssetResponse
  | ServiceCallFailure
  | ServerLogin
  | Kicked
  | ServerSyncTime
  | NetworkStatus
  | TimeOffset;

export type ClientMessage =
  | Subscribe
  | Unsubscribe
  | ClientAdvertise
  | ClientUnadvertise
  | GetParameters
  | SetParameters
  | SubscribeParameterUpdates
  | UnsubscribeParameterUpdates
  | ClientMessageData
  | ServiceCallRequest
  | SubscribeConnectionGraph
  | UnsubscribeConnectionGraph
  | FetchAsset
  | ClientLogin
  | ClientSyncTime;

/**
 * Abstraction that supports both browser and Node WebSocket clients.
 */
export interface IWebSocket {
  binaryType: string;
  protocol: string;
  // eslint-disable-next-line no-restricted-syntax
  onerror: ((event: any) => void) | null | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line no-restricted-syntax
  onopen: ((event: any) => void) | null | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line no-restricted-syntax
  onclose: ((event: any) => void) | null | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line no-restricted-syntax
  onmessage: ((event: any) => void) | null | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  close(): void;
  send(
    data: string | ArrayBuffer | ArrayBufferView,
    /** Options available in Node "ws" library */
    options?: { fin?: boolean },
  ): void;
}
