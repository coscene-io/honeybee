// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useFavicon } from "react-use";

import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

export function useCoSceneInit(): void {
  let favicon = "";

  if (APP_CONFIG.LOGO_CONFIG[window.location.hostname]?.logo === "supor") {
    favicon = "/viz/supor.ico";
  } else {
    switch (APP_CONFIG.VITE_APP_PROJECT_ENV) {
      case "local":
        favicon = "/logo-light.svg";
        break;
      case "keenon":
        favicon = "/viz/keenon_favicon.svg";
        break;
      default:
        favicon = "/viz/logo-light.svg";
    }
  }

  useFavicon(favicon);
}
