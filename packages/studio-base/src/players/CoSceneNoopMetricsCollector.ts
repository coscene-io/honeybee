// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CoScenePlayerMetricsCollectorInterface } from "@foxglove/studio-base/players/types";

export default class CoSceneNoopMetricsCollector implements CoScenePlayerMetricsCollectorInterface {
  public playerConstructed(): void {
    // no-op
  }
  public play(): void {
    // no-op
  }
  public pause(): void {
    // no-op
  }
}
