import type { PublicWatch, PublicWatchImage } from './api';

export function getWatchDisplayImages(watch: PublicWatch): PublicWatchImage[] {
  if (watch.images.length > 0) {
    return watch.images;
  }

  if (watch.imageUrl) {
    return [
      {
        id: 'legacy',
        url: watch.imageUrl,
        altText: `${watch.brand} ${watch.model}`,
        sortOrder: 0,
        isPrimary: true,
      },
    ];
  }

  return [];
}

export function watchImageAlt(
  image: PublicWatchImage,
  watch: Pick<PublicWatch, 'brand' | 'model'>,
): string {
  const alt = image.altText?.trim();
  return alt || `${watch.brand} ${watch.model}`;
}
