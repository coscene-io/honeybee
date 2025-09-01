// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// coScene custom tools
import { createPromiseClient, PromiseClient, Interceptor } from "@bufbuild/connect";
import { createGrpcWebTransport } from "@bufbuild/connect-web";
import { ServiceType, Timestamp, JsonObject, Struct } from "@bufbuild/protobuf";
import { Layout } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/layout_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { StatusCode } from "grpc-web";
import i18next from "i18next";
import { v4 as uuidv4 } from "uuid";

import { LayoutID, ISO8601Timestamp } from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";
import { ACCESS_TOKEN_NAME } from "@foxglove/studio-base/util/queries";
import { Auth } from "@foxglove/studio-desktop/src/common/types";

export * from "./cosel";

const authBridge = (global as { authBridge?: Auth }).authBridge;

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
  const jwt = localStorage.getItem(ACCESS_TOKEN_NAME);
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
      if (window.location.pathname !== "/login") {
        if (isDesktopApp()) {
          authBridge?.logout();
        } else {
          window.location.href = `/login?redirectToPath=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`;
        }
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
      baseUrl: window.cosConfig.VITE_APP_BASE_API_URL ?? "https://api.coscene.cn",
      interceptors: [setAuthorizationUnaryInterceptor, setLocaleInfoUnaryInterceptor],
    }),
  );
}

// protobuf => JsonObject is not support undefind type so we need to replace undefined with null
export function replaceUndefinedWithNull(obj: Record<string, unknown>): Record<string, unknown> {
  Object.keys(obj).forEach((key) => {
    if (obj[key] != undefined && typeof obj[key] === "object") {
      replaceUndefinedWithNull(obj[key] as Record<string, unknown>);
    } else if (obj[key] == undefined) {
      obj[key] = ReactNull;
    }
  });
  return obj;
}

// export const getCoSceneLayout = (layout: {
//   id: LayoutID | undefined;
//   modifyTime: Timestamp | undefined;
//   displayName: string | undefined;
//   permission: "CREATOR_WRITE" | "ORG_READ" | "ORG_WRITE" | undefined;
//   data: Record<string, unknown> | undefined;
//   userId: string;
// }): Layout => {
//   // todo
//   return new Layout(
//     {
//       name: layout.permission === "CREATOR_WRITE"
//         ? `users/${layout.userId}/layouts/${layout.id}`
//         : `${layout.p}/layouts/${layout.id}`,
//       displayName: layout.displayName ?? "",
//       createTime: Timestamp.fromDate(new Date()),
//       updateTime: Timestamp.fromDate(new Date()),
//       // todo:  replaceUndefinedWithNull 是否必须
//       data: layout.data ? Struct.fromJson(replaceUndefinedWithNull(layout.data) as JsonObject) : undefined,
//       modifyTime: Timestamp.fromDate(new Date()),
//       creator: layout.userId,
//       modifier: layout.userId,
//     }
//   );
// };

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
    color += ("00" + value.toString(16)).slice(-2);
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
