export interface AppConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmRequest {
  id: number;
  message: string;
  options: AppConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

type ConfirmListener = (request: ConfirmRequest) => void;

let nextConfirmRequestId = 1;
let confirmListener: ConfirmListener | null = null;

export function subscribeConfirmDialogs(listener: ConfirmListener): () => void {
  confirmListener = listener;
  return () => {
    if (confirmListener === listener) {
      confirmListener = null;
    }
  };
}

export async function confirmAction(message: string, options: AppConfirmOptions = {}): Promise<boolean> {
  if (!confirmListener) {
    return window.confirm(message);
  }

  return new Promise<boolean>((resolve) => {
    confirmListener?.({
      id: nextConfirmRequestId,
      message,
      options,
      resolve,
    });
    nextConfirmRequestId += 1;
  });
}
