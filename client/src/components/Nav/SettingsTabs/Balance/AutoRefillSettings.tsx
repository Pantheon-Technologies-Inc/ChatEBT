import React from 'react';
import { Label } from '@librechat/client';
import HoverCardSettings from '~/components/Nav/SettingsTabs/HoverCardSettings';
import { TranslationKeys, useLocalize } from '~/hooks';

interface AutoRefillSettingsProps {
  lastRefill: Date;
  refillAmount: number;
  refillIntervalUnit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
  refillIntervalValue: number;
}

/**
 * Adds a time interval to a given date.
 * @param {Date} date - The starting date.
 * @param {number} value - The numeric value of the interval.
 * @param {'seconds'|'minutes'|'hours'|'days'|'weeks'|'months'} unit - The unit of time.
 * @returns {Date} A new Date representing the starting date plus the interval.
 */
const addIntervalToDate = (
  date: Date,
  value: number,
  unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months',
): Date => {
  const result = new Date(date);
  switch (unit) {
    case 'seconds':
      result.setSeconds(result.getSeconds() + value);
      break;
    case 'minutes':
      result.setMinutes(result.getMinutes() + value);
      break;
    case 'hours':
      result.setHours(result.getHours() + value);
      break;
    case 'days':
      result.setDate(result.getDate() + value);
      break;
    case 'weeks':
      result.setDate(result.getDate() + value * 7);
      break;
    case 'months':
      result.setMonth(result.getMonth() + value);
      break;
    default:
      break;
  }
  return result;
};

const AutoRefillSettings: React.FC<AutoRefillSettingsProps> = ({
  lastRefill,
  refillAmount,
  refillIntervalUnit,
  refillIntervalValue,
}) => {
  const localize = useLocalize();

  const lastRefillDate = lastRefill ? new Date(lastRefill) : null;
  const nextRefill = lastRefillDate
    ? addIntervalToDate(lastRefillDate, refillIntervalValue, refillIntervalUnit)
    : null;

  // Return the localized unit based on singular/plural values
  const getLocalizedIntervalUnit = (
    value: number,
    unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months',
  ): string => {
    let key: TranslationKeys;
    switch (unit) {
      case 'seconds':
        key = value === 1 ? 'com_nav_balance_second' : 'com_nav_balance_seconds';
        break;
      case 'minutes':
        key = value === 1 ? 'com_nav_balance_minute' : 'com_nav_balance_minutes';
        break;
      case 'hours':
        key = value === 1 ? 'com_nav_balance_hour' : 'com_nav_balance_hours';
        break;
      case 'days':
        key = value === 1 ? 'com_nav_balance_day' : 'com_nav_balance_days';
        break;
      case 'weeks':
        key = value === 1 ? 'com_nav_balance_week' : 'com_nav_balance_weeks';
        break;
      case 'months':
        key = value === 1 ? 'com_nav_balance_month' : 'com_nav_balance_months';
        break;
      default:
        key = 'com_nav_balance_seconds';
    }
    return localize(key);
  };

  return (
    <section className="rounded-[6px] border border-[#ffc772]/60 bg-[#191613] px-5 py-4 text-[#ffc772]">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.28em]">
        {localize('com_nav_balance_auto_refill_settings')}
      </h3>
      <div className="mt-3 space-y-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="uppercase tracking-[0.28em]">
            {localize('com_nav_balance_last_refill')}
          </span>
          <span className="font-medium">{lastRefillDate ? lastRefillDate.toLocaleString() : '-'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="uppercase tracking-[0.28em]">
            {localize('com_nav_balance_refill_amount')}
          </span>
          <span className="font-medium">{refillAmount !== undefined ? refillAmount : '-'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="uppercase tracking-[0.28em]">
            {localize('com_nav_balance_interval')}
          </span>
          <span className="font-medium">
            {localize('com_nav_balance_every')} {refillIntervalValue}{' '}
            {getLocalizedIntervalUnit(refillIntervalValue, refillIntervalUnit)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 uppercase tracking-[0.28em]">
            <Label className="font-light text-[#ffc772]">
              {localize('com_nav_balance_next_refill')}
            </Label>
            <HoverCardSettings
              side="bottom"
              text="com_nav_balance_next_refill_info"
              iconClassName="text-[#ffc772]"
            />
          </div>
          <span className="text-sm font-medium" role="note">
            {nextRefill ? nextRefill.toLocaleString() : '-'}
          </span>
        </div>
      </div>
    </section>
  );
};

export default AutoRefillSettings;
