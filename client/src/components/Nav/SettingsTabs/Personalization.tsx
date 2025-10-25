import { useState, useEffect } from 'react';
import { Switch, Button, useToastContext } from '@librechat/client';
import TextareaAutosize from 'react-textarea-autosize';
import { useGetUserQuery, useUpdateMemoryPreferencesMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import ImportChatGPTHistory from './Personalization/ImportChatGPTHistory';

interface PersonalizationProps {
  hasMemoryOptOut: boolean;
  hasAnyPersonalizationFeature: boolean;
}

export default function Personalization({
  hasMemoryOptOut,
  hasAnyPersonalizationFeature,
}: PersonalizationProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: user } = useGetUserQuery();
  const [referenceSavedMemories, setReferenceSavedMemories] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');

  const updateMemoryPreferencesMutation = useUpdateMemoryPreferencesMutation({
    onSuccess: (_data, variables) => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });

      if (typeof variables?.systemPrompt === 'string') {
        const normalizedPrompt = variables.systemPrompt.trim();
        setSystemPrompt(normalizedPrompt);
        setDraftSystemPrompt(normalizedPrompt);
      }
    },
    onError: (_error, variables) => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
      if (typeof variables?.memories === 'boolean') {
        setReferenceSavedMemories((prev) => !prev);
      }
      if (typeof variables?.systemPrompt === 'string') {
        setDraftSystemPrompt(systemPrompt);
      }
    },
  });

  // Initialize state from user data
  useEffect(() => {
    if (user?.personalization?.memories !== undefined) {
      setReferenceSavedMemories(user.personalization.memories);
    }
  }, [user?.personalization?.memories]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const personalization = user.personalization ?? {};
    const hasSystemPrompt = Object.prototype.hasOwnProperty.call(personalization, 'systemPrompt');

    if (hasSystemPrompt && typeof personalization.systemPrompt === 'string') {
      setSystemPrompt(personalization.systemPrompt);
      setDraftSystemPrompt(personalization.systemPrompt);
    } else if (hasSystemPrompt && personalization.systemPrompt == null) {
      setSystemPrompt('');
      setDraftSystemPrompt('');
    }
  }, [user, user?.personalization?.systemPrompt]);

  const handleMemoryToggle = (checked: boolean) => {
    setReferenceSavedMemories(checked);
    updateMemoryPreferencesMutation.mutate({ memories: checked });
  };

  const normalizedDraftSystemPrompt = draftSystemPrompt.trim();
  const hasSystemPromptChanges = normalizedDraftSystemPrompt !== systemPrompt;

  const handleSystemPromptSave = () => {
    if (!hasSystemPromptChanges) {
      return;
    }

    updateMemoryPreferencesMutation.mutate({ systemPrompt: normalizedDraftSystemPrompt });
  };

  if (!hasAnyPersonalizationFeature) {
    return (
      <div className="flex flex-col gap-3 text-sm text-text-primary">
        <div className="text-text-secondary">{localize('com_ui_no_personalization_available')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm text-text-primary">
      {/* Memory Settings Section */}
      {hasMemoryOptOut && (
        <>
          <div className="border-b border-border-medium pb-3">
            <div className="text-base font-semibold">{localize('com_ui_memory')}</div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                {localize('com_ui_reference_saved_memories')}
              </div>
              <div className="mt-1 text-xs text-text-secondary">
                {localize('com_ui_reference_saved_memories_description')}
              </div>
            </div>
            <Switch
              checked={referenceSavedMemories}
              onCheckedChange={handleMemoryToggle}
              disabled={updateMemoryPreferencesMutation.isLoading}
              aria-label={localize('com_ui_reference_saved_memories')}
            />
          </div>
        </>
      )}

      <div className="border-b border-border-medium pb-3 pt-3">
        <div className="text-base font-semibold">{localize('com_ui_system_prompt')}</div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs text-text-secondary">
          {localize('com_ui_system_prompt_description')}
        </div>
        <TextareaAutosize
          minRows={3}
          value={draftSystemPrompt}
          onChange={(event) => setDraftSystemPrompt(event.target.value)}
          placeholder={localize('com_ui_system_prompt_placeholder')}
          className="w-full resize-none rounded-md border border-border-medium bg-transparent px-3 py-2 text-sm outline-none focus:border-border-active focus:ring-0"
          disabled={updateMemoryPreferencesMutation.isLoading}
        />
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={handleSystemPromptSave}
            disabled={!hasSystemPromptChanges || updateMemoryPreferencesMutation.isLoading}
          >
            {localize('com_ui_save')}
          </Button>
        </div>
      </div>

      {/* ChatGPT History Import Section */}
      <div className="border-b border-border-medium pb-3 pt-3">
        <div className="text-base font-semibold">ChatGPT History</div>
      </div>

      <ImportChatGPTHistory />
    </div>
  );
}
