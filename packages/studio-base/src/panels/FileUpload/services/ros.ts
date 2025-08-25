import { delay } from "../utils/format";
import type { FileCandidate, RosService } from "../types";

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
}

/** HTTP版本：连接到模拟ROS服务器 */
export class RealRosService implements RosService {
  private baseUrl: string;
  
  constructor(private opts?: { baseUrl?: string }) {
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
}