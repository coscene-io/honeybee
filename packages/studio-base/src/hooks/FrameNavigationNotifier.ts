// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export class FrameNavigationNotifier {
  #activeNavigationId: string | undefined = undefined;

  public startNavigation(navigationId: string): void {
    this.#activeNavigationId = navigationId;
  }

  public endNavigation(navigationId: string): void {
    if (this.#activeNavigationId === navigationId) {
      setTimeout(() => {
        if (this.#activeNavigationId === navigationId) {
          this.#activeNavigationId = undefined;
        }
      }, 0);
    }
  }

  public isOtherNavigationActive(navigationId: string): boolean {
    return this.#activeNavigationId != undefined && this.#activeNavigationId !== navigationId;
  }
}

export const frameNavigationNotifier = new FrameNavigationNotifier();
