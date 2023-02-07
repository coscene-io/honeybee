// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export default {
  setting: "设置",
  level: "级别",
  frame: "帧",
  displayFrame: "展示帧",
  followMode: "跟踪模式",

  scene: "场景",

  renderStats: "渲染数据",
  background: "背景",
  labelScale: "标签范围",
  ignoreTag: '忽视 COLLADA <up_axis>"',
  syncCamera: "同步相机",
  meshUpAxis: "向上轴",

  view: "视图",

  editable: "可编辑",
  labels: "标签",
  labelSize: "标签大小",
  axisScale: "坐标轴范围",
  lineWidth: "线宽",
  lineColor: "线颜色",

  transforms: "转化",

  topics: "主题",
  showAll: "展示全部",
  hideAll: "隐藏全部",

  customLayers: "自定义图层",
  addGrid: "添加网格",
  addFormat: "统一机器人描述格式",

  publish: "发布",
  type: "类型",
  topic: "主题",

  addPanel: "添加面板",
  impExpSetting: "导入/导出设置...",
  reset: "重新设置到默认值",

  dataSourceInfo: "数据源信息",
  changePanel: "更改面板",
  splitHorizontal: "水平拆分 ",
  splitVertical: "垂直拆分",
  fullScreen: "全屏",
  removePanel: "删除面板",

  diagnosticsDetail: "诊断 – 详情 (ROS)",
  diagnosticsSummary: "诊断 – 总结 (ROS)",

  general: "通用",
  numericPrecision: "数值精度",
  sortByLevel: "按级别排序",

  gauge: "仪表",
  data: "数据",
  minimum: "最小",
  maxiMum: "最大",
  colorMode: "颜色模式",
  colorMap: "颜色图谱",
  reverse: "转置",

  image: "图片",
  cameraTopic: "相机主题",
  transformMarkers: "转化标记",
  synchronizeTimestamps: "同步时间戳",
  bilinearSmoothing: "双线性平滑",
  flipHorizontal: "水平翻转",
  flipVertical: "垂直翻转",
  rotation: "旋转",
  minimumValue: "最小值 (深度图像)",
  maximumValue: "最大值 (深度图像)",
  markers: "标记",

  indicator: "指标",
  indicatorPanelSettings: "指标面板设置",
  style: "风格",
  rules: "以第一个匹配的规则为准",
  comparison: "对比",
  comparisonWith: "比较",
  color: "颜色",
  label: "标签",

  otherwise: "否则",

  legacyPlot: "遗留图",
  legacyPlotPanelSettings: "传统图表面板设置",

  log: "日志",
  logPanelSettings: "日志面板设置",

  map: "地图",
  mapPanelSettings: "地图面板设置 ",
  tileLayer: "瓦层 ",
  followTopic: "关注主题",

  parameters: "参数",
  parametersPanelSettings: "参数面板设置",

  plot: "图",
  plotPanelSettings: "图面板设置",
  title: "标题",
  syncWithOtherPlots: "同步其他图",
  showLabels: "展示标签",
  rangeSecond: "范围 (秒)",
  series: "序列",
  path: "路径",
  timeStamp: "时间戳",

  publishPanelSettings: "发布面板设置",
  editingMode: "编辑模式",
  buttonTitle: "按钮标题",
  buttonTooltip: "按钮工具提示",
  buttonColor: "按钮颜色",

  rawMessage: "原始信息",
  rawMessagePanelSettings: "原始信息面板设置",

  stateTransition: "状态转移",
  stateTransitionPanelSettings: "状态转移面板设置",

  studioPlaybackPerformance: "Studio - 回放性能",
  studioPlaybackPerformancePanelSettings: "回放性能面板设置",

  tab: "标签",
  tabPanelSettings: "标签面板设置",

  table: "表",
  tablePanelSettings: "表面板设置",

  teleop: "远程操作",
  teleopPanelSettings: "远程操作面板设置",

  publishRate: "发布频率",
  upButton: "上按钮",
  downButton: "下按钮",
  leftButton: "左按钮",
  rightButton: "右按钮",
  field: "领域",
  value: "值",

  topicGraph: "主题图",
  topicGraphPanelSettings: "主题图面板设置",

  urdfViewer: "URDF 查看器",
  urdfViewerPanelSettings: "URDF 查看器面板设置",

  asset: "资源",
  opacity: "透明度",
  manualControl: "手动控制",

  userScript: "用户脚本",
  userScriptPanelSettings: "用户脚本面板设置",
  autoSave: "自动保存格式化",

  variableSlider: "可变滑块",
  variableSliderPanelSettings: "可变滑块面板设置",
  variableName: "变量名",

  selectPanelLayout: "选择以下面板加入你的布局.",
  learnMore: "查看更多",

  threeDDescription: "在 3D 场景中显示标记、相机图像、网格、URDF 等。",
  diagnosticsDetailDescription: "显示特定 hardware_id 的 ROS DiagnosticArray 消息。",
  diagnosticsSummaryDescription: "显示所有 ROS DiagnosticArray 消息的摘要。",
  imageDescription: "显示带注释的图像。",
  gaugeDescription: "显示基于连续值的彩色仪表。",
  indicatorDescription: "根据阈值显示彩色和/或文本指示器。",
  teleopDescription: "通过实时连接远程操作机器人。",
  mapDescription: "在地图上显示点。",
  parametersDescription: "读取和设置数据源的参数。",
  plotDescription: "随时间或其他值绘制数值。",
  publishDescription: "将消息发布到数据源（仅限实时连接）。",
  rawMessageDescription: "检查主题消息。",
  logDescription: "按节点和严重级别显示日志。",
  stateDescription: "当值随时间变化时跟踪",
  tableDescription: "以表格格式显示主题消息。",
  urdfDescription: "可视化统一机器人描述格式文件。",
  topicGraphDescription: "显示活动节点、主题和服务的图表。",
  dataSourceDescription: "查看当前数据源的主题和时间戳等详细信息。",
  variableDescription: "更新布局的数值变量值。",
  userScriptDescription: "在 TypeScript 中编写自定义数据转换。 以前称为节点社区。",
  tabDescription: "将相关面板分组到选项卡中。",
  studioDescription: "显示播放和数据流性能统计数据。",
};
