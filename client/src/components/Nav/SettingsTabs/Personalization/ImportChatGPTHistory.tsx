import { useState, useRef, useEffect } from 'react';
import { useRecoilState } from 'recoil';
import { Upload } from 'lucide-react';
import { Spinner, useToastContext, CircleHelpIcon } from '@librechat/client';
import axios from 'axios';
import type { TError } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import useChatGPTImportOnboarding from '~/hooks/useChatGPTImportOnboarding';
import store from '~/store';
import { cn } from '~/utils';

interface ImportJobStatus {
  jobId: string;
  userId: string;
  totalConversations: number;
  processedConversations: number;
  status: 'processing' | 'completed' | 'failed';
  error: string | null;
}

const IMPORT_JOB_KEY = 'chatgpt_import_job_id';

function ImportChatGPTHistory() {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToastContext();
  const [allowImport, setAllowImport] = useState(true);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [, setErrors] = useState<string[]>([]);
  const setError = (error: string) => setErrors((prevErrors) => [...prevErrors, error]);
  const { markImported } = useChatGPTImportOnboarding();
  const [showInstructions, setShowInstructions] = useState(false);
  const [shouldOpenInstructions, setShouldOpenInstructions] = useRecoilState(
    store.openImportInstructionsAtom,
  );

  useEffect(() => {
    if (!shouldOpenInstructions) {
      return;
    }

    setShowInstructions(true);
    setShouldOpenInstructions(false);

    if (sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [setShouldOpenInstructions, shouldOpenInstructions]);

  // On mount, check if there's an ongoing import job
  useEffect(() => {
    const savedJobId = localStorage.getItem(IMPORT_JOB_KEY);
    if (savedJobId) {
      // Resume polling for this job
      setCurrentJobId(savedJobId);
      setAllowImport(false);

      // Show immediate toast to indicate import is resuming
      showToast({
        message: 'Resuming import... Do not close this tab',
        status: 'info',
        showIcon: false,
      });
    }
  }, [showToast]);

  // Poll for import progress
  useEffect(() => {
    if (!currentJobId) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const response = await axios.get<ImportJobStatus>(
          `/api/convos/import/progress/${currentJobId}`,
        );
        const status = response.data;

        if (status.status === 'completed') {
          clearInterval(pollInterval);
          localStorage.removeItem(IMPORT_JOB_KEY);
          showToast({
            message: `Successfully imported ${status.totalConversations} conversations!`,
            status: 'success',
          });
          markImported();
          setCurrentJobId(null);
          setAllowImport(true);

          // Refresh conversation list
          window.location.reload();
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          localStorage.removeItem(IMPORT_JOB_KEY);
          showToast({
            message: `Import failed: ${status.error || 'Unknown error'}`,
            status: 'error',
          });
          setCurrentJobId(null);
          setAllowImport(true);
        } else if (status.status === 'processing') {
          // Update progress toast
          const progress = `${status.processedConversations}/${status.totalConversations}`;
          const percentage = Math.round(
            (status.processedConversations / status.totalConversations) * 100,
          );

          showToast({
            message: `Importing conversations: ${progress} (${percentage}%) - Do not close this tab`,
            status: 'info',
            showIcon: false,
          });
        }
      } catch (error) {
        console.error('Error polling import status:', error);
        clearInterval(pollInterval);
        localStorage.removeItem(IMPORT_JOB_KEY);
        setCurrentJobId(null);
        setAllowImport(true);
      }
    }, 1000); // Poll every second

    return () => clearInterval(pollInterval);
  }, [currentJobId, showToast, markImported]);

  const startUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file, encodeURIComponent(file.name || 'File'));

    try {
      const response = await axios.post('/api/convos/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const { jobId, totalConversations } = response.data;

      // Save jobId to localStorage so polling can resume after refresh
      localStorage.setItem(IMPORT_JOB_KEY, jobId);
      setCurrentJobId(jobId);
      showToast({
        message: `Starting import of ${totalConversations} conversations - Do not close this tab`,
        status: 'info',
      });
    } catch (error) {
      const axiosError = error as TError;
      setAllowImport(true);
      showToast({
        message: axiosError.response?.data?.message || localize('com_ui_import_conversation_error'),
        status: 'error',
      });
    }
  };

  const handleFiles = async (_file: File) => {
    try {
      // Check file size (100MB limit)
      const maxSize = 100 * 1024 * 1024; // 100MB in bytes
      if (_file.size > maxSize) {
        showToast({
          message: `File is too large. Maximum size is 100MB. Your file is ${(_file.size / (1024 * 1024)).toFixed(2)}MB`,
          status: 'error',
        });
        return;
      }

      setAllowImport(false);
      await startUpload(_file);
    } catch (error) {
      console.log('file handling error', error);
      setError('An error occurred while processing the file.');
      setAllowImport(true);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFiles(file);
    }
    // Reset input so the same file can be selected again if needed
    event.target.value = '';
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleImportClick();
    }
  };

  return (
    <div ref={sectionRef} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <span>Import ChatGPT History</span>
            <button
              type="button"
              aria-label="How to export chats from ChatGPT"
              aria-expanded={showInstructions}
              aria-controls="chatgpt-import-instructions"
              onClick={() => setShowInstructions((prev) => !prev)}
              className="rounded-full p-1 text-text-tertiary transition-colors hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-border-active focus:ring-offset-2"
            >
              <CircleHelpIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            Upload your conversations.json file exported from ChatGPT to import your chat history.
          </div>
        </div>
        <div className="relative">
          <button
            onClick={handleImportClick}
            onKeyDown={handleKeyDown}
            disabled={!allowImport}
            aria-label="Import ChatGPT History"
            className="btn btn-neutral relative ml-4 flex items-center gap-2"
          >
            {allowImport ? (
              <Upload className="h-4 w-4 stroke-1" />
            ) : (
              <Spinner className="w-4" />
            )}
            <span>Upload</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className={cn('hidden')}
            accept=".json"
            onChange={handleFileChange}
            aria-hidden="true"
          />
        </div>
      </div>
      {showInstructions && (
        <div
          id="chatgpt-import-instructions"
          className="rounded-md border border-border-medium bg-surface-secondary px-3 py-3 text-xs text-text-secondary"
        >
          <ol className="list-decimal space-y-1 pl-4">
            <li>Open ChatGPT and navigate to Settings.</li>
            <li>Select Data Controls.</li>
            <li>Choose Export Data and confirm the request.</li>
            <li>OpenAI will email you a link when the export is ready.</li>
            <li>Download the ZIP archive from the email.</li>
            <li>Unzip the file and upload the conversations.json here.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

export default ImportChatGPTHistory;
