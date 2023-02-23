// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  GetProjectRequest,
  GetUserRequest,
  IncCounterRequest,
  ListOrganizationUsersRequest,
  Project,
  TaskCategoryEnum,
  TaskStateEnum,
  User as CoUser,
} from "@coscene-io/coscene/proto/v1alpha1";
import {
  ListEventsRequest,
  CreateEventRequest,
  Event,
  DeleteEventRequest,
  UpdateEventRequest,
  GetRecordRequest,
  Record as CoSceneRecord,
  CreateTaskRequest,
  Task,
} from "@coscene-io/coscene/proto/v1alpha2";
import { CsWebClient } from "@coscene-io/coscene/queries";
import { Metric } from "@coscene-io/cosceneapis/coscene/dataplatform/v1alpha1/common/metric_pb";
import * as base64 from "@protobufjs/base64";
import * as google_protobuf_empty_pb from "google-protobuf/google/protobuf/empty_pb";
import { FieldMask } from "google-protobuf/google/protobuf/field_mask_pb";

import { Time, toRFC3339String } from "@foxglove/rostime";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { timestampToTime } from "@foxglove/studio-base/util/time";

export type User = {
  id: string;
  email: string;
  orgId: string;
  orgDisplayName: string | null; // eslint-disable-line no-restricted-syntax
  orgSlug: string;
  orgPaid: boolean | null; // eslint-disable-line no-restricted-syntax
  org: {
    id: string;
    slug: string;
    displayName: string;
    isEnterprise: boolean;
    allowsUploads: boolean;
    supportsEdgeSites: boolean;
  };
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
};

export enum MetricType {
  RecordPlaysTotal = "honeybee_record_plays_total",
  RecordPlaysEveryFiveSecondsTotal = "honeybee_record_plays_every_five_seconds_total",
}

export type CoSceneContext = {
  currentWarehouseId?: string;
  currentWarehouseDisplayName?: string;
  currentWarehouseSlug?: string;
  currentProjectId?: string;
  currentProjectSlug?: string;
  currentProjectDisplayName?: string;
  currentOrganizationId?: string;
  currentOrganizationDisplayName?: string;
  currentRecordId?: string;
  isCurrentProjectArchived?: boolean;
};

type ApiResponse<T> = { status: number; json: T };

type LayoutTemplatesIndex = {
  [key: string]: {
    path: string;
    updateTime: string;
  };
};

class CoSceneConsoleApi {
  private _baseUrl: string;
  private _authHeader?: string;
  private _responseObserver: undefined | ((response: Response) => void);
  private _coSceneContext: CoSceneContext;

