---
sidebar_position: 1
title: 数采面板接口说明
---

# 数采面板接口技术文档

本说明文档用于前端与后端在数采面板接入中的接口对接，包含录制控制、文件管理、动作管理与上传校验等能力。

---

## 1. 功能概述

数采面板接口用于统一管理机器人数据录制与上传流程，主要提供以下功能：

- **触发录制**（指定动作类型、录制前后时间窗口）
- **停止录制**
- **查询录制文件列表**
- **获取已配置的录制动作列表**
- **获取上传可行性状态**

接口基于 **ROS2 服务定义**（`.srv` + `.msg`），前端调用时只需封装请求参数并解析返回结果。

---

## 2. 服务接口定义

### 2.1 开始录制（StartRecord.srv）

```srv
string action_name
uint32 preparation_duration_s
uint32 record_duration_s
---
uint32 code
string msg
```

#### 参数说明

- **action_name**

  - 描述：触发录制的数据列表名称
  - 示例：`default_action`
  - 当前可选值：`default_action`, `interaction_action`, `perception_action`
  - 后续可扩展到十几种，需支持动态新增。

- **preparation_duration_s**

  - 描述：录制触发前多少秒的数据
  - 示例：`30`
  - 需支持前端配置

- **record_duration_s**

  - 描述：录制触发后多少秒的数据
  - 示例：`30`
  - 需支持前端配置

#### 返回结果

- **code**：状态码（0 成功，非 0 失败）
- **msg**：提示信息

---

### 2.2 停止录制（StopRecord.srv）

```srv
string action_name
---
uint32 code
string msg
```

#### 参数说明

- **action_name**：对应开始录制时的 action 名称

#### 返回结果

- **code**：状态码
- **msg**：提示信息

---

### 2.3 获取文件列表（GetBagList.srv）

```srv
string mode
string action_name
---
uint32 code
string msg
BagInfo[] bags
```

#### BagInfo.msg

```msg
string mode
string action_name
string path
string type
```

#### 参数说明

- **mode**

  - `imd`：持续录制
  - `signal`：触发录制
  - 不传时，返回所有模式数据

- **action_name**

  - 示例：`default_action`, `interaction_action`, `perception_action`
  - 不传时，返回所有 action 数据

- **path**

  - `imd` 示例：

    ```
    /agibot/data/bag/imd/aimrtbag_20250624_031249/aimrtbag_20250624_031249.mcap
    ```

  - `signal` 示例：

    ```
    /agibot/data/bag/signal/interaction_action/aimrtbag_20250624_064055
    ```

  - 区别说明：

    - imd：路径为单个 mcap 文件，需拉取该 mcap 和同级目录下的 `metadata.yaml`
    - signal：路径为文件夹，拉取目录下所有文件（包含 mcap 和 metadata.yaml）

- **type**

  - `file`：imd 模式
  - `folder`：signal 模式

---

### 2.4 获取 action 列表（GetActionList.srv）

```srv
string mode
---
uint32 code
string msg
ActionInfo[] actions
```

#### ActionInfo.msg

```msg
string mode
string action_name
string method
uint32 preparation_duration_s
uint32 record_duration_s
uint32 max_record_duration_s
string[] topics
bool is_enable
bool is_auto_upload
```

#### 参数说明

- **mode**：录制模式（imd / signal）
- **action_name**：动作名称（如 `default_action`）
- **method**：触发方式说明
- **preparation_duration_s**：录制触发前的时间（默认30s，仅新增时前端初始化使用）
- **record_duration_s**：录制触发后的时间（默认30s，仅新增时前端初始化使用）
- **max_record_duration_s**：最大允许录制时长（避免过长导致存储占满）
- **topics**：该 action 录制的 topic 列表，支持多种中间件，例如：

  ```
  iceoryx:/body_drive/leg_temp_state
  mqtt:/ota/heartbeat
  mqtt:/ota/schedule
  mqtt:/ota/result
  ros2:/arm_joint_servo/joint_command
  ros2:/motion/control/locomotion_velocity
  ```

- **is_enable**：布尔值，是否启用（false 时前端不显示）
- **is_auto_upload**：布尔值，是否录制完成后自动上传

---

### 2.5 获取上传状态（GetUploadAllowed.srv）

```srv
---
bool upload_allowed
string msg
```

#### 参数说明

- **upload_allowed**：是否允许上传数据（true/false）
- **msg**：不可上传时的提示原因，例如：

  - “交互时不可拉取”
  - “不在 WiFi 环境下不可拉取”

---

## 3. 前端接入要点

1. **动作管理**

   - 前端需支持动态加载 action 列表（通过 `GetActionList` 接口）。
   - 新增 action 时，初始化参数需使用接口返回的默认值。

2. **录制控制**

   - 调用 `StartRecord` 需传入 action 名称和时间参数。
   - `StopRecord` 需保证 action_name 一致。

3. **文件管理**

   - 调用 `GetBagList` 获取文件路径与类型。
   - 注意区分 imd（单文件）与 signal（文件夹）。

4. **上传校验**

   - 上传前调用 `GetUploadAllowed`，若为 false 需提示用户原因。

---
