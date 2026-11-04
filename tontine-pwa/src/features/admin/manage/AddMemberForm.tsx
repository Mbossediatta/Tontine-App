import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { OnlineButton } from '@/components/layout/OnlineButton';
import { Card, CardTitle, Input, PhoneInput } from '@/components/ui';
import { useAction } from '@/lib/query';
import { addByPhoneSchema, type AddByPhoneValues } from '@/lib/validators';
import { membershipService } from '@/services';

/** Ajoute une personne, ou une part supplémentaire si elle est déjà inscrite. */
export function AddMemberForm({
  groupId,
  maxShares,
}: {
  groupId: string;
  maxShares: number;
}) {
  const {
    control,
    handleSubmit,
    reset,
    register,
    formState: { errors },
  } = useForm<AddByPhoneValues>({
    resolver: zodResolver(addByPhoneSchema),
    defaultValues: { phone: '', shareCount: 1 },
  });
  const add = useAction({
    action: ({ phone, shareCount }: AddByPhoneValues) =>
      membershipService.addByPhone(groupId, phone, shareCount),
    success: (count: number) => `${count} part(s) attribuée(s)`,
    onSuccess: () => reset(),
  });

  return (
    <Card>
      <form
        onSubmit={handleSubmit((values) => add.mutate(values))}
        className="flex flex-col gap-3"
        noValidate
      >
        <CardTitle>Ajouter un membre ou une part</CardTitle>
        <p className="text-label text-muted">
          Indiquez le nombre de parts à attribuer. Si la personne est déjà inscrite, ces parts
          s’ajouteront aux siennes. Il reste {maxShares} place(s) dans ce groupe.
        </p>
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <PhoneInput
              label="Numéro du membre"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.phone?.message}
            />
          )}
        />
        <Input
          label="Nombre de parts à attribuer"
          type="number"
          min={1}
          max={maxShares}
          step={1}
          disabled={maxShares === 0}
          inputMode="numeric"
          error={errors.shareCount?.message}
          {...register('shareCount', { valueAsNumber: true })}
        />
        <OnlineButton
          type="submit"
          variant="secondary"
          block
          disabled={maxShares === 0}
          loading={add.isPending}
          icon={<UserPlus className="h-5 w-5" aria-hidden="true" />}
        >
          Attribuer les parts
        </OnlineButton>
      </form>
    </Card>
  );
}
