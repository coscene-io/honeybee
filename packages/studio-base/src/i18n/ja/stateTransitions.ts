// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const stateTransitions: Partial<TypeOptions["resources"]["stateTransitions"]> = {
  addSeries: "系列を追加",
  arrayError: "このパスは複数の値に解決されます",
  clickToAddSeries: "クリックして系列を追加",
  collapseAllSeries: "すべて折りたたむ",
  deleteSeries: "系列を削除",
  expandAllSeries: "すべて展開",
  general: "一般",
  insertSeries: "系列を挿入",
  label: "ラベル",
  max: "最大",
  maxXError: "Xの最大値はXの最小値より大きくなければなりません。",
  min: "最小",
  messagePath: "メッセージパス",
  series: "系列",
  seriesDefaultName: "系列 {{index}}",
  showPoints: "ポイントを表示",
  showPointsHelp: "各状態遷移メッセージにポイントを表示します",
  syncWithOtherPlots: "他のプロットと同期",
  secondsRange: "範囲（秒）",
  timestamp: "タイムスタンプ",
  timestampHeaderStamp: "ヘッダースタンプ",
  timestampReceiveTime: "受信時間",
  xAxis: "X軸",
};
