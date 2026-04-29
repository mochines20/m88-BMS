import React, { useEffect, useRef, useState } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  message: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  type?: 'prompt' | 'confirm' | 'alert';
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  placeholder = 'Enter your reason...',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  defaultValue = '',
  type = 'prompt'
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-[32px] border border-[var(--role-border)] bg-[var(--bms-bg-1)] p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--role-primary)]/5 via-transparent to-[var(--role-secondary)]/5" />
        
        <h3 className="text-2xl font-bold text-[var(--role-text)]">{title}</h3>
        <p className="mt-2 text-[var(--role-text)]/70">{message}</p>
        
        {type === 'prompt' && (
          <div className="mt-6">
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="min-h-[120px] w-full rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4 text-[var(--role-text)] placeholder-[var(--bms-muted)] outline-none ring-[var(--role-primary)]/20 transition-all focus:border-[var(--role-primary)]/50 focus:bg-[var(--bms-bg-1)] focus:ring-4"
            />
          </div>
        )}
        
        <div className="mt-8 flex flex-wrap-reverse items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] px-6 py-3 font-semibold text-[var(--role-text)] transition hover:bg-[var(--role-border)] sm:flex-none"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => onConfirm(value)}
            className="flex-1 rounded-2xl bg-[var(--role-primary)] px-8 py-3 font-semibold text-white shadow-lg transition hover:scale-[1.02] hover:shadow-[var(--role-primary)]/25 active:scale-[0.98] sm:flex-none"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