  public constructor(baseUrl: string, coSceneContext?: CoSceneContext) {
    this._baseUrl = baseUrl;
    this._coSceneContext = coSceneContext ?? {};
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

  private async get<T>(
    apiPath: string,
    query?: Record<string, string | undefined>,
    // eslint-disable-next-line @foxglove/no-boolean-parameters
    customHost?: boolean,
  ): Promise<T> {
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
        undefined,
        customHost,
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

  private async request<T>(
    url: string,
    config?: RequestInit,
    {
      allowedStatuses = [],
    }: {
      /** By default, status codes other than 200 will throw an error. */
      allowedStatuses?: number[];
    } = {},
    // eslint-disable-next-line @foxglove/no-boolean-parameters
    customHost?: boolean,
  ): Promise<ApiResponse<T>> {
    const fullUrl = customHost != undefined && customHost ? url : `${this._baseUrl}${url}`;

    const headers: Record<string, string> = {
      // Include the version of studio in the request Useful when scraping logs to determine what
      // versions of the app are making requests.
      "fg-user-agent": FOXGLOVE_USER_AGENT,
    };
    const fullConfig: RequestInit = {
      ...config,
      headers: { ...headers, ...config?.headers },
    };

    const res = await fetch(fullUrl, fullConfig);
    this._responseObserver?.(res);
    if (res.status !== 200 && !allowedStatuses.includes(res.status)) {
      if (res.status === 401) {
        throw new Error("Not logged in. Please log in again.");
      } else if (res.status === 403) {
        throw new Error(
          "Unauthorized. Please check if you are logged in and have permission to access.",
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

  // eslint-disable-next-line @foxglove/no-boolean-parameters
  private async post<T>(apiPath: string, body?: unknown, customHost?: boolean): Promise<T> {
    return (
      await this.request<T>(
        apiPath,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        {},
        customHost,
      )
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

  // coScene-----------------------------------------------------------
  public async topics(
    params: DataPlatformRequestArgs & { includeSchemas?: boolean },
  ): Promise<customTopicResponse> {
    const topics = await this.get<topicInterfaceReturns>("/v1/data/getMetadata", {
      revisionName: params.revisionName,
      includeSchemas: params.includeSchemas ?? false ? "true" : "false",
      access_token: this._authHeader?.replace(/(^\s*)|(\s*$)/g, ""),
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

  public getStreamUrl(revisionName: string, authHeader: string): string {
    return `${
      this._baseUrl
    }/v1/data/getStreams?revisionName=${revisionName}&access_token=${authHeader.replace(
      /(^\s*)|(\s*$)/g,
      "",
    )}`;
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

    const newEvent = await CsWebClient.getEventClient().createEvent(createEventRequest);

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

    const events = await CsWebClient.getEventClient().listEvents(listEventsRequest);

    return events.getEventsList();
  }

  public async deleteEvent({
    eventName,
  }: {
    eventName: string;
  }): Promise<google_protobuf_empty_pb.Empty> {
    const deleteEventRequest = new DeleteEventRequest().setName(eventName);

    return await CsWebClient.getEventClient().deleteEvent(deleteEventRequest);
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

    await CsWebClient.getEventClient().updateEvent(req);
  }

  public async getUser(userName: string): Promise<CoUser> {
    const request = new GetUserRequest().setName(userName);
    const result = await CsWebClient.getUserClient().getUser(request);
    return result;
  }

  public async createTask({
    parent,
    record,
    task,
  }: {
    parent: string;
    record: string;
    task: {
      title: string;
      description: string;
      assignee: string;
      assigner: string;
    };
  }): Promise<Task> {
    const currentUser = await this.getUser("users/current");
    const newTask = new Task()
      .setCategory(TaskCategoryEnum.TaskCategory.RECORD)
      .setRecord(record)
      .setDescription(task.title)
      .setTitle(task.title)
      .setDescription(task.description)
      .setState(TaskStateEnum.TaskState.PENDING)
      .setAssignee(task.assignee)
      .setAssigner(currentUser.getName());

    const request = new CreateTaskRequest().setParent(parent).setTask(newTask);
    const result = await CsWebClient.getTaskClient().createTask(request);
    return result;
  }

  public async listOrganizationUsers(): Promise<CoUser[]> {
    const request = new ListOrganizationUsersRequest()
      .setParent("organizations/current")
      .setPageSize(100);
    const result = await CsWebClient.getUserClient().listOrganizationUsers(request);
    return result.getOrganizationUsersList();
  }

  public async sendIncCounter({
    name,
    desc = "",
    tag = new Map(),
  }: {
    name: MetricType;
    desc?: string;
    tag?: Map<string, string>;
  }): Promise<void> {
    const req = new IncCounterRequest();
    const metric = new Metric();
    metric.setName(name);
    metric.setDescription(desc);
    for (const [key, value] of tag.entries()) {
      metric.getLabelsMap().set(key, value);
    }

    if (this._coSceneContext.currentOrganizationId) {
      const orgId = this._coSceneContext.currentOrganizationId.split("/").pop();
      metric.getLabelsMap().set("org_id", orgId ? orgId : "");
    }

    req.setCounter(metric);
    await CsWebClient.getMetricClient().incCounter(req);
  }

  public async getRecord({ recordName }: { recordName: string }): Promise<CoSceneRecord> {
    const req = new GetRecordRequest();
    req.setName(recordName);

    return await CsWebClient.getRecordClient().getRecord(req);
  }

  public async getProject({ projectName }: { projectName: string }): Promise<Project> {
    const req = new GetProjectRequest().setName(projectName);
    return await CsWebClient.getProjectClient().getProject(req);
  }

  public async getLayoutTemplatesIndex(layoutTemplatesUrl: string): Promise<LayoutTemplatesIndex> {
    return await this.get<LayoutTemplatesIndex>(layoutTemplatesUrl, undefined, true);
  }

  public async getLayoutTemplate(url: string): Promise<LayoutData> {
    return await this.get<LayoutData>(url, undefined, true);
  }
}

export type { Org, DeviceCodeResponse, Session, CoverageResponse };
export default CoSceneConsoleApi;
