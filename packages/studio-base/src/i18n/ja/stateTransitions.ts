// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const stateTransitions: Partial<TypeOptions["resources"]["stateTransitions"]> = {
  addSeries: "シリーズを追加する",
  arrayError: "このパスは複数の値に解決されます",
  clickToAddSeries: "シリーズを追加するにはクリック",
  collapseAllSeries: "すべて折りたたむ",
  deleteSeries: "シリーズを削除する",
  expandAllSeries: "すべて展開する",
  general: "一般的な",
  insertSeries: "下に挿入",
  label: "ラベル",
  max: "最大",
  maxXError: "Xの最大値はXの最小値より大きくなければなりません。",
  min: "最小",
  messagePath: "メッセージパス",
  series: "シリーズ",
  seriesDefaultName: "シリーズ {{index}}",
  showPoints: "ポイントを表示",
  showPointsHelp: "各状態遷移メッセージにポイントを表示します",
  syncWithOtherPlots: "他のプロットと同期する",
  secondsRange: "範囲（秒数）",
  timestamp: "タイムスタンプ",
  timestampHeaderStamp: "ヘッダースタンプ",
  timestampReceiveTime: "受信時間",
  xAxis: "X軸",
};
