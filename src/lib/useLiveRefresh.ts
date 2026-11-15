import { useEffect, useRef } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
let eventSource: EventSource | null = null;
let reconnectTimer: number | null = null;
let channel: BroadcastChannel | null = null;
let onRemoteChange: (() => void) | null = null;

export function setOnRemoteChange(fn: () => void) {
  onRemoteChange = fn;
}

function notifyAll() {
  for (const fn of listeners) {
    fn();
  }
}

export function broadcastAppChange() {
  notifyAll();
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      if (!channel) {
        channel = new BroadcastChannel('cris-parambu-sync');
      }
      channel.postMessage({ ts: Date.now() });
    } catch {
      // Ignore BroadcastChannel restriction errors
    }
  }
}

function ensureRealtimeConnected() {
  if (typeof window === 'undefined' || listeners.size === 0) return;

  if (typeof BroadcastChannel !== 'undefined' && !channel) {
    try {
      channel = new BroadcastChannel('cris-parambu-sync');
      channel.onmessage = () => {
        onRemoteChange?.();
        notifyAll();
      };
    } catch {
      // Ignore if unavailable
    }
  }

  if (typeof EventSource !== 'undefined' && !eventSource) {
    const connect = () => {
      if (listeners.size === 0 || eventSource) return;
      try {
        const es = new EventSource('/api/events', { withCredentials: true });
        eventSource = es;
        es.addEventListener('change', () => {
          onRemoteChange?.();
          notifyAll();
        });
        es.onerror = () => {
          es.close();
          if (eventSource === es) eventSource = null;
          if (reconnectTimer === null && listeners.size > 0) {
            reconnectTimer = window.setTimeout(() => {
              reconnectTimer = null;
              connect();
            }, 4000);
          }
        };
      } catch {
        // Ignore EventSource errors
      }
    };
    connect();
  }
}

function cleanupRealtimeIfUnused() {
  if (listeners.size > 0) return;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

/**
 * Atualiza os dados automaticamente quando houver qualquer alteração no sistema
 * (na mesma aba, em outra aba ou em outro aparelho), ou quando a janela voltar ao foco.
 */
export function useLiveRefresh(onRefresh: () => void, enabled = true) {
  const callbackRef = useRef(onRefresh);
  callbackRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    let debounceTimer: number | null = null;
    const trigger = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        callbackRef.current();
      }, 120);
    };

    listeners.add(trigger);
    ensureRealtimeConnected();

    const onFocus = () => trigger();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') trigger();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      listeners.delete(trigger);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      cleanupRealtimeIfUnused();
    };
  }, [enabled]);
}
