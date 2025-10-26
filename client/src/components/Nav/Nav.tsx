import { useCallback, useEffect, useState, useMemo, memo, lazy, Suspense, useRef } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMediaQuery, NewChatIcon } from '@librechat/client';
import { PermissionTypes, Permissions, QueryKeys, Constants } from 'librechat-data-provider';
import type { ConversationListResponse, TMessage } from 'librechat-data-provider';
import type { InfiniteQueryObserverResult } from '@tanstack/react-query';
import {
  useLocalize,
  useHasAccess,
  useAuthContext,
  useLocalStorage,
  useNavScrolling,
  useNewConvo,
} from '~/hooks';
import useChatGPTImportOnboarding from '~/hooks/useChatGPTImportOnboarding';
import { useConversationsInfiniteQuery } from '~/data-provider';
import { Conversations } from '~/components/Conversations';
import SearchBar from './SearchBar';
import NewChat from './NewChat';
import { cn } from '~/utils';
import store from '~/store';

const BookmarkNav = lazy(() => import('./Bookmarks/BookmarkNav'));
const AccountSettings = lazy(() => import('./AccountSettings'));

const NAV_WIDTH_DESKTOP = '260px';
const NAV_WIDTH_MOBILE = '320px';

const NavMask = memo(
  ({ navVisible, toggleNavVisible }: { navVisible: boolean; toggleNavVisible: () => void }) => (
    <div
      id="mobile-nav-mask-toggle"
      role="button"
      tabIndex={0}
      className={`nav-mask transition-opacity duration-200 ease-in-out ${navVisible ? 'active opacity-100' : 'opacity-0'}`}
      onClick={toggleNavVisible}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          toggleNavVisible();
        }
      }}
      aria-label="Toggle navigation"
    />
  ),
);

const MemoNewChat = memo(NewChat);

