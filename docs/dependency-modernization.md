# 依赖现代化与暂缓项（2026-11-11）

基于 React 19 已合入的 main `095e7abeeb49ad0bbcd46c013586be970b5baba8`。
按本轮授权执行建议升级、替换与清理；Mosaic 7 根据明确选择暂缓，持久化布局继续使用 patched 6.2 格式。
完整原有直接依赖逐项对照见 [JSON 清单](dependency-modernization-inventory.json)，安装结果以 `yarn.lock` 为准。新增的 peer provider 和原先漏声明的直接 import 也已补齐。

## 主要升级和替换

- Node 26.13.0（本地、CI `.node-version`、Docker、engines 一致），Node 类型 26.6.6；Yarn 4.18.1，移除已内置的旧 Yarn 插件。
- Electron 45.3.0、electron-builder 26.18.0 及配套构建包。Actions v3/v4、plist v5 为 ESM，CommonJS 的 ts-node 打包钩子通过原生动态 import 加载。
- Material UI / Icons 9.5.0、Data Grid / Date Pickers 9.17.0：迁移 slot API、主题覆盖、移除的布局属性；静态布局合并到已有 tss 样式，动态值用 style，保留禁止 JSX sx 的规则。移植 ripple 资源释放补丁。
- TanStack Table 9.3.1：显式注册排序、展开、分页、列可见性；保留手动分页语义，并允许自行渲染嵌套表格的行展开。
- resizable-panels 4.21.0：显式百分比尺寸、Group/Separator、panelRef；i18next 27.1.1 / react-i18next 18.0.1：保留原空字符串和语言码行为并删除旧补丁。
- moize → micro-memoize 5.2.2：保留深比较和 owner 生命周期内引用复用。该库不接受 Infinity（会退回容量 1），改为 MAX_SAFE_INTEGER 并回归 A→B→A 引用稳定性。
- react-monaco-editor → @monaco-editor/react 4.7.0：显式绑定本地 Monaco，禁止默认 CDN 加载；同步异步挂载期间变化的脚本和光标选择，保留全局模型供跨文件导航使用。
- react-virtualized / 类型 → 独立 AutoSizer 2.0.4；保留隐藏面板、零尺寸时不渲染列表的行为。
- depcheck → Knip 6.45.1：保留显式使用注释、三斜线类型引用和 workspace 边界，检查全部源文件/测试，未全局忽略缺失依赖。
- 删除未使用的 @mui/lab、过时 stub 类型、Sentry types 包和多余声明/补丁；@foxglove/ws-protocol 明确使用 workspace 实现。
- 其他升级包括 mathjs 15、FlatBuffers 25、meshoptimizer 1.3、GrowthBook 2、内部生成 API/Buf/Connect、Ramda/Immer、Chart.js 4.6.1、Mediabunny、PostHog、Markdown、搜索、日期、网络与构建工具。全部原有依赖的具体版本见清单。

## 安全修复与约束

- Protobuf.js 7.6.6 重新移植 BigInt reader/converter 补丁，保留上游属性名防护；测试精确 64 位边界、默认值、十进制 map key 和 `__proto__`。上游 writer 仍接受 string/Long，未声称新增 bigint 编码能力。
- 刷新传递依赖并 dedupe；对必须超出上游约束的项目使用窄范围 resolution：Monaco 的 DOMPurify 3.4.17、Mosaic 的 UUID 11.1.1、glob 10/13 的引入范围升级到 14.0.4、minimatch 9/10 的引入范围升级到 11.0.5，以及 xmlbuilder2 的 js-yaml 3.15.2。没有全局覆盖旧 minimatch 3/5 的不同函数接口。
- minimatch 11.0.7 尚未满足 Yarn 新包冷却期；选择已修复公告、满足冷却期的 11.0.5，没有关闭该机制。
- PostHog 显式保留 legacy defaults、页面采集/存储行为，不启用新默认快照；关闭新 conversation/product tour 与网络 body/JSON-LD 录制选项，保留现有 before_send 隐私过滤。没有开启新采集用途。
- 同一 npm bulk advisory + 锁定版本 semver 匹配方法：基线 65 个包命中公告；本轮结束仍有 **deepmerge 4.3.1、elliptic 6.6.1 两个包命中低危公告**。这是版本命中，不是已证实的可利用漏洞数；扫描器也不能验证自有 patch 的有效性。

