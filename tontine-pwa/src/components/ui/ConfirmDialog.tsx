import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** primary (vert) pour une action d'argent, blue pour une action neutre, danger pour une suppression. */
  tone?: 'primary' | 'blue' | 'danger';
  loading?: boolean;
  /** Texte à recopier pour confirmer (ex. le nom du groupe). */
  confirmText?: string;
}

/** Confirmation obligatoire avant toute action irréversible. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Annuler',
  tone = 'primary',
  loading = false,
  confirmText,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const blocked = confirmText !== undefined && typed.trim() !== confirmText.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} disabled={blocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-body text-ink">
        {children}
        {confirmText !== undefined ? (
          <Input
            label={`Pour confirmer, tapez « ${confirmText} »`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
        ) : null}
      </div>
    </Modal>
  );
}
