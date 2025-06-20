// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";

import { parseServerMessage } from "./parse";
import {
  BinaryOpcode,
  Channel,
  RemoveStatusMessages,
  ClientBinaryOpcode,
  ClientChannel,
  ClientChannelId,
  ClientChannelWithoutId,
  ClientMessage,
  ConnectionGraphUpdate,
  FetchAssetResponse,
  IWebSocket,
  Parameter,
  ParameterValues,
  ServerMessage,
  Service,
  ServiceCallFailure,
  ServiceCallPayload,
  ServiceCallResponse,
  ServiceId,
  SubscriptionId,
  Time,
  ServerLogin,
  Kicked,
  ChannelId,
  MessageData,
  ServerInfo,
  StatusMessage,
} from "./types";

type EventTypes = {
  open: () => void;
  error: (error: Error) => void;
  close: (event: CloseEvent) => void;

  serverInfo: (event: ServerInfo) => void;
  status: (event: StatusMessage) => void;
  removeStatus: (event: RemoveStatusMessages) => void;
  message: (event: MessageData) => void;
  time: (event: Time) => void;
  advertise: (newChannels: Channel[]) => void;
  unadvertise: (removedChannels: ChannelId[]) => void;
  advertiseServices: (newServices: Service[]) => void;
  unadvertiseServices: (removedServices: ServiceId[]) => void;
  parameterValues: (event: ParameterValues) => void;
  serviceCallResponse: (event: ServiceCallResponse) => void;
  connectionGraphUpdate: (event: ConnectionGraphUpdate) => void;
  fetchAssetResponse: (event: FetchAssetResponse) => void;
  serviceCallFailure: (event: ServiceCallFailure) => void;
  login: (event: ServerLogin) => void;
  kicked: (event: Kicked) => void;
};

const textEncoder = new TextEncoder();

export default class FoxgloveClient {
  public static SUPPORTED_SUBPROTOCOL = "foxglove.websocket.v1";

  #emitter = new EventEmitter<EventTypes>();
  #ws: IWebSocket;
  #nextSubscriptionId = 0;
  #nextAdvertisementId = 0;

  public constructor({ ws }: { ws: IWebSocket }) {
    this.#ws = ws;
    this.#reconnect();
  }

  public on<E extends EventEmitter.EventNames<EventTypes>>(
    name: E,
    listener: EventEmitter.EventListener<EventTypes, E>,
  ): void {
    this.#emitter.on(name, listener);
  }
  public off<E extends EventEmitter.EventNames<EventTypes>>(
    name: E,
    listener: EventEmitter.EventListener<EventTypes, E>,
  ): void {
    this.#emitter.off(name, listener);
  }

