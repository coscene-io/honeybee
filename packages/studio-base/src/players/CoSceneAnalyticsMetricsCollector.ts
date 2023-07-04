// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CoScenePlayerMetricsCollectorInterface } from "@foxglove/studio-base/players/types";
import CoSceneConsoleApi, { MetricType } from "@foxglove/studio-base/services/CoSceneConsoleApi";

export default class CoSceneAnalyticsMetricsCollector
  implements CoScenePlayerMetricsCollectorInterface
{
  #timeStatistics: number = 0;
  #playing: boolean = false;
  #consoleApi: CoSceneConsoleApi | undefined;

  public constructor(consoleApi: CoSceneConsoleApi | undefined) {
    this.#timeStatistics = 0;
    this.#consoleApi = consoleApi;
    setInterval(async () => {
      if (this.#playing) {
        this.#timeStatistics += 0.1;
        if (~~(this.#timeStatistics * 10) % 50 === 0) {
          if (this.#consoleApi) {
            await this.#consoleApi.sendIncCounter({
              name: MetricType.RecordPlaysEveryFiveSecondsTotal,
            });
          }
        }
      }
    }, 100);
  }

  public async playerConstructed(): Promise<void> {
    if (this.#consoleApi) {
      await this.#consoleApi.sendIncCounter({
        name: MetricType.RecordPlaysTotal,
      });
    }
  }

  public play(): void {
    this.#playing = true;
  }

  public pause(): void {
    this.#playing = false;
  }
}
