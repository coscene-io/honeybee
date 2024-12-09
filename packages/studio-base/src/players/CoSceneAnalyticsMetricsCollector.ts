// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";
import {
  PlayerMetricsCollectorInterface,
  SubscribePayload,
} from "@foxglove/studio-base/players/types";
import CoSceneConsoleApi, { MetricType } from "@foxglove/studio-base/services/CoSceneConsoleApi";
import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

export default class CoSceneAnalyticsMetricsCollector implements PlayerMetricsCollectorInterface {
  #timeStatistics: number = 0;
  #playing: boolean = false;
  #consoleApi: CoSceneConsoleApi | undefined;
  #analytics: IAnalytics;
  #sourceId: string | undefined;

  public constructor({ analytics }: { analytics: IAnalytics }) {
    this.#timeStatistics = 0;
    this.#analytics = analytics;

    setInterval(async () => {
      if (this.#playing) {
        this.#timeStatistics += 0.1;
        if (~~(this.#timeStatistics * 10) % 50 === 0) {
          await this.#analytics.logEvent(AppEvent.PLAYER_RECORD_PLAYS_EVERY_FIVE_SECONDS_TOTAL);
        }
      }
    }, 100);
  }

  // sets sourceId in every time  opening a file or connecting to server
  public async setProperty(key: string, value: string | number | boolean): Promise<void> {
    console.debug(`coScene setProperty: ${key}=${value}`);
    if (key === "player") {
      this.#sourceId = value as string;
      await this.#analytics.logEvent(AppEvent.PLAYER_INIT, { sourceId: this.#sourceId });
    }
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
