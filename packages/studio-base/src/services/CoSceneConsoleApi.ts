// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Value, PartialMessage, Empty, FieldMask } from "@bufbuild/protobuf";
import { Metric } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/common/metric_pb";
import { Organization } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { User as CoUser } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/user_pb";
import { MetricService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/metric_connect";
import { IncCounterRequest } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/metric_pb";
import { OrganizationService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/organization_connect";
import { GetOrganizationRequest } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/organization_pb";
import { ProjectService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/project_connect";
import {
  GetProjectRequest,
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
import { UserService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/user_connect";
import {
  GetUserRequest,
  BatchGetUsersRequest,
  BatchGetUsersResponse,
  ListOrganizationUsersRequest,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/services/user_pb";
import { ConfigMap } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/config_map_pb";
import { DiagnosisRule } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/diagnosis_rule_pb";
import { Event } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/event_pb";
import { Record as CoSceneRecord } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { ConfigMapService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/config_map_connect";
import {
  UpsertConfigMapRequest,
  GetConfigMapRequest,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/config_map_pb";
import { DiagnosisService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/diagnosis_rule_connect";
import { GetDiagnosisRuleRequest } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/diagnosis_rule_pb";
import { EventService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/event_connect";
import {
  CreateEventRequest,
  DeleteEventRequest,
  UpdateEventRequest,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/event_pb";
import { RecordService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_connect";
import {
  GetRecordRequest,
  ListRecordsRequest,
  ListRecordsResponse,
  CreateRecordRequest,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/record_pb";
import { TicketSystemService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/ticket_system_connect";
import {
  GetTicketSystemMetadataRequest,
  TicketSystemMetadata,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/services/ticket_system_pb";
import { TaskCategoryEnum_TaskCategory } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_category_pb";
import { TaskStateEnum_TaskState } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/enums/task_state_pb";
import { File as File_es } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { Task } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/task_pb";
import { FileService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_connect";
import {
  ListFilesRequest,
  ListFilesResponse,
  DeleteFileRequest,
  GenerateFileDownloadUrlRequest,
  GenerateFileDownloadUrlResponse,
  GenerateFileUploadUrlsRequest,
  GenerateFileUploadUrlsResponse,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/file_pb";
import { TaskService } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/task_connect";
import {
  UpsertTaskRequest,
  SyncTaskRequest,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/services/task_pb";
import { JobRun } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/resources/job_run_pb";
import { JobRunService } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/services/job_run_connect";
import { GetJobRunRequest } from "@coscene-io/cosceneapis-es/coscene/matrix/v1alpha1/services/job_run_pb";
import * as base64 from "@protobufjs/base64";
import { StatusCode } from "grpc-web";
import { t } from "i18next";
import toast from "react-hot-toast";

import { Time, toRFC3339String } from "@foxglove/rostime";
import { CoSceneErrors } from "@foxglove/studio-base/CoSceneErrors";
import { BaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import PlayerProblemManager from "@foxglove/studio-base/players/PlayerProblemManager";
import { getPromiseClient } from "@foxglove/studio-base/util/coscene";
import { generateFileName } from "@foxglove/studio-base/util/coscene/upload";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";
import { timestampToTime } from "@foxglove/studio-base/util/time";
import { Auth } from "@foxglove/studio-desktop/src/common/types";

const authBridge = (global as { authBridge?: Auth }).authBridge;

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

export type MediaStatus =
  | "NORMAL"
  | "MEDIA_LOST"
  | "GENERATING"
  | "GENERATE_INCAPABLE"
  | "MEDIA_ILLEGAL"
  | "PERMISSION"
  | "GENERATED_SUCCESS";

export type FileList = {
  source: string;
  displayName: string;
  startTime: number;
  endTime: number;
  projectName: string;
  recordName: string;
  ghostModeFileType: "NORMAL_FILE" | "GHOST_RESULT_FILE" | "GHOST_SOURCE_FILE";
  mediaStatus: MediaStatus;
  sha256: string;
};

export type getPlaylistResponse = {
  fileList: FileList[];
};

type CoverageResponse = {
  deviceId: string;
  start: string;
  end: string;
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
  event: Event;
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

export type GetFileStatusResponse = { filename: string; status: MediaStatus }[];

class CoSceneConsoleApi {
  #baseUrl: string;
  #bffUrl: string;
  #authHeader?: string;
  #responseObserver: undefined | ((response: Response) => void);
  #addTopicPrefix: "false" | "true" = "false";
  #timeMode: "absoluteTime" | "relativeTime" = "absoluteTime";
  #problemManager = new PlayerProblemManager();
  #baseInfo: BaseInfo = {};
  #type?: "realtime" | "playback" | "other";
  #playbackQualityLevel: "ORIGINAL" | "HIGH" | "MID" | "LOW" = "ORIGINAL";

  public constructor(
    baseUrl: string,
    bffUrl: string,
    jwt: string,
    // The following three parameters are only used in data sources
    addTopicPrefix?: "true" | "false",
    timeMode?: "absoluteTime" | "relativeTime",
    playbackQualityLevel?: "ORIGINAL" | "HIGH" | "MID" | "LOW",
  ) {
    this.#baseUrl = baseUrl;
    this.#bffUrl = bffUrl;
    this.#authHeader = jwt;
    this.#addTopicPrefix = addTopicPrefix === "true" ? "true" : "false";
    this.#timeMode = timeMode === "absoluteTime" ? "absoluteTime" : "relativeTime";
    this.#playbackQualityLevel = playbackQualityLevel ?? "ORIGINAL";
  }

  public getPlaybackQualityLevel(): "ORIGINAL" | "HIGH" | "MID" | "LOW" {
    return this.#playbackQualityLevel;
  }

  public setApiBaseInfo(baseInfo: BaseInfo): void {
    this.#baseInfo = baseInfo;
  }

  public getApiBaseInfo(): BaseInfo {
    return this.#baseInfo;
  }

  public setType(type?: "realtime" | "playback" | "other"): void {
    this.#type = type;
  }

  public getType(): "realtime" | "playback" | "other" | undefined {
    return this.#type;
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

  public getBffUrl(): string {
    return this.#bffUrl;
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

  public setAddTopicPrefix(prefix: "true" | "false"): void {
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

  public async getLayouts(options: { includeData: boolean }): Promise<readonly ConsoleApiLayout[]> {
    return await this.#get<ConsoleApiLayout[]>("/bff/honeybee/layout/v2/layouts", {
      includeData: options.includeData ? "true" : "false",
      projectId: this.#baseInfo.projectId,
      recordId: this.#baseInfo.recordId,
    });
  }

  public async getLayout(
    id: LayoutID,
    options: { includeData: boolean },
  ): Promise<ConsoleApiLayout | undefined> {
    // if layout not found, return empty object
    const res = await this.#get<ConsoleApiLayout>(`/bff/honeybee/layout/v2/layouts/${id}`, {
      includeData: options.includeData ? "true" : "false",
      projectId: this.#baseInfo.projectId,
      recordId: this.#baseInfo.recordId,
    });

    if (Object.keys(res).length === 0) {
      return undefined;
    }

    return res;
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
      recordId: this.#baseInfo.recordId,
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
      { ...layout, projectId: this.#baseInfo.projectId },
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

  public getRequectConfig(
    url: string,
    config?: RequestInit,
    // eslint-disable-next-line @foxglove/no-boolean-parameters
    customHost?: boolean,
  ): { fullUrl: string; fullConfig: RequestInit } {
    const fullUrl =
      customHost != undefined && customHost
        ? url
        : url.startsWith("/bff")
        ? `${this.#bffUrl}${url}`
        : `${this.#baseUrl}${url}`;

    const fullConfig: RequestInit = {
      ...config,
      headers: {
        Authorization: this.#authHeader?.replace(/(^\s*)|(\s*$)/g, "") ?? "",
        ...config?.headers,
      },
    };

    return { fullUrl, fullConfig };
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

    const { fullUrl, fullConfig } = this.getRequectConfig(url, config, customHost);

    const res = await fetch(fullUrl, fullConfig);
    this.#responseObserver?.(res);
    if (res.status !== 200 && !allowedStatuses.includes(res.status)) {
      if (res.status === 401) {
        if (!isDesktopApp()) {
          window.location.href = `/login?redirectToPath=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`;
        } else {
          authBridge?.logout();
        }
      } else if (res.status === 403) {
        throw new Error(
          "Unauthorized. Please check if you are logged in and have permission to access.",
        );
      }
      const json = (await res.json().catch((err: unknown) => {
        throw new Error(
          `Status ${res.status}: ${err instanceof Error ? err.message : String(err)}`,
        );
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
    } catch {
      throw new Error("Request Failed.");
    }
  }

  async #post<T>(
    apiPath: string,
    body?: unknown,
    // eslint-disable-next-line @foxglove/no-boolean-parameters
    customHost?: boolean,
    config?: RequestInit,
  ): Promise<T> {
    return (
      await this.#request<T>(
        apiPath,
        {
          method: "POST",
          body: JSON.stringify(body),
          ...(config ?? {}),
          headers: { "Content-Type": "application/json", ...(config?.headers ?? {}) },
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
      {
        headers: {
          "Topic-Prefix": this.#addTopicPrefix,
          "Relative-Time": this.#timeMode === "relativeTime" ? "true" : "false",
          "Playback-Quality-Level": this.#playbackQualityLevel,
        },
      },
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

  public async getStreams({
    start,
    end,
    topics,
    id,
    signal,
    projectName,
    fetchCompleteTopicState,
  }: {
    start: number;
    end: number;
    topics: string[];
    id: string;
    signal: AbortSignal;
    projectName: string;
    fetchCompleteTopicState?: "complete" | "incremental";
  }): Promise<Response> {
    const { fullUrl, fullConfig } = this.getRequectConfig("/v1/data/getStreams", {
      method: "POST",
      signal,
      cache: "no-cache",
      headers: {
        // Include the version of studio in the request Useful when scraping logs to determine what
        // versions of the app are making requests.
        "Content-Type": "application/json",
        "Topic-Prefix": this.#addTopicPrefix,
        "Playback-Quality-Level": this.#playbackQualityLevel,
        "Relative-Time": this.#timeMode === "relativeTime" ? "true" : "false",
        ProjectName: projectName,
      },
      body: JSON.stringify({
        start,
        end,
        topics,
        id,
        fetchCompleteTopicState: fetchCompleteTopicState ?? "incremental",
      }),
    });

    return await fetch(fullUrl, fullConfig);
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
    const createEventRequest = new CreateEventRequest({
      parent,
      event,
      record: recordName,
    });

    const newEvent = await getPromiseClient(EventService).createEvent(createEventRequest);

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
        event: Event.fromBinary(uint8Array),
        projectDisplayName: event.projectDisplayName,
        recordDisplayName: event.recordDisplayName,
      };
    });
  }

  public async deleteEvent({ eventName }: { eventName: string }): Promise<Empty> {
    const deleteEventRequest = new DeleteEventRequest({
      name: eventName,
    });

    return await getPromiseClient(EventService).deleteEvent(deleteEventRequest);
  }

  public async updateEvent({
    event,
    updateMask,
  }: {
    event: Event;
    updateMask: FieldMask;
  }): Promise<void> {
    const req = new UpdateEventRequest({
      event,
      updateMask,
    });

    await getPromiseClient(EventService).updateEvent(req);
  }

  public async getUser(userName: string): Promise<CoUser> {
    const request = new GetUserRequest({
      name: userName,
    });
    const result = await getPromiseClient(UserService).getUser(request);
    return result;
  }

  public async batchGetUsers(userNames: string[]): Promise<BatchGetUsersResponse> {
    const request = new BatchGetUsersRequest({
      names: userNames,
    });
    return await getPromiseClient(UserService).batchGetUsers(request);
  }

  public async getOrg(orgName: string): Promise<Organization> {
    const request = new GetOrganizationRequest({ name: orgName });
    return await getPromiseClient(OrganizationService).getOrganization(request);
  }

  public async createTask({
    parent,
    task,
    event,
  }: {
    parent: string;
    task: {
      title: string;
      description: string;
      assignee: string;
      assigner: string;
    };
    event: Event;
  }): Promise<Task> {
    const currentUser = await this.getUser("users/current");
    const newTask = new Task({
      category: TaskCategoryEnum_TaskCategory.COMMON,
      title: task.title,
      description: task.description,
      state: TaskStateEnum_TaskState.PENDING,
      assignee: task.assignee,
      assigner: currentUser.name,
      detail: {
        case: "commonTaskDetail",
        value: {
          related: {
            case: "event",
            value: event.name,
          },
        },
      },
    });

    const request = new UpsertTaskRequest({
      parent,
      task: newTask,
    });
    // create task does not have remove dumplicates logic, so we use upsert task to create task
    return await getPromiseClient(TaskService).upsertTask(request);
  }

  public async getTicketSystemMetadata({
    parent,
  }: {
    parent: string;
  }): Promise<TicketSystemMetadata> {
    const request = new GetTicketSystemMetadataRequest({
      name: parent,
    });
    const result = await getPromiseClient(TicketSystemService).getTicketSystemMetadata(request);
    return result;
  }

  public async syncTask({ name }: { name: string }): Promise<void> {
    const req = new SyncTaskRequest({
      name,
    });

    await getPromiseClient(TaskService).syncTask(req);
  }

  public async listOrganizationUsers(): Promise<CoUser[]> {
    const request = new ListOrganizationUsersRequest({
      parent: "organizations/current",
      pageSize: 100,
    });
    const result = await getPromiseClient(UserService).listOrganizationUsers(request);
    return result.organizationUsers;
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
    const metric = new Metric({
      name,
      description: desc,
    });
    for (const [key, value] of tag.entries()) {
      metric.labels[key] = value;
    }

    if (this.#baseInfo.organizationId) {
      const orgId = this.#baseInfo.organizationId.split("/").pop();
      metric.labels["org_id"] = orgId ?? "";
    }

    req.counter = metric;
    await getPromiseClient(MetricService).incCounter(req);
  }

  public async getRecord({ recordName }: { recordName: string }): Promise<CoSceneRecord> {
    const req = new GetRecordRequest({
      name: recordName,
    });

    return await getPromiseClient(RecordService).getRecord(req);
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
    return await configMapClient.getConfigMap(req).catch((err: unknown) => {
      if (err instanceof Error && (err.message as unknown as StatusCode) === StatusCode.NOT_FOUND) {
        return undefined;
      }
    });
  }

  public async getProject({ projectName }: { projectName: string }): Promise<Project> {
    const req = new GetProjectRequest({
      name: projectName,
    });
    return await getPromiseClient(ProjectService).getProject(req);
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

  public async generateFileUploadUrls(
    payload: PartialMessage<GenerateFileUploadUrlsRequest>,
  ): Promise<GenerateFileUploadUrlsResponse> {
    const req = new GenerateFileUploadUrlsRequest(payload);
    return await getPromiseClient(FileService)
      .generateFileUploadUrls(req)
      .catch((err: unknown) => {
        console.error("generateFileUploadUrls", err);
        throw err;
      });
  }

  public async uploadEventPicture({
    recordName,
    file,
    filename,
  }: {
    recordName: string;
    file: File;
    filename: string;
  }): Promise<void> {
    const name = generateFileName({
      filename,
      recordName,
      targetDir: ".cos/moments",
    });

    const Es_file = new File_es({
      filename,
      name,
      size: BigInt(file.size),
    });

    const uploadUrlsResult = await this.generateFileUploadUrls({
      files: [Es_file],
      parent: recordName,
    });

    const url = uploadUrlsResult.preSignedUrls[name] ?? "";

    const res = await fetch(url, {
      method: "PUT",
      body: file,
    });

    if (res.status !== 200) {
      throw new Error("Failed to upload file");
    }
  }

  public async generateFileDownloadUrl(
    payload: PartialMessage<GenerateFileDownloadUrlRequest>,
  ): Promise<GenerateFileDownloadUrlResponse> {
    const req = new GenerateFileDownloadUrlRequest(payload);
    return await getPromiseClient(FileService)
      .generateFileDownloadUrl(req)
      .catch((err: unknown) => {
        console.error("error", err);
        throw err;
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

  public async deleteFile(payload: PartialMessage<DeleteFileRequest>): Promise<void> {
    const req = new DeleteFileRequest(payload);
    await getPromiseClient(FileService)
      .deleteFile(req)
      .catch((err: unknown) => {
        throw err;
      });
  }

  public async getFilesStatus(key: string): Promise<Response> {
    const { fullConfig, fullUrl } = this.getRequectConfig(`/v1/data/getFilesStatus/${key}`);
    return await fetch(fullUrl, fullConfig);
  }

  public async createRecord(payload: PartialMessage<CreateRecordRequest>): Promise<CoSceneRecord> {
    const req = new CreateRecordRequest(payload);
    return await getPromiseClient(RecordService).createRecord(req);
  }

  public async getDiagnosisRule(): Promise<DiagnosisRule> {
    const projectId = this.#baseInfo.projectId;
    const warehouseId = this.#baseInfo.warehouseId;

    const name = `warehouses/${warehouseId}/projects/${projectId}/diagnosisRule`;

    const req = new GetDiagnosisRuleRequest({
      name,
    });

    return await getPromiseClient(DiagnosisService).getDiagnosisRule(req);
  }

  public async syncMedia({ key }: { key: string }): Promise<void> {
    await this.#patch("/v1/data/sync", { id: key });
  }
}

export type { Org, DeviceCodeResponse, Session, CoverageResponse };
export default CoSceneConsoleApi;
