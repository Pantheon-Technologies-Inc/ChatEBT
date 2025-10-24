import { memo, useEffect, useMemo, useState } from 'react';
import { Tools } from 'librechat-data-provider';
import { useRecoilValue } from 'recoil';
import { useLocalize } from '~/hooks';
import store from '~/store';
import { cn } from '~/utils';

type PendingResponseIndicatorProps = {
  index?: number;
  className?: string;
};

const PendingResponseIndicator = ({ index = 0, className }: PendingResponseIndicatorProps) => {
  const localize = useLocalize();
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const isSubmittingAdded = useRecoilValue(store.isSubmittingFamily(index + 1));
  const showStop = useRecoilValue(store.showStopButtonByIndex(index));
  const showStopAdded = useRecoilValue(store.showStopButtonByIndex(index + 1));
  const submission = useRecoilValue(store.submissionByIndex(index));
  const addedSubmission = useRecoilValue(store.submissionByIndex(index + 1));

  const isWaiting = isSubmitting || isSubmittingAdded || showStop || showStopAdded;
  const activeSubmission = submission ?? addedSubmission ?? null;
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (!isWaiting) {
      setShouldRender(false);
      return;
    }

    const timer = setTimeout(() => setShouldRender(true), 250);
    return () => clearTimeout(timer);
  }, [isWaiting]);

  const toolSignals = useMemo(() => {
    const tools = activeSubmission?.conversation?.tools;
    if (!Array.isArray(tools)) {
      return [];
    }

    return tools
      .map((tool) => {
        if (typeof tool === 'string') {
          return tool;
        }

        if (tool && typeof tool === 'object' && 'type' in tool) {
          return tool.type;
        }

        return null;
      })
      .filter((tool): tool is string => typeof tool === 'string');
  }, [activeSubmission?.conversation?.tools]);

  const label = useMemo(() => {
    if (toolSignals.includes(Tools.web_search)) {
      return localize('com_ui_web_searching');
    }

    if (
      toolSignals.includes(Tools.file_search) ||
      toolSignals.includes(Tools.retrieval) ||
      toolSignals.includes(Tools.code_interpreter) ||
      toolSignals.includes(Tools.execute_code)
    ) {
      return localize('com_ui_analyzing');
    }

    return localize('com_ui_thinking');
  }, [localize, toolSignals]);

  if (!isWaiting || !shouldRender) {
    return null;
  }

  return (
    <div
      className={cn('relative flex h-3.5 w-3.5 items-center justify-center', className)}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <span className="blink-dot h-2.5 w-2.5 rounded-full bg-accent-primary/80" />
    </div>
  );
};

export default memo(PendingResponseIndicator);
