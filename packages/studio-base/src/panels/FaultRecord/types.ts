export type LogLine = { ts: string; level: "info" | "warn" | "error"; msg: string };

export interface RosService {
  markFaultPoint(note?: string): Promise<void>;
  callService(serviceName: string, params: any): Promise<void>;
}

export interface FaultMark {
  id: string;
  timestamp: string;
  note: string;
  serviceType: string;
}