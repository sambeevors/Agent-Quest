import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, WsEvent, ActivityLogEntry, LinearStatus } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { WS_URL } from '../config';

const RECONNECT_DELAY_MS = 3000;
const MAX_LOG_ENTRIES = 200;

export interface AgentStateHook {
  agents: AgentState[];
  activityLog: ActivityLogEntry[];
  connected: boolean;
  /** Config dirs reported by the server in the last snapshot. `null` means
   * we haven't received a snapshot yet (still connecting); an empty array
   * means the server found neither ~/.claude* nor ~/.codex install on disk. */
  configDirs: string[] | null;
  /** Linear project status backing the construction sites. `null` until the first push. */
  linear: LinearStatus | null;
  /**
   * Apply a status the server returned directly (from the connect form) so the
   * UI updates on the response rather than waiting for the WebSocket echo.
   */
  setLinear: (status: LinearStatus) => void;
}

export function useAgentState(): AgentStateHook {
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [configDirs, setConfigDirs] = useState<string[] | null>(null);
  const [linear, setLinear] = useState<LinearStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEvent = useCallback((event: WsEvent) => {
    switch (event.type) {
      case 'snapshot':
        setAgents(event.agents);
        setConfigDirs(event.configDirs);
        break;

      case 'agent:new':
        setAgents((prev) => [...prev, event.agent]);
        break;

      case 'agent:update':
        setAgents((prev) =>
          prev.map((a) => (a.id === event.agent.id ? event.agent : a)),
        );
        break;

      case 'agent:complete':
        setAgents((prev) =>
          prev.map((a) =>
            a.id === event.id ? { ...a, status: 'completed' as const, currentActivity: 'idle' as const } : a,
          ),
        );
        break;

      case 'activity:log':
        setActivityLog((prev) => {
          const entry: ActivityLogEntry = {
            agentId: event.agentId,
            action: event.action,
            detail: event.detail,
            timestamp: event.timestamp,
          };
          const next = [entry, ...prev];
          return next.length > MAX_LOG_ENTRIES ? next.slice(0, MAX_LOG_ENTRIES) : next;
        });
        break;

      case 'linear:status':
        setLinear(event.status);
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      eventBridge.emit('ws:connected');
      console.log('[WS] connected to', WS_URL);
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as WsEvent;
        handleEvent(event);
      } catch (err) {
        console.error('[WS] failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      eventBridge.emit('ws:disconnected');
      console.log('[WS] disconnected, reconnecting in', RECONNECT_DELAY_MS, 'ms');
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error('[WS] error:', err);
      ws.close();
    };
  }, [handleEvent]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return { agents, activityLog, connected, configDirs, linear, setLinear };
}
