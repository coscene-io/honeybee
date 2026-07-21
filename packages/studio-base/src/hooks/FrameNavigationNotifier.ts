// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export class FrameNavigationNotifier {
  #activeNavigation: { readonly id: string; readonly onSuperseded?: () => void } | undefined =
    undefined;

  public startNavigation(navigationId: string, onSuperseded?: () => void): void {
    const previousNavigation = this.#activeNavigation;
    this.#activeNavigation = { id: navigationId, onSuperseded };
    previousNavigation?.onSuperseded?.();
  }

  public endNavigation(navigationId: string): void {
    const navigation = this.#activeNavigation;
    if (navigation?.id === navigationId) {
      setTimeout(() => {
        if (this.#activeNavigation === navigation) {
          this.#activeNavigation = undefined;
        }
      }, 0);
    }
  }

  public isOtherNavigationActive(navigationId: string): boolean {
    return this.#activeNavigation != undefined && this.#activeNavigation.id !== navigationId;
  }

  public isNavigationActive(navigationId: string): boolean {
    return this.#activeNavigation?.id === navigationId;
  }
}

export const frameNavigationNotifier = new FrameNavigationNotifier();
