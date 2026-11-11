import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// Phase 7: basic proctoring for the interview screen. Records only that the
// tab was hidden or fullscreen was exited (the server stamps the time) —
// no screenshots, keystrokes, camera or content. The candidate is told about
// it in the consent text and sees a notice each time it happens. Reporting
// is fire-and-forget: a failed report never blocks the interview.
export default function useProctoring(token, enabled = true) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastWarning, setLastWarning] = useState(null);

  const report = useCallback(
    (eventType) => {
      api.recordProctoringEvent(token, eventType).catch(() => {});
    },
    [token]
  );

  useEffect(() => {
    if (!enabled || !token) return undefined;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        report('tab_hidden');
        setLastWarning('You left the interview tab. This is noted for the hiring team.');
      }
    };

    const onFullscreen = () => {
      const nowFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen((wasFullscreen) => {
        if (wasFullscreen && !nowFullscreen) {
          report('fullscreen_exit');
          setLastWarning('You exited fullscreen. This is noted for the hiring team.');
        }
        return nowFullscreen;
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [enabled, token, report]);

  const enterFullscreen = useCallback(() => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const fullscreenSupported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

  return {
    isFullscreen,
    fullscreenSupported,
    enterFullscreen,
    lastWarning,
    dismissWarning: () => setLastWarning(null),
  };
}
