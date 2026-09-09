import type { AlbumApi } from "./album-api";
import type { StoredPhoto } from "./types";

export const DOWNLOAD_CONCURRENCY = 3;

export async function collectAll(
  service: Pick<AlbumApi, "list">,
  signal: AbortSignal,
  excludeMine: boolean,
): Promise<StoredPhoto[]> {
  const photos: StoredPhoto[] = [];
  let offset: number | null = 0;
  while (offset !== null && !signal.aborted) {
    const page = await service.list(signal, offset, excludeMine);
    photos.push(...page.photos);
    offset = page.next_offset;
  }
  return photos;
}
