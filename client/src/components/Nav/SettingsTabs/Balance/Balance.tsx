import React, { useCallback } from 'react';
import { Button } from '@librechat/client';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import HoverCardSettings from '~/components/Nav/SettingsTabs/HoverCardSettings';
import CreditsCounter from '~/components/CreditsCounter';
import AutoRefillSettings from './AutoRefillSettings';

function Balance() {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();

  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });
  const balanceData = balanceQuery.data;

  // Pull out all the fields we need, with safe defaults
  const {
    autoRefillEnabled = false,
    lastRefill,
    refillAmount,
    refillIntervalUnit,
    refillIntervalValue,
  } = balanceData ?? {};

  // Check that all auto-refill props are present
  const hasValidRefillSettings =
    lastRefill !== undefined &&
    refillAmount !== undefined &&
    refillIntervalUnit !== undefined &&
    refillIntervalValue !== undefined;

  const handleBuyCredits = useCallback(() => {
    window.open('https://joinares.com/pricing', '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm text-[#ffc772]">
      <section className="rounded-[6px] border border-[#ffc772] bg-[#1a1714] px-5 py-4">
        <div className="flex flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.3em]">
              <span>{localize('com_nav_balance')}</span>
              <HoverCardSettings
                side="bottom"
                text="com_nav_info_balance"
                iconClassName="text-[#ffc772]"
              />
            </div>
            <Button
              className="h-8 rounded-[6px] border border-[#ffc772] bg-[#ffc772] px-4 text-xs font-semibold text-black transition hover:bg-[#ffd88d]"
              onClick={handleBuyCredits}
              type="button"
            >
              {localize('com_nav_buy_credits')}
            </Button>
          </header>
          <div className="space-y-3">
            <CreditsCounter className="px-0" />
            <div className="rounded-[6px] border border-[#ffc772]/60 bg-[#211d1a] px-4 py-3 text-[#ffc772]">
              <p className="font-rajdhani text-[10px] font-semibold uppercase tracking-[0.3em]">
                {localize('com_nav_credits_ares_title')}
              </p>
              <p className="mt-2 font-rajdhani text-sm leading-relaxed">
                {localize('com_nav_credits_ares_description')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {autoRefillEnabled && hasValidRefillSettings && (
        <AutoRefillSettings
          lastRefill={lastRefill}
          refillAmount={refillAmount}
          refillIntervalUnit={refillIntervalUnit}
          refillIntervalValue={refillIntervalValue}
        />
      )}
    </div>
  );
}

export default React.memo(Balance);