const Nav = memo(
  ({
    navVisible,
    setNavVisible,
  }: {
    navVisible: boolean;
    setNavVisible: React.Dispatch<React.SetStateAction<boolean>>;
  }) => {
    const localize = useLocalize();
    const { isAuthenticated } = useAuthContext();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { newConversation: newConvo } = useNewConvo(0);
    const { conversation } = store.useCreateConversationAtom(0);

    const [navWidth, setNavWidth] = useState(NAV_WIDTH_DESKTOP);
    const isSmallScreen = useMediaQuery('(max-width: 768px)');
    const [newUser, setNewUser] = useLocalStorage('newUser', true);
    const [showLoading, setShowLoading] = useState(false);
    const [tags, setTags] = useState<string[]>([]);
    const setConversationCount = useSetRecoilState(store.conversationCountAtom);
    const { shouldShowTooltip } = useChatGPTImportOnboarding();

    const hasAccessToBookmarks = useHasAccess({
      permissionType: PermissionTypes.BOOKMARKS,
      permission: Permissions.USE,
    });

    const search = useRecoilValue(store.search);

    const { data, fetchNextPage, isFetchingNextPage, isLoading, isFetching, refetch } =
      useConversationsInfiniteQuery(
        {
          tags: tags.length === 0 ? undefined : tags,
          search: search.debouncedQuery || undefined,
        },
        {
          enabled: isAuthenticated,
          staleTime: 30000,
          cacheTime: 300000,
        },
      );

    const computedHasNextPage = useMemo(() => {
      if (data?.pages && data.pages.length > 0) {
        const lastPage: ConversationListResponse = data.pages[data.pages.length - 1];
        return lastPage.nextCursor !== null;
      }
      return false;
    }, [data?.pages]);

    const outerContainerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<any>(null);

    const { moveToTop } = useNavScrolling<ConversationListResponse>({
      setShowLoading,
      fetchNextPage: async (options?) => {
        if (computedHasNextPage) {
          return fetchNextPage(options);
        }
        return Promise.resolve(
          {} as InfiniteQueryObserverResult<ConversationListResponse, unknown>,
        );
      },
      isFetchingNext: isFetchingNextPage,
    });

    const conversations = useMemo(() => {
      return data ? data.pages.flatMap((page) => page.conversations) : [];
    }, [data]);

    const totalConversationCount = useMemo(() => {
      const ids = conversations
        .map((conversation) => conversation?.conversationId)
        .filter(
          (conversationId): conversationId is string =>
            typeof conversationId === 'string' && conversationId !== Constants.NEW_CONVO,
        );

      return new Set(ids).size;
    }, [conversations]);

    useEffect(() => {
      if (!isAuthenticated) {
        setConversationCount(null);
        return;
      }

      if (!data) {
        if (isLoading || isFetching) {
          setConversationCount(null);
        }
        return;
      }

      setConversationCount(totalConversationCount);
    }, [isAuthenticated, data, isFetching, isLoading, setConversationCount, totalConversationCount]);

    const toggleNavVisible = useCallback(() => {
      setNavVisible((prev: boolean) => {
        localStorage.setItem('navVisible', JSON.stringify(!prev));
        return !prev;
      });
      if (newUser) {
        setNewUser(false);
      }
    }, [newUser, setNavVisible, setNewUser]);

    const itemToggleNav = useCallback(() => {
      if (isSmallScreen) {
        toggleNavVisible();
      }
    }, [isSmallScreen, toggleNavVisible]);

    const handleNewChatClick = useCallback(() => {
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, conversation?.conversationId ?? Constants.NEW_CONVO],
        [],
      );
      queryClient.invalidateQueries([QueryKeys.messages]);
      newConvo();
      navigate('/c/new', { state: { focusChat: true } });
      if (isSmallScreen) {
        toggleNavVisible();
      }
    }, [queryClient, conversation, newConvo, navigate, toggleNavVisible, isSmallScreen]);

    useEffect(() => {
      if (isSmallScreen) {
        const savedNavVisible = localStorage.getItem('navVisible');
        if (savedNavVisible === null) {
          toggleNavVisible();
        }
        setNavWidth(NAV_WIDTH_MOBILE);
      } else {
        setNavWidth(NAV_WIDTH_DESKTOP);
      }
    }, [isSmallScreen, toggleNavVisible]);

    useEffect(() => {
      refetch();
    }, [tags, refetch]);

    const loadMoreConversations = useCallback(() => {
      if (isFetchingNextPage || !computedHasNextPage) {
        return;
      }

      fetchNextPage();
    }, [isFetchingNextPage, computedHasNextPage, fetchNextPage]);

    const subHeaders = useMemo(
      () => search.enabled === true && <SearchBar isSmallScreen={isSmallScreen} />,
      [search.enabled, isSmallScreen],
    );

    const headerButtons = useMemo(
      () =>
        hasAccessToBookmarks && (
          <>
            <div className="mt-1.5" />
            <Suspense fallback={null}>
              {/* <BookmarkNav tags={tags} setTags={setTags} isSmallScreen={isSmallScreen} /> */}
            </Suspense>
          </>
        ),
      [hasAccessToBookmarks, tags, isSmallScreen],
    );

    const [isSearchLoading, setIsSearchLoading] = useState(
      !!search.query && (search.isTyping || isLoading || isFetching),
    );

    useEffect(() => {
      if (search.isTyping) {
        setIsSearchLoading(true);
      } else if (!isLoading && !isFetching) {
        setIsSearchLoading(false);
      } else if (!!search.query && (isLoading || isFetching)) {
        setIsSearchLoading(true);
      }
    }, [search.query, search.isTyping, isLoading, isFetching]);

    return (
      <>
        <div
          data-testid="nav"
          className={cn(
            'nav active max-w-[320px] flex-shrink-0 transform overflow-x-hidden bg-surface-primary-alt transition-all duration-200 ease-in-out',
            'md:max-w-[260px]',
          )}
          style={{
            width: navVisible ? navWidth : '0px',
            transform: navVisible ? 'translateX(0)' : 'translateX(-100%)',
          }}
        >
          <div className="h-full w-[320px] md:w-[260px]">
            <div className="flex h-full flex-col">
              <div
                className={`flex h-full flex-col transition-opacity duration-200 ease-in-out ${navVisible ? 'opacity-100' : 'opacity-0'}`}
              >
                <div className="flex h-full flex-col">
                  <nav
                    id="chat-history-nav"
                    aria-label={localize('com_ui_chat_history')}
                    className="flex h-full flex-col px-2 pb-3.5 md:px-1"
                  >
                    <div className="flex flex-1 flex-col" ref={outerContainerRef}>
                      <MemoNewChat
                        subHeaders={subHeaders}
                        toggleNav={toggleNavVisible}
                        headerButtons={headerButtons}
                        isSmallScreen={isSmallScreen}
                      />

                      <div className="pb-2">
                        <button
                          onClick={handleNewChatClick}
                          className="group relative flex h-12 w-full items-center rounded-lg px-2 text-white transition-colors duration-200 hover:bg-surface-active-alt md:h-9"
                          aria-label={localize('com_ui_new_chat')}
                        >
                          <div className="flex grow items-center gap-2 overflow-hidden rounded-lg">
                            <NewChatIcon className="h-5 w-5 flex-shrink-0" />
                            <div className="relative flex-1 grow overflow-hidden whitespace-nowrap text-left">
                              {localize('com_ui_new_chat')}
                            </div>
                          </div>
                        </button>
                      </div>

                      <Conversations
                        conversations={conversations}
                        moveToTop={moveToTop}
                        toggleNav={itemToggleNav}
                        containerRef={listRef}
                        loadMoreConversations={loadMoreConversations}
                        isLoading={isFetchingNextPage || showLoading || isLoading}
                        isSearchLoading={isSearchLoading}
                      />
                    </div>
                    <Suspense fallback={null}>
                      <AccountSettings showImportTooltip={shouldShowTooltip} />
                    </Suspense>
                  </nav>
                </div>
              </div>
            </div>
          </div>
        </div>
        {isSmallScreen && <NavMask navVisible={navVisible} toggleNavVisible={toggleNavVisible} />}
      </>
    );
  },
);

Nav.displayName = 'Nav';

export default Nav;
