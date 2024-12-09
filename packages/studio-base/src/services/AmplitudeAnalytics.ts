// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@foxglove/log";
import OsContextSingleton from "@foxglove/studio-base/OsContextSingleton";
import { User } from "@foxglove/studio-base/context/CurrentUserContext";
import CoSceneConsoleApi, { MetricType } from "@foxglove/studio-base/services/CoSceneConsoleApi";
import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const log = Logger.getLogger("Analytics");

export class AmplitudeAnalytics implements IAnalytics {
  #consoleApi: CoSceneConsoleApi | undefined;
  #user: User | undefined;

  // need console api
  public constructor({ consoleApi }: { consoleApi: CoSceneConsoleApi }) {
    this.#consoleApi = consoleApi;
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
  }

  public async logEvent(event: AppEvent, data?: { [key: string]: unknown }): Promise<void> {
    switch (event) {
      case AppEvent.PLAYER_RECORD_PLAYS_EVERY_FIVE_SECONDS_TOTAL:
        await this.#consoleApi?.sendIncCounter({
          name: MetricType.RecordPlaysEveryFiveSecondsTotal,
        });
        break;
      default:
        log.info(`[EVENT] ${event}`, data);
        break;
    }
  }

  public setUser(user: User): void {
    // log this user
    log.info(`[USER] ${user.id}`, user);
    this.#user = user;
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
