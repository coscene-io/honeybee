import React, { useState, useRef, useEffect } from "react";
import { PanelExtensionContext } from "@foxglove/studio";

import { Button } from "./components/ui";
import type { Config } from "./config/types";
import { RealRosService } from "./services/ros";
import type { RosService } from "./types";

interface FaultRecordPanelProps {
  context: PanelExtensionContext;
}

export default function FaultRecordPanel({ context }: FaultRecordPanelProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const rosRef = useRef<RosService>(new RealRosService(context));
  
  const [config, setConfig] = useState<Config>({
    services: [
      { displayName: "故障点1", serviceName: "/mark_fault_1" },
      { displayName: "故障点2", serviceName: "/mark_fault_2" },
      { displayName: "故障点3", serviceName: "/mark_fault_3" },
    ],
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Array<{ ts: string; level: string; msg: string }>>([]);

  // 监听配置变化
  useEffect(() => {
    const updateConfig = () => {
      const panelConfig = context.initialState as Config;
      if (panelConfig?.services) {
        setConfig(panelConfig);
      }
    };
    
    updateConfig();
    context.onRender = updateConfig;
    
    return () => {
      context.onRender = undefined;
    };
  }, [context]);

  const log = (level: string, msg: string) => {
    setLogs((xs) => [...xs, { ts: new Date().toLocaleTimeString(), level, msg }]);
  };

  // 自动滚动日志到底部
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // 处理服务调用
  const handleServiceCall = async (serviceInfo: { id: number; name: string; service: string }) => {
    const timestamp = new Date().toLocaleString();
    const noteKey = `service${serviceInfo.id}Note`;
    const note = notes[noteKey] || '';
    
    try {
      // 调用HTTP ROS服务
      await rosRef.current.callService(serviceInfo.service, { note });
      
      const logMessage = `[${timestamp}] ${serviceInfo.name}${note ? ` - ${note}` : ''} (服务: ${serviceInfo.service})`;
      setLogs(prev => [...prev, { ts: new Date().toLocaleTimeString(), level: "info", msg: logMessage }]);
      
      // 清空对应的备注
      setNotes(prev => ({ ...prev, [noteKey]: '' }));
      
    } catch (error) {
      const errorMessage = `[${timestamp}] 调用${serviceInfo.name}失败: ${error instanceof Error ? error.message : error}`;
      setLogs(prev => [...prev, { ts: new Date().toLocaleTimeString(), level: "error", msg: errorMessage }]);
    }
  };

  const onReset = () => {
    setNotes({});
    setLogs([]);
    log("info", "已重置所有状态");
  };

  const updateNote = (noteKey: string, note: string) => {
    setNotes(prev => ({ ...prev, [noteKey]: note }));
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ 
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 16
        }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>故障点记录面板</div>
        </div>



        {/* 动态生成的服务按钮和备注输入框 */}
         {config.services.map((service, index) => {
           const noteKey = `service${index}Note`;
           
           return (
             <div key={index} style={{ marginBottom: 16 }}>
               <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                 <div style={{ flex: 1 }}>
                   <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                     {service.displayName} - 备注 (可选)
                   </div>
                   <input
                     style={{
                       width: '100%',
                       padding: '8px 12px',
                       border: '1px solid #d1d5db',
                       borderRadius: 6,
                       fontSize: 14
                     }}
                     value={notes[noteKey] || ''}
                     onChange={(e) => updateNote(noteKey, e.target.value)}
                     placeholder={`为${service.displayName}添加备注信息`}
                   />
                 </div>
                 <Button 
                   variant="primary" 
                   size="large"
                   onClick={() => handleServiceCall({ id: index, name: service.displayName, service: service.serviceName })}
                 >
                   {service.displayName}
                 </Button>
               </div>
             </div>
           );
         })}

        {/* 重置按钮 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20, marginBottom: 20 }}>
          <Button variant="ghost" size="large" onClick={onReset}>
            重置所有状态
          </Button>
        </div>



        <div style={{ 
          backgroundColor: '#f9fafb', 
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 12
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>日志</div>
          <div 
            ref={logContainerRef}
            style={{ maxHeight: 120, overflowY: 'auto' }}
          >
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