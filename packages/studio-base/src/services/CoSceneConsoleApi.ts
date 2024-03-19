// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Value } from "@bufbuild/protobuf";
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
  CreateEventRequest,
  DeleteEventRequest,
  UpdateEventRequest,
  GetRecordRequest,
  Record as CoSceneRecord,
  Task,
  UpsertTaskRequest,
  GetTicketSystemMetadataRequest,
  SyncTaskRequest,
  TicketSystemMetadata,
  Event,
} from "@coscene-io/coscene/proto/v1alpha2";
import { CsWebClient } from "@coscene-io/coscene/queries";
import { Metric } from "@coscene-io/cosceneapis/coscene/dataplatform/v1alpha1/common/metric_pb";
import { ProjectService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_connect";
import {
  ListUserProjectsRequest,
  ListUserProjectsResponse,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_pb";
import { RoleService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/role_connect";
import {
  ListRolesRequest,
  ListRolesResponse,
  BatchGetUserRolesRequest,
  BatchGetUserRolesResponse,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/role_pb";
import { ConfigMap } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/config_map_pb";
import { Event as Event_es } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import { ConfigMapService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/config_map_connect";
import {
  UpsertConfigMapRequest,
  GetConfigMapRequest,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/config_map_pb";
import { EventService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/event_connect";
import {
  GenerateEventPictureUploadUrlRequest,
  GenerateEventPictureUploadUrlResponse,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/event_pb";
import { RecordService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_connect";
import {
  ListRecordsRequest,
  ListRecordsResponse,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { FileService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_connect";
import {
  ListFilesRequest,
  ListFilesResponse,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_pb";
import { JobRun } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/resources/job_run_pb";
import { JobRunService } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/services/job_run_connect";
import { GetJobRunRequest } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/services/job_run_pb";
import * as base64 from "@protobufjs/base64";
import * as google_protobuf_empty_pb from "google-protobuf/google/protobuf/empty_pb";
import { FieldMask } from "google-protobuf/google/protobuf/field_mask_pb";
import { StatusCode } from "grpc-web";
import { t } from "i18next";
import toast from "react-hot-toast";

import { Time, toRFC3339String } from "@foxglove/rostime";
import { CoSceneErrors } from "@foxglove/studio-base/CoSceneErrors";
import { BaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { LayoutData } from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext/actions";
import PlayerProblemManager from "@foxglove/studio-base/players/PlayerProblemManager";
import { getPromiseClient } from "@foxglove/studio-base/util/coscene";
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

export type UserPersonalInfo = {
  history?: {
    visitedProject?: string[];
  };
  settings?: {
    language?: string;
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
  messageCount?: number;
  messageFrequency?: number;
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

export type getPlaylistResponse = {
  fileList: {
    source: string;
    displayName: string;
    startTime: number;
    endTime: number;
    projectName: string;
    recordName: string;
    fileType: "NORMAL_FILE" | "GHOST_RESULT_FILE" | "GHOST_SOURCE_FILE";
  }[];
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
export type Permission = "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE";

export type ConsoleApiLayout = {
  id: LayoutID;
  name: string;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  savedAt?: ISO8601Timestamp;
  permission: Permission;
  data?: Record<string, unknown>;
  isProjectRecommended: boolean;
  isRecordRecommended: boolean;
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
  currentOrganizationSlug?: string;
  currentOrganizationDisplayName?: string;
  currentRecordId?: string;
  isCurrentProjectArchived?: boolean;
  currentUserId?: string;
};

type ApiResponse<T> = { status: number; json: T };

type LayoutTemplatesIndex = {
  [key: string]: {
    path: string;
    updateTime: string;
  };
};

export type SingleFileGetEventsRequest = {
  projectName: string;
  projectDisplayName: string;
  recordDisplayName: string;
  filter?: string;
  startTime: number;
  endTime: number;
};

export type EventList = {
  event: Event_es;
  projectDisplayName: string;
  recordDisplayName: string;
}[];

export type GetEventsResponse = {
  eventList: {
    event: string;
    projectDisplayName: string;
    recordDisplayName: string;
  }[];
};

class CoSceneConsoleApi {
  #baseUrl: string;
  #bffUrl: string;
  #authHeader?: string;
  #responseObserver: undefined | ((response: Response) => void);
  #addTopicPrefix: string;
  #timeMode: "absoluteTime" | "relativeTime" = "absoluteTime";
  #problemManager = new PlayerProblemManager();
  #currentProjectId: string = "";
  #currentRecordId: string = "";

  public coSceneContext: CoSceneContext;

  public constructor(
    baseUrl: string,
    bffUrl: string,
    addTopicPrefix: string,
    timeMode: "absoluteTime" | "relativeTime",
    coSceneContext?: CoSceneContext,
  ) {
    this.#baseUrl = baseUrl;
    this.#bffUrl = bffUrl;
    this.coSceneContext = coSceneContext ?? {};
    this.#addTopicPrefix = addTopicPrefix === "true" ? "true" : "false";
    this.#timeMode = timeMode;
  }

  public setProjectId(projectId: string): void {
    this.#currentProjectId = projectId;
  }

  public getProjectId(): string {
    return this.#currentProjectId;
  }

  public setRecordId(recordId: string): void {
    this.#currentRecordId = recordId;
  }

  public getRecordId(): string {
    return this.#currentRecordId;
  }

  public getProblemManager(): PlayerProblemManager {
    return this.#problemManager;
  }

  public getTimeMode(): "absoluteTime" | "relativeTime" {
    return this.#timeMode;
  }

  public setTimeMode(timeMode: "absoluteTime" | "relativeTime"): void {
    this.#timeMode = timeMode;
  }

  public getBaseUrl(): string {
    return this.#baseUrl;
  }

  public setAuthHeader(header: string): void {
    this.#authHeader = header;
  }

  public getAuthHeader(): string | undefined {
    return this.#authHeader;
  }

  public getAddTopicPrefix(): string {
    return this.#addTopicPrefix;
  }

  public setAddTopicPrefix(prefix: string): void {
    this.#addTopicPrefix = prefix;
  }

  public setResponseObserver(observer: undefined | ((response: Response) => void)): void {
    this.#responseObserver = observer;
  }

  public async orgs(): Promise<Org[]> {
    return await this.#get<Org[]>("/v1/orgs");
  }

  public async me(): Promise<User> {
    return await this.#get<User>("/v1/me");
  }

  public async signin(args: SigninArgs): Promise<Session> {
    return await this.#post<Session>("/v1/signin", args);
  }

  public async signout(): Promise<void> {
    await this.#post<void>("/v1/signout");
  }

  public async deviceCode(args: DeviceCodeArgs): Promise<DeviceCodeResponse> {
    return await this.#post<DeviceCodeResponse>("/v1/auth/device-code", {
      clientId: args.clientId,
    });
  }

  public async token(args: TokenArgs): Promise<TokenResponse> {
    return await this.#post<TokenResponse>("/v1/auth/token", {
      deviceCode: args.deviceCode,
      clientId: args.clientId,
    });
  }

  async #get<T>(
    apiPath: string,
    query?: Record<string, string | undefined>,
    // eslint-disable-next-line @foxglove/no-boolean-parameters
    customHost?: boolean,
    config?: RequestInit,
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
      await this.#request<T>(
        query == undefined
          ? apiPath
          : `${apiPath}?${new URLSearchParams(queryWithoutUndefined).toString()}`,
        { method: "GET", ...config },
        undefined,
        customHost,
      )
    ).json;
  }

  public async getExtensions(): Promise<ExtensionResponse[]> {
    return await this.#get<ExtensionResponse[]>("/v1/extensions");
  }

  public async getExtension(id: string): Promise<ExtensionResponse> {
    return await this.#get<ExtensionResponse>(`/v1/extensions/${id}`);
  }

  public async getDevice(id: string): Promise<DeviceResponse> {
    return await this.#get<DeviceResponse>(`/v1/devices/${id}`);
  }

  public async getLayouts(options: { includeData: boolean }): Promise<readonly ConsoleApiLayout[]> {
    return await this.#get<ConsoleApiLayout[]>("/bff/honeybee/layout/v2/layouts", {
      includeData: options.includeData ? "true" : "false",
      projectId: this.#currentProjectId,
      recordId: this.#currentRecordId,
    });
  }

  public async getLayout(
    id: LayoutID,
    options: { includeData: boolean },
  ): Promise<ConsoleApiLayout | undefined> {
    return await this.#get<ConsoleApiLayout>(`/bff/honeybee/layout/v2/layouts/${id}`, {
      includeData: options.includeData ? "true" : "false",
      projectId: this.#currentProjectId,
    });
  }

  public async createLayout(layout: {
    id: LayoutID | undefined;
    savedAt: ISO8601Timestamp | undefined;
    name: string | undefined;
    permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
    data: Record<string, unknown> | undefined;
  }): Promise<ConsoleApiLayout> {
    return await this.#post<ConsoleApiLayout>("/bff/honeybee/layout/v2/layouts", {
      ...layout,
    });
  }

  public async createRecordLayout(layout: {
    id: LayoutID | undefined;
    savedAt: ISO8601Timestamp | undefined;
    name: string | undefined;
    permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
    data: Record<string, unknown> | undefined;
  }): Promise<ConsoleApiLayout> {
    return await this.#post<ConsoleApiLayout>("/bff/honeybee/layout/v2/recordLayout", {
      ...layout,
      recordId: this.#currentRecordId,
    });
  }

  public async updateLayout(layout: {
    id: LayoutID;
    savedAt: ISO8601Timestamp;
    name: string | undefined;
    permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
    data: Record<string, unknown> | undefined;
  }): Promise<{ status: "success"; newLayout: ConsoleApiLayout } | { status: "conflict" }> {
    const { status, json: newLayout } = await this.#patch<ConsoleApiLayout>(
      `/bff/honeybee/layout/v2/layouts/${layout.id}`,
      { ...layout, projectId: this.#currentProjectId },
    );
    if (status === 200) {
      return { status: "success", newLayout };
    } else {
      return { status: "conflict" };
    }
  }

  public async deleteLayout(id: LayoutID): Promise<boolean> {
    return (await this.#delete(`/bff/honeybee/layout/v2/layouts/${id}`)).status === 200;
  }

  async #request<T>(
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
    if (url.length === 0 || url === "/") {
      throw new Error("Invalid URL");
    }
    const fullUrl =
      customHost != undefined && customHost
        ? url
        : url.startsWith("/bff")
        ? `${this.#bffUrl}${url}`
        : `${this.#baseUrl}${url}`;

    const headers: Record<string, string> = {
      Authorization: this.#authHeader?.replace(/(^\s*)|(\s*$)/g, "") ?? "",
    };
    const fullConfig: RequestInit = {
      ...config,
      headers: {
        ...headers,
        ...config?.headers,
        "Topic-Prefix": this.#addTopicPrefix,
        "Relative-Time": this.#timeMode === "relativeTime" ? "true" : "false",
      },
    };

    const res = await fetch(fullUrl, fullConfig);
    this.#responseObserver?.(res);
    if (res.status !== 200 && !allowedStatuses.includes(res.status)) {
      if (res.status === 401) {
        window.location.href = "/login";
      } else if (res.status === 403) {
        throw new Error(
          "Unauthorized. Please check if you are logged in and have permission to access.",
        );
      }
      const json = (await res.json().catch((err) => {
        throw new Error(`Status ${res.status}: ${err.message}`);
      })) as { message?: string; error?: string; errorCode?: number };
      const message = json.message ?? json.error;
      if (json.errorCode != undefined) {
        const coSceneErrorMessageKey = CoSceneErrors[json.errorCode];
        if (coSceneErrorMessageKey) {
          toast.error(`${t(coSceneErrorMessageKey, "error", { ns: "cosError" })}`);
        }

        this.#problemManager.addProblem("CoScene:request-error", {
          message: String(json.errorCode),
          severity: "error",
        });
      }
      throw new Error(`Status ${res.status}${message != undefined ? `: ${message}` : ""}`);
    }

    try {
      return { status: res.status, json: (await res.json()) as T };
    } catch (err) {
      throw new Error("Request Failed.");
    }
  }

  // eslint-disable-next-line @foxglove/no-boolean-parameters
  async #post<T>(apiPath: string, body?: unknown, customHost?: boolean): Promise<T> {
    return (
      await this.#request<T>(
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

  async #patch<T>(apiPath: string, body?: unknown): Promise<ApiResponse<T>> {
    return await this.#request<T>(
      apiPath,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { allowedStatuses: [409] },
    );
  }

  async #delete<T>(apiPath: string, query?: Record<string, string>): Promise<ApiResponse<T>> {
    return await this.#request<T>(
      query == undefined ? apiPath : `${apiPath}?${new URLSearchParams(query).toString()}`,
      { method: "DELETE" },
      { allowedStatuses: [404] },
    );
  }

  // coScene-----------------------------------------------------------
  public async topics(key: string): Promise<customTopicResponse> {
    const topics = await this.#post<topicInterfaceReturns>(
      "/v1/data/getMetadata",
      {
        id: key,
      },
      undefined,
    );

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

  public getStreamUrl(): string {
    return `${this.#baseUrl}/v1/data/getStreams`;
  }

  public async getPlaylist(key: string): Promise<getPlaylistResponse> {
    return await this.#post<getPlaylistResponse>(
      "/v1/data/getPlaylist",
      {
        id: key,
      },
      undefined,
    );
  }

  // event
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

  public async getEvents(params: { fileList: SingleFileGetEventsRequest[] }): Promise<EventList> {
    const eventBinaryArray = await this.#post<GetEventsResponse>(
      "/bff/honeybee/event/v1/listEvents",
      params,
    );

    return eventBinaryArray.eventList.map((event) => {
      const binaryEvent = event.event;
      const binaryString = atob(binaryEvent);
      const uint8Array = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
      }
      return {
        event: Event_es.fromBinary(uint8Array),
        projectDisplayName: event.projectDisplayName,
        recordDisplayName: event.recordDisplayName,
      };
    });
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
    event,
  }: {
    parent: string;
    record: string;
    task: {
      title: string;
      description: string;
      assignee: string;
      assigner: string;
    };
    event: Event;
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

    const request = new UpsertTaskRequest().setParent(parent).setTask(newTask).setEvent(event);
    const result = await CsWebClient.getTaskClient().upsertTask(request);
    return result;
  }

  public async getTicketSystemMetadata({
    parent,
  }: {
    parent: string;
  }): Promise<TicketSystemMetadata> {
    const request = new GetTicketSystemMetadataRequest().setName(parent);
    const result = await CsWebClient.getTicketSystemClient().getTicketSystemMetadata(request);
    return result;
  }

  public async syncTask({ name }: { name: string }): Promise<void> {
    const req = new SyncTaskRequest().setName(name);

    await CsWebClient.getTaskClient().syncTask(req);
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

    if (this.coSceneContext.currentOrganizationId) {
      const orgId = this.coSceneContext.currentOrganizationId.split("/").pop();
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

  public async upsertUserConfig({
    userId,
    configId,
    obj,
  }: {
    userId: string;
    configId: string;
    obj: UserPersonalInfo;
  }): Promise<ConfigMap> {
    const req = new UpsertConfigMapRequest({
      configMap: {
        name: `users/${userId}/configMaps/${configId}`,
        value: Object.keys(obj).length > 0 ? Value.fromJson(obj) : undefined,
      },
    });
    const configMapClient = getPromiseClient(ConfigMapService);
    return await configMapClient.upsertConfigMap(req);
  }

  public async getUserConfigMap({
    userId,
    configId,
  }: {
    userId: string;
    configId: string;
  }): Promise<ConfigMap | undefined> {
    const configName = `users/${userId}/configMaps/${configId}`;
    const req = new GetConfigMapRequest({ name: configName });
    const configMapClient = getPromiseClient(ConfigMapService);
    return await configMapClient.getConfigMap(req).catch((err) => {
      if (err.code === StatusCode.NOT_FOUND) {
        return undefined;
      }
    });
  }

  public async getProject({ projectName }: { projectName: string }): Promise<Project> {
    const req = new GetProjectRequest().setName(projectName);
    return await CsWebClient.getProjectClient().getProject(req);
  }

  public async getLayoutTemplatesIndex(layoutTemplatesUrl: string): Promise<LayoutTemplatesIndex> {
    return await this.#get<LayoutTemplatesIndex>(layoutTemplatesUrl, undefined, true);
  }

  public async getLayoutTemplate(url: string): Promise<LayoutData> {
    return await this.#get<LayoutData>(url, undefined, true);
  }

  public async listUserProjects({
    userId,
    pageSize,
    filter,
    currentPage,
  }: {
    userId: string;
    pageSize: number;
    filter?: string;
    currentPage: number;
  }): Promise<ListUserProjectsResponse> {
    const req = new ListUserProjectsRequest({
      parent: `users/${userId}`,
      pageSize,
      skip: pageSize * currentPage,
    });

    if (filter) {
      req.filter = filter;
    }

    const projectClient = getPromiseClient(ProjectService);

    return await projectClient.listUserProjects(req);
  }

  public async listRecord({
    projectName,
    pageSize,
    filter,
    currentPage,
  }: {
    projectName: string;
    pageSize: number;
    filter: string;
    currentPage: number;
  }): Promise<ListRecordsResponse> {
    const req = new ListRecordsRequest({
      parent: projectName,
      filter,
      pageSize,
      skip: pageSize * currentPage,
    });

    const recordClient = getPromiseClient(RecordService);

    return await recordClient.listRecords(req);
  }

  public async listFiles({
    revcordName,
    pageSize,
    filter,
    currentPage,
  }: {
    revcordName: string;
    pageSize: number;
    filter: string;
    currentPage: number;
  }): Promise<ListFilesResponse> {
    const req = new ListFilesRequest({
      parent: revcordName,
      filter,
      pageSize,
      skip: pageSize * currentPage,
    });

    const fileClient = getPromiseClient(FileService);

    return await fileClient.listFiles(req);
  }

  public async generateEventPictureUploadUrl({
    event,
  }: {
    event: string;
  }): Promise<GenerateEventPictureUploadUrlResponse> {
    const eventClient = getPromiseClient(EventService);

    const req = new GenerateEventPictureUploadUrlRequest({
      event,
    });

    return await eventClient.generateEventPictureUploadUrl(req);
  }

  public async uploadEventPicture({ event, file }: { event: string; file: File }): Promise<void> {
    const result = await this.generateEventPictureUploadUrl({ event });
    const url = result.preSignedUri;
    await fetch(url, {
      method: "PUT",
      body: file,
    });
  }

  public async getJobRun(jobRunName: string): Promise<JobRun> {
    const jobRunClient = getPromiseClient(JobRunService);

    const req = new GetJobRunRequest({
      name: jobRunName,
    });

    return await jobRunClient.getJobRun(req);
  }

  public async getBaseInfo(key: string): Promise<BaseInfo> {
    const baseInfoString: BaseInfo = await this.#get<BaseInfo>(`/bff/shortenUrl/${key}`);

    return baseInfoString;
  }

  public async setBaseInfo(baseInfo: BaseInfo): Promise<string> {
    const baseInfoString: string = JSON.stringify(baseInfo) ?? "";

    const key = await this.#post<{ id: string }>("/bff/shortenUrl", {
      url: baseInfoString,
    });

    return key.id;
  }

  public async setProjectRecommendedLayouts(
    layoutIds: LayoutID[],
    currentProjectId: string,
  ): Promise<{ status: "success" } | { status: "conflict" }> {
    const { status } = await this.#patch(
      `/bff/honeybee/layout/v2/recommend/project/${currentProjectId}`,
      {
        layoutIds,
      },
    );

    if (status === 200) {
      return { status: "success" };
    }

    return { status: "conflict" };
  }

  public async getRoleLists(): Promise<ListRolesResponse> {
    const req = new ListRolesRequest({ pageSize: 999 });

    const roleClient = getPromiseClient(RoleService);

    return await roleClient.listRoles(req);
  }

  public async batchGetProjectUserRoles(
    projectName: string,
    userIds: string[],
  ): Promise<BatchGetUserRolesResponse> {
    const req = new BatchGetUserRolesRequest({
      parent: projectName,
      names: userIds,
    });

    const roleClient = getPromiseClient(RoleService);

    return await roleClient.batchGetUserRoles(req);
  }

  public async batchGetOrgUserRoles(userIds: string[]): Promise<BatchGetUserRolesResponse> {
    const req = new BatchGetUserRolesRequest({
      names: userIds,
    });

    const roleClient = getPromiseClient(RoleService);

    return await roleClient.batchGetUserRoles(req);
  }
}

export type { Org, DeviceCodeResponse, Session, CoverageResponse };
export default CoSceneConsoleApi;
