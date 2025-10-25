import React, { forwardRef } from 'react';
import { useWatch } from 'react-hook-form';
import type { Control } from 'react-hook-form';
import { SendIcon, TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SendButtonProps = {
  disabled: boolean;
  control: Control<{ text: string }>;
  className?: string;
  iconClassName?: string;
  iconSize?: number;
};

const SubmitButton = React.memo(
  forwardRef(
    (
      props: { disabled: boolean; className?: string; iconClassName?: string; iconSize?: number },
      ref: React.ForwardedRef<HTMLButtonElement>,
    ) => {
      const localize = useLocalize();
      return (
        <TooltipAnchor
          description={localize('com_nav_send_message')}
          render={
            <button
              ref={ref}
              aria-label={localize('com_nav_send_message')}
              id="send-button"
              disabled={props.disabled}
              className={cn(
                'inline-flex items-center justify-center rounded-full bg-text-primary p-1.5 text-text-primary outline-offset-4 transition-all duration-200 disabled:cursor-not-allowed disabled:text-text-secondary disabled:opacity-10',
                props.className,
              )}
              data-testid="send-button"
              type="submit"
            >
              <span className="" data-state="closed">
                <SendIcon
                  size={props.iconSize ?? 24}
                  className={cn(props.iconClassName)}
                />
              </span>
            </button>
          }
        />
      );
    },
  ),
);

const SendButton = React.memo(
  forwardRef((props: SendButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const data = useWatch({ control: props.control });
    return (
      <SubmitButton
        ref={ref}
        disabled={props.disabled || !data.text}
        className={props.className}
        iconClassName={props.iconClassName}
        iconSize={props.iconSize}
      />
    );
  }),
);
export default SendButton;
