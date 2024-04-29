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
  deleteConfirmTitle: "从播放列表移除文件",
  deleteConfirmPrompt: "移除文件 {{filename}} 后，将在当前窗口不可播放，可再次添加至播放列表",
  addFilesFailed: "添加文件失败",
  remove: "移除",
  generateMediaSuccess: "media 生成完成，刷新页面即可播放",
  generateMediaFailed: "meida 生成失败，请检查文件",
  generateMediaProcessing: "meida 生成中，稍后即可播放",
  projectFrom: "来自{{projectName}}",
};
