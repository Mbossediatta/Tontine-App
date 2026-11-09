import type { ChangeEvent } from 'react';
import { ImageIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, GroupPhoto } from '@/components/ui';
import { compressAvatar } from '@/lib/image';

interface GroupPhotoPickerProps {
  name: string;
  value?: string;
  onChange: (photoUrl: string | undefined) => void;
  disabled?: boolean;
}

/**
 * Photo ou logo du groupe, facultatif. Sur téléphone, « Choisir une photo » propose aussi
 * l'appareil photo. L'image est recadrée au carré et compressée (comme la photo de profil).
 */
export function GroupPhotoPicker({ name, value, onChange, disabled }: GroupPhotoPickerProps) {
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onChange(await compressAvatar(file, 320, 0.82));
    } catch {
      toast.error('Impossible de lire cette image.');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-label font-bold text-ink">Photo ou logo du groupe (facultatif)</span>
      <div className="flex items-center gap-4">
        <GroupPhoto name={name.trim() || '?'} src={value} size="lg" />
        <div className="flex flex-wrap gap-2">
          <label
            className={
              disabled
                ? 'inline-flex min-h-touch cursor-not-allowed items-center gap-2 rounded-control border-2 border-line bg-white px-4 text-label font-bold text-muted'
                : 'inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-control border-2 border-blue-700 bg-white px-4 text-label font-bold text-blue-700 focus-within:outline focus-within:outline-[3px] focus-within:outline-green-300 hover:bg-blue-50'
            }
          >
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            {value ? 'Changer la photo' : 'Choisir une photo'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={disabled}
              onChange={(e) => void onFile(e)}
            />
          </label>
          {value ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(undefined)}
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            >
              Retirer
            </Button>
          ) : null}
        </div>
      </div>
      <span className="text-small text-muted">
        Visible par les membres du groupe et partout où le groupe apparaît sur la plateforme.
      </span>
    </div>
  );
}
