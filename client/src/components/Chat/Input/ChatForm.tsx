import { memo, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useWatch } from 'react-hook-form';
import { TextareaAutosize } from '@librechat/client';
import { useRecoilState, useRecoilValue } from 'recoil';
import { Constants, isAssistantsEndpoint, isAgentsEndpoint } from 'librechat-data-provider';
import {
  useChatContext,
  useChatFormContext,
  useAddedChatContext,
  useAssistantsMapContext,
} from '~/Providers';
import {
  useTextarea,
  useAutoSave,
  useRequiresKey,
  useHandleKeyUp,
  useQueryParams,
  useSubmitMessage,
  useFocusChatEffect,
} from '~/hooks';
import { mainTextareaId, BadgeItem } from '~/common';
import AttachFileChat from './Files/AttachFileChat';
import FileFormChat from './Files/FileFormChat';
import { cn, removeFocusRings } from '~/utils';
import TextareaHeader from './TextareaHeader';
import PromptsCommand from './PromptsCommand';
import AudioRecorder from './AudioRecorder';
import CollapseChat from './CollapseChat';
import StreamAudio from './StreamAudio';
import StopButton from './StopButton';
import SendButton from './SendButton';
import EditBadges from './EditBadges';
import BadgeRow from './BadgeRow';
import Mention from './Mention';
import store from '~/store';

