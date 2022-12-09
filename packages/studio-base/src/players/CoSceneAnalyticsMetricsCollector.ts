// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CoScenePlayerMetricsCollectorInterface } from "@foxglove/studio-base/players/types";
import CoSceneConsoleApi, { MetricType } from "@foxglove/studio-base/services/CoSceneConsoleApi";

export default class CoSceneAnalyticsMetricsCollector
  implements CoScenePlayerMetricsCollectorInterface
{
  private _timeStatistics: number = 0;
  private _playing: boolean = false;
  private _consoleApi: CoSceneConsoleApi | undefined;

  public constructor(consoleApi: CoSceneConsoleApi | undefined) {
    this._timeStatistics = 0;
    this._consoleApi = consoleApi;
    setInterval(async () => {
      if (this._playing) {
        this._timeStatistics += 0.1;
        if (~~(this._timeStatistics * 10) % 50 === 0) {
          if (this._consoleApi) {
            await this._consoleApi.sendIncCounter({
              name: MetricType.RecordPlaysEveryFiveSecondsTotal,
            });
          }
        }
      }
    }, 100);
  }

  public async playerConstructed(): Promise<void> {
    if (this._consoleApi) {
      await this._consoleApi.sendIncCounter({
        name: MetricType.RecordPlaysTotal,
      });
    }
  }

  public play(): void {
    this._playing = true;
  }

  public pause(): void {
    this._playing = false;
  }
}
