import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Button, Modal, OtpInput, PhoneInput } from '@/components/ui';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/format';
import { useAction } from '@/lib/query';
import { changePhoneSchema, type ChangePhoneValues } from '@/lib/validators';
import { authService, memberService } from '@/services';
import type { User } from '@/types';

/**
 * Changement de numéro d'un membre, en deux étapes :
 * 1. saisie du nouveau numéro → un code SMS y est envoyé ;
 * 2. le membre communique ce code au super administrateur, qui le saisit.
 * Le code prouve que le nouveau numéro appartient bien au membre.
 */
export function ChangePhoneDialog({
  user,
  open,
  onClose,
}: {
  user: User;
  open: boolean;
  onClose: () => void;
}) {
  // Numéro auquel le code a été envoyé (null : on en est à la 1re étape).
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ChangePhoneValues>({
    resolver: zodResolver(changePhoneSchema),
    defaultValues: { phone: '', code: '' },
  });

  // Repart de zéro à chaque ouverture.
  useEffect(() => {
    if (open) {
      reset({ phone: '', code: '' });
      setSentTo(null);
    }
  }, [open, reset]);

  const save = useAction({
    action: ({ phone, code }: ChangePhoneValues) => memberService.changePhone(user.id, phone, code),
    success: 'Numéro modifié',
    onSuccess: onClose,
  });

  const sendCode = async () => {
    const phone = watch('phone');
    if (!/^7\d{8}$/.test(phone)) return;
    setSending(true);
    try {
      await authService.sendOtp(phone);
      setSentTo(phone);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Changer le numéro">
      <form
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="flex flex-col gap-4"
        noValidate
      >
        <p className="text-ink">
          Numéro actuel : <strong className="tabular-nums">{formatPhone(user.phone)}</strong>
        </p>
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <PhoneInput
              label="Nouveau numéro"
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                // Changer de numéro après l'envoi oblige à renvoyer un code.
                if (sentTo) setSentTo(null);
              }}
              onBlur={field.onBlur}
              error={errors.phone?.message}
            />
          )}
        />
        {sentTo ? (
          <>
            <Controller
              control={control}
              name="code"
              render={({ field }) => (
                <OtpInput
                  label={`Code reçu par SMS au ${formatPhone(sentTo)}`}
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.code?.message}
                />
              )}
            />
            {env.useMocks ? (
              <p className="rounded-control bg-blue-100 p-3 text-label text-blue-700">
                Mode démonstration : le code est <strong className="tabular-nums">123456</strong>.
              </p>
            ) : null}
            <OnlineButton type="submit" variant="blue" loading={save.isPending} className="w-full">
              Valider le nouveau numéro
            </OnlineButton>
          </>
        ) : (
          <Button
            variant="blue"
            loading={sending}
            onClick={() => void sendCode()}
            disabled={!/^7\d{8}$/.test(watch('phone'))}
            className="w-full"
          >
            Envoyer un code à ce numéro
          </Button>
        )}
      </form>
    </Modal>
  );
}