const ChatForm = memo(({ index = 0 }: { index?: number }) => {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  useFocusChatEffect(textAreaRef);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [, setIsScrollable] = useState(false);
  const [visualRowCount, setVisualRowCount] = useState(1);
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false);
  const [backupBadges, setBackupBadges] = useState<Pick<BadgeItem, 'id'>[]>([]);

  const SpeechToText = useRecoilValue(store.speechToText);
  const TextToSpeech = useRecoilValue(store.textToSpeech);
  const chatDirection = useRecoilValue(store.chatDirection);
  const automaticPlayback = useRecoilValue(store.automaticPlayback);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);
  const isTemporary = useRecoilValue(store.isTemporary);

  const [badges, setBadges] = useRecoilState(store.chatBadges);
  const [isEditingBadges, setIsEditingBadges] = useRecoilState(store.isEditingBadges);
  const [showStopButton, setShowStopButton] = useRecoilState(store.showStopButtonByIndex(index));
  const [showPlusPopover, setShowPlusPopover] = useRecoilState(store.showPlusPopoverFamily(index));
  const [showMentionPopover, setShowMentionPopover] = useRecoilState(
    store.showMentionPopoverFamily(index),
  );

  const { requiresKey } = useRequiresKey();
  const methods = useChatFormContext();
  const {
    files,
    setFiles,
    conversation,
    isSubmitting,
    filesLoading,
    newConversation,
    handleStopGenerating,
  } = useChatContext();
  const {
    addedIndex,
    generateConversation,
    conversation: addedConvo,
    setConversation: setAddedConvo,
    isSubmitting: isSubmittingAdded,
  } = useAddedChatContext();
  const assistantMap = useAssistantsMapContext();
  const showStopAdded = useRecoilValue(store.showStopButtonByIndex(addedIndex));

  const endpoint = useMemo(
    () => conversation?.endpointType ?? conversation?.endpoint,
    [conversation?.endpointType, conversation?.endpoint],
  );
  const conversationId = useMemo(
    () => conversation?.conversationId ?? Constants.NEW_CONVO,
    [conversation?.conversationId],
  );

  const isRTL = useMemo(
    () => (chatDirection != null ? chatDirection?.toLowerCase() === 'rtl' : false),
    [chatDirection],
  );
  const invalidAssistant = useMemo(
    () =>
      isAssistantsEndpoint(endpoint) &&
      (!(conversation?.assistant_id ?? '') ||
        !assistantMap?.[endpoint ?? '']?.[conversation?.assistant_id ?? '']),
    [conversation?.assistant_id, endpoint, assistantMap],
  );
  const disableInputs = useMemo(
    () => requiresKey || invalidAssistant,
    [requiresKey, invalidAssistant],
  );

  const handleContainerClick = useCallback(() => {
    /** Check if the device is a touchscreen */
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      return;
    }
    textAreaRef.current?.focus();
  }, []);

  const handleFocusOrClick = useCallback(() => {
    if (isCollapsed) {
      setIsCollapsed(false);
    }
  }, [isCollapsed]);

  useAutoSave({
    files,
    setFiles,
    textAreaRef,
    conversationId,
    isSubmitting: isSubmitting || isSubmittingAdded,
  });

  const { submitMessage, submitPrompt } = useSubmitMessage();

  const handleKeyUp = useHandleKeyUp({
    index,
    textAreaRef,
    setShowPlusPopover,
    setShowMentionPopover,
  });
  const isMoreThanThreeRows = visualRowCount > 3;
  const isNewConversation = useMemo(
    () =>
      (conversation?.messages?.length ?? 0) === 0 &&
      (conversationId == null || conversationId === Constants.NEW_CONVO),
    [conversation?.messages?.length, conversationId],
  );
  const showLandingInput = isNewConversation;
  const shouldExtendLandingInput = showLandingInput && visualRowCount > 1;
  const {
    isNotAppendable,
    handlePaste,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useTextarea({
    textAreaRef,
    submitButtonRef,
    setIsScrollable,
    disabled: disableInputs,
    customPlaceholder: showLandingInput ? 'Ask anything' : undefined,
  });

  useQueryParams({ textAreaRef });

  const { ref, ...registerProps } = methods.register('text', {
    required: true,
    onChange: useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) =>
        methods.setValue('text', e.target.value, { shouldValidate: true }),
      [methods],
    ),
  });

  const textValue = useWatch({ control: methods.control, name: 'text' });

  useEffect(() => {
    const textarea = textAreaRef.current;
    if (!textarea) {
      return;
    }

    const value = textarea.value ?? '';
    if (value.trim().length === 0) {
      setVisualRowCount(1);
      return;
    }

    const style = window.getComputedStyle(textarea);
    const parsedLineHeight = parseFloat(style.lineHeight);
    const fontSize = parseFloat(style.fontSize);
    const lineHeight =
      Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
        ? parsedLineHeight
        : Number.isFinite(fontSize) && fontSize > 0
          ? fontSize * 1.2
          : textarea.clientHeight || 1;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const contentHeight = textarea.scrollHeight - paddingTop - paddingBottom;
    const singleRowHeight = lineHeight;

    if (contentHeight <= singleRowHeight + 1) {
      setVisualRowCount(1);
      return;
    }

    setVisualRowCount(Math.max(1, Math.ceil(contentHeight / lineHeight)));
  }, [textValue]);

  useEffect(() => {
    if (isEditingBadges && backupBadges.length === 0) {
      setBackupBadges([...badges]);
    }
  }, [isEditingBadges, badges, backupBadges.length]);

  const handleSaveBadges = useCallback(() => {
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [setIsEditingBadges, setBackupBadges]);

  const handleCancelBadges = useCallback(() => {
    if (backupBadges.length > 0) {
      setBadges([...backupBadges]);
    }
    setIsEditingBadges(false);
    setBackupBadges([]);
  }, [backupBadges, setBadges, setIsEditingBadges]);

  const textareaClasses = useMemo(
    () =>
      showLandingInput
        ? cn(
            'm-0 w-full flex-1 resize-none border-none bg-transparent px-0 py-2 text-base leading-[1.35] placeholder:text-white/20 focus:outline-none focus-visible:outline-none sm:text-lg',
            'min-h-[40px] overflow-y-auto text-white',
            isRTL ? 'text-right' : 'text-left',
          )
        : cn(
            'md:py-3.5 m-0 w-full resize-none bg-transparent py-[13px] placeholder-black/50 dark:placeholder-white/50 [&:has(textarea:focus)]:shadow-[0_2px_6px_rgba(0,0,0,.05)]',
            'min-h-[44px] overflow-y-auto',
            isCollapsed ? 'max-h-[52px]' : 'max-h-[45vh] md:max-h-[55vh]',
            isMoreThanThreeRows ? 'pl-5' : 'px-5',
          ),
    [showLandingInput, isRTL, isCollapsed, isMoreThanThreeRows],
  );

  return (
    <form
      onSubmit={methods.handleSubmit(submitMessage)}
      className={cn(
        'mx-auto flex w-full flex-row gap-3 transition-[max-width] duration-300 sm:px-2',
        maximizeChatSpace
          ? 'max-w-full'
          : showLandingInput
            ? 'max-w-lg sm:max-w-xl md:max-w-2xl'
            : 'md:max-w-3xl xl:max-w-4xl',
        centerFormOnLanding &&
          (conversationId == null || conversationId === Constants.NEW_CONVO) &&
          !isSubmitting &&
          conversation?.messages?.length === 0
          ? 'transition-all duration-200 sm:mb-28'
          : 'sm:mb-10',
      )}
    >
      <div className="relative flex h-full flex-1 items-stretch md:flex-col">
        <div className={cn('flex w-full items-center', isRTL && 'flex-row-reverse')}>
          {showPlusPopover && !isAssistantsEndpoint(endpoint) && (
            <Mention
              setShowMentionPopover={setShowPlusPopover}
              newConversation={generateConversation}
              textAreaRef={textAreaRef}
              commandChar="+"
              placeholder="com_ui_add_model_preset"
              includeAssistants={false}
            />
          )}
          {showMentionPopover && (
            <Mention
              setShowMentionPopover={setShowMentionPopover}
              newConversation={newConversation}
              textAreaRef={textAreaRef}
            />
          )}
          <PromptsCommand index={index} textAreaRef={textAreaRef} submitPrompt={submitPrompt} />
          <div
            onClick={handleContainerClick}
            className={cn(
              'relative flex w-full flex-grow flex-col overflow-hidden text-text-primary transition-all duration-200',
              showLandingInput
                ? shouldExtendLandingInput
                  ? 'rounded-3xl px-4 py-2 sm:rounded-3xl sm:px-6 sm:py-3'
                  : 'rounded-full px-4 py-1.5 sm:rounded-full sm:px-6 sm:py-2'
                : 'rounded-t-3xl border pb-4 sm:rounded-3xl sm:pb-0',
              showLandingInput
                ? isTextAreaFocused
                  ? 'shadow-[0_20px_60px_rgba(15,15,15,0.6)]'
                  : 'shadow-[0_14px_48px_rgba(15,15,15,0.45)]'
                : isTextAreaFocused
                  ? 'shadow-lg'
                  : 'shadow-md',
              isTemporary
                ? showLandingInput
                  ? 'bg-violet-950/20'
                  : 'border-violet-800/60 bg-violet-950/10'
                : showLandingInput
                  ? 'bg-white/10'
                  : 'border-border-light bg-surface-chat',
            )}
          >
            <TextareaHeader addedConvo={addedConvo} setAddedConvo={setAddedConvo} />
            <EditBadges
              isEditingChatBadges={isEditingBadges}
              handleCancelBadges={handleCancelBadges}
              handleSaveBadges={handleSaveBadges}
              setBadges={setBadges}
            />
            <FileFormChat disableInputs={disableInputs} />
            {endpoint && (
              <div
                className={cn(
                  'flex',
                  isRTL ? 'flex-row-reverse' : 'flex-row',
                  showLandingInput
                    ? shouldExtendLandingInput
                      ? 'items-start gap-3 pt-2'
                      : 'items-center gap-3'
                    : undefined,
                )}
              >
                {showLandingInput && (
                  <div
                    className={cn(
                      'flex flex-shrink-0 items-center transform',
                      isRTL ? 'pl-1 sm:pl-2 translate-x-[5px]' : '-translate-x-[5px] pr-1 sm:pr-2',
                    )}
                  >
                    <AttachFileChat disableInputs={disableInputs} />
                  </div>
                )}
                <TextareaAutosize
                  {...registerProps}
                  ref={(e) => {
                    ref(e);
                    (textAreaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = e;
                  }}
                  disabled={disableInputs || isNotAppendable}
                  onPaste={handlePaste}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  id={mainTextareaId}
                  placeholder={showLandingInput ? 'Ask anything' : undefined}
                  tabIndex={0}
                  data-testid="text-input"
                  rows={1}
                  minRows={1}
                  onFocus={() => {
                    handleFocusOrClick();
                    setIsTextAreaFocused(true);
                  }}
                  onBlur={setIsTextAreaFocused.bind(null, false)}
                  onClick={handleFocusOrClick}
                  className={cn(
                    textareaClasses,
                    removeFocusRings,
                    'transition-[max-height] duration-200 disabled:cursor-not-allowed',
                    showLandingInput ? 'px-0 sm:px-1' : undefined,
                  )}
                />
                {showLandingInput ? (
                  <div
                    className={cn(
                      'flex transform flex-shrink-0 items-center gap-2',
                      isRTL ? 'mr-auto flex-row-reverse pl-2 -translate-x-[5px]' : 'ml-auto pr-1 translate-x-[5px]',
                    )}
                  >
                    {SpeechToText && (
                      <AudioRecorder
                        methods={methods}
                        ask={submitMessage}
                        textAreaRef={textAreaRef}
                        disabled={disableInputs || isNotAppendable}
                        isSubmitting={isSubmitting}
                      />
                    )}
                      <SendButton
                        ref={submitButtonRef}
                        control={methods.control}
                        disabled={filesLoading || isSubmitting || disableInputs || isNotAppendable}
                        className="size-10 p-2 !bg-[#0169cc] text-white shadow-[0_10px_28px_rgba(0,0,0,0.5)] hover:!bg-[#0169cc]/90 hover:shadow-[0_12px_32px_rgba(0,0,0,0.5)] focus-visible:!bg-[#0169cc]"
                        iconClassName="text-white"
                        iconSize={20}
                      />
                  </div>
                ) : (
                  <div className="flex flex-col items-start justify-start pt-1.5">
                    <CollapseChat
                      isCollapsed={isCollapsed}
                      isScrollable={isMoreThanThreeRows}
                      setIsCollapsed={setIsCollapsed}
                    />
                  </div>
                )}
              </div>
            )}
            {!showLandingInput && (
              <div
                className={cn(
                  'items-between ml-1 flex gap-1 pb-2',
                  isRTL ? 'flex-row-reverse' : 'flex-row',
                )}
              >
                <div className={`${isRTL ? 'mr-1' : 'ml-1'}`}>
                  <AttachFileChat disableInputs={disableInputs} />
                </div>
                <BadgeRow
                  showEphemeralBadges={!isAgentsEndpoint(endpoint) && !isAssistantsEndpoint(endpoint)}
                  isSubmitting={isSubmitting || isSubmittingAdded}
                  conversationId={conversationId}
                  onChange={setBadges}
                  isInChat={
                    Array.isArray(conversation?.messages) && conversation.messages.length >= 1
                  }
                />
                <div className="mx-auto flex" />
                {SpeechToText && (
                  <AudioRecorder
                    methods={methods}
                    ask={submitMessage}
                    textAreaRef={textAreaRef}
                    disabled={disableInputs || isNotAppendable}
                    isSubmitting={isSubmitting}
                  />
                )}
                <div className={`${isRTL ? 'ml-2' : 'mr-2'}`}>
                  {(isSubmitting || isSubmittingAdded) && (showStopButton || showStopAdded) ? (
                    <StopButton stop={handleStopGenerating} setShowStopButton={setShowStopButton} />
                  ) : (
                    endpoint && (
                      <SendButton
                        ref={submitButtonRef}
                        control={methods.control}
                        disabled={filesLoading || isSubmitting || disableInputs || isNotAppendable}
                      />
                    )
                  )}
                </div>
              </div>
            )}
            {TextToSpeech && automaticPlayback && <StreamAudio index={index} />}
          </div>
        </div>
      </div>
    </form>
  );
});

export default ChatForm;
