import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 0);

    return () => {
      previousActiveElement?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busy) onCancel();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = [cancelButtonRef.current, confirmButtonRef.current].filter(
        (element): element is HTMLButtonElement => Boolean(element && !element.disabled),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="confirm-dialog-header">
          <h2 id="confirm-dialog-title">{title}</h2>
        </div>
        <div className="confirm-dialog-body">
          <p id="confirm-dialog-message">{message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="confirm-dialog-cancel-btn"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className={destructive ? 'confirm-dialog-confirm-btn confirm-dialog-confirm-btn-danger' : 'confirm-dialog-confirm-btn'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
