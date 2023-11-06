// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// coScene custom tools
import { createPromiseClient, PromiseClient, Interceptor } from "@bufbuild/connect";
import { createGrpcWebTransport } from "@bufbuild/connect-web";
import { Timestamp } from "@bufbuild/protobuf";
import { ServiceType } from "@bufbuild/protobuf";
import { Value, JsonObject } from "@bufbuild/protobuf";
import {
  ACCESS_TOKEN_NAME,
  SUPER_TOKEN_ACCESS_TOKEN_NAME,
  uuidv4,
} from "@coscene-io/coscene/queries";
import { LayoutDetail } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";
import { Layout } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";
import { StatusCode } from "grpc-web";
import i18next from "i18next";

import {
  ConsoleApiLayout,
  LayoutID,
  ISO8601Timestamp,
  Permission,
} from "@foxglove/studio-base/services/CoSceneConsoleApi";

export function getPlaybackQualityLevelByLocalStorage(): "ORIGINAL" | "HIGH" | "MID" | "LOW" {
  const localPlaybackQualityLevel = localStorage.getItem("playbackQualityLevel");
  let playbackQualityLevel: "ORIGINAL" | "HIGH" | "MID" | "LOW" = "ORIGINAL";

  switch (localPlaybackQualityLevel) {
    case "ORIGINAL":
      playbackQualityLevel = "ORIGINAL";
      break;
    case "HIGH":
      playbackQualityLevel = "HIGH";
      break;
    case "MID":
      playbackQualityLevel = "MID";
      break;
    case "LOW":
      playbackQualityLevel = "LOW";
      break;
    default:
      playbackQualityLevel = "ORIGINAL";
  }

  return playbackQualityLevel;
}

// window.navigator.platform is not reliable, use this function to check os
export function getOS(): string | undefined {
  const userAgent = window.navigator.userAgent.toLowerCase(),
    macosPlatforms = /(macintosh|macintel|macppc|mac68k|macos)/i,
    windowsPlatforms = /(win32|win64|windows|wince)/i,
    iosPlatforms = /(iphone|ipad|ipod)/i;

  let os = undefined;

  if (macosPlatforms.test(userAgent)) {
    os = "macos";
  } else if (iosPlatforms.test(userAgent)) {
    os = "ios";
  } else if (windowsPlatforms.test(userAgent)) {
    os = "windows";
  } else if (userAgent.includes("android")) {
    os = "android";
  } else if (userAgent.includes("linux")) {
    os = "linux";
  }

  return os;
}

const setAuthorizationUnaryInterceptor: Interceptor = (next) => async (req) => {
  const jwt =
    localStorage.getItem(ACCESS_TOKEN_NAME) ?? localStorage.getItem(SUPER_TOKEN_ACCESS_TOKEN_NAME);
  if (jwt) {
    req.header.set("Authorization", jwt);
    req.header.set("x-cos-request-id", uuidv4());
  } else {
    console.error("no jwt");
  }

  try {
    return await next(req);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    // grpc error code-16 === http status code 401
    // https://grpc.github.io/grpc/core/md_doc_statuscodes.html
    if (error.code === StatusCode.UNAUTHENTICATED) {
      localStorage.removeItem("demoSite");
      localStorage.removeItem("joyrideInfoList");
      localStorage.removeItem("honeybeeDemoStatus");
      if (window.location.pathname !== "/login") {
        window.location.href = `/login?redirectToPath=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`;
      }
    }

    console.error(error);
    try {
      console.error(
        `Error Calling GRPC Service ${req.service.typeName} Code: ${error.code} Message: ${error.message}`,
      );
    } catch (err) {
      console.error(err);
    }
  }

  return await next(req);
};

const setLocaleInfoUnaryInterceptor: Interceptor = (next) => async (req) => {
  req.header.set("x-cos-utc-offset", String(new Date().getTimezoneOffset()));
  req.header.set("x-cos-language-code", i18next.language);

  return await next(req);
};

export function getPromiseClient<T extends ServiceType>(service: T): PromiseClient<T> {
  return createPromiseClient(
    service,
    createGrpcWebTransport({
      baseUrl: window.cosConfig.VITE_APP_BASE_API_URL ?? "",
      interceptors: [setAuthorizationUnaryInterceptor, setLocaleInfoUnaryInterceptor],
    }),
  );
}

export const coSceneLayoutToConsoleApiLayout = (layout: Layout): ConsoleApiLayout => {
  return {
    id: layout.name.split("layouts/").pop() as LayoutID,
    name: layout.value?.name ?? "",
    createdAt: layout.value?.createTime?.toDate().toISOString() as ISO8601Timestamp,
    updatedAt: layout.value?.updateTime?.toDate().toISOString() as ISO8601Timestamp,
    savedAt: layout.value?.saveTime?.toDate().toISOString() as ISO8601Timestamp,
    permission: layout.value?.permission as Permission,
    data: layout.value?.data?.toJson() as Record<string, unknown>,
  };
};

export const getCoSceneLayout = (layout: {
  id: LayoutID | undefined;
  savedAt: ISO8601Timestamp | undefined;
  name: string | undefined;
  permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
  data: Record<string, unknown> | undefined;
}): Layout => {
  const newLayout = new Layout();
  newLayout.name = "layouts/" + layout.id;
  const layoutDetail = new LayoutDetail();

  layoutDetail.name = layout.name ?? "";
  layoutDetail.permission = layout.permission ?? "";
  layoutDetail.createTime = Timestamp.fromDate(new Date());
  layoutDetail.updateTime = Timestamp.fromDate(new Date());
  layoutDetail.saveTime = Timestamp.fromDate(new Date(layout.savedAt ?? ""));
  layoutDetail.data = layout.data ? Value.fromJson(layout.data as JsonObject) : undefined;

  newLayout.value = layoutDetail;

  return newLayout;
};
