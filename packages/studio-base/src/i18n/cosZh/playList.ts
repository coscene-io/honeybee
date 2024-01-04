// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TypeOptions } from "i18next";

export const cosPlaylist: Partial<TypeOptions["resources"]["cosPlaylist"]> = {
  noPlayableBag: "当前列表无可播放的bag文件",
  noPlayableBagDesc: "请刷新重试，或前往记录详情页查看与操作",
  viewRecordDetails: "查看记录详情",
  searchByNameTime: "按照名字或者时间搜索",
  noLoadingBag: "加载bag文件错误",
  noBag: "没有bag文件",
  shadowMode: "影子模式",
  addFiles: "添加文件",
  selectedFilesCount: "已选择：{{count}}个文件",
  selecteFilesFromRecord: "从记录中选择文件",
  duplicateFile: "该文件与文件{{filename}}是同一文件",
  deleteConfirmTitle: "删除文件",
  deleteConfirmPrompt: "确定要删除文件{{filename}}吗？",
};
