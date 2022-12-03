// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  ListEventsRequest,
  CreateEventRequest,
  Event,
  DeleteEventRequest,
  UpdateEventRequest,
} from "@coscene-io/coscene/proto/v1alpha2";
import { eventClient } from "@coscene-io/coscene/queries";
import * as base64 from "@protobufjs/base64";
import * as google_protobuf_empty_pb from "google-protobuf/google/protobuf/empty_pb";
import { FieldMask } from "google-protobuf/google/protobuf/field_mask_pb";

import { Time, toRFC3339String } from "@foxglove/rostime";
import { timestampToTime } from "@foxglove/studio-base/util/time";

type User = {
  id: string;
  email: string;
  orgId: string;
  orgDisplayName: string | null; // eslint-disable-line no-restricted-syntax
  orgSlug: string;
  orgPaid: boolean | null; // eslint-disable-line no-restricted-syntax
};

type SigninArgs = {
  idToken: string;
};

type Session = {
  bearerToken: string;
};

type Org = {
  id: string;
  slug: string;
  displayName?: string;
};

type DeviceCodeArgs = {
  clientId: string;
};

type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

type ExtensionResponse = {
  activeVersion: string;
  description?: string;
  foxe: string;
  id: string;
  name: string;
  publisher: string;
  sha256Sum?: string;
};

export type ConsoleEvent = {
  id: string;
  createdAt: string;
  deviceId: string;
  durationNanos: string;
  endTime: Time;
  endTimeInSeconds: number;
  metadata: Record<string, string>;
  startTime: Time;
  startTimeInSeconds: number;
  timestampNanos: string;
  updatedAt: string;
};

type TokenArgs = {
  deviceCode: string;
  clientId: string;
};

type TokenResponse = {
  accessToken: string;
  idToken: string;
};

type TopicResponse = {
  topic: string;
  encoding: string;
  schemaName: string;
  schemaEncoding: string;
  schema?: Uint8Array;
  version: string;
};

type RawTopicResponse = Omit<TopicResponse, "schema"> & { schema?: string };

type topicInterfaceReturns = {
  startTime: number;
  endTime: number;
  topics: RawTopicResponse[];
};

type customTopicResponse = {
  start: string;
  end: string;
  metaData: TopicResponse[];
};

type CoverageResponse = {
  deviceId: string;
  start: string;
  end: string;
};

type DeviceResponse = {
  id: string;
  name: string;
};

export type LayoutID = string & { __brand: "LayoutID" };
export type ISO8601Timestamp = string & { __brand: "ISO8601Timestamp" };

export type ConsoleApiLayout = {
  id: LayoutID;
  name: string;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  savedAt?: ISO8601Timestamp;
  permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE";
  data?: Record<string, unknown>;
};

export type DataPlatformRequestArgs = {
  revisionName: string;
  filename: string;
};

type ApiResponse<T> = { status: number; json: T };

class CoSceneConsoleApi {
  private _baseUrl: string;
  private _authHeader?: string;
  private _responseObserver: undefined | ((response: Response) => void);

