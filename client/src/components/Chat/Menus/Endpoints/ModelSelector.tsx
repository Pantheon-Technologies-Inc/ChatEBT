import React, { useMemo } from 'react';
import type { ModelSelectorProps } from '~/common';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import {
  renderModelSpecs,
  renderEndpoints,
  renderSearchResults,
  renderEndpointModels,
} from './components';
import { getSelectedIcon, getDisplayValue } from './utils';
import { CustomMenu as Menu } from './CustomMenu';
import DialogManager from './DialogManager';
import { useLocalize } from '~/hooks';
import { ChevronDownIcon } from '@radix-ui/react-icons';

function ModelSelectorContent() {
  const localize = useLocalize();

  const getModelSuffix = (displayValue: string) => {
    if (!displayValue || displayValue === localize('com_ui_select_model')) {
      return '';
    }

    // For models starting with 'o', show the whole thing
    if (displayValue.startsWith('o1')) {
      return displayValue;
    }

    // For GPT models, remove the 'gpt-' prefix
    if (displayValue.startsWith('gpt-')) {
      return displayValue.replace(/^gpt-/, '');
    }

    // For other models, show as is
    return displayValue;
  };

  const {
    // LibreChat
    modelSpecs,
    mappedEndpoints,
    endpointsConfig,
    // State
    searchValue,
    searchResults,
    selectedValues,

    // Functions
    setSearchValue,
    setSelectedValues,
    // Dialog
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig],
  );
  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, modelSpecs, selectedValues, mappedEndpoints],
  );

  const trigger = (
    <button
      className="ring-none my-1 flex h-10 w-full max-w-[70vw] items-center justify-center gap-2 rounded-xl border-none bg-surface-secondary px-3 py-2 text-sm text-text-primary hover:bg-surface-tertiary"
      aria-label={localize('com_ui_select_model')}
    >
      {/* {selectedIcon && React.isValidElement(selectedIcon) && (
        <div className="flex flex-shrink-0 items-center justify-center overflow-hidden">
          {selectedIcon}
        </div>
      )} */}
      {/* <span className="flex-grow truncate text-left">{selectedDisplayValue}</span> */}
      <span className="flex-grow truncate text-left text-lg font-thin tracking-wide">
        ChatEBT{getModelSuffix(selectedDisplayValue) && ` ${getModelSuffix(selectedDisplayValue)}`}
      </span>
      <ChevronDownIcon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="relative flex w-full max-w-md flex-col items-center gap-2">
      <Menu
        values={selectedValues}
        onValuesChange={(values: Record<string, any>) => {
          setSelectedValues({
            endpoint: values.endpoint || '',
            model: values.model || '',
            modelSpec: values.modelSpec || '',
          });
        }}
        onSearch={(value) => setSearchValue(value)}
        combobox={<input placeholder={localize('com_endpoint_search_models')} />}
        trigger={trigger}
      >
        {searchResults ? (
          renderSearchResults(searchResults, localize, searchValue)
        ) : (
          <>
            {renderModelSpecs(modelSpecs, selectedValues.modelSpec || '')}
            {/* Render OpenAI models directly without the endpoint wrapper */}
            {mappedEndpoints && mappedEndpoints.length > 0 && mappedEndpoints[0].models
              ? renderEndpointModels(
                  mappedEndpoints[0],
                  mappedEndpoints[0].models,
                  selectedValues.model,
                )
              : null}
          </>
        )}
      </Menu>
      <DialogManager
        keyDialogOpen={keyDialogOpen}
        onOpenChange={onOpenChange}
        endpointsConfig={endpointsConfig || {}}
        keyDialogEndpoint={keyDialogEndpoint || undefined}
      />
    </div>
  );
}

export default function ModelSelector({ startupConfig }: ModelSelectorProps) {
  return (
    <ModelSelectorProvider startupConfig={startupConfig}>
      <ModelSelectorContent />
    </ModelSelectorProvider>
  );
}
