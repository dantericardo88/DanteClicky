import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useDanteAgentsBridge() {
  const [connectionCount, setConnectionCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const poll = () => {
      invoke<number>("get_ws_connection_count")
        .then((count) => {
          setConnectionCount(count);
          setIsConnected(count > 0);
        })
        .catch(() => {
          setConnectionCount(0);
          setIsConnected(false);
        });
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  return { connectionCount, isConnected };
}
