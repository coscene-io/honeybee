// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PanelsState } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";

/**
 * This is loaded when the user has no layout selected on application launch
 * to avoid presenting the user with a blank layout.
 */
export const defaultLayout: PanelsState = {
  configById: {
    "3D!3me9aqv": {
      cameraState: {
        perspective: true,
        distance: 8.996917948102954,
        phi: 54.92689132690093,
        thetaOffset: 71.86161518097255,
        targetOffset: [0.2855428839276065, -1.1206910736170728, -3.1616401048435267e-16],
        target: [0, 0, 0],
        targetOrientation: [0, 0, 0, 1],
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-pose",
      scene: {
        enableStats: false,
        transforms: {
          editable: false,
        },
        backgroundColor: "#000000",
      },
      transforms: {},
      topics: {
        "/camera1_record/depth/camera_info": {
          visible: true,
        },
        "/camera2_record/depth/camera_info": {
          visible: true,
        },
        "/camera3_record/depth/camera_info": {
          visible: true,
        },
        "/camera4_record/depth/camera_info": {
          visible: true,
        },
        "/camera5_record/depth/camera_info": {
          visible: true,
        },
        "/camera1_record/depth/image_raw": {
          visible: true,
        },
        "/camera2_record/depth/image_raw": {
          visible: true,
        },
        "/camera3_record/depth/image_raw": {
          visible: true,
        },
        "/camera4_record/depth/image_raw": {
          visible: true,
        },
        "/camera5_record/depth/image_raw": {
          visible: true,
        },
        "/track_markerarray": {
          visible: true,
        },
        "/cloud_rgba": {
          visible: true,
          colorField: "rgba",
          colorMode: "rgba",
          colorMap: "turbo",
        },
        "/dabai/multi_layer_points3": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/dabai/multi_layer_points4": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/dabai/multi_layer_points5": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/pointcloud1": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/pointcloud2": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan_tracked": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/scan": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/scan_filtered2": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/tracked_obstacle_center_points": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/localization/current_pose": {
          visible: true,
        },
        "/v5_current_pose": {
          visible: true,
        },
        "/move_base/global_costmap/costmap": {
          visible: true,
        },
        "/move_base/global_costmap/inflation_caculate_distance_map": {
          visible: true,
        },
        "/move_base/global_costmap/inflationed_static_map": {
          visible: true,
        },
        "/move_base/global_costmap/local_costmap": {
          visible: true,
        },
        "/sick_scan_filtered_lsod": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/move_base/global_costmap/local_clean_footprint_master": {
          visible: true,
        },
        "/console/init_pose": {
          visible: true,
        },
        "/initialpose_direct": {
          visible: true,
        },
        "/initialpose_multiple_landmarks": {
          visible: true,
        },
        "/elevator_map": {
          visible: true,
        },
        "/gate_map": {
          visible: true,
        },
        "/map": {
          visible: true,
        },
        "/move_base/local_costmap/costmap": {
          visible: true,
          minColor: "#0500fa",
          maxColor: "#ff0000",
        },
        "/vel_map": {
          visible: true,
        },
        "/virtual_wall": {
          visible: true,
        },
        "/beam": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/bump": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/elev_detect_cloud": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/elev_detect_cloud2": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/scan_orig": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/move_base/global_costmap/footprint": {
          visible: true,
        },
        "/move_base/local_costmap/footprint": {
          visible: true,
        },
        "/localization/robot_pose": {
          visible: true,
        },
        "/move_base/current_goal": {
          visible: true,
        },
        "/move_base/KPlannerROS/plan_output": {
          visible: true,
        },
        "/move_base/move_base_global_plan": {
          visible: true,
        },
        "/move_base/TebLocalPlannerROS/teb_poses": {
          visible: true,
        },
        "/particlecloud": {
          visible: true,
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
      followTf: "map",
    },
    "Plot!t0ra0d": {
      title: "Plot",
      paths: [
        {
          value: "/chassis_imu_data.angular_velocity.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/chassis_imu_data.angular_velocity.y",
          enabled: true,
          timestampMethod: "receiveTime",
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
    "Plot!1o1y0sh": {
      title: "Plot",
      paths: [
        {
          value: "/imu_raw.angular_velocity.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/imu_raw.angular_velocity.y",
          enabled: true,
          timestampMethod: "receiveTime",
        },
      ],
      showXAxisLabels: true,
      showYAxisLabels: true,
      showLegend: false,
      legendDisplay: "floating",
      showPlotValuesInLegend: false,
      isSynced: true,
      xAxisVal: "timestamp",
      sidebarDimension: 240,
    },
    "Plot!v4o8q1": {
      title: "Plot",
      paths: [
        {
          value: "/cmd_vel.linear.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/cmd_vel.angular.z",
          enabled: true,
          timestampMethod: "receiveTime",
        },
      ],
      showXAxisLabels: true,
      showYAxisLabels: true,
      showLegend: false,
      legendDisplay: "floating",
      showPlotValuesInLegend: false,
      isSynced: true,
      xAxisVal: "timestamp",
      sidebarDimension: 240,
    },
    "RosOut!mt4hkx": {
      searchTerms: [],
      minLogLevel: 1,
    },
  },
  globalVariables: {},
  userNodes: {},
  linkedGlobalVariables: [],
  playbackConfig: {
    speed: 1,
  },
  layout: {
    first: "3D!3me9aqv",
    second: {
      direction: "row",
      first: {
        first: {
          first: "Plot!t0ra0d",
          second: "Plot!1o1y0sh",
          direction: "column",
        },
        second: "Plot!v4o8q1",
        direction: "column",
        splitPercentage: 64.1726618705036,
      },
      second: "RosOut!mt4hkx",
      splitPercentage: 47.79050736497547,
    },
    direction: "row",
  },
} as const;
