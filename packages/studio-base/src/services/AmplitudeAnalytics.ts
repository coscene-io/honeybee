// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Organization } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { posthog } from "posthog-js";

import Logger from "@foxglove/log";
import OsContextSingleton from "@foxglove/studio-base/OsContextSingleton";
import { User } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { DataSourceArgs } from "@foxglove/studio-base/context/PlayerSelectionContext";
import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { getAppConfig } from "@foxglove/studio-base/util/appConfig";

const log = Logger.getLogger("Analytics");

export class AmplitudeAnalytics implements IAnalytics {
  public constructor() {
    const platform = getPlatformName();
    const appVersion = OsContextSingleton?.getAppVersion();
    const { glVendor, glRenderer } = getWebGLInfo() ?? {
      glVendor: "(unknown)",
      glRenderer: "(unknown)",
    };

    log.info(
      `[APP_INIT] ${platform}${
        appVersion ? ` v${appVersion}` : ""
      }, GL Vendor: ${glVendor}, GL Renderer: ${glRenderer}`,
    );
    posthog.register({
      os: platform,
      gl_vendor: glVendor,
      gl_renderer: glRenderer,
    });
  }

  public async initPlayer(sourceId: string, args?: DataSourceArgs): Promise<void> {
    posthog.register({
      source_id: sourceId,
    });
    posthog.capture(AppEvent.PLAYER_INIT, { source_id: sourceId, args });
  }

  public setSpeed(speed: number): void {
    posthog.register({
      speed,
    });
  }

  public async logEvent(event: AppEvent, data?: { [key: string]: unknown }): Promise<void> {
    switch (event) {
      case AppEvent.PLAYER_RECORD_PLAYS_EVERY_FIVE_SECONDS_TOTAL:
        posthog.capture(event, data);
        break;
      case AppEvent.FILE_UPLOAD:
        posthog.capture(event, data);
        break;
      case AppEvent.PLAYER_INITIALIZING_TIME:
        posthog.capture(event, data);
        break;
      case AppEvent.PLAYER_SEEK_LATENCY:
        posthog.capture(event, data);
        break;
      case AppEvent.PLAYER_STALL_DURATION:
        posthog.capture(event, data);
        break;
      default:
        log.info(`[EVENT] ${event}`, data);
        break;
    }
  }

  public setUser(user: User, organization: Organization): void {
    const appConfig = getAppConfig();

    // log this user
    posthog.identify(user.userId, {
      nick_name: user.nickName,
      email: user.email,
      phone: user.phoneNumber,
      org_id: organization.name.split("/").pop(),
      org_display_name: organization.displayName,
      environment: appConfig.VITE_APP_PROJECT_ENV,
    });

    posthog.register({
      org_id: organization.name.split("/").pop(),
      org_display_name: organization.displayName,
    });
  }
}

function getPlatformName(): string {
  const platform = OsContextSingleton?.platform ?? "web";
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    default:
      return platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  }
}

function getWebGLInfo(): { glVendor: string; glRenderer: string } | undefined {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    canvas.remove();
    return undefined;
  }

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const res = debugInfo
    ? {
        glVendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        glRenderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
      }
    : undefined;

  canvas.remove();
  return res;
}
