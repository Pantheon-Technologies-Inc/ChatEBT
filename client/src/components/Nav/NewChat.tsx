import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import { QueryKeys, Constants } from 'librechat-data-provider';
import { NewChatIcon, MobileSidebar, Sidebar, TooltipAnchor, Button } from '@librechat/client';
import { useLocalize, useNewConvo } from '~/hooks';
import store from '~/store';

export default function NewChat({
  index = 0,
  toggleNav,
  subHeaders,
  isSmallScreen,
  headerButtons,
}: {
  index?: number;
  toggleNav: () => void;
  isSmallScreen?: boolean;
  subHeaders?: React.ReactNode;
  headerButtons?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  /** Note: this component needs an explicit index passed if using more than one */
  const { newConversation: newConvo } = useNewConvo(index);
  const navigate = useNavigate();
  const localize = useLocalize();
  const { conversation } = store.useCreateConversationAtom(index);

  const clickHandler: React.MouseEventHandler<HTMLButtonElement> = useCallback(
    (e) => {
      if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        window.open('/c/new', '_blank');
        return;
      }
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, conversation?.conversationId ?? Constants.NEW_CONVO],
        [],
      );
      queryClient.invalidateQueries([QueryKeys.messages]);
      newConvo();
      navigate('/c/new', { state: { focusChat: true } });
      if (isSmallScreen) {
        toggleNav();
      }
    },
    [queryClient, conversation, newConvo, navigate, toggleNav, isSmallScreen],
  );

  return (
    <>
      <div className="flex items-center justify-between py-[2px] md:py-2">
        <TooltipAnchor
          description="Visit ChatEBT"
          render={
            <a
              href="https://chatebt.so"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-8 w-8 items-center justify-center rounded-full border-none bg-transparent p-1 hover:bg-surface-hover md:h-10 md:w-10 md:rounded-xl md:p-2"
              aria-label="Visit ChatEBT"
            >
              <img src="/assets/logo.svg" alt="ChatEBT Logo" className="h-6 w-6 md:h-8 md:w-8" />
            </a>
          }
        />
        <div className="flex">
          {headerButtons}
          <TooltipAnchor
            description={localize('com_nav_close_sidebar')}
            render={
              <Button
                size="icon"
                variant="outline"
                data-testid="close-sidebar-button"
                aria-label={localize('com_nav_close_sidebar')}
                className="rounded-full border-none bg-transparent p-2 hover:bg-surface-hover md:rounded-xl"
                onClick={toggleNav}
              >
                <Sidebar className="max-md:hidden" />
                <MobileSidebar className="m-1 inline-flex size-10 items-center justify-center md:hidden" />
              </Button>
            }
          />
        </div>
      </div>
      {subHeaders != null ? subHeaders : null}
    </>
  );
}
