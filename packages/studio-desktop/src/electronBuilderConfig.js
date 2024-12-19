// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const { version: electronVersion } = require("electron/package.json");
const path = require("path");

/**
 * @param {{appPath: string}} params
 * @returns {import("electron-builder").Configuration}
 */
function makeElectronBuilderConfig(params) {
  return {
    electronVersion,
    appId: "dev.coStudio",
    npmRebuild: false,
    asar: true,
    directories: {
      app: params.appPath,
      buildResources: path.join(__dirname, "../resources"),
    },
    artifactName: "coStudio-v${version}-${os}-${arch}.${ext}",
    afterPack: path.resolve(__dirname, "afterPack.ts"),
    icon: path.join(__dirname, "../resources/icon/icon.icns"),
    protocols: [
      {
        name: "coscene",
        schemes: ["coscene"],
      },
    ],
    linux: {
      target: [
        {
          target: "deb",
          arch: ["x64", "arm64"],
        },
      ],
      fileAssociations: [
        {
          ext: "bag",
          name: "ROS Bag File",
          mimeType: "application/octet-stream",
        },
        {
          ext: "mcap",
          name: "MCAP File",
          mimeType: "application/octet-stream",
        },
        {
          ext: "foxe",
          name: "coScene Extension",
          mimeType: "application/zip",
        },
      ],
    },
    win: {
      target: [
        {
          target: "nsis",
          arch: ["x64", "arm64"],
        },
      ],
      icon: path.join(__dirname, "../resources/icon/icon.png"),
      fileAssociations: [
        {
          ext: "bag",
          name: "ROS Bag File",
          icon: path.join(__dirname, "../resources/icon/BagIcon.ico"),
        },
        {
          ext: "mcap",
          name: "MCAP File",
          icon: path.join(__dirname, "../resources/icon/McapIcon.ico"),
        },
        {
          ext: "foxe",
          name: "coScene Extension",
          mimeType: "application/zip",
        },
      ],
    },
    mac: {
      target: {
        target: "default",
        arch: ["universal", "arm64"],
      },
      category: "public.app-category.developer-tools",
      icon: path.join(__dirname, "../resources/icon/icon.icns"),
      entitlements: path.join(__dirname, "../resources/mac/entitlements.plist"),
      entitlementsInherit: path.join(__dirname, "../resources/mac/entitlements.plist"),
      extraFiles: [
        {
          from: path.join(
            require.resolve("quicklookjs/index.d.ts"),
            "../dist/PreviewExtension.appex",
          ),
          to: "PlugIns/PreviewExtension.appex",
        },
      ],
      extraResources: [
        { from: path.join(__dirname, "../resources/icon/BagIcon.png"), to: "BagIcon.png" },
        { from: path.join(__dirname, "../resources/icon/McapIcon.png"), to: "McapIcon.png" },
        { from: path.join(__dirname, "../resources/icon/FoxeIcon.png"), to: "FoxeIcon.png" },
      ],
      extendInfo: {
        CFBundleDocumentTypes: [
          {
            CFBundleTypeExtensions: ["bag"],
            CFBundleTypeIconFile: "BagIcon",
            CFBundleTypeName: "ROS Bag File",
            CFBundleTypeRole: "Viewer",
            LSHandlerRank: "Default",
            CFBundleTypeIconSystemGenerated: 1,
            LSItemContentTypes: ["org.ros.bag"],
          },
          {
            CFBundleTypeExtensions: ["mcap"],
            CFBundleTypeIconFile: "McapIcon",
            CFBundleTypeName: "MCAP File",
            CFBundleTypeRole: "Viewer",
            LSHandlerRank: "Owner",
            CFBundleTypeIconSystemGenerated: 1,
            LSItemContentTypes: ["dev.mcap.mcap"],
          },
          {
            CFBundleTypeExtensions: ["foxe"],
            CFBundleTypeIconFile: "FoxeIcon",
            CFBundleTypeName: "coScene Extension File",
            CFBundleTypeRole: "Viewer",
            LSHandlerRank: "Owner",
            CFBundleTypeIconSystemGenerated: 1,
            LSItemContentTypes: ["dev.foxglove.extension"],
          },
        ],
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: ["coscene"],
            CFBundleTypeRole: "Viewer",
          },
        ],
        UTExportedTypeDeclarations: [
          {
            UTTypeConformsTo: ["public.data", "public.log", "public.composite-content"],
            UTTypeDescription: "MCAP File",
            UTTypeIcons: { UTTypeIconText: "mcap" },
            UTTypeIdentifier: "dev.mcap.mcap",
            UTTypeTagSpecification: { "public.filename-extension": "mcap" },
            UTTypeReferenceURL: "https://mcap.dev/",
          },
          {
            UTTypeConformsTo: ["public.data", "public.archive", "public.zip-archive"],
            UTTypeDescription: "coScene Extension File",
            UTTypeIcons: { UTTypeIconText: "foxe" },
            UTTypeIdentifier: "dev.foxglove.extension",
            UTTypeTagSpecification: { "public.filename-extension": "foxe" },
            UTTypeReferenceURL: "https://foxglove.dev/docs/studio/extensions/getting-started",
          },
        ],
        UTImportedTypeDeclarations: [
          {
            UTTypeConformsTo: ["public.data", "public.log", "public.composite-content"],
            UTTypeDescription: "ROS 1 Bag File",
            UTTypeIcons: { UTTypeIconText: "bag" },
            UTTypeIdentifier: "org.ros.bag",
            UTTypeTagSpecification: { "public.filename-extension": "bag" },
            UTTypeReferenceURL: "http://wiki.ros.org/Bags",
          },
        ],
      },
    },
    appx: {
      applicationId: "coStudio",
      backgroundColor: "#f7def6",
      displayName: "coStudio",
      identityName: "coStudio",
      publisher: "CN=coScene, O=coScene, L=Shanghai, S=Shanghai, C=CN",
      publisherDisplayName: "coStudio",
      languages: ["en-US"],
      addAutoLaunchExtension: false,
      showNameOnTiles: false,
      setBuildNumber: false,
    },
    dmg: {
      background: path.join(__dirname, "../resources/dmg-background/background.png"),
      contents: [
        { x: 144, y: 170, type: "file" },
        { x: 390, y: 170, type: "link", path: "/Applications" },
      ],
      // license: path.join(__dirname, "../resources/LICENSE.txt"),
    },
    deb: {
      packageName: "costudio",
      depends: [
        "libgtk-3-0",
        "libnotify4",
        "libnss3",
        "libxtst6",
        "xdg-utils",
        "libatspi2.0-0",
        "libdrm2",
        "libgbm1",
        "libxcb-dri3-0",
      ],
      // after install script
      afterInstall: path.join(__dirname, "../resources/linux/deb/postinst"),
      // license: path.join(__dirname, "../resources/LICENSE.txt"), // 添加许可证文件
      // 确保许可证文件被安装到正确的位置
      // lintianOverrides: [
      //   // copyright-file-contains-full-license-text
      //   // 这个规则通常要求不要在 copyright 文件中包含完整的许可证文本
      //   // 默认建议引用 /usr/share/common-licenses 中的标准许可证文本
      //   // 通过覆盖这个规则，我们可以在包中包含完整的许可证文本
      //   "copyright-file-contains-full-license-text",
      //   // copyright-should-refer-to-common-license-file-for-lgpl
      //   // 这个规则要求 LGPL 许可证应该引用公共许可证文件
      //   // 同样，通过覆盖这个规则，我们可以使用自己的许可证文本
      //   "copyright-should-refer-to-common-license-file-for-lgpl",
      // ],
    },
    snap: {
      confinement: "strict",
      grade: "stable",
      summary: "Integrated visualization and diagnosis tool for robotics",
    },
    publish: [
      {
        provider: "generic",
        url: "https://coscene-download.oss-cn-hangzhou.aliyuncs.com/coStudio/packages",
      },
    ],
    nsis: {
      license: path.join(__dirname, "../resources/LICENSE.txt"), // 许可协议文件
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
    },
  };
}

module.exports = { makeElectronBuilderConfig };
