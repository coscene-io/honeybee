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
        distance: 22.650034325984734,
        phi: 1.3886851178769857,
        thetaOffset: -93.08666554917356,
        targetOffset: [0.36727694720688536, 0.26534843185416623, -6.410308819688133e-16],
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
      transforms: {
        "frame:/beam_link": {
          visible: false,
        },
        "frame:/bump_link": {
          visible: false,
        },
        "frame:map": {
          visible: false,
        },
        "frame:": {
          visible: false,
        },
        "frame:odom": {
          visible: true,
        },
        "frame:camera_link6": {
          visible: false,
        },
        "frame:base_link": {
          visible: false,
        },
        "frame:camera_link4": {
          visible: false,
        },
        "frame:camera_link2": {
          visible: false,
        },
        "frame:camera_link3": {
          visible: false,
        },
        "frame:camera_link": {
          visible: false,
        },
        "frame:camera_link5": {
          visible: false,
        },
        "frame:imu": {
          visible: false,
        },
        "frame:base_laser": {
          visible: false,
        },
        "frame:livox_frame_r": {
          visible: false,
        },
        "frame:steering_link": {
          visible: false,
        },
        "frame:livox_link_0": {
          visible: false,
        },
        "frame:object_link": {
          visible: false,
        },
        "frame:object_link2": {
          visible: false,
        },
        "frame:object_link3": {
          visible: false,
        },
        "frame:object_link4": {
          visible: false,
        },
        "frame:rgb_w_b": {
          visible: false,
        },
        "frame:rgb_n_f": {
          visible: false,
        },
        "frame:rgb_n_b": {
          visible: false,
        },
        "frame:rgb_m_f": {
          visible: false,
        },
        "frame:rgb_m_b": {
          visible: false,
        },
        "frame:rgb_w_l": {
          visible: false,
        },
        "frame:rgb_n_ftu": {
          visible: false,
        },
        "frame:rgb_n_ftul": {
          visible: false,
        },
        "frame:rgb_n_ftur": {
          visible: false,
        },
        "frame:rgb_w_r": {
          visible: false,
        },
        "frame:rgb_m_ftd": {
          visible: false,
        },
        "frame:rgb_n_ftd": {
          visible: false,
        },
        "frame:laser_link": {
          visible: false,
        },
        "frame:wheel_odom": {
          visible: false,
        },
        "frame:beam_link": {
          visible: false,
        },
        "frame:bump_link": {
          visible: false,
        },
        "frame:camera_1_link": {
          visible: false,
        },
        "frame:camera_2_link": {
          visible: false,
        },
        "frame:left_wheel": {
          visible: false,
        },
        "frame:label_camera_link": {
          visible: false,
        },
        "frame:mx_camera_link": {
          visible: false,
        },
        "frame:right_wheel": {
          visible: false,
        },
        "frame:stm32_imu": {
          visible: false,
        },
        "frame:sonar1": {
          visible: false,
        },
        "frame:sonar2": {
          visible: false,
        },
        "frame:correct": {
          visible: false,
        },
        "frame:world": {
          visible: false,
        },
        "frame:base_laser_2": {
          visible: false,
        },
        "frame:intrinsic_depth3": {
          visible: false,
        },
        "frame:intrinsic_color3": {
          visible: false,
        },
        "frame:intrinsic_depth5": {
          visible: false,
        },
        "frame:intrinsic_color5": {
          visible: false,
        },
        "frame:follow_link": {
          visible: false,
        },
        "frame:intrinsic_depth": {
          visible: false,
        },
        "frame:rslidar": {
          visible: false,
        },
        "frame:base_odom": {
          visible: true,
        },
        "frame:intrinsic_depth6": {
          visible: false,
        },
        "frame:intrinsic_color6": {
          visible: false,
        },
        "frame:intrinsic_depth2": {
          visible: false,
        },
        "frame:intrinsic_color2": {
          visible: false,
        },
        "frame:intrinsic_color": {
          visible: false,
        },
        "frame:ultrasonic1": {
          visible: false,
        },
        "frame:ultrasonic5": {
          visible: false,
        },
        "frame:rgb_n_ft": {
          visible: false,
        },
        "frame:ultrasonic3": {
          visible: false,
        },
        "frame:ultrasonic2": {
          visible: false,
        },
        "frame:ultrasonic0": {
          visible: false,
        },
        "frame:camera_frame": {
          visible: false,
        },
        "frame:camera_link7": {
          visible: false,
        },
        "frame:rgb_m_ft": {
          visible: false,
        },
        "frame:base_ground_lamp": {
          visible: false,
        },
        "frame:ultrasonic4": {
          visible: false,
        },
        "frame:top_camera_link": {
          visible: false,
        },
        "frame:use_camera_link": {
          visible: false,
        },
      },
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
          visible: false,
        },
        "/camera1_record/depth/image_raw": {
          visible: true,
          cameraInfoTopic: "/camera1_record/depth/camera_info",
        },
        "/camera2_record/depth/image_raw": {
          visible: true,
          cameraInfoTopic: "/camera2_record/depth/camera_info",
        },
        "/camera3_record/depth/image_raw": {
          visible: true,
          cameraInfoTopic: "/camera3_record/depth/camera_info",
        },
        "/camera4_record/depth/image_raw": {
          visible: false,
          cameraInfoTopic: "/camera4_record/depth/camera_info",
        },
        "/camera5_record/depth/image_raw": {
          visible: false,
          cameraInfoTopic: "/camera5_record/depth/camera_info",
        },
        "/track_markerarray": {
          visible: false,
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
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#300de5",
        },
        "/dabai/multi_layer_points5": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#ebe00a",
        },
        "/pointcloud1": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#5add1d",
        },
        "/pointcloud2": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#dc22e5",
        },
        "/raw_scan": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#d11551",
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
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 5,
          decayTime: 0,
          pointShape: "circle",
          flatColor: "#ed8c0a",
        },
        "/scan_filtered2": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#000000",
        },
        "/tracked_obstacle_center_points": {
          visible: false,
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
          minColor: "#ffffffff",
          frameLocked: true,
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
          frameLocked: false,
        },
        "/vel_map": {
          visible: true,
        },
        "/virtual_wall": {
          visible: true,
          minColor: "#889a98ff",
          maxColor: "#2af900",
          unknownColor: "#ffffffff",
          invalidColor: "#ffffffff",
          frameLocked: false,
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
          pointSize: 3,
          flatColor: "#51e55b",
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
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 5,
          decayTime: 0,
          flatColor: "#2af900ff",
        },
        "/move_base/global_costmap/footprint": {
          visible: true,
        },
        "/move_base/local_costmap/footprint": {
          visible: true,
          lineWidth: 0.1,
        },
        "/localization/robot_pose": {
          visible: true,
        },
        "/move_base/current_goal": {
          visible: true,
          axisScale: 0.19999999999999996,
          type: "arrow",
          arrowScale: [0.5, 0.05, 0.05],
          color: "#ff190fff",
        },
        "/move_base/KPlannerROS/plan_output": {
          visible: true,
          gradient: ["#19ff0fff", "#19ff0fff"],
          lineWidth: 0.09999999999999992,
        },
        "/move_base/move_base_global_plan": {
          visible: true,
          gradient: ["#ff0000ff", "#ff0000ff"],
          lineWidth: 0.09999999999999992,
        },
        "/move_base/TebLocalPlannerROS/teb_poses": {
          visible: true,
          type: "line",
          gradient: ["#ff0000ff", "#ff0000ff"],
          lineWidth: 0.09999999999999992,
        },
        "/particlecloud": {
          visible: false,
        },
        "/booth_score": {
          visible: false,
        },
        "/planner/object_list": {
          visible: true,
        },
        "/costmap_node/global_costmap/costmap": {
          visible: false,
        },
        "/costmap_node/global_costmap/local_costmap": {
          visible: false,
        },
        "/costmap_node/global_costmap/local_laser_static_map": {
          visible: false,
        },
        "/costmap_node/global_costmap/mapping_map": {
          visible: true,
        },
        "/costmap_node/global_costmap/record_type_map": {
          visible: false,
        },
        "/raw_scan_tracked_ogm": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/costmap_node/clean_footprint_master": {
          visible: true,
        },
        "/v5_follow_pose": {
          visible: true,
        },
        "/costmap_node/global_costmap/semantic_points": {
          visible: true,
        },
        "/camera_info": {
          visible: true,
        },
        "/landmark_poses_list": {
          visible: true,
        },
        "/planner/dyn_object_list": {
          visible: true,
        },
        "/radar_pipeline/fused_obj_list_markers": {
          visible: true,
        },
        "/foreground_points": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/nalei_radar/object_pointcloud": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/nalei_radar/object_pointcloud2": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/nalei_radar/object_pointcloud3": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/nalei_radar/object_pointcloud4": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/scan_2": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "map.png": {
          visible: true,
          colorField: "red",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/block_pcl": {
          visible: true,
        },
        "/schedule_path": {
          visible: true,
        },
      },
      layers: {
        "108784e4-993a-457b-9b7e-4bda09b3d80c": {
          visible: true,
          frameLocked: true,
          label: "Grid",
          instanceId: "108784e4-993a-457b-9b7e-4bda09b3d80c",
          layerId: "foxglove.Grid",
          size: 10,
          divisions: 10,
          lineWidth: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          order: 1,
          color: "#a0a0a4ff",
        },
      },
      publish: {
        type: "point",
        poseTopic: "/move_base_simple/goal",
        pointTopic: "/clicked_point",
        poseEstimateTopic: "/initialpose",
        poseEstimateXDeviation: 0.5,
        poseEstimateYDeviation: 0.5,
        poseEstimateThetaDeviation: 0.26179939,
      },
      followTf: "base_link",
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
      showLegend: false,
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
          value: "/charge_state_fromSTM32.state",
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
      showLegend: true,
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
      splitPercentage: 52.17751124437782,
    },
    direction: "row",
    splitPercentage: 59.87158908507223,
  },
} as const;
