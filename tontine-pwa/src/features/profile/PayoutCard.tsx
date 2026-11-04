import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle, PhoneInput, Select } from '@/components/ui';
import { useAuthStore, useCurrentUser } from '@/hooks/useAuth';
import { useAction } from '@/lib/query';
import { payoutSchema, type PayoutValues } from '@/lib/validators';
import { authService } from '@/services';

/** Numéro Wave ou Orange Money où recevoir la cagnotte. */
export function PayoutCard() {
  const user = useCurrentUser();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<PayoutValues>({
    resolver: zodResolver(payoutSchema),
    defaultValues: {
      payoutMethod: user.payoutMethod ?? 'wave',
      payoutPhone: user.payoutPhone ?? user.phone,
    },
  });

  const save = useAction({
    action: (values: PayoutValues) => authService.updateProfile(values),
    success: 'Numéro de reversement enregistré',
    onSuccess: (updated) => {
      useAuthStore.getState().setUser(updated);
      reset({
        payoutMethod: updated.payoutMethod ?? 'wave',
        payoutPhone: updated.payoutPhone ?? '',
      });
    },
  });

  return (
    <Card>
      <form
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="flex flex-col gap-3"
        noValidate
      >
        <div>
          <CardTitle>Recevoir la cagnotte</CardTitle>
          <p className="text-label text-muted">
            Le numéro sur lequel l’administrateur vous reverse la cagnotte.
          </p>
        </div>
        {!user.payoutPhone ? (
          <p className="rounded-control bg-blue-100 p-3 text-label text-blue-900">
            Aucun numéro enregistré : renseignez-le pour pouvoir recevoir la cagnotte.
          </p>
        ) : null}
        <Select
          label="Service"
          options={[
            { value: 'wave', label: 'Wave' },
            { value: 'orange_money', label: 'Orange Money' },
          ]}
          error={errors.payoutMethod?.message}
          {...register('payoutMethod')}
        />
        <Controller
          control={control}
          name="payoutPhone"
          render={({ field }) => (
            <PhoneInput
              label="Numéro de reversement"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.payoutPhone?.message}
            />
          )}
        />
        <OnlineButton
          type="submit"
          variant="secondary"
          block
          loading={save.isPending}
          disabled={!isDirty && Boolean(user.payoutPhone)}
        >
          Enregistrer
        </OnlineButton>
      </form>
    </Card>
  );
}