| 残留项                                                                  | 引入与处理原因                                                                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [deepmerge 原型污染](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | 由构建时的 SVGR/SVGO 合并配置引入，当前上游最新版仍为 4.3.1；无已发布修复版本。未用跨包强制替换伪装修复。配置和 SVG 来自项目源码。                                          |
| [elliptic 风险实现](https://github.com/advisories/GHSA-848j-6mx2-7j84)  | 由 crypto-browserify 的签名/密钥兼容链引入，最新版 6.6.1 仍在公告范围；需要替换整条浏览器加密兼容链并验证协议。未证明应用会调用公告涉及的操作，不把潜在可达等同于已可利用。 |

## 暂缓最新版

| 依赖                 | 本轮选择                         | 暂缓原因                                                                                                                  |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Mosaic               | patched 6.2.0                    | 用户明确暂缓 7；新版改变持久化布局结构和旧客户端兼容。仅更新其 UUID 安全依赖。                                            |
| Three / 类型         | patched 0.166.1 / 0.166.0        | shader cache 补丁、深层 examples 导入、GPU 画面与资源生命周期需分阶段迁移。                                               |
| react-window / 类型  | 1.8.11 / 1.8.8                   | 2 需要重写列表 API；变高、seek 定位、自动滚动及大列表性能需独立验收。                                                     |
| react-json-tree      | patched 0.15.1                   | 上游无现有展开/折叠事件契约，RawMessages 持久化展开状态会丢失。                                                           |
| Monaco / 用户脚本 TS | 0.55.1 / 5.9.3                   | wrapper 已替换；核心升级仍需与嵌入语言服务、用户脚本编译器保持一致。                                                      |
| TypeScript alias     | JS TS6 6.0.2 + 独立 native 7.0.2 | ESLint、ts-node、导出扫描器依赖 JS compiler API；native 7 不能直接替代。                                                  |
| ESLint               | 9.39.5                           | 9 已 EOL；10 仍与 import/react 插件 peer 冲突。本轮先升 9 补丁，不绕过 peer 强推 10，后续须安排规则迁移。                 |
| Sentry browser/core  | 8.55.2                           | 11 涉及自托管服务端版本及隐私/行为验收；移除 types 重复 core，构建插件独立升 11.12.0。                                    |
| Chart zoom fork      | 2.1.0                            | 业务调用 fork 的私有 `$zoom` handler，上游插件不能直接替换。Chart.js 同主线已升级，peer 警告如实保留。                    |
| @foxglove/xmlrpc     | 1.3.0                            | 实际发现 1.4 → xmlbuilder2 4 → @oozcitak/url 3 依赖 Node `url`，导致 Web 构建失败；暂缓此传递升级，单独修复其 YAML 依赖。 |

## 验证与限制

- 本地不可变安装、CI 类型检查、React 19 严格类型入口、TS6 工具链检查通过。
- 全量单元测试通过 3,848 项（1 项原有 skip）、38 个快照，含 Cosel 24 保存过滤器兼容和真实 Chart.js / zoom fork 的 wheel/pan 桥接测试。串行 detectOpenHandles 也通过；多 worker 模式仍有非阻断的退出警告。
- Web、Desktop（main/preload/renderer/Quicklook）、benchmark 生产构建通过；保留现有大包和 asn1.js 可选 vm 警告。
- 真实 Chromium Web（`/viz/` 与 `/`）扩展安装、保存/重载、移除/重加生命周期通过；真实 Electron 扩展和内置面板 smoke 通过。
- Electron 资源回归：2 次预热 + 12 次测量开关。四个样本的扩展/宿主面板弱引用均收集；最后相对预热堆 -11,940 bytes、DOM -14、监听器 -3（只是此场景观察，非通用泄漏/性能承诺）。发现并修复新 V8 对最后一个 setter 闭包的保留：使用共享 setter + WeakMap，避免 allocation feedback 引用面板会话。GC 等待覆盖全部被断言的节点，没有放宽零保留断言。
- 本地 macOS ARM64 directory 打包通过，验证新版 Actions/plist ESM 钩子、Quick Look 资源及 ad-hoc 沙盒签名、Spotlight 校验/提取。不涉及生产签名、发布或 notarization；Windows/Linux/universal 打包仍由对应环境验证。
- Prettier 新版要求额外 48 个原有文件格式调整，仅自动格式变化；没有关闭 lint/类型规则。
- Knip 依赖检查通过，仍提示一些冗余显式标记和旧 package main 入口（配置提示，不是未使用/缺失依赖错误）。unused-exports 脚本已适配新版输出结构，可以运行并列出当前库级导出清理项；未把全库公共导出清理混入本次升级。
- 许可证扫描仍停在内部 `@coscene-io/cosceneapis-es-v2@0.0.488` 缺失许可证元数据的 UNKNOWN。未扩大 allowlist、未把 UNKNOWN 擅自归类；需要内部包维护方补齐授权/元数据。这与 npm 安全公告扫描是两项检查。
- 未执行完整真实远端 MP4、设备/ROS 服务、Sentry 服务端 sourcemap 定位、生产 PostHog 发送或百万点/GPU 性能基准。浏览器测试使用隔离测试资料，不把生产服务验收或实际媒体性能声明为已完成。

## 原有依赖变更对照

下表涵盖升级、替换或删除的原有依赖；未变化的条目仍完整保留在 JSON 中。多版本声明包含 peer 范围，实际解析见 lock。

| 依赖                                       | 原声明版本      | 本轮声明                                                             | 处理       |
| ------------------------------------------ | --------------- | -------------------------------------------------------------------- | ---------- |
| @actions/core                              | 1.10.1          | 3.0.1                                                                | 升级       |
| @actions/exec                              | 1.1.1           | 3.0.0                                                                | 升级       |
| @actions/tool-cache                        | 2.0.1           | 4.0.0                                                                | 升级       |
| @aws-sdk/client-s3                         | 3.826.0         | 3.1166.0                                                             | 升级       |
| @bufbuild/protobuf                         | 2.10.1          | 2.17.0                                                               | 升级       |
| @connectrpc/connect                        | 2.1.1           | 2.3.0                                                                | 升级       |
| @connectrpc/connect-web                    | 2.1.1           | 2.3.0                                                                | 升级       |
| @coscene-io/cosceneapis-es-v2              | 0.0.458         | 0.0.488                                                              | 升级       |
| @coscene-io/cosel                          | 24.14.0         | 25.31.0                                                              | 升级       |
| @eslint-community/regexpp                  | 4.12.2          | 4.12.3                                                               | 升级       |
| @foxglove/rosbag                           | 0.4.1           | 0.4.2                                                                | 升级       |
| @foxglove/rosmsg-msgs-common               | 3.2.3           | 3.3.0                                                                | 升级       |
| @foxglove/rosmsg-serialization             | 2.1.1           | 2.1.3                                                                | 升级       |
| @foxglove/schemas                          | 2.0.0           | 2.3.1                                                                | 升级       |
| @foxglove/three-text                       | 0.6.0           | 0.6.1                                                                | 升级       |
| @foxglove/ws-protocol                      | 0.0.0-use.local | workspace:*                                                          | 升级       |
| @growthbook/growthbook-react               | 1.6.5           | 2.0.0                                                                | 升级       |
| @mcap/core                                 | 2.1.7           | 2.4.0                                                                | 升级       |
| @mui/icons-material                        | 7.3.11          | 9.5.0                                                                | 升级       |
| @mui/lab                                   | 7.0.0-beta.17   | 移除                                                                 | 移除/替换  |
| @mui/material                              | 7.3.11          | 9.5.0                                                                | 升级       |
| @mui/x-data-grid                           | 9.12.0          | 9.17.0                                                               | 升级       |
| @mui/x-date-pickers                        | 8.8.0           | 9.17.0                                                               | 升级       |
| @popperjs/core                             | 2.11.8          | 移除                                                                 | 移除/替换  |
| @rspack/cli                                | 2.2.9           | 2.3.2                                                                | 升级       |
| @rspack/core                               | 2.2.9           | 2.3.2                                                                | 升级       |
| @rspack/dev-server                         | 2.1.0           | 2.2.2                                                                | 升级       |
| @sentry/browser                            | 8.24.0          | 8.55.2                                                               | 暂缓最新版 |
| @sentry/core                               | 8.24.0          | 8.55.2                                                               | 暂缓最新版 |
| @sentry/types                              | 8.24.0          | 移除                                                                 | 移除/替换  |
| @sentry/webpack-plugin                     | 2.22.0          | 11.12.0                                                              | 升级       |
| @swc/core                                  | 1.16.2          | 1.16.22                                                              | 升级       |
| @tanstack/react-table                      | 8.21.3          | 9.3.1                                                                | 升级       |
| @testing-library/dom                       | 10.4.1          | 10.4.2                                                               | 升级       |
| @types/base16                              | 1.0.5           | ^1.0.5                                                               | 升级       |
| @types/case-sensitive-paths-webpack-plugin | 2.1.9           | 移除                                                                 | 移除/替换  |
| @types/cytoscape                           | 3.21.9          | 移除                                                                 | 移除/替换  |
| @types/electron-devtools-installer         | 2.2.3           | 移除                                                                 | 移除/替换  |
| @types/geojson                             | 7946.0.14       | 7946.0.16                                                            | 升级       |
| @types/gl-matrix                           | 3.2.0           | 移除                                                                 | 移除/替换  |
| @types/hammerjs                            | 2.0.45          | 2.0.46                                                               | 升级       |
| @types/jest                                | 30.0.0          | 30.0.0, ^30.0.0                                                      | 升级       |
| @types/license-checker                     | 25.0.6          | ^25.0.6                                                              | 升级       |
| @types/lodash                              | 4.17.15         | 移除                                                                 | 移除/替换  |
| @types/lodash-es                           | 4.17.9          | 4.17.12                                                              | 升级       |
| @types/moment-duration-format              | 2.2.6           | 2.2.7                                                                | 升级       |
| @types/node                                | 24.13.1         | 26.6.6                                                               | 升级       |
| @types/plist                               | 3.0.5           | 移除                                                                 | 移除/替换  |
| @types/pngjs                               | 6.0.5           | ^6.0.2                                                               | 升级       |
| @types/ramda                               | 0.29.10         | 0.32.0                                                               | 升级       |
| @types/react-refresh                       | 0.14.6          | 0.14.7                                                               | 升级       |
| @types/react-transition-group              | 4.4.8           | 4.4.12                                                               | 升级       |
| @types/react-virtualized                   | 9.22.0          | 移除                                                                 | 移除/替换  |
| @types/react-window                        | 1.8.8           | ^1.8.8                                                               | 暂缓最新版 |
| @types/sanitize-html                       | 2.9.3           | 2.16.2                                                               | 升级       |
| @types/semver                              | 7.8.0           | 移除                                                                 | 移除/替换  |
| @types/serve-handler                       | 6.1.2           | 6.1.4                                                                | 升级       |
| @types/use-sync-external-store             | 1.5.0           | 1.7.0                                                                | 升级       |
| @types/utif                                | 3.0.6           | ^3.0.6                                                               | 升级       |
| @types/uuid                                | 9.0.7           | 移除                                                                 | 移除/替换  |
| @types/wicg-file-system-access             | 2020.9.6        | 2023.10.7                                                            | 升级       |
| @types/ws                                  | 8.5.12          | 8.18.2                                                               | 升级       |
| @typescript-eslint/parser                  | 8.63.0          | 8.72.2                                                               | 升级       |
| @typescript-eslint/rule-tester             | 8.63.0          | 8.72.2                                                               | 升级       |
| @typescript-eslint/utils                   | 8.63.0          | 8.72.2                                                               | 升级       |
| @typescript/native                         | 7.0.2           | npm:typescript@7.0.2                                                 | 升级       |
| @uiw/react-textarea-code-editor            | 3.0.2           | 3.1.3                                                                | 升级       |
| @xmldom/xmldom                             | 0.8.10          | 0.9.12                                                               | 升级       |
| app-builder-lib                            | 26.15.3         | 26.18.0                                                              | 升级       |
| async-mutex                                | 0.4.1           | 0.5.0                                                                | 升级       |
| axios                                      | 1.11.0          | 1.21.1                                                               | 升级       |
| builder-util                               | 26.15.3         | 26.16.0                                                              | 升级       |
| chart.js                                   | 4.5.1           | 4.6.1                                                                | 升级       |
| cross-env                                  | 7.0.3           | 10.1.0                                                               | 升级       |
| crypto-browserify                          | 3.12.0          | 3.12.1                                                               | 升级       |
| cytoscape                                  | 3.31.0          | 3.35.0                                                               | 升级       |
| cytoscape-dagre                            | 4.0.0           | 4.1.0                                                                | 升级       |
| dayjs                                      | 1.11.21         | 1.11.23                                                              | 升级       |
| depcheck                                   | 1.4.7           | 移除                                                                 | 移除/替换  |
| dmg-builder                                | 26.15.3         | 26.18.0                                                              | 升级       |
| electron                                   | 35.0.3          | 45.3.0                                                               | 升级       |
| electron-builder                           | 26.15.3         | 26.18.0                                                              | 升级       |
| electron-builder-squirrel-windows          | 26.15.3         | 26.18.0                                                              | 升级       |
| electron-updater                           | 6.3.9           | 6.8.11                                                               | 升级       |
| esa-cli                                    | 1.0.10          | 1.0.13                                                               | 升级       |
| eslint                                     | 9.39.4          | 9.39.5, ^9.39.5                                                      | 暂缓最新版 |
| eslint-plugin-jest                         | 28.9.0          | 29.17.0                                                              | 升级       |
| eslint-plugin-react                        | 7.37.2          | 7.37.5                                                               | 升级       |
| eslint-plugin-react-hooks                  | 5.1.0           | 7.1.1                                                                | 升级       |
| eventemitter3                              | 5.0.1           | 5.0.4                                                                | 升级       |
| fake-indexeddb                             | 4.0.2           | 6.2.8                                                                | 升级       |
| flatbuffers                                | 23.5.26         | 25.9.23                                                              | 升级       |
| fuzzysort                                  | 3.1.0           | 4.0.2                                                                | 升级       |
| gl-matrix                                  | 3.4.3           | 3.4.4                                                                | 升级       |
| glob                                       | 13.0.6          | 移除                                                                 | 移除/替换  |
| globals                                    | 17.6.0          | 17.14.0                                                              | 升级       |
| i18next                                    | 26.3.1          | 27.1.1                                                               | 升级       |
| i18next-browser-languagedetector           | 8.0.2           | 8.3.0                                                                | 升级       |
| idb                                        | 8.0.3           | 8.0.4                                                                | 升级       |
| idb-keyval                                 | 6.2.1           | 6.3.0                                                                | 升级       |
| immer                                      | 10.0.3          | 11.2.10                                                              | 升级       |
| jest                                       | 30.5.1          | 30.5.2                                                               | 升级       |
| jest-environment-jsdom                     | 30.5.1          | 30.5.2                                                               | 升级       |
| lodash-es                                  | 4.17.21         | 4.18.1                                                               | 升级       |
| mathjs                                     | 11.11.1         | 15.2.0                                                               | 升级       |
| mediabunny                                 | 1.52.2          | 1.65.2                                                               | 升级       |
| meshoptimizer                              | 0.21.0          | 1.3.0                                                                | 升级       |
| moize                                      | 6.1.7           | 移除                                                                 | 移除/替换  |
| moment                                     | 2.30.1          | 2.31.0                                                               | 升级       |
| moment-timezone                            | 0.5.45          | 0.6.6                                                                | 升级       |
| oxlint                                     | 1.82.0          | 1.93.0                                                               | 升级       |
| oxlint-tsgolint                            | 7.0.2001        | 7.0.2006                                                             | 升级       |
| pinyin-match                               | 1.2.4           | 1.2.10                                                               | 升级       |
| playwright                                 | 1.60.0          | 1.65.0                                                               | 升级       |
| plist                                      | 5.0.0           | 5.1.1                                                                | 升级       |
| posthog-js                                 | 1.205.0         | 1.447.12                                                             | 升级       |
| prettier                                   | 3.8.4           | 3.9.10                                                               | 升级       |
| protobufjs                                 | 7.2.4           | patch:protobufjs@7.6.6#../../patches/protobufjs.patch                | 升级       |
| ramda                                      | 0.29.1          | 0.32.0                                                               | 升级       |
| react                                      | 19.3.1          | 19.3.1, ^19.3.1                                                      | 升级       |
| react-colorful                             | 5.7.0           | 5.8.1                                                                | 升级       |
| react-hook-form                            | 7.58.1          | 7.91.0                                                               | 升级       |
| react-hot-toast                            | 2.4.0           | 2.6.1                                                                | 升级       |
| react-i18next                              | 14.0.5          | 18.0.1                                                               | 升级       |
| react-json-tree                            | 0.15.1          | patch:react-json-tree@npm:0.15.1#../../patches/react-json-tree.patch | 暂缓最新版 |
| react-markdown                             | 9.1.0           | 10.1.0                                                               | 升级       |
| react-monaco-editor                        | 0.59.0          | 移除                                                                 | 移除/替换  |
| react-refresh                              | 0.18.0          | 0.19.0                                                               | 升级       |
| react-resizable-panels                     | 2.1.9           | 4.21.0                                                               | 升级       |
| react-resize-detector                      | 12.0.2          | 12.3.0                                                               | 升级       |
| react-virtualized                          | 9.22.6          | 移除                                                                 | 移除/替换  |
| readable-stream                            | 4.7.0           | 4.8.0                                                                | 升级       |
| rimraf                                     | 6.1.3           | 6.1.4                                                                | 升级       |
| sanitize-html                              | 2.11.0          | 2.18.1                                                               | 升级       |
| semver                                     | 7.8.5           | 移除                                                                 | 移除/替换  |
| serve-handler                              | 6.1.5           | 6.1.8                                                                | 升级       |
| string-replace-loader                      | 3.1.0           | 3.3.0                                                                | 升级       |
| text-metrics                               | 3.0.0           | 4.0.1                                                                | 升级       |
| three                                      | 0.166.1         | patch:three@0.166.1#../../patches/three.patch                        | 暂缓最新版 |
| ts-checker-rspack-plugin                   | 1.6.0           | 1.8.0                                                                | 升级       |
| ts-essentials                              | 10.0.4          | 10.2.1                                                               | 升级       |
| ts-jest                                    | 29.4.11         | 29.4.15                                                              | 升级       |
| ts-unused-exports                          | 10.0.1          | 11.0.1                                                               | 升级       |
| tslib                                      | 2.8.1           | 2.9.1                                                                | 升级       |
| typescript                                 | 6.0.2           | 6.0.2, npm:@typescript/typescript6@6.0.2                             | 暂缓最新版 |
| typescript-eslint                          | 8.63.0          | 8.72.2                                                               | 升级       |
| typescript-for-user-script                 | 5.9.3           | npm:typescript@5.9.3                                                 | 暂缓最新版 |
| use-sync-external-store                    | 1.6.0           | 1.7.0                                                                | 升级       |
| uuid                                       | 11.0.5          | 14.0.3                                                               | 升级       |
| webpack                                    | 5.97.1          | 5.112.2                                                              | 升级       |
| ws                                         | 8.18.0          | 8.22.2                                                               | 升级       |
| xacro-parser                               | 0.3.9           | 0.3.11                                                               | 升级       |
| zustand                                    | 5.0.8           | 5.1.0                                                                | 升级       |
