// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { ILayoutManager } from "@foxglove/studio-base/services/CoSceneILayoutManager";

export default class MockCoSceneLayoutManager implements ILayoutManager {
  public projectName: string | undefined;
  public userName: string | undefined;
  public supportsSharing = false;
  public isBusy = false;
  public isOnline = false;
  public error: Error | undefined = undefined;

  public on = jest.fn();
  public off = jest.fn();
  public setError = jest.fn();
  public setOnline = jest.fn();
  public getLayouts = jest.fn().mockResolvedValue([]);
  public getLayout = jest.fn();
  public saveNewLayout = jest.fn();
  public updateLayout = jest.fn();
  public deleteLayout = jest.fn();
  public overwriteLayout = jest.fn();
  public revertLayout = jest.fn();
  public makePersonalCopy = jest.fn();
  public syncWithRemote = jest.fn();
  public putHistory = jest.fn();
  public getHistory = jest.fn();
}
