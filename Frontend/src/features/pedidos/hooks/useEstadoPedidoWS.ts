/**
 * useEstadoPedidoWS — WebSocket hook for client-specific order updates.
 *
 * Connects to /ws/pedidos/{pedidoId}?token=<jwt> and listens for real-time
 * state change events. On each event, calls the provided onEvent callback
 * and updates the wsStore.
 *
 * Features:
 *   - JWT authentication from authStore
 *   - Automatic connection lifecycle (connect on mount/enabled, close on unmount)
 *   - Exponential backoff reconnection: 1s, 2s, 4s, 8s, 16s, 30s cap, max 10 attempts
 *   - wsStore integration for connection status
 *
 * Usage:
 *   useEstadoPedidoWS(pedidoId, true, () => loadPedidos());
 */
import { useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "@/shared/store/authStore";
import { useWsStore } from "@/features/pedidos/store/wsStore";
import type { WsEvent } from "@/features/pedidos/types/ws";

const WS_BASE = (import.meta.env.VITE_WS_URL || "ws://localhost:8000") + "/api/v1";

/** Exponential backoff delays in milliseconds (index = attempt number). */
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000];
const MAX_ATTEMPTS = 10;

export function useEstadoPedidoWS(
  pedidoId: number,
  enabled: boolean,
  onEvent?: (event: WsEvent) => void,
): void {
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);

  const accessToken = useAuthStore((s) => s.accessToken);
  const setStatus = useWsStore((s) => s.setStatus);
  const setLastEvent = useWsStore((s) => s.setLastEvent);
  const incrementReconnect = useWsStore((s) => s.incrementReconnect);
  const resetReconnect = useWsStore((s) => s.resetReconnect);

  const disconnect = useCallback(() => {
    connectingRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close(1000, "cleanup");
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !accessToken || !mountedRef.current) return;
    if (connectingRef.current) return; // prevent concurrent connect attempts (strict mode)

    disconnect();
    connectingRef.current = true;
    attemptRef.current = 0;

    const url = `${WS_BASE}/pedidos/ws/pedidos/${pedidoId}?token=${accessToken}`;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      connectingRef.current = false;
      if (!mountedRef.current) {
        socket.close();
        return;
      }
      setStatus('connected');
      resetReconnect();
    };

    socket.onmessage = (msg) => {
      try {
        const event: WsEvent = JSON.parse(msg.data as string);
        setLastEvent(event);
        onEvent?.(event);
      } catch {
        // Ignore malformed messages
      }
    };

    socket.onclose = () => {
      connectingRef.current = false;
      if (!mountedRef.current) return;
      setStatus('disconnected');

      const attempt = attemptRef.current;
      if (attempt < MAX_ATTEMPTS) {
        const delay = BACKOFF_DELAYS[attempt] || 30000;
        attemptRef.current = attempt + 1;
        incrementReconnect();

        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    socket.onerror = () => {
      // onclose will fire after onerror — handle reconnection there
    };
  }, [enabled, accessToken, pedidoId, disconnect, setStatus, setLastEvent, resetReconnect, incrementReconnect, onEvent]);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled && accessToken) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect, enabled, accessToken]);
}
