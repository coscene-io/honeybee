// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// coScene custom tools
import { createPromiseClient, PromiseClient, Interceptor } from "@bufbuild/connect";
import { createGrpcWebTransport } from "@bufbuild/connect-web";
import { ServiceType, Timestamp, Value, JsonObject } from "@bufbuild/protobuf";
import { ACCESS_TOKEN_NAME, SUPER_TOKEN_ACCESS_TOKEN_NAME } from "@coscene-io/coscene/queries";
import {
  Layout,
  LayoutDetail,
} from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { StatusCode } from "grpc-web";
import i18next from "i18next";
import { v4 as uuidv4 } from "uuid";

import { LayoutID, ISO8601Timestamp } from "@foxglove/studio-base/services/CoSceneConsoleApi";

export * from "./cosel";

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

// protobuf => JsonObject is not support undefind type so we need to replace undefined with null
function replaceUndefinedWithNull(obj: Record<string, unknown>) {
  Object.keys(obj).forEach((key) => {
    if (obj[key] != undefined && typeof obj[key] === "object") {
      replaceUndefinedWithNull(obj[key] as Record<string, unknown>);
    } else if (obj[key] == undefined) {
      obj[key] = ReactNull;
    }
  });
  return obj;
}

export const getCoSceneLayout = (layout: {
  id: LayoutID | undefined;
  savedAt: ISO8601Timestamp | undefined;
  name: string | undefined;
  permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
  data: Record<string, unknown> | undefined;
  userId: string;
}): Layout => {
  const newLayout = new Layout();
  newLayout.name =
    layout.permission === "CREATOR_WRITE"
      ? `users/${layout.userId}/layouts/${layout.id}`
      : "layouts/" + layout.id;
  const layoutDetail = new LayoutDetail();

  layoutDetail.name = layout.name ?? "";
  layoutDetail.permission = layout.permission ?? "";
  layoutDetail.createTime = Timestamp.fromDate(new Date());
  layoutDetail.updateTime = Timestamp.fromDate(new Date());
  layoutDetail.saveTime = Timestamp.fromDate(new Date(layout.savedAt ?? ""));

  layoutDetail.data = Value.fromJson(replaceUndefinedWithNull(layout.data ?? {}) as JsonObject);

  newLayout.value = layoutDetail;

  return newLayout;
};

// 将任意字符串映射为一颜色
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = "#";
  for (let i = 0; i < 3; i++) {
    let value = (hash >> (i * 8)) & 0xff;
    value = Math.floor(value * 0.3 + 0.5 * 0xff); // adjust value to get a brightness between 30% and 50%
    color += ("00" + value.toString(16)).substr(-2);
  }
  return color;
}

const SupportedFileExtension = [
  "bag",
  "active",
  "txt",
  "log",
  "png",
  "pgm",
  "ppm",
  "pbm",
  "record",
  "mcap",
  "yaml",
  "yml",
];

export const checkBagFileSupported = (file: File): boolean => {
  // if file.filename.split(".").pop() === file.filename
  // this file does not have an extension, so it is treated as a text file.
  return (
    file.filename.split(".").pop() === file.filename ||
    SupportedFileExtension.includes(file.filename.split(".").pop() ?? "")
  );
};