  public constructor(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  public getBaseUrl(): string {
    return this._baseUrl;
  }

  public setAuthHeader(header: string): void {
    this._authHeader = header;
  }

  public getAuthHeader(): string | undefined {
    return this._authHeader;
  }

  public setResponseObserver(observer: undefined | ((response: Response) => void)): void {
    this._responseObserver = observer;
  }

  public async orgs(): Promise<Org[]> {
    return await this.get<Org[]>("/v1/orgs");
  }

  public async me(): Promise<User> {
    return await this.get<User>("/v1/me");
  }

  public async signin(args: SigninArgs): Promise<Session> {
    return await this.post<Session>("/v1/signin", args);
  }

  public async signout(): Promise<void> {
    return await this.post<void>("/v1/signout");
  }

  public async deviceCode(args: DeviceCodeArgs): Promise<DeviceCodeResponse> {
    return await this.post<DeviceCodeResponse>("/v1/auth/device-code", {
      clientId: args.clientId,
    });
  }

  public async token(args: TokenArgs): Promise<TokenResponse> {
    return await this.post<TokenResponse>("/v1/auth/token", {
      deviceCode: args.deviceCode,
      clientId: args.clientId,
    });
  }

  private async get<T>(apiPath: string, query?: Record<string, string | undefined>): Promise<T> {
    // Strip keys with undefined values from the final query
    let queryWithoutUndefined: Record<string, string> | undefined;
    if (query) {
      queryWithoutUndefined = {};
      for (const [key, value] of Object.entries(query)) {
        if (value != undefined) {
          queryWithoutUndefined[key] = value;
        }
      }
    }

    return (
      await this.request<T>(
        query == undefined
          ? apiPath
          : `${apiPath}?${new URLSearchParams(queryWithoutUndefined).toString()}`,
        { method: "GET" },
      )
    ).json;
  }

  public async getExtensions(): Promise<ExtensionResponse[]> {
    return await this.get<ExtensionResponse[]>("/v1/extensions");
  }

  public async getExtension(id: string): Promise<ExtensionResponse> {
    return await this.get<ExtensionResponse>(`/v1/extensions/${id}`);
  }

  public async getDevice(id: string): Promise<DeviceResponse> {
    return await this.get<DeviceResponse>(`/v1/devices/${id}`);
  }

  public async createEvent({
    event,
    parent,
    recordName,
  }: {
    event: Event;
    parent: string;
    recordName: string;
  }): Promise<Event> {
    const createEventRequest = new CreateEventRequest();
    createEventRequest.setParent(parent);
    createEventRequest.setEvent(event);
    createEventRequest.setRecord(recordName);

    const newEvent = await eventClient.createEvent(createEventRequest);

    return newEvent;
  }

  public async getEvents({
    parent,
    recordId,
  }: {
    parent: string;
    recordId: string;
  }): Promise<Event[]> {
    const listEventsRequest = new ListEventsRequest()
      .setParent(parent)
      .setOrderBy("create_time desc")
      .setFilter(`record.id="${recordId}"`)
      .setPageSize(999);

    const events = await eventClient.listEvents(listEventsRequest);

    return events.getEventsList();
  }

  public async deleteEvent({
    eventName,
  }: {
    eventName: string;
  }): Promise<google_protobuf_empty_pb.Empty> {
    const deleteEventRequest = new DeleteEventRequest().setName(eventName);

    return await eventClient.deleteEvent(deleteEventRequest);
  }

  public async updateEvent({
    event,
    updateMask,
  }: {
    event: Event;
    updateMask: FieldMask;
  }): Promise<void> {
    const req = new UpdateEventRequest();
    req.setEvent(event);
    req.setUpdateMask(updateMask);

    await eventClient.updateEvent(req);
  }

  public async getLayouts(options: { includeData: boolean }): Promise<readonly ConsoleApiLayout[]> {
    return await this.get<ConsoleApiLayout[]>("/v1/layouts", {
      includeData: options.includeData ? "true" : "false",
    });
  }

  public async getLayout(
    id: LayoutID,
    options: { includeData: boolean },
  ): Promise<ConsoleApiLayout | undefined> {
    return await this.get<ConsoleApiLayout>(`/v1/layouts/${id}`, {
      includeData: options.includeData ? "true" : "false",
    });
  }

  public async createLayout(layout: {
    id: LayoutID | undefined;
    savedAt: ISO8601Timestamp | undefined;
    name: string | undefined;
    permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
    data: Record<string, unknown> | undefined;
  }): Promise<ConsoleApiLayout> {
    return await this.post<ConsoleApiLayout>("/v1/layouts", layout);
  }

  public async updateLayout(layout: {
    id: LayoutID;
    savedAt: ISO8601Timestamp;
    name: string | undefined;
    permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
    data: Record<string, unknown> | undefined;
  }): Promise<{ status: "success"; newLayout: ConsoleApiLayout } | { status: "conflict" }> {
    const { status, json: newLayout } = await this.patch<ConsoleApiLayout>(
      `/v1/layouts/${layout.id}`,
      layout,
    );
    if (status === 200) {
      return { status: "success", newLayout };
    } else {
      return { status: "conflict" };
    }
  }

  public async deleteLayout(id: LayoutID): Promise<boolean> {
    return (await this.delete(`/v1/layouts/${id}`)).status === 200;
  }

  public async topics(
    params: DataPlatformRequestArgs & { includeSchemas?: boolean },
  ): Promise<customTopicResponse> {
    const topics = await this.get<topicInterfaceReturns>("/v1/data/getMetadata", {
      revisionName: params.revisionName,
      filename: params.filename,
      includeSchemas: params.includeSchemas ?? false ? "true" : "false",
    });

    const metaData = topics.topics.map((topic) => {
      if (topic.schema == undefined) {
        return topic as Omit<RawTopicResponse, "schema">;
      }
      const decodedSchema = new Uint8Array(base64.length(topic.schema));
      base64.decode(topic.schema, decodedSchema, 0);
      return { ...topic, schema: decodedSchema };
    });

    return {
      // ...topics,
      start: toRFC3339String(timestampToTime(topics.startTime)),
      end: toRFC3339String(timestampToTime(topics.endTime)),
      metaData,
    };
  }

  private async request<T>(
    url: string,
    config?: RequestInit,
    {
      allowedStatuses = [],
    }: {
      /** By default, status codes other than 200 will throw an error. */
      allowedStatuses?: number[];
    } = {},
  ): Promise<ApiResponse<T>> {
    const fullUrl = `${this._baseUrl}${url}`;

    const headers: Record<string, string> = {
      // Include the version of studio in the request Useful when scraping logs to determine what
      // versions of the app are making requests.
      "fg-user-agent": FOXGLOVE_USER_AGENT,
    };
    if (this._authHeader != undefined) {
      headers["Authorization"] = this._authHeader;
    }
    const fullConfig: RequestInit = {
      ...config,
      credentials: "include",
      headers: { ...headers, ...config?.headers },
    };

    const res = await fetch(fullUrl, fullConfig);
    this._responseObserver?.(res);
    if (res.status !== 200 && !allowedStatuses.includes(res.status)) {
      if (res.status === 401) {
        throw new Error("Not logged in. Log in to your Foxglove account and try again.");
      } else if (res.status === 403) {
        throw new Error(
          "Unauthorized. Check that you are logged in to the correct Foxglove organization.",
        );
      }
      const json = (await res.json().catch((err) => {
        throw new Error(`Status ${res.status}: ${err.message}`);
      })) as { message?: string; error?: string };
      const message = json.message ?? json.error;
      throw new Error(`Status ${res.status}${message != undefined ? `: ${message}` : ""}`);
    }

    try {
      return { status: res.status, json: (await res.json()) as T };
    } catch (err) {
      throw new Error("Request Failed.");
    }
  }

  private async post<T>(apiPath: string, body?: unknown): Promise<T> {
    return (
      await this.request<T>(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json;
  }

  private async patch<T>(apiPath: string, body?: unknown): Promise<ApiResponse<T>> {
    return await this.request<T>(
      apiPath,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { allowedStatuses: [409] },
    );
  }

  private async delete<T>(
    apiPath: string,
    query?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return await this.request<T>(
      query == undefined ? apiPath : `${apiPath}?${new URLSearchParams(query).toString()}`,
      { method: "DELETE" },
      { allowedStatuses: [404] },
    );
  }
}

export type { Org, DeviceCodeResponse, Session, CoverageResponse };
export default CoSceneConsoleApi;
