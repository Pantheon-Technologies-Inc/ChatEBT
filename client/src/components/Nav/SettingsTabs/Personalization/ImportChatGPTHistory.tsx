import { useState, useRef, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { Spinner, useToastContext } from '@librechat/client';
import axios from 'axios';
import type { TError } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
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
  const { showToast } = useToastContext();
  const [allowImport, setAllowImport] = useState(true);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [, setErrors] = useState<string[]>([]);
  const setError = (error: string) => setErrors((prevErrors) => [...prevErrors, error]);

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
  }, [currentJobId, showToast]);

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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="text-sm font-medium text-text-primary">
            Import ChatGPT History
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            Upload your conversations.json file exported from ChatGPT to import your chat history
          </div>
        </div>
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
  );
}

export default ImportChatGPTHistory;
