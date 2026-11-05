/**
 * Redimensionne et compresse une photo d'avatar (carré, JPEG) pour limiter le poids.
 * Source : fichier de la galerie, ou image de la caméra (élément vidéo en direct).
 */
export async function compressAvatar(
  file: Blob | HTMLVideoElement,
  size = 256,
  quality = 0.8,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas indisponible');
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
