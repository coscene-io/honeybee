// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { RosService } from "../types";

const delay = async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms));

/** Mock 版本：专门用于故障点记录 */
export class MockRosService implements RosService {
  async markFaultPoint(note?: string): Promise<void> {
    await delay(100);
    // 这里可以添加实际的ROS服务调用逻辑
    console.log(`故障点已记录: ${note || '无备注'}`);
  }

  async callService(serviceName: string, params: any): Promise<void> {
    await delay(100);
    // 这里可以添加实际的ROS服务调用逻辑
    console.log(`调用服务 ${serviceName}:`, params);
  }
}

/** CoStudio版本：使用CoStudio的context.callService API */
export class RealRosService implements RosService {
  private context: any;
  
  constructor(context: any) {
    this.context = context;
  }

  async markFaultPoint(note?: string): Promise<void> {
    await this.callService('/mark_fault', { data: true, note: note || '' });
  }

  async callService(serviceName: string, params: any): Promise<any> {
    try {
      // 验证context和callService方法是否可用
      if (!this.context?.callService) {
        throw new Error('CoStudio服务调用功能不可用，请确保在CoStudio环境中运行');
      }

      console.log(`调用服务 ${serviceName}:`, params);
      
      // 使用CoStudio的callService API，参考DataCollection面板的实现
      const response = await this.context.callService(serviceName, params);
      
      console.log(`调用服务 ${serviceName} 成功:`, response);
      
      // 对于std_srvs/srv/SetBool类型的服务，检查success字段
      if (response && typeof response === 'object') {
        if ('success' in response && !response.success) {
          throw new Error(response.message || '服务调用失败');
        }
      }
      
      return response;
    } catch (error) {
      console.error(`调用服务 ${serviceName} 失败:`, error);
      // 保持原有的错误信息格式，便于用户理解
      throw new Error(`ROS服务调用失败: ${error instanceof Error ? error.message : error}`);
    }
  }
}