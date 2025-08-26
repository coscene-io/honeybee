// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export interface ServiceConfig {
  displayName: string;  // 按钮显示的中文名称
  serviceName: string;  // ROS服务名称
}

export interface Config {
  services: ServiceConfig[];  // 改为数组支持动态增删
}