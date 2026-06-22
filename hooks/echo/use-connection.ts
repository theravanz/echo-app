"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ConnectionStatus } from "./types";

interface UseConnectionReturn {
  connectionStatus: ConnectionStatus;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  checkConnectivity: () => Promise<boolean>;
}

// Реальная проверка соединения с Supabase через REST API
const checkRealConnectivity = async (): Promise<boolean> => {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
      {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
    );

    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
};

export function useConnection(onReconnect?: () => void): UseConnectionReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connected");
  const processReconnectRef = useRef(onReconnect);
  processReconnectRef.current = onReconnect;

  useEffect(() => {
    let isActive = true;
    let lastOnline: boolean | null = null;

    const checkConnection = async () => {
      const isOnline = await checkRealConnectivity();
      if (!isActive) return;

      if (isOnline) {
        if (lastOnline === false) {
          // Reconnected — process offline queue
          processReconnectRef.current?.();
          setConnectionStatus("connected");
        } else if (lastOnline === null) {
          setConnectionStatus("connected");
        }
        lastOnline = true;
      } else {
        setConnectionStatus("disconnected");
        lastOnline = false;
      }
    };

    checkConnection();

    const handleOnline = () => {
      setConnectionStatus("connecting");
      setTimeout(checkConnection, 500);
    };
    const handleOffline = () => {
      setConnectionStatus("disconnected");
      lastOnline = false;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const checkInterval = setInterval(checkConnection, 15000);

    return () => {
      isActive = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(checkInterval);
    };
  }, []);

  const checkConnectivity = useCallback(async () => {
    return checkRealConnectivity();
  }, []);

  return { connectionStatus, setConnectionStatus, checkConnectivity };
}