  #reconnect() {
    this.#ws.binaryType = "arraybuffer";
    this.#ws.onerror = (event: { error?: Error }) => {
      this.#emitter.emit("error", event.error ?? new Error("WebSocket error"));
    };
    this.#ws.onopen = (_event) => {
      if (this.#ws.protocol !== FoxgloveClient.SUPPORTED_SUBPROTOCOL) {
        throw new Error(
          `Expected subprotocol ${FoxgloveClient.SUPPORTED_SUBPROTOCOL}, got '${
            this.#ws.protocol
          }'`,
        );
      }
      this.#emitter.emit("open");
    };
    this.#ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      let message: ServerMessage;
      try {
        if (event.data instanceof ArrayBuffer) {
          message = parseServerMessage(event.data);
        } else {
          message = JSON.parse(event.data) as ServerMessage;
        }
      } catch (error) {
        this.#emitter.emit("error", error as Error);
        return;
      }

      switch (message.op) {
        case "serverInfo":
          this.#emitter.emit("serverInfo", message);
          return;

        case "status":
          this.#emitter.emit("status", message);
          return;

        case "removeStatus":
          this.#emitter.emit("removeStatus", message);
          return;

        case "advertise":
          this.#emitter.emit("advertise", message.channels);
          return;

        case "unadvertise":
          this.#emitter.emit("unadvertise", message.channelIds);
          return;

        case "parameterValues":
          this.#emitter.emit("parameterValues", message);
          return;

        case "advertiseServices":
          this.#emitter.emit("advertiseServices", message.services);
          return;

        case "unadvertiseServices":
          this.#emitter.emit("unadvertiseServices", message.serviceIds);
          return;

        case "connectionGraphUpdate":
          this.#emitter.emit("connectionGraphUpdate", message);
          return;

        case "serviceCallFailure":
          this.#emitter.emit("serviceCallFailure", message);
          return;

        case "login":
          this.#emitter.emit("login", message);
          return;

        case "kicked":
          this.#emitter.emit("kicked", message);
          return;

        case BinaryOpcode.MESSAGE_DATA:
          this.#emitter.emit("message", message);
          return;

        case BinaryOpcode.TIME:
          this.#emitter.emit("time", message);
          return;

        case BinaryOpcode.SERVICE_CALL_RESPONSE:
          this.#emitter.emit("serviceCallResponse", message);
          return;

        case BinaryOpcode.FETCH_ASSET_RESPONSE:
          this.#emitter.emit("fetchAssetResponse", message);
          return;
      }
    };
    this.#ws.onclose = (event: CloseEvent) => {
      this.#emitter.emit("close", event);
    };
  }

  public close(): void {
    this.#ws.close();
  }

  public subscribe(channelId: ChannelId): SubscriptionId {
    const id = this.#nextSubscriptionId++;
    const subscriptions = [{ id, channelId }];
    this.#send({ op: "subscribe", subscriptions });
    return id;
  }

  public unsubscribe(subscriptionId: SubscriptionId): void {
    this.#send({ op: "unsubscribe", subscriptionIds: [subscriptionId] });
  }

  public advertise(clientChannel: ClientChannelWithoutId): ClientChannelId {
    const id = ++this.#nextAdvertisementId;
    const channels: ClientChannel[] = [{ id, ...clientChannel }];
    this.#send({ op: "advertise", channels });
    return id;
  }

  public unadvertise(channelId: ClientChannelId): void {
    this.#send({ op: "unadvertise", channelIds: [channelId] });
  }

  public getParameters(parameterNames: string[], id?: string): void {
    this.#send({ op: "getParameters", parameterNames, id });
  }

  public setParameters(parameters: Parameter[], id?: string): void {
    this.#send({ op: "setParameters", parameters, id });
  }

  public subscribeParameterUpdates(parameterNames: string[]): void {
    this.#send({ op: "subscribeParameterUpdates", parameterNames });
  }

  public unsubscribeParameterUpdates(parameterNames: string[]): void {
    this.#send({ op: "unsubscribeParameterUpdates", parameterNames });
  }

  public sendMessage(channelId: ChannelId, data: Uint8Array): void {
    const payload = new Uint8Array(5 + data.byteLength);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    view.setUint8(0, ClientBinaryOpcode.MESSAGE_DATA);
    view.setUint32(1, channelId, true);
    payload.set(data, 5);
    this.#ws.send(payload);
  }

  public sendServiceCallRequest(request: ServiceCallPayload): void {
    const encoding = textEncoder.encode(request.encoding);
    const payload = new Uint8Array(1 + 4 + 4 + 4 + encoding.length + request.data.byteLength);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let offset = 0;
    view.setUint8(offset, ClientBinaryOpcode.SERVICE_CALL_REQUEST);
    offset += 1;
    view.setUint32(offset, request.serviceId, true);
    offset += 4;
    view.setUint32(offset, request.callId, true);
    offset += 4;
    view.setUint32(offset, request.encoding.length, true);
    offset += 4;
    payload.set(encoding, offset);
    offset += encoding.length;
    const data = new Uint8Array(
      request.data.buffer,
      request.data.byteOffset,
      request.data.byteLength,
    );
    payload.set(data, offset);
    this.#ws.send(payload);
  }

  public subscribeConnectionGraph(): void {
    this.#send({ op: "subscribeConnectionGraph" });
  }

  public unsubscribeConnectionGraph(): void {
    this.#send({ op: "unsubscribeConnectionGraph" });
  }

  public fetchAsset(uri: string, requestId: number): void {
    this.#send({ op: "fetchAsset", uri, requestId });
  }

  public login(userId: string, username: string): void {
    this.#send({ op: "login", userId, username });
  }

  /**
   * @deprecated Use `sendServiceCallRequest` instead
   */
  public sendCallServiceRequest(request: ServiceCallPayload): void {
    this.sendServiceCallRequest(request);
  }

  #send(message: ClientMessage) {
    this.#ws.send(JSON.stringify(message) ?? "");
  }
}
