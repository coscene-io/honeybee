import React from "react";
import { Section } from "./ui";
import { bytes, iso } from "../utils/format";
import type { FileCandidate } from "../types";

export function FileTable({
  files,
  selectedIds,
  onToggle,
  title,
}: {
  files: FileCandidate[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  title: string;
}) {
  return (
    <Section 
      title={title} 
      right={
        <span style={{ fontSize: 14, color: '#6b7280' }}>
          {files.length} 项
        </span>
      }
    >
      {files.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 14 }}>无</div>
      ) : (
        <div style={{ 
          overflow: 'auto',
          maxHeight: '300px',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          backgroundColor: '#ffffff'
        }}>
          <table style={{ 
            width: '100%', 
            fontSize: 14,
            borderCollapse: 'collapse'
          }}>
            <thead>
              <tr style={{ 
                backgroundColor: '#f9fafb',
                borderBottom: '1px solid #e5e7eb'
              }}>
                <th style={{ 
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#6b7280',
                  fontWeight: 600,
                  fontSize: 13,
                  width: '80px'
                }}>
                  选择
                </th>
                <th style={{ 
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#6b7280',
                  fontWeight: 600,
                  fontSize: 13
                }}>
                  文件名 / 备注
                </th>
                <th style={{ 
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#6b7280',
                  fontWeight: 600,
                  fontSize: 13,
                  width: '100px'
                }}>
                  大小
                </th>
                <th style={{ 
                  padding: '12px 16px',
                  textAlign: 'left',
                  color: '#6b7280',
                  fontWeight: 600,
                  fontSize: 13,
                  width: '140px'
                }}>
                  时间
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, index) => (
                <tr 
                  key={f.id} 
                  style={{ 
                    borderBottom: index < files.length - 1 ? '1px solid #f3f4f6' : 'none',
                    backgroundColor: selectedIds.has(f.id) ? '#f0f9ff' : '#ffffff',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedIds.has(f.id)) {
                      e.currentTarget.style.backgroundColor = '#f9fafb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedIds.has(f.id)) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }
                  }}
                >
                  <td style={{ 
                    padding: '12px 16px',
                    verticalAlign: 'top'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(f.id)} 
                      onChange={() => onToggle(f.id)}
                      style={{
                        width: 16,
                        height: 16,
                        cursor: 'pointer'
                      }}
                    />
                  </td>
                  <td style={{ 
                    padding: '12px 16px',
                    verticalAlign: 'top'
                  }}>
                    <div style={{ 
                      fontWeight: 500,
                      color: '#111827',
                      marginBottom: f.note ? 6 : 0,
                      wordBreak: 'break-all'
                    }}>
                      {f.name}
                    </div>
                    {f.note && (
                      <div style={{ marginTop: 4 }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 12,
                          border: '1px solid #e5e7eb',
                          backgroundColor: '#f9fafb',
                          fontSize: 12,
                          color: '#6b7280'
                        }}>
                          备注：{f.note}
                        </span>
                      </div>
                    )}
                  </td>
                  <td style={{ 
                    padding: '12px 16px',
                    verticalAlign: 'top',
                    color: '#6b7280',
                    fontSize: 13
                  }}>
                    {bytes(f.sizeBytes)}
                  </td>
                  <td style={{ 
                    padding: '12px 16px',
                    verticalAlign: 'top',
                    color: '#6b7280',
                    fontSize: 13
                  }}>
                    {iso(f.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}