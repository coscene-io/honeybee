// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// @ts-ignore
import BrowserLogger from "alife-logger";

import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const pid = "g39a9o8s2b@15d243d7126f1d1";

const logger = (() => {
  if (APP_CONFIG.VITE_APP_PROJECT_ENV && APP_CONFIG.VITE_APP_PROJECT_ENV !== "local") {
    return {};
  }

  let environment = "";
  switch (APP_CONFIG.VITE_APP_PROJECT_ENV) {
    case "keenon":
      environment = "prod";
      break;

    case "gaussian":
      environment = "gray";
      break;

    case "staging":
      environment = "pre";
      break;

    case "dev":
      environment = "daily";
      break;

    case "local":
      environment = "local";
      break;
  }

  try {
    const __bl = BrowserLogger.singleton({
      pid,
      appType: "web",
      imgUrl: "https://arms-retcode.aliyuncs.com/r.png?",
      sendResource: true,
      enableLinkTrace: true,
      behavior: true,
      environment,
      release: APP_CONFIG.IMAGE_TAG,
      c1: APP_CONFIG.VITE_APP_PROJECT_ENV,
      setUsername: () => {
        const str = localStorage.getItem("current_user");
        if (str) {
          try {
            const user = JSON.parse(str);
            return user?.userId;
          } catch (error) {
            console.log(error);
          }
        }
      },
    });
    return { __bl };
  } catch (e) {
    console.error("init ali browser logger fail", e);
  }

  return {};
})();

export default logger;
