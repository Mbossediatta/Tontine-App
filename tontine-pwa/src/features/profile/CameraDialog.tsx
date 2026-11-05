import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { compressAvatar } from '@/lib/image';

/**
 * Photo prise en direct : la caméra avant du téléphone (ou la webcam de l'ordinateur)
 * s'affiche, « Prendre la photo » fige l'image. La caméra est coupée à la fermeture.
 */
export function CameraDialog({
  open,
  onClose,
  onPhoto,
}: {
  open: boolean;
  onClose: () => void;
  /** Photo carrée compressée (data URL JPEG), comme une photo de la galerie. */
  onPhoto: (dataUrl: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'La caméra n’est pas disponible sur cet appareil. Choisissez une photo dans la galerie.',
      );
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play().then(() => setReady(true));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'L’accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur, ou choisissez une photo dans la galerie.'
            : 'Impossible d’ouvrir la caméra. Choisissez une photo dans la galerie.',
        );
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open]);

  const take = async () => {
    if (!video.current) return;
    setTaking(true);
    try {
      onPhoto(await compressAvatar(video.current));
      onClose();
    } catch {
      setError('Impossible de prendre la photo. Réessayez.');
    } finally {
      setTaking(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Prendre une photo">
      <div className="flex flex-col items-center gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-warning-bg p-4 text-ink">
            {error}
          </p>
        ) : (
          <>
            {/* Cadre rond : la photo finale est recadrée au carré, comme l'avatar. */}
            <div className="relative h-64 w-64 overflow-hidden rounded-full bg-blue-50">
              <video
                ref={video}
                playsInline
                muted
                aria-label="Aperçu de la caméra"
                // Effet miroir, plus naturel pour un selfie (la photo prise n'est pas inversée).
                className="h-full w-full -scale-x-100 object-cover"
              />
            </div>
            <p className="text-center text-label text-muted">
              Placez votre visage dans le cercle, bien éclairé.
            </p>
            <Button
              variant="blue"
              className="w-full"
              disabled={!ready}
              loading={taking}
              onClick={() => void take()}
              icon={<Camera className="h-5 w-5" aria-hidden="true" />}
            >
              Prendre la photo
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
