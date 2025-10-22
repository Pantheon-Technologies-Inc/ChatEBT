import { memo, useMemo } from 'react';
import {
  Constants,
  supportsFiles,
  mergeFileConfig,
  isAgentsEndpoint,
  isAssistantsEndpoint,
  fileConfig as defaultFileConfig,
} from 'librechat-data-provider';
import type { EndpointFileConfig } from 'librechat-data-provider';
import { useGetFileConfig } from '~/data-provider';
import { useChatContext } from '~/Providers';
import AttachFile from './AttachFile';

/**
 * Unified file attachment component for chat.
 * With the Responses API, all file types are handled uniformly,
 * so we no longer need separate components for different endpoints.
 */
function AttachFileChat({ disableInputs }: { disableInputs: boolean }) {
  const { conversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const { endpoint, endpointType, agent_id, assistant_id } = conversation ?? { endpoint: null };
  const isAgents = useMemo(() => isAgentsEndpoint(endpoint), [endpoint]);
  const isAssistants = useMemo(() => isAssistantsEndpoint(endpoint), [endpoint]);

  const { data: fileConfig = defaultFileConfig } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  const endpointFileConfig = fileConfig.endpoints[endpoint ?? ''] as EndpointFileConfig | undefined;
  const endpointSupportsFiles: boolean = supportsFiles[endpointType ?? endpoint ?? ''] ?? false;
  const isUploadDisabled = (disableInputs || endpointFileConfig?.disabled) ?? false;

  if (!endpointSupportsFiles || isUploadDisabled) {
    return null;
  }

  // Build additional metadata for specialized endpoints
  const additionalMetadata: Record<string, string | undefined> = {};
  if (isAgents && agent_id) {
    additionalMetadata.agent_id = agent_id;
  }
  if (isAssistants && assistant_id) {
    additionalMetadata.assistant_id = assistant_id;
  }

  // Single unified upload button for all file types
  return (
    <AttachFile
      disabled={disableInputs}
      overrideEndpoint={endpoint ?? undefined}
      additionalMetadata={Object.keys(additionalMetadata).length > 0 ? additionalMetadata : undefined}
    />
  );
}

export default memo(AttachFileChat);
