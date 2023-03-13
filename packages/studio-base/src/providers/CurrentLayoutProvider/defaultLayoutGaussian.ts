// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";

/**
 * This is loaded when the user has no layout selected on application launch
 * to avoid presenting the user with a blank layout.
 */
export const gs50Layout: LayoutData = {
  configById: {
    "3D!3me9aqv": {
      cameraState: {
        distance: 22.16066481994401,
        perspective: true,
        phi: 0.47583854832627764,
        target: [0, 0, 0],
        targetOffset: [5.047111950773007, -0.44475575331862194, 6.01960032509308e-18],
        targetOrientation: [0, 0, 0, 1],
        thetaOffset: 52.54218760354421,
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-position",
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
          visible: false,
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
        "frame:camera_depth_frame": {
          visible: false,
        },
        "frame:webcam_link": {
          visible: false,
        },
        "frame:synthetic_laser_0": {
          visible: false,
        },
        "frame:intrinsic_depth4": {
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
        "frame:/world": {
          visible: false,
        },
        "frame:rgb_m_bt": {
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
          visible: true,
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
          visible: true,
          cameraInfoTopic: "/camera4_record/depth/camera_info",
        },
        "/camera5_record/depth/image_raw": {
          visible: true,
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
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#10f000",
          pointSize: 5,
        },
        "/dabai/multi_layer_points4": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#ff0000",
          pointSize: 5,
        },
        "/dabai/multi_layer_points5": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 1,
        },
        "/pointcloud1": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#ffff00",
          pointSize: 5,
        },
        "/pointcloud2": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#5555ffff",
          pointSize: 5,
        },
        "/raw_scan": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#d11551",
          pointSize: 5,
        },
        "/raw_scan_tracked": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
          pointSize: 2,
        },
        "/scan": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 5,
          decayTime: 0,
          pointShape: "circle",
          flatColor: "#eba709",
        },
        "/scan_filtered2": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#eba709ff",
          pointSize: 3,
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
          visible: false,
          minColor: "#b8dd9e",
          maxColor: "#82d172",
          unknownColor: "#57e552",
          invalidColor: "#39cf38",
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
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#c51c1c",
          pointSize: 6,
          decayTime: 0,
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
          gradient: ["#44e543", "#41e15480"],
        },
        "/move_base/TebLocalPlannerROS/teb_poses": {
          visible: true,
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
          visible: true,
          colorMode: "custom",
        },
        "/costmap_node/global_costmap/local_costmap": {
          visible: true,
          minColor: "#0c20dd",
          maxColor: "#d90e0e",
          colorMode: "costmap",
          alpha: 1,
          frameLocked: false,
        },
        "/costmap_node/global_costmap/local_laser_static_map": {
          visible: true,
          colorMode: "custom",
        },
        "/costmap_node/global_costmap/mapping_map": {
          visible: true,
          colorMode: "custom",
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
          color: "#1aff00",
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
          visible: false,
        },
        "/planner/dyn_object_list": {
          visible: false,
        },
        "/radar_pipeline/fused_obj_list_markers": {
          visible: false,
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
          colorMode: "flat",
          colorMap: "turbo",
          pointShape: "square",
        },
        "/nalei_radar/object_pointcloud2": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointShape: "square",
        },
        "/nalei_radar/object_pointcloud3": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointShape: "square",
        },
        "/nalei_radar/object_pointcloud4": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#ffff00ff",
        },
        "/scan_2": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 3,
          flatColor: "#eba709ff",
        },
        "map.png": {
          visible: true,
          colorField: "red",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/block_pcl": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/schedule_path": {
          visible: true,
        },
        "/predict_human_path": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 5,
          flatColor: "#ffff7fff",
        },
        "/sick_scan_tracked_obstacle_points": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
          pointSize: 2,
        },
        "/scan_2_fltr": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/scan_2_filtered": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/synthetic_scan_0": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan_tracked_obstacle_points": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan_2_filtered": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan_2": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/move_base/planner_origin_path": {
          visible: true,
          type: "line",
          gradient: ["#00FF00ff", "#00FF00ff"],
        },
        "/unicycle_planner/dij_path": {
          visible: true,
          gradient: ["#550fffff", "#550fffff"],
        },
        "/unicycle_planner/output_path": {
          visible: true,
          gradient: ["#aa07ffff", "#aa07ffff"],
        },
        "/eco_control/dwa_concontroller/dwa_plan": {
          visible: true,
          gradient: ["#0fffffff", "#0fffffff"],
        },
        "/coverage/current_path": {
          visible: true,
        },
        "/coverage/output_path": {
          visible: true,
          gradient: ["#ffff00ff", "#ffff00ff"],
        },
        "/pointcloud3": {
          visible: true,
          pointSize: 5,
          flatColor: "#00FF00ff",
          colorField: "rgba",
          colorMode: "rgba",
          colorMap: "turbo",
        },
        "/pointcloud4": {
          visible: true,
          pointSize: 3,
          flatColor: "#FF0000ff",
          colorField: "rgba",
          colorMode: "rgba",
          colorMap: "turbo",
        },
        "/pointcloud6": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/move_base/goal_base/a_goal": {
          visible: true,
          type: "arrow",
          color: "#00FF00ff",
        },
        "/map.png": {
          visible: true,
          colorField: "blue",
          colorMode: "rgba-fields",
          colorMap: "turbo",
          gradient: ["#0011ffff", "#ffffffff"],
          minValue: -20,
          maxValue: 1,
        },
        "/pointcloud7": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/coScene-example_map.png": {
          visible: true,
        },
        "/kitti/camera_color_left/camera_info": {
          visible: true,
        },
        "/kitti/camera_color_left/image_raw": {
          visible: true,
        },
        "/kitti/camera_color_right/camera_info": {
          visible: true,
        },
        "/kitti/camera_color_right/image_raw": {
          visible: true,
        },
        "/kitti/camera_gray_left/camera_info": {
          visible: true,
        },
        "/kitti/camera_gray_left/image_raw": {
          visible: true,
        },
        "/kitti/camera_gray_right/camera_info": {
          visible: true,
        },
        "/kitti/camera_gray_right/image_raw": {
          visible: true,
        },
        "/kitti/velo/pointcloud": {
          visible: true,
        },
        "/CAM_FRONT_RIGHT/image_rect_compressed": {
          visible: true,
        },
        "/markers/annotations": {
          visible: true,
        },
        "/semantic_map": {
          visible: true,
        },
        "/drivable_area": {
          visible: true,
        },
        "/LIDAR_TOP": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_BACK_LEFT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_BACK_RIGHT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_FRONT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_FRONT_LEFT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_FRONT_RIGHT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/pose": {
          visible: true,
        },
        "/1.png": {
          visible: false,
        },
        "/map_1.png": {
          visible: true,
        },
        "/map_10.png": {
          visible: false,
        },
        "/map_2.png": {
          visible: true,
          colorMode: "rgba-fields",
          colorMap: "turbo",
        },
        "/map_3.png": {
          visible: false,
          colorMode: "rgba-fields",
          colorMap: "turbo",
        },
        "/map_4.png": {
          visible: false,
        },
        "/map_5.png": {
          visible: false,
        },
        "/map_6.png": {
          visible: false,
        },
        "/map_7.png": {
          visible: false,
        },
        "/map_8.png": {
          visible: false,
        },
        "/map_9.png": {
          visible: false,
        },
      },
      layers: {
        "108784e4-993a-457b-9b7e-4bda09b3d80c": {
          visible: true,
          frameLocked: true,
          label: "Grid",
          instanceId: "108784e4-993a-457b-9b7e-4bda09b3d80c",
          layerId: "foxglove.Grid",
          size: 100,
          divisions: 200,
          lineWidth: 1,
          color: "#a0a0a4ff",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          order: 1,
          frameId: "base_odom",
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
      paths: [
        {
          value: "/cmd_vel.linear.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/cmd_vel.linear.y",
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
      foxglovePanelTitle: "CMD 下发速度",
    },
    "Plot!1o1y0sh": {
      paths: [
        {
          value: "/unbiased_imu_PRY.vector.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/unbiased_imu_PRY.vector.y",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/unbiased_imu_PRY.vector.z",
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
      foxglovePanelTitle: "IMU 陀螺仪数值",
    },
    "Plot!v4o8q1": {
      paths: [
        {
          value: "/odom.twist.twist.linear.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/odom.twist.twist.linear.y",
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
      foxglovePanelTitle: "odom 实际速度",
    },
    "RosOut!mt4hkx": {
      searchTerms: [],
      minLogLevel: 1,
      topicToRender: "/rosout",
    },
    "RawMessages!2pph0z6": {
      diffEnabled: false,
      diffMethod: "custom",
      diffTopicPath: "",
      showFullMessageForDiff: false,
      topicPath: "/device/all_device_status",
      expansion: "all",
    },
  },
  globalVariables: {},
  userNodes: {},
  playbackConfig: {
    speed: 3,
  },
  layout: {
    direction: "row",
    first: "3D!3me9aqv",
    second: {
      direction: "row",
      first: {
        first: {
          first: "Plot!t0ra0d",
          second: "Plot!1o1y0sh",
          direction: "column",
          splitPercentage: 49.013069640872324,
        },
        second: "Plot!v4o8q1",
        direction: "column",
        splitPercentage: 64.1726618705036,
      },
      second: {
        first: "RosOut!mt4hkx",
        second: "RawMessages!2pph0z6",
        direction: "column",
      },
      splitPercentage: 50.80789975449156,
    },
    splitPercentage: 57.921149320114516,
  },
} as const;

/**
 * This is loaded when the user has no layout selected on application launch
 * to avoid presenting the user with a blank layout.
 */
export const gs75Layout: LayoutData = {
  configById: {
    "3D!3me9aqv": {
      cameraState: {
        distance: 22.16066481994401,
        perspective: true,
        phi: 0.47583854832627764,
        target: [0, 0, 0],
        targetOffset: [5.047111950773007, -0.44475575331862194, 6.01960032509308e-18],
        targetOrientation: [0, 0, 0, 1],
        thetaOffset: 52.54218760354421,
        fovy: 45,
        near: 0.5,
        far: 5000,
      },
      followMode: "follow-position",
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
          visible: false,
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
        "frame:camera_depth_frame": {
          visible: false,
        },
        "frame:webcam_link": {
          visible: false,
        },
        "frame:synthetic_laser_0": {
          visible: false,
        },
        "frame:intrinsic_depth4": {
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
        "frame:/world": {
          visible: false,
        },
        "frame:rgb_m_bt": {
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
          visible: true,
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
          visible: true,
          cameraInfoTopic: "/camera4_record/depth/camera_info",
        },
        "/camera5_record/depth/image_raw": {
          visible: true,
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
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#10f000",
          pointSize: 5,
        },
        "/dabai/multi_layer_points4": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#ff0000",
          pointSize: 5,
        },
        "/dabai/multi_layer_points5": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 1,
        },
        "/pointcloud1": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#ffff00",
          pointSize: 5,
        },
        "/pointcloud2": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#5555ffff",
          pointSize: 5,
        },
        "/raw_scan": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#d11551",
          pointSize: 5,
        },
        "/raw_scan_tracked": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
          pointSize: 2,
        },
        "/scan": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 5,
          decayTime: 0,
          pointShape: "circle",
          flatColor: "#eba709",
        },
        "/scan_filtered2": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#eba709ff",
          pointSize: 3,
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
          visible: false,
          minColor: "#b8dd9e",
          maxColor: "#82d172",
          unknownColor: "#57e552",
          invalidColor: "#39cf38",
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
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#c51c1c",
          pointSize: 6,
          decayTime: 0,
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
          gradient: ["#44e543", "#41e15480"],
        },
        "/move_base/TebLocalPlannerROS/teb_poses": {
          visible: true,
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
          visible: true,
          colorMode: "custom",
        },
        "/costmap_node/global_costmap/local_costmap": {
          visible: true,
          minColor: "#0c20dd",
          maxColor: "#d90e0e",
          colorMode: "costmap",
          alpha: 1,
          frameLocked: false,
        },
        "/costmap_node/global_costmap/local_laser_static_map": {
          visible: true,
          colorMode: "custom",
        },
        "/costmap_node/global_costmap/mapping_map": {
          visible: true,
          colorMode: "custom",
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
          color: "#1aff00",
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
          visible: false,
        },
        "/planner/dyn_object_list": {
          visible: false,
        },
        "/radar_pipeline/fused_obj_list_markers": {
          visible: false,
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
          colorMode: "flat",
          colorMap: "turbo",
          pointShape: "square",
        },
        "/nalei_radar/object_pointcloud2": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointShape: "square",
        },
        "/nalei_radar/object_pointcloud3": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointShape: "square",
        },
        "/nalei_radar/object_pointcloud4": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          flatColor: "#ffff00ff",
        },
        "/scan_2": {
          visible: true,
          colorField: "intensity",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 3,
          flatColor: "#eba709ff",
        },
        "map.png": {
          visible: true,
          colorField: "red",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/block_pcl": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/schedule_path": {
          visible: true,
        },
        "/predict_human_path": {
          visible: true,
          colorField: "x",
          colorMode: "flat",
          colorMap: "turbo",
          pointSize: 5,
          flatColor: "#ffff7fff",
        },
        "/sick_scan_tracked_obstacle_points": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
          pointSize: 2,
        },
        "/scan_2_fltr": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/scan_2_filtered": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/synthetic_scan_0": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan_tracked_obstacle_points": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan_2_filtered": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/raw_scan_2": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/move_base/planner_origin_path": {
          visible: true,
          type: "line",
          gradient: ["#00FF00ff", "#00FF00ff"],
        },
        "/unicycle_planner/dij_path": {
          visible: true,
          gradient: ["#550fffff", "#550fffff"],
        },
        "/unicycle_planner/output_path": {
          visible: true,
          gradient: ["#aa07ffff", "#aa07ffff"],
        },
        "/eco_control/dwa_concontroller/dwa_plan": {
          visible: true,
          gradient: ["#0fffffff", "#0fffffff"],
        },
        "/coverage/current_path": {
          visible: true,
        },
        "/coverage/output_path": {
          visible: true,
          gradient: ["#ffff00ff", "#ffff00ff"],
        },
        "/pointcloud3": {
          visible: true,
          pointSize: 5,
          flatColor: "#00FF00ff",
          colorField: "rgba",
          colorMode: "rgba",
          colorMap: "turbo",
        },
        "/pointcloud4": {
          visible: true,
          pointSize: 3,
          flatColor: "#FF0000ff",
          colorField: "rgba",
          colorMode: "rgba",
          colorMap: "turbo",
        },
        "/pointcloud6": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/move_base/goal_base/a_goal": {
          visible: true,
          type: "arrow",
          color: "#00FF00ff",
        },
        "/map.png": {
          visible: true,
          colorField: "blue",
          colorMode: "rgba-fields",
          colorMap: "turbo",
          gradient: ["#0011ffff", "#ffffffff"],
          minValue: -20,
          maxValue: 1,
        },
        "/pointcloud7": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/coScene-example_map.png": {
          visible: true,
        },
        "/kitti/camera_color_left/camera_info": {
          visible: true,
        },
        "/kitti/camera_color_left/image_raw": {
          visible: true,
        },
        "/kitti/camera_color_right/camera_info": {
          visible: true,
        },
        "/kitti/camera_color_right/image_raw": {
          visible: true,
        },
        "/kitti/camera_gray_left/camera_info": {
          visible: true,
        },
        "/kitti/camera_gray_left/image_raw": {
          visible: true,
        },
        "/kitti/camera_gray_right/camera_info": {
          visible: true,
        },
        "/kitti/camera_gray_right/image_raw": {
          visible: true,
        },
        "/kitti/velo/pointcloud": {
          visible: true,
        },
        "/CAM_FRONT_RIGHT/image_rect_compressed": {
          visible: true,
        },
        "/markers/annotations": {
          visible: true,
        },
        "/semantic_map": {
          visible: true,
        },
        "/drivable_area": {
          visible: true,
        },
        "/LIDAR_TOP": {
          visible: true,
          colorField: "intensity",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_BACK_LEFT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_BACK_RIGHT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_FRONT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_FRONT_LEFT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/RADAR_FRONT_RIGHT": {
          visible: true,
          colorField: "x",
          colorMode: "colormap",
          colorMap: "turbo",
        },
        "/pose": {
          visible: true,
        },
        "/1.png": {
          visible: false,
        },
        "/map_1.png": {
          visible: true,
        },
        "/map_10.png": {
          visible: false,
        },
        "/map_2.png": {
          visible: true,
          colorMode: "rgba-fields",
          colorMap: "turbo",
        },
        "/map_3.png": {
          visible: false,
          colorMode: "rgba-fields",
          colorMap: "turbo",
        },
        "/map_4.png": {
          visible: false,
        },
        "/map_5.png": {
          visible: false,
        },
        "/map_6.png": {
          visible: false,
        },
        "/map_7.png": {
          visible: false,
        },
        "/map_8.png": {
          visible: false,
        },
        "/map_9.png": {
          visible: false,
        },
      },
      layers: {
        "108784e4-993a-457b-9b7e-4bda09b3d80c": {
          visible: true,
          frameLocked: true,
          label: "Grid",
          instanceId: "108784e4-993a-457b-9b7e-4bda09b3d80c",
          layerId: "foxglove.Grid",
          size: 100,
          divisions: 200,
          lineWidth: 1,
          color: "#a0a0a4ff",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          order: 1,
          frameId: "base_odom",
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
      paths: [
        {
          value: "/cmd_vel.linear.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/cmd_vel.linear.y",
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
      foxglovePanelTitle: "CMD 下发速度",
    },
    "Plot!1o1y0sh": {
      paths: [
        {
          value: "/unbiased_imu_PRY.vector.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/unbiased_imu_PRY.vector.y",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/unbiased_imu_PRY.vector.z",
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
      foxglovePanelTitle: "IMU 陀螺仪数值",
    },
    "Plot!v4o8q1": {
      paths: [
        {
          value: "/odom.twist.twist.linear.x",
          enabled: true,
          timestampMethod: "receiveTime",
        },
        {
          value: "/odom.twist.twist.linear.y",
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
      foxglovePanelTitle: "odom 实际速度",
    },
    "RosOut!mt4hkx": {
      searchTerms: [],
      minLogLevel: 1,
      topicToRender: "/rosout",
    },
    "RawMessages!2pph0z6": {
      diffEnabled: false,
      diffMethod: "custom",
      diffTopicPath: "",
      showFullMessageForDiff: false,
      topicPath: "/device/all_device_status",
      expansion: "all",
    },
  },
  globalVariables: {},
  userNodes: {},
  playbackConfig: {
    speed: 3,
  },
  layout: {
    direction: "row",
    first: "3D!3me9aqv",
    second: {
      direction: "row",
      first: {
        first: {
          first: "Plot!t0ra0d",
          second: "Plot!1o1y0sh",
          direction: "column",
          splitPercentage: 49.013069640872324,
        },
        second: "Plot!v4o8q1",
        direction: "column",
        splitPercentage: 64.1726618705036,
      },
      second: {
        first: "RosOut!mt4hkx",
        second: "RawMessages!2pph0z6",
        direction: "column",
      },
      splitPercentage: 50.80789975449156,
    },
    splitPercentage: 57.921149320114516,
  },
} as const;
