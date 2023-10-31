// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// coScene custom tools
import { createPromiseClient, PromiseClient } from "@bufbuild/connect";
import { Interceptor } from "@bufbuild/connect";
import { createGrpcWebTransport } from "@bufbuild/connect-web";
import { ServiceType } from "@bufbuild/protobuf";
import {
  ACCESS_TOKEN_NAME,
  SUPER_TOKEN_ACCESS_TOKEN_NAME,
  uuidv4,
} from "@coscene-io/coscene/queries";
import { StatusCode } from "grpc-web";
import i18next from "i18next";

import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

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
    // eslint-disable-next-line @typescript-eslint/return-await
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

  // eslint-disable-next-line @typescript-eslint/return-await
  return await next(req);
};

const setLocaleInfoUnaryInterceptor: Interceptor = (next) => async (req) => {
  req.header.set("x-cos-utc-offset", String(new Date().getTimezoneOffset()));
  req.header.set("x-cos-language-code", i18next.language);
  // eslint-disable-next-line @typescript-eslint/return-await
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
