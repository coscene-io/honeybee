// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Log from "@foxglove/log";
import { Time } from "@foxglove/rostime";
import {
  CoScenePlayerMetricsCollectorInterface,
  SubscribePayload,
} from "@foxglove/studio-base/players/types";
import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const log = Log.getLogger(__filename);

export default class CoSceneAnalyticsMetricsCollector
  implements CoScenePlayerMetricsCollectorInterface
{
  private _timeStatistics: number = 0;
  private _playing: boolean = false;

  public constructor() {
    log.debug("New CoSceneAnalyticsMetricsCollector");
    this._timeStatistics = 0;
    setTimeout(() => {
      console.log(this._playing);
    }, 1000);
  }

  public playerConstructed(): void {
    console.log("playerConstructed");
  }

  public play(): void {
    console.log("is playing");
    this._playing = true;
  }

  public pause(): void {
    console.log("no playing");
    this._playing = false;
  }
}
