/**
 * WebSocket connection state store (Zustand).
 *
 * Centralises WebSocket connection state so any component can read
 * connectivity status without prop drilling. Follows the same pattern
 * as authStore.
 *
 * State:
 *   - connected: boolean — whether at least one WS connection is open
 *   - reconnectAttempt: number — current reconnection attempt counter
 *   - lastEvent: WsEvent | null — most recent event received (for debugging)
 */
import { create } from "zustand";
import type { WsEvent } from "../types/ws";

// ── Types ──

export interface WsState {
  connected: boolean;
  reconnectAttempt: number;
  lastEvent: WsEvent | null;
}

export interface WsActions {
  setConnected: (connected: boolean) => void;
  incrementReconnect: () => void;
  resetReconnect: () => void;
  setLastEvent: (event: WsEvent) => void;
}

type WsStore = WsState & WsActions;

// ── Store ──

export const useWsStore = create<WsStore>((set) => ({
  connected: false,
  reconnectAttempt: 0,
  lastEvent: null,

  setConnected: (connected) => set({ connected }),
  incrementReconnect: () =>
    set((state) => ({ reconnectAttempt: state.reconnectAttempt + 1 })),
  resetReconnect: () => set({ reconnectAttempt: 0 }),
  setLastEvent: (event) => set({ lastEvent: event }),
}));

// ── Selectors ──

export const useWsConnected = () => useWsStore((s) => s.connected);
export const useWsReconnectAttempt = () => useWsStore((s) => s.reconnectAttempt);
export const useWsLastEvent = () => useWsStore((s) => s.lastEvent);
