
export type Dict<T=any>=Record<string, T>
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off";

// websocket建立成功回包
export interface wsResData {
    op: number; // opcode ws的类型
    d?: {
        // 事件内容
        heartbeat_interval?: number; // 心跳时间间隔
        session_id?:string;
        user?:{
            id?:string;
            username?:string
            bot?:boolean
            status?:number
        }
    };
    s: number; // 心跳的唯一标识
    t: string; // 事件类型
    id?: string; // 事件ID
}
