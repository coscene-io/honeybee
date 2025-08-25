import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { PanelExtensionContext } from "@foxglove/studio";

import { Button } from "./ui";
import { FileTable } from "./FileTable";
import { ProjectAndTagPicker } from "./ProjectAndTagPicker";
import type { CoSceneClient, FileCandidate, LogLine, RosService, UploadConfig } from "../types";
import type { Config } from "../config/types";
import { RealCoSceneClient } from "../services/coscene";
import { RealRosService } from "../services/ros";

interface FileUploadPanelProps {
  context: PanelExtensionContext;
  ros?: RosService;
  cos?: CoSceneClient;
  onConfigClick?: () => void;
}

export function FileUploadPanel({ context, ros, cos, onConfigClick }: FileUploadPanelProps) {
  const rosRef = useRef<RosService>(ros ?? new RealRosService());
  const cosRef = useRef<CoSceneClient>(cos ?? new RealCoSceneClient());
  
  const [config, setConfig] = useState<Config>({
    rosServiceUrl: "http://localhost:3001",
    coSceneApiUrl: "http://localhost:3002",
  });
  const [phase, setPhase] = useState<"idle" | "listing" | "selecting" | "uploading" | "done">("idle");
  const [recorded, setRecorded] = useState<FileCandidate[]>([]);
  const [others, setOthers] = useState<FileCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cfg, setCfg] = useState<UploadConfig>({ projectId: null, addTags: false, tags: [] });
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);

  // 监听配置变化
  useEffect(() => {
    const updateConfig = () => {
      const panelConfig = context.initialState as Config;
      if (panelConfig) {
        setConfig(panelConfig);
      }
    };
    
    updateConfig();
    context.onRender = updateConfig;
    
    return () => {
      context.onRender = undefined;
    };
  }, [context]);

  const log = useCallback((level: LogLine["level"], msg: string) => {
    setLogs((xs) => [...xs, { ts: new Date().toLocaleTimeString(), level, msg }]);
  }, []);

  const scenario = useMemo(() => (recorded.length > 0 ? 2 : 1), [recorded.length]);
  const selectedFiles = useMemo(() => {
    return [...recorded, ...others].filter((f) => selected.has(f.id));
  }, [recorded, others, selected]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const onEndTest = useCallback(async () => {
    try {
      setPhase("listing");
      setSelected(new Set()); // 清空之前的选择状态
      log("info", "调用后端：结束测试并收集候选文件…");
      
      const result = await rosRef.current.endTestAndCollect();
      
      setRecorded(result.recorded);
      setOthers(result.others);
      setPhase("selecting");
      
      log(
        "info",
        `候选文件：recorded=${result.recorded.length}，others=${result.others.length}。` +
          (result.recorded.length > 0 ? "（工作场景2）" : "（工作场景1）")
      );
    } catch (e: any) {
      setPhase("idle");
      log("error", `收集候选文件失败：${e?.message || e}`);
    }
  }, [log]);

  const onUpload = useCallback(async () => {
    if (!cfg.projectId) {
      log("error", "请选择项目");
      return;
    }
    if (selectedFiles.length === 0) {
      log("error", "请选择要上传的文件");
      return;
    }

    try {
      setPhase("uploading");
      setProgress(0);
      
      const selectedTagsInfo = cfg.addTags && cfg.tags.length > 0 
        ? ` 标签：[${cfg.tags.join(', ')}]` 
        : '';
      
      log("info", `开始上传：${selectedFiles.length} 个文件 → 项目 ${cfg.projectId}${selectedTagsInfo}`);
      
      await cosRef.current.upload(selectedFiles, cfg, (p) => setProgress(p));
      
      setPhase("done");
      setProgress(100);
      log("info", "上传完成。");
    } catch (e: any) {
      setPhase("selecting");
      log("error", `上传失败：${e?.message || e}`);
    }
  }, [cfg, selectedFiles, log]);

  const onReset = useCallback(() => {
    setPhase("idle");
    setRecorded([]);
    setOthers([]);
    setSelected(new Set());
    setCfg({ projectId: null, addTags: false, tags: [] });
    setProgress(0);
    setLogs([]);
    log("info", "已重置文件上传面板所有状态");
  }, [log]);

  return (
    <div style={{ 
      padding: 16, 
      fontFamily: 'system-ui, sans-serif',
      height: '100%',
      overflow: 'auto',
      maxHeight: '100vh'
    }}>
      <div style={{ 
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        minWidth: '600px'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 16
        }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>文件选择与上传</div>
          {onConfigClick && (
            <button 
              style={{
                padding: '4px 12px',
                fontSize: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
              onClick={onConfigClick}
            >
              ⚙️ 配置
            </button>
          )}
        </div>



        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
            {config.services[0]?.displayName || "结束测试并获取候选文件"} - 操作
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Button 
              variant="primary" 
              size="large"
              onClick={onEndTest} 
              disabled={phase === "listing" || phase === "uploading"}
            >
              {config.services[0]?.displayName || "结束测试并获取候选文件"}
            </Button>
          </div>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20, marginBottom: 20 }}>
          <Button variant="ghost" size="large" onClick={onReset}>
            {config.services[1]?.displayName || "重置"}
          </Button>
        </div>

        {(phase === "selecting" || phase === "uploading" || phase === "done") && (
          <>
            <div style={{ marginBottom: 16 }}>
              <FileTable 
                title="记录按钮采集的片段（优先上传，场景2）" 
                files={recorded} 
                selectedIds={selected} 
                onToggle={toggle} 
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <FileTable 
                title="其余全量文件" 
                files={others} 
                selectedIds={selected} 
                onToggle={toggle} 
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <ProjectAndTagPicker client={cosRef.current} value={cfg} onChange={setCfg} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Button 
                  variant="primary" 
                  onClick={onUpload} 
                  disabled={phase === "uploading"}
                >
                  开始上传
                </Button>
                {phase === "uploading" && (
                  <div style={{ 
                    flex: 1, 
                    backgroundColor: '#e5e7eb', 
                    borderRadius: 9999, 
                    height: 8 
                  }}>
                    <div 
                      style={{ 
                        backgroundColor: '#3b82f6', 
                        height: 8, 
                        borderRadius: 9999, 
                        transition: 'all 0.3s', 
                        width: `${progress}%` 
                      }}
                    />
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                * 若误按"记录按钮"进入场景2，可仅勾选 recorded 列表中的文件进行上传。
              </div>
            </div>
          </>
        )}

        <div style={{ 
          backgroundColor: '#f9fafb', 
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 12
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>日志</div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {logs.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 12 }}>无日志</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} style={{ 
                  color: l.level === "error" ? "#b91c1c" : l.level === "warn" ? "#b45309" : "#111",
                  fontSize: 12,
                  marginBottom: 2
                }}>
                  [{l.ts}] {l.level.toUpperCase()} | {l.msg}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}