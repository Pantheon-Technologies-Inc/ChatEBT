import { useCallback, useState, memo } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import * as Select from '@ariakit/react/select';
import { FileText, LogOut } from 'lucide-react';
import { GearIcon, DropdownMenuSeparator, UserIcon } from '@librechat/client';
import { SettingsTabValues } from 'librechat-data-provider';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import FilesView from '~/components/Chat/Input/Files/FilesView';
import { useAuthContext } from '~/hooks/AuthContext';
import useAvatar from '~/hooks/Messages/useAvatar';
import { useLocalize } from '~/hooks';
import Settings from './Settings';
import store from '~/store';
import useChatGPTImportOnboarding from '~/hooks/useChatGPTImportOnboarding';

type AccountSettingsProps = {
  showImportTooltip?: boolean;
};

function AccountSettings({ showImportTooltip = false }: AccountSettingsProps) {
  const localize = useLocalize();
  const { user, isAuthenticated, logout } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showFiles, setShowFiles] = useRecoilState(store.showFiles);
  const [initialSettingsTab, setInitialSettingsTab] = useState<SettingsTabValues>();
  const setShouldOpenImportInstructions = useSetRecoilState(store.openImportInstructionsAtom);
  const { recordTooltipClick } = useChatGPTImportOnboarding();
  const avatarSrc = useAvatar(user);
  const avatarSeed = user?.avatar || user?.name || user?.username || '';

  const openImportSettings = useCallback(
    (event?: SyntheticEvent) => {
      event?.preventDefault();
      event?.stopPropagation();

      recordTooltipClick();
      setShouldOpenImportInstructions(true);
      setInitialSettingsTab(SettingsTabValues.PERSONALIZATION);
      setShowSettings(true);
    },
    [recordTooltipClick, setShouldOpenImportInstructions],
  );

  const handleAccountClick = (event: SyntheticEvent) => {
    if (showImportTooltip) {
      openImportSettings(event);
    }
  };

  const handleAccountKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (showImportTooltip && (event.key === 'Enter' || event.key === ' ')) {
      openImportSettings(event);
    }
  };

  const handleSettingsOpenChange = (isOpen: boolean) => {
    setShowSettings(isOpen);
    if (!isOpen) {
      setInitialSettingsTab(undefined);
    }
  };

  return (
    <Select.SelectProvider>
      <div className="relative">
        {showImportTooltip && (
          <div className="absolute -top-14 right-0 z-50 flex flex-col items-end">
            <button
              type="button"
              onClick={openImportSettings}
              className="flex cursor-pointer flex-col items-end rounded-md bg-gray-900 px-3 py-2 text-left text-xs text-white shadow-lg transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-border-active focus:ring-offset-2 focus:ring-offset-gray-900 dark:bg-gray-800 dark:hover:bg-gray-700 dark:focus:ring-offset-gray-800"
            >
              <span className="font-medium">Import chat from ChatGPT</span>
              <span className="mt-1 text-[10px] text-gray-300">Click to open import settings</span>
            </button>
            <div className="-mt-1 h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-800" aria-hidden="true" />
          </div>
        )}
        <Select.Select
          aria-label={localize('com_nav_account_settings')}
          data-testid="nav-user"
          className="mt-text-sm flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out hover:bg-surface-hover"
          onClick={handleAccountClick}
          onKeyDown={handleAccountKeyDown}
        >
          <div className="-ml-0.9 -mt-0.8 h-8 w-8 flex-shrink-0">
            <div className="relative flex">
              {avatarSeed.length === 0 ? (
                <div
                  style={{
                    backgroundColor: 'rgb(121, 137, 255)',
                    width: '32px',
                    height: '32px',
                    boxShadow: 'rgba(240, 246, 252, 0.1) 0px 0px 0px 1px',
                  }}
                  className="relative flex items-center justify-center rounded-full p-1 text-text-primary"
                  aria-hidden="true"
                >
                  <UserIcon />
                </div>
              ) : (
                <img
                  className="rounded-full"
                  src={(user?.avatar ?? '') || avatarSrc}
                  alt={`${user?.name || user?.username || user?.email || ''}'s avatar`}
                />
              )}
            </div>
          </div>
          <div
            className="mt-2 grow overflow-hidden text-ellipsis whitespace-nowrap text-left text-text-primary"
            style={{ marginTop: '0', marginLeft: '0' }}
          >
            {user?.name ?? user?.username ?? localize('com_nav_user')}
          </div>
        </Select.Select>
      </div>
      <Select.SelectPopover
        className="popover-ui w-[235px]"
        style={{
          transformOrigin: 'bottom',
          marginRight: '0px',
          translate: '0px',
        }}
      >
        <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
          {user?.email ?? localize('com_nav_user')}
        </div>
        <DropdownMenuSeparator />
        {startupConfig?.balance?.enabled === true && balanceQuery.data != null && (
          <>
            {/* <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
              {localize('com_nav_balance')}:{' '}
              {new Intl.NumberFormat().format(Math.round(balanceQuery.data.tokenCredits))}
            </div>
            <DropdownMenuSeparator /> */}
          </>
        )}
        <Select.SelectItem
          value=""
          onClick={() => setShowFiles(true)}
          className="select-item text-sm"
        >
          <FileText className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_files')}
        </Select.SelectItem>
        <Select.SelectItem
          value=""
          onClick={() => setShowSettings(true)}
          className="select-item text-sm"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Select.SelectItem>
        <DropdownMenuSeparator />
        <Select.SelectItem
          aria-selected={true}
          onClick={() => logout()}
          value="logout"
          className="select-item text-sm"
        >
          <LogOut className="icon-md" />
          {localize('com_nav_log_out')}
        </Select.SelectItem>
      </Select.SelectPopover>
      {showFiles && <FilesView open={showFiles} onOpenChange={setShowFiles} />}
      {showSettings && (
        <Settings
          open={showSettings}
          onOpenChange={handleSettingsOpenChange}
          initialTab={initialSettingsTab}
        />
      )}
    </Select.SelectProvider>
  );
}

export default memo(AccountSettings);
