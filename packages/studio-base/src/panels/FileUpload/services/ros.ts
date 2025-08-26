// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { FileCandidate, RosService, GetBagListReq, GetBagListRsp, SubmitFilesReq, CommonRsp } from "../types";
import { delay } from "../utils/format";

/** Mock 版本：专门用于文件收集和上传 */
export class MockRosService implements RosService {
  async endTestAndCollect(): Promise<{ recorded: FileCandidate[]; others: FileCandidate[] }> {
    await delay(200);
    const now = Date.now();

    const recorded = Array.from({ length: 10 }).map((_, i) => ({
      id: `rec-${i}`,
      name: `recorded_${i}.mcap`,
      sizeBytes: 20_000_000 + i * 1_000_000,
      createdAt: new Date(now - (i + 1) * 60_000).toISOString(),
      kind: "recorded" as const,
      note: `故障点 ${i + 1}`,
    }));

    const others = Array.from({ length: 5 }).map((_, i) => ({
      id: `oth-${i}`,
      name: `full_${i}.mcap`,
      sizeBytes: 120_000_000 + i * 20_000_000,
      createdAt: new Date(now - (i + 5) * 90_000).toISOString(),
      kind: "other" as const,
    }));

    return { recorded, others };
  }

  async getBagList(req: GetBagListReq): Promise<GetBagListRsp> {
    await delay(100);
    // 模拟返回一些bag文件
    const mockBags = [
      { mode: "imd", action_name: "navigation", path: "/ros/bags/nav_001.bag" },
      { mode: "signal", action_name: "emergency_stop", path: "/ros/bags/emergency_001.bag" },
      { mode: "imd", action_name: "mapping", path: "/ros/bags/map_001.bag" },
    ];
    
    // 根据请求过滤
    let filteredBags = mockBags;
    if (req.mode) {
      filteredBags = filteredBags.filter(bag => bag.mode === req.mode);
    }
    if (req.action_name) {
      filteredBags = filteredBags.filter(bag => bag.action_name === req.action_name);
    }
    
    return {
      code: 0,
      msg: "success",
      bags: filteredBags
    };
  }

  async submitFiles(req: SubmitFilesReq): Promise<CommonRsp> {
    await delay(200);
    console.log("MockRosService: 提交文件", req.paths);
    return {
      code: 0,
      msg: "文件提交成功"
    };
  }
}

/** HTTP版本：连接到模拟ROS服务器 */
export class RealRosService implements RosService {
  private baseUrl: string;
  
  constructor(opts?: { baseUrl?: string }) {
    this.baseUrl = opts?.baseUrl || 'http://localhost:3001';
  }
  
  async endTestAndCollect(): Promise<{ recorded: FileCandidate[]; others: FileCandidate[] }> {
    try {
      const response = await fetch(`${this.baseUrl}/end_test_and_get_files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '服务器返回错误');
      }
      
      return result.data;
    } catch (error) {
      console.error('调用 endTestAndCollect 失败:', error);
      throw new Error(`连接ROS服务失败: ${error instanceof Error ? error.message : error}`);
    }
  }

  async getBagList(req: GetBagListReq): Promise<GetBagListRsp> {
    try {
      const response = await fetch(`${this.baseUrl}/get_bag_list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('调用 getBagList 失败:', error);
      return {
        code: -1,
        msg: `连接ROS服务失败: ${error instanceof Error ? error.message : error}`,
        bags: []
      };
    }
  }

  async submitFiles(req: SubmitFilesReq): Promise<CommonRsp> {
    try {
      const response = await fetch(`${this.baseUrl}/submit_files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('调用 submitFiles 失败:', error);
      return {
        code: -1,
        msg: `连接ROS服务失败: ${error instanceof Error ? error.message : error}`
      };
    }
  }
}