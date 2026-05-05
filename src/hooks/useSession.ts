import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';

export function useSession(model: string, provider: string) {
  const sessionId = useRef<number | null>(null);

  useEffect(() => {
    invoke<number>('db_new_session', { model, provider })
      .then(id => { sessionId.current = id; })
      .catch(console.error);
  }, [model, provider]);

  const saveMessage = async (role: string, content: string, tokens?: number) => {
    if (sessionId.current === null) return;
    await invoke('db_save_message', {
      sessionId: sessionId.current, role, content,
      model, tokens: tokens ?? null
    });
  };

  return { saveMessage, sessionId };
}
