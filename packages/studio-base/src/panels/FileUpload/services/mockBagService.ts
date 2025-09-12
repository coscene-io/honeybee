// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { GetBagListReq, GetBagListRsp, SubmitFilesReq, CommonRsp, BagFile } from "../types";

// Mock数据
const mockBagFiles: BagFile[] = [
  {
    mode: "imd",
    action_name: "",
    path: "/agibot/data/bag/imd/aimrtbag_20250624_031249"
  },
  {
    mode: "signal",
    action_name: "default_action",
    path: "/agibot/data/bag/signal/default_action/aimrtbag_20250825_101010"
  },
  {
    mode: "signal",
    action_name: "interaction_action",
    path: "/agibot/data/bag/signal/interaction_action/aimrtbag_20250826_143022"
  },
  {
    mode: "imd",
    action_name: "",
    path: "/agibot/data/bag/imd/aimrtbag_20250627_094512"
  },
  {
    mode: "signal",
    action_name: "test_action",
    path: "/agibot/data/bag/signal/test_action/aimrtbag_20250828_165533"
  }
];

export class MockBagService {
  async getBagList(req: GetBagListReq): Promise<GetBagListRsp> {
    console.log("[MockBagService] getBagList called with:", req);
    
    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 500));
    
    let filteredBags = mockBagFiles;
    
    // 根据mode过滤
    if (req.mode && req.mode !== "") {
      filteredBags = filteredBags.filter(bag => bag.mode === req.mode);
    }
    
    // 根据action_name过滤
    if (req.action_name && req.action_name !== "") {
      filteredBags = filteredBags.filter(bag => bag.action_name === req.action_name);
    }
    
    const response: GetBagListRsp = {
      code: 0,
      msg: "ok",
      bags: filteredBags
    };
    
    console.log("[MockBagService] getBagList response:", response);
    return response;
  }
  
  async submitFiles(req: SubmitFilesReq): Promise<CommonRsp> {
    console.log("[MockBagService] submitFiles called with:", req);
    
    // 模拟网络延迟
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const response: CommonRsp = {
      code: 0,
      msg: "Files submitted successfully"
    };
    
    console.log("[MockBagService] submitFiles response:", response);
    return response;
  }
  
  // 获取所有唯一的action_name列表（用于下拉框选项）
  getUniqueActionNames(): string[] {
    const actionNames = new Set<string>();
    mockBagFiles.forEach(bag => {
      if (bag.action_name && bag.action_name !== "") {
        actionNames.add(bag.action_name);
      }
    });
    return Array.from(actionNames).sort();
  }
}