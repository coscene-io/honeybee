import { delay } from "../utils/format";
import type { CoSceneClient, FileCandidate, UploadConfig } from "../types";

/** Mock 版本：项目/标签查询 + 模拟上传进度 */
export class MockCoSceneClient implements CoSceneClient {
  async listProjects(): Promise<{ id: string; name: string }[]> {
    await delay(100);
    return [
      { id: "proj-1", name: "Warehouse Nav Benchmark" },
      { id: "proj-2", name: "CleaningBot Field Test" },
      { id: "proj-3", name: "Demo – Shenzhen" }
    ];
  }

  async listTags(projectId: string): Promise<string[]> {
    await delay(80);
    const map: Record<string, string[]> = {
      "proj-1": ["slam", "localization", "regression", "night-run"],
      "proj-2": ["navigation", "failpoint", "sensor", "charging"],
      "proj-3": ["demo", "warehouse", "dc-fast", "qa"]
    };
    return map[projectId] || [];
  }

  async upload(
    _files: FileCandidate[],
    _cfg: Partial<UploadConfig> & { projectId: string | null },
    onProgress?: (p: number) => void
  ): Promise<void> {
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      await delay(80);
      onProgress?.(Math.round((i / steps) * 100));
    }
  }
}

/**
 * HTTP版本：连接到模拟服务器进行文件上传
 */
export class RealCoSceneClient implements CoSceneClient {
  private baseUrl: string;
  
  constructor(private opts?: { baseUrl?: string; token?: string }) {
    this.baseUrl = opts?.baseUrl || 'http://localhost:3001';
  }

  async listProjects(): Promise<{ id: string; name: string }[]> {
    // 使用Mock数据，因为模拟服务器主要关注文件上传
    await delay(100);
    return [
      { id: "proj-1", name: "Warehouse Nav Benchmark" },
      { id: "proj-2", name: "CleaningBot Field Test" },
      { id: "proj-3", name: "Demo – Shenzhen" }
    ];
  }

  async listTags(projectId: string): Promise<string[]> {
    // 使用Mock数据，因为模拟服务器主要关注文件上传
    await delay(80);
    const map: Record<string, string[]> = {
      "proj-1": ["slam", "localization", "regression", "night-run"],
      "proj-2": ["navigation", "failpoint", "sensor", "charging"],
      "proj-3": ["demo", "warehouse", "dc-fast", "qa"]
    };
    return map[projectId] || [];
  }

  async upload(
    files: FileCandidate[],
    cfg: Partial<UploadConfig> & { projectId: string | null },
    onProgress?: (p: number) => void
  ): Promise<void> {
    try {
      const formData = new FormData();
      
      // 添加配置信息
      formData.append('config', JSON.stringify({
        projectId: cfg.projectId,
        addTags: cfg.addTags,
        tags: cfg.tags || []
      }));
      
      // 添加文件信息（模拟文件数据）
      files.forEach((file, index) => {
        const blob = new Blob([`模拟文件内容: ${file.name}`], { type: 'application/octet-stream' });
        formData.append(`files`, blob, file.name);
        formData.append(`fileInfo_${index}`, JSON.stringify(file));
      });
      
      const response = await fetch(`${this.baseUrl}/upload_files`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '上传失败');
      }
      
      // 模拟上传进度
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        await delay(80);
        onProgress?.(Math.round((i / steps) * 100));
      }
      
    } catch (error) {
      console.error('文件上传失败:', error);
      throw new Error(`上传失败: ${error instanceof Error ? error.message : error}`);
    }
  }
}