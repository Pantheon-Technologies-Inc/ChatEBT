import { useMemo, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';
import useLocalStorage from '~/hooks/useLocalStorage';

export const CHATGPT_IMPORT_COMPLETED_KEY = 'chatgptImportCompleted';
const CHATGPT_IMPORT_ONBOARDING_DEBUG_KEY = 'chatgptImportOnboardingDebug';
const MAX_CONVERSATIONS_FOR_ONBOARDING = 5;

export default function useChatGPTImportOnboarding() {
  const conversationCount = useRecoilValue(store.conversationCountAtom);
  const [hasImported, setHasImported] = useLocalStorage<boolean>(
    CHATGPT_IMPORT_COMPLETED_KEY,
    false,
  );
  const [debugEnabled, setDebugEnabled] = useLocalStorage<boolean>(
    CHATGPT_IMPORT_ONBOARDING_DEBUG_KEY,
    false,
  );

  const shouldShowTooltip = useMemo(() => {
    if (debugEnabled) {
      return true;
    }

    if (hasImported) {
      return false;
    }

    if (conversationCount == null) {
      return false;
    }

    return conversationCount < MAX_CONVERSATIONS_FOR_ONBOARDING;
  }, [conversationCount, debugEnabled, hasImported]);

  const markImported = useCallback(() => {
    setHasImported(true);
  }, [setHasImported]);

  const recordTooltipClick = useCallback(() => {
    setHasImported(true);
    if (debugEnabled) {
      setDebugEnabled(false);
    }
  }, [debugEnabled, setDebugEnabled, setHasImported]);

  return {
    conversationCount: conversationCount ?? 0,
    shouldShowTooltip,
    markImported,
    recordTooltipClick,
    debugEnabled,
  };
}
