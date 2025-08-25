export type FileCandidate = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;           // ISO string
  kind: "recorded" | "other";
  note?: string;               // 记录故障点时的备注（recorded 才会带）
};

export type UploadConfig = {
  projectId: string | null;
  addTags: boolean;
  tags: string[];
};

export type LogLine = { ts: string; level: "info" | "warn" | "error"; msg: string };

export interface RosService {
  endTestAndCollect(): Promise<{ recorded: FileCandidate[]; others: FileCandidate[] }>;
}

export interface CoSceneClient {
  listProjects(): Promise<{ id: string; name: string }[]>;
  listTags(projectId: string): Promise<string[]>;
  upload(
    files: FileCandidate[],
    cfg: Partial<UploadConfig> & { projectId: string | null },
    onProgress?: (p: number) => void
  ): Promise<void>;
}