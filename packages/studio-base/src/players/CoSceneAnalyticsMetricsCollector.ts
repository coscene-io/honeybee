// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";
import {
  PlayerMetricsCollectorInterface,
  SubscribePayload,
} from "@foxglove/studio-base/players/types";
import CoSceneConsoleApi, { MetricType } from "@foxglove/studio-base/services/CoSceneConsoleApi";

export default class CoSceneAnalyticsMetricsCollector implements PlayerMetricsCollectorInterface {
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
  public setProperty(key: string, value: string | number | boolean): void {
    console.debug(`coScene setProperty: ${key}=${value}`);
  }
  public seek(time: Time): void {
    console.debug(`coScene seek: ${time.sec}.${time.nsec}`);
  }
  public setSpeed(speed: number): void {
    console.debug(`coScene setSpeed: ${speed}`);
  }
  public close(): void {
    console.debug(`coScene close`);
  }
  public setSubscriptions(subscriptions: SubscribePayload[]): void {
    console.debug(`coScene setSubscriptions: ${JSON.stringify(subscriptions)}`);
  }
  public recordBytesReceived(bytes: number): void {
    console.debug(`coScene recordBytesReceived: ${bytes}`);
  }
  public recordPlaybackTime(time: Time, params: { stillLoadingData: boolean }): void {
    console.debug(
      `coScene recordPlaybackTime: ${time.sec}.${time.nsec}, ${params.stillLoadingData}`,
    );
  }
  public recordUncachedRangeRequest(): void {
    console.debug(`coScene recordUncachedRangeRequest`);
  }
  public recordTimeToFirstMsgs(): void {
    console.debug(`coScene recordTimeToFirstMsgs`);
  }

  public async playerConstructed(): Promise<void> {
    if (this.#consoleApi) {
      await this.#consoleApi.sendIncCounter({
        name: MetricType.RecordPlaysTotal,
      });
    }
  }

  public play(speed?: number): void {
    console.debug(`coScene play: ${speed}`);
    this.#playing = true;
  }

  public pause(): void {
    this.#playing = false;
  }
}
