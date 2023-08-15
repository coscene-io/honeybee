// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutData } from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext/actions";

/**
 * This is loaded when the user has no layout selected on application launch
 * to avoid presenting the user with a blank layout.
 */
export const sampleLayout: LayoutData = {
  configById: {
    "Image!1xfui8q": {
      cameraState: {
        distance: 20,
        perspective: true,
        phi: 60,
        target: [0, 0, 0],
        targetOffset: [0, 0, 0],
        targetOrientation: [0, 0, 0, 1],
        thetaOffset: 45,
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-pose",
      scene: {},
      transforms: {},
      topics: {},
      layers: {},
      publish: {
        type: "point",
        poseTopic: "/move_base_simple/goal",
        pointTopic: "/clicked_point",
        poseEstimateTopic: "/initialpose",
        poseEstimateXDeviation: 0.5,
        poseEstimateYDeviation: 0.5,
        poseEstimateThetaDeviation: 0.26179939,
      },
      imageMode: {
        imageTopic: "/CAM_FRONT_LEFT/image_rect_compressed",
        calibrationTopic: "/CAM_FRONT_LEFT/camera_info",
      },
      foxglovePanelTitle: "左前方摄像头",
    },
    "Image!bba5y3": {
      cameraState: {
        distance: 20,
        perspective: true,
        phi: 60,
        target: [0, 0, 0],
        targetOffset: [0, 0, 0],
        targetOrientation: [0, 0, 0, 1],
        thetaOffset: 45,
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-pose",
      scene: {},
      transforms: {},
      topics: {},
      layers: {},
      publish: {
        type: "point",
        poseTopic: "/move_base_simple/goal",
        pointTopic: "/clicked_point",
        poseEstimateTopic: "/initialpose",
        poseEstimateXDeviation: 0.5,
        poseEstimateYDeviation: 0.5,
        poseEstimateThetaDeviation: 0.26179939,
      },
      imageMode: {
        imageTopic: "/CAM_FRONT/image_rect_compressed",
        calibrationTopic: "/CAM_FRONT/camera_info",
      },
      foxglovePanelTitle: "正前方摄像头",
    },
    "Image!2rltlpq": {
      cameraState: {
        distance: 20,
        perspective: true,
        phi: 60,
        target: [0, 0, 0],
        targetOffset: [0, 0, 0],
        targetOrientation: [0, 0, 0, 1],
        thetaOffset: 45,
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-pose",
      scene: {},
      transforms: {},
      topics: {},
      layers: {},
      publish: {
        type: "point",
        poseTopic: "/move_base_simple/goal",
        pointTopic: "/clicked_point",
        poseEstimateTopic: "/initialpose",
        poseEstimateXDeviation: 0.5,
        poseEstimateYDeviation: 0.5,
        poseEstimateThetaDeviation: 0.26179939,
      },
      imageMode: {
        imageTopic: "/CAM_FRONT_RIGHT/image_rect_compressed",
        calibrationTopic: "/CAM_FRONT_RIGHT/camera_info",
      },
      foxglovePanelTitle: "右前方摄像头",
    },
    "Image!4eqstk4": {
      cameraState: {
        distance: 20,
        perspective: true,
        phi: 60,
        target: [0, 0, 0],
        targetOffset: [0, 0, 0],
        targetOrientation: [0, 0, 0, 1],
        thetaOffset: 45,
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-pose",
      scene: {},
      transforms: {},
      topics: {},
      layers: {},
      publish: {
        type: "point",
        poseTopic: "/move_base_simple/goal",
        pointTopic: "/clicked_point",
        poseEstimateTopic: "/initialpose",
        poseEstimateXDeviation: 0.5,
        poseEstimateYDeviation: 0.5,
        poseEstimateThetaDeviation: 0.26179939,
      },
      imageMode: {
        imageTopic: "/CAM_BACK/image_rect_compressed",
        calibrationTopic: "/CAM_BACK/camera_info",
      },
      foxglovePanelTitle: "后摄像头",
    },
    "3D!31z6r56": {
      cameraState: {
        perspective: true,
        distance: 75.89554049202877,
        phi: 44.09749244054485,
        thetaOffset: 107.51020340436357,
        targetOffset: [7.924582373259089, -5.707433252982329, -3.422054418061105e-16],
        target: [0, 0, 0],
        targetOrientation: [0, 0, 0, 1],
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-pose",
      scene: {},
      transforms: {
        "frame:base_link": {
          visible: true,
        },
        "frame:map": {
          visible: true,
        },
        "frame:RADAR_FRONT": {
          visible: true,
        },
        "frame:RADAR_FRONT_LEFT": {
          visible: true,
        },
        "frame:RADAR_FRONT_RIGHT": {
          visible: true,
        },
        "frame:RADAR_BACK_LEFT": {
          visible: true,
        },
        "frame:RADAR_BACK_RIGHT": {
          visible: true,
        },
        "frame:LIDAR_TOP": {
          visible: true,
        },
        "frame:CAM_FRONT": {
          visible: true,
        },
        "frame:CAM_FRONT_RIGHT": {
          visible: true,
        },
        "frame:CAM_BACK_RIGHT": {
          visible: true,
        },
        "frame:CAM_BACK": {
          visible: true,
        },
        "frame:CAM_BACK_LEFT": {
          visible: true,
        },
        "frame:CAM_FRONT_LEFT": {
          visible: true,
        },
      },
      topics: {
        "/map": {
          visible: true,
        },
        "/LIDAR_TOP": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/markers/annotations": {
          visible: true,
        },
        "/pose": {
          visible: false,
        },
        "/RADAR_BACK_LEFT": {
          visible: false,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/semantic_map": {
          visible: false,
        },
        "/drivable_area": {
          visible: false,
        },
        "/CAM_FRONT_RIGHT/image_rect_compressed": {
          visible: false,
          frameLocked: true,
          cameraInfoTopic: "/CAM_FRONT_RIGHT/camera_info",
          distance: 1,
          planarProjectionFactor: 0,
          color: "#ffffff",
        },
        "/CAM_FRONT_LEFT/image_rect_compressed": {
          visible: false,
          frameLocked: true,
          cameraInfoTopic: "/CAM_FRONT_LEFT/camera_info",
          distance: 1,
          planarProjectionFactor: 0,
          color: "#ffffff",
        },
        "/CAM_FRONT/image_rect_compressed": {
          visible: false,
          frameLocked: true,
          cameraInfoTopic: "/CAM_FRONT/camera_info",
          distance: 1,
          planarProjectionFactor: 0,
          color: "#ffffff",
        },
        "/CAM_BACK_RIGHT/image_rect_compressed": {
          visible: false,
          frameLocked: true,
          cameraInfoTopic: "/CAM_BACK_RIGHT/camera_info",
          distance: 1,
          planarProjectionFactor: 0,
          color: "#ffffff",
        },
        "/CAM_BACK_LEFT/image_rect_compressed": {
          visible: false,
          frameLocked: true,
          cameraInfoTopic: "/CAM_BACK_LEFT/camera_info",
          distance: 1,
          planarProjectionFactor: 0,
          color: "#ffffff",
        },
        "/CAM_BACK/image_rect_compressed": {
          visible: false,
          frameLocked: true,
          cameraInfoTopic: "/CAM_BACK/camera_info",
          distance: 1,
          planarProjectionFactor: 0,
          color: "#ffffff",
        },
      },
      layers: {},
      publish: {
        type: "point",
        poseTopic: "/move_base_simple/goal",
        pointTopic: "/clicked_point",
        poseEstimateTopic: "/initialpose",
        poseEstimateXDeviation: 0.5,
        poseEstimateYDeviation: 0.5,
        poseEstimateThetaDeviation: 0.26179939,
      },
      imageMode: {},
    },
    "map!4k70bpj": {
      center: {
        lat: 1.2982765347023577,
        lon: 103.78835684326744,
      },
      customTileUrl: "",
      disabledTopics: [],
      followTopic: "",
      layer: "map",
      topicColors: {
        "/gps": "#4fe372",
      },
      zoomLevel: 18,
      maxNativeZoom: 18,
    },
    "3D!3zug0e1": {
      cameraState: {
        distance: 68.49572529409527,
        perspective: false,
        phi: 59.99999999999999,
        target: [0, 0, 0],
        targetOffset: [1.8716367183533178, -3.650618153619784, 1.2802007788397496e-16],
        targetOrientation: [0, 0, 0, 1],
        thetaOffset: 45.00000000000003,
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-pose",
      scene: {},
      transforms: {
        "frame:base_link": {
          visible: true,
        },
        "frame:map": {
          visible: false,
        },
        "frame:RADAR_FRONT": {
          visible: false,
        },
        "frame:RADAR_FRONT_LEFT": {
          visible: false,
        },
        "frame:RADAR_FRONT_RIGHT": {
          visible: false,
        },
        "frame:RADAR_BACK_LEFT": {
          visible: false,
        },
        "frame:RADAR_BACK_RIGHT": {
          visible: false,
        },
        "frame:LIDAR_TOP": {
          visible: false,
        },
        "frame:CAM_FRONT": {
          visible: false,
        },
        "frame:CAM_FRONT_RIGHT": {
          visible: false,
        },
        "frame:CAM_BACK_RIGHT": {
          visible: false,
        },
        "frame:CAM_BACK": {
          visible: false,
        },
        "frame:CAM_BACK_LEFT": {
          visible: false,
        },
        "frame:CAM_FRONT_LEFT": {
          visible: false,
        },
      },
      topics: {
        "/map": {
          visible: true,
        },
        "/semantic_map": {
          visible: true,
        },
        "/markers/annotations": {
          visible: true,
        },
        "/drivable_area": {
          visible: true,
          colorMode: "raw",
        },
      },
      layers: {},
      publish: {
        type: "point",
        poseTopic: "/move_base_simple/goal",
        pointTopic: "/clicked_point",
        poseEstimateTopic: "/initialpose",
        poseEstimateXDeviation: 0.5,
        poseEstimateYDeviation: 0.5,
        poseEstimateThetaDeviation: 0.26179939,
      },
      imageMode: {},
    },
    "Plot!v2vphz": {
      paths: [
        {
          value: "/imu.linear_acceleration.x",
          enabled: true,
          timestampMethod: "headerStamp",
          showLine: true,
        },
        {
          timestampMethod: "headerStamp",
          value: '/diagnostics.status[:].values[:]{key=="throttle_sensor"}.value',
          enabled: true,
        },
      ],
      showXAxisLabels: true,
      showYAxisLabels: true,
      showLegend: true,
      legendDisplay: "floating",
      showPlotValuesInLegend: false,
      isSynced: true,
      xAxisVal: "timestamp",
      sidebarDimension: 240,
    },
    "Plot!48xy8rm": {
      paths: [
        {
          value: '/diagnostics.status[:].values[:]{key=="FL_wheel_speed"}.value',
          enabled: true,
          timestampMethod: "headerStamp",
        },
        {
          timestampMethod: "headerStamp",
          value: '/diagnostics.status[:].values[:]{key=="FR_wheel_speed"}.value',
          enabled: true,
        },
        {
          timestampMethod: "headerStamp",
          value: '/diagnostics.status[:].values[:]{key=="RL_wheel_speed"}.value',
          enabled: true,
        },
        {
          timestampMethod: "headerStamp",
          value: '/diagnostics.status[:].values[:]{key=="RR_wheel_speed"}.value',
          enabled: true,
        },
      ],
      showXAxisLabels: true,
      showYAxisLabels: true,
      showLegend: true,
      legendDisplay: "floating",
      showPlotValuesInLegend: false,
      isSynced: true,
      xAxisVal: "timestamp",
      sidebarDimension: 240,
    },
    "StateTransitions!1maiqz0": {
      paths: [
        {
          value: '/diagnostics.status[:].values[:]{key=="brake_switch"}.value',
          timestampMethod: "receiveTime",
        },
      ],
      isSynced: true,
    },
    "DiagnosticSummary!wutfwz": {
      minLevel: 0,
      pinnedIds: [],
      hardwareIdFilter: "",
      topicToRender: "/diagnostics",
      sortByLevel: true,
    },
    "DiagnosticStatusPanel!fuybpm": {
      topicToRender: "/diagnostics",
    },
    "SourceInfo!29h6thu": {},
    "RawMessages!3ca6dmt": {
      diffEnabled: false,
      diffMethod: "custom",
      diffTopicPath: "",
      showFullMessageForDiff: false,
      topicPath: "/markers/annotations",
      expansion: {
        markers: "e",
      },
    },
    "Tab!439zop1": {
      activeTabIdx: 0,
      tabs: [
        {
          title: "洞察",
          layout: {
            first: {
              first: {
                first: "Image!1xfui8q",
                second: "Image!bba5y3",
                direction: "row",
              },
              second: {
                first: "Image!2rltlpq",
                second: "Image!4eqstk4",
                direction: "row",
              },
              direction: "row",
            },
            second: "3D!31z6r56",
            direction: "column",
            splitPercentage: 24.75,
          },
        },
        {
          title: "规划",
          layout: {
            first: "map!4k70bpj",
            second: "3D!3zug0e1",
            direction: "row",
            splitPercentage: 32.283547583007625,
          },
        },
        {
          title: "控制",
          layout: {
            first: "Plot!v2vphz",
            second: "Plot!48xy8rm",
            direction: "column",
          },
        },
        {
          title: "诊断",
          layout: {
            first: {
              first: {
                first: "StateTransitions!1maiqz0",
                second: "DiagnosticSummary!wutfwz",
                direction: "column",
              },
              second: "DiagnosticStatusPanel!fuybpm",
              direction: "column",
            },
            second: {
              first: "SourceInfo!29h6thu",
              second: "RawMessages!3ca6dmt",
              direction: "column",
              splitPercentage: 69.16666666666667,
            },
            direction: "row",
            splitPercentage: 54.03653506187389,
          },
        },
      ],
    },
    "RosOut!aumo9o": {
      searchTerms: [],
      minLogLevel: 1,
      reverseOrder: false,
    },
  },
  globalVariables: {},
  userNodes: {},
  playbackConfig: {
    speed: 1,
  },
  layout: {
    first: "Tab!439zop1",
    second: "RosOut!aumo9o",
    direction: "row",
    splitPercentage: 79.3361383824217,
  },
} as const;
