// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Log from "@foxglove/log";
import { Time } from "@foxglove/rostime";
import { DataSourceArgs } from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  PlayerMetricsCollectorInterface,
  SubscribePayload,
} from "@foxglove/studio-base/players/types";
import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const log = Log.getLogger(__filename);

type EventData = { [key: string]: string | number | boolean };

export default class AnalyticsMetricsCollector implements PlayerMetricsCollectorInterface {
  #timeStatistics: number = 0;
  #playing: boolean = false;
  #analytics: IAnalytics;
  #sourceId: string | undefined;
  #metadata: EventData = {};

  public constructor({ analytics }: { analytics: IAnalytics }) {
    log.debug("New AnalyticsMetricsCollector");
    this.#timeStatistics = 0;
    this.#analytics = analytics;

    setInterval(async () => {
      if (this.#playing) {
        this.#timeStatistics += 0.1;
        if (~~(this.#timeStatistics * 10) % 50 === 0) {
          void this.#syncEventToAnalytics({
            event: AppEvent.PLAYER_RECORD_PLAYS_EVERY_FIVE_SECONDS_TOTAL,
          });
        }
      }
    }, 100);
  }

  async #syncEventToAnalytics({
    event,
    data,
  }: {
    event: AppEvent;
    data?: { [key: string]: unknown };
  }): Promise<void> {
    await this.#analytics.logEvent(event, data);
  }

  // sets sourceId in every time  opening a file or connecting to server
  public setProperty(key: string, value: string | number | boolean, args?: DataSourceArgs): void {
    this.#metadata[key] = value;
    console.debug(`coScene setProperty: ${key}=${value}`);
    if (key === "player") {
      this.#sourceId = value as string;
      this.#analytics.initPlayer(this.#sourceId, args);
    }
  }

  public seek(time: Time): void {
    console.debug(`coScene seek: ${time.sec}.${time.nsec}`);
  }
  public setSpeed(speed: number): void {
    this.#analytics.setSpeed(speed);
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

  public async playerConstructed(): Promise<void> {}

  public play(speed?: number): void {
    console.debug(`coScene play: ${speed}`);
    this.#playing = true;
  }

  public pause(): void {
    this.#playing = false;
  }
}
