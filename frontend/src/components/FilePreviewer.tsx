import React from 'react';

interface FilePreviewerProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl: string;
  fileName: string;
}

const FilePreviewer: React.FC<FilePreviewerProps> = ({ isOpen, onClose, fileUrl, fileName }) => {
  if (!isOpen) return null;

  const isPDF = fileUrl.toLowerCase().endsWith('.pdf') || fileUrl.includes('pdf');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />
      
      {/* Content */}
      <div className="relative flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-white/20 bg-black/20 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-black/40 p-4 text-white">
          <h3 className="text-lg font-semibold truncate px-4">{fileName}</h3>
          <div className="flex items-center gap-3">
            <a 
              href={fileUrl} 
              download={fileName}
              className="rounded-full bg-white/10 p-2 transition hover:bg-white/20"
              title="Download"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
            <button
              onClick={onClose}
              className="rounded-full bg-white/10 p-2 transition hover:bg-white/20"
              title="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Body */}
        <div className="flex-1 overflow-auto bg-white/5 p-4 flex items-center justify-center">
          {isPDF ? (
            <iframe
              src={`${fileUrl}#toolbar=0`}
              className="h-full w-full rounded-xl"
              title={fileName}
            />
          ) : (
            <img
              src={fileUrl}
              alt={fileName}
              className="max-h-full max-w-full object-contain shadow-2xl rounded-xl"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default FilePreviewer;
