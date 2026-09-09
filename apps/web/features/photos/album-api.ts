import { request } from "@/lib/api";
import type { PhotoPage } from "./types";

export function albumApi(share: string, token: string) {
  const root = `/events/${encodeURIComponent(share)}/album`;
  return {
    list: (signal: AbortSignal, offset = 0, excludeMine = false) =>
      request<PhotoPage>(
        `${root}?offset=${offset}&exclude_mine=${excludeMine}`,
        { token, signal },
      ),
    original: (id: string, signal: AbortSignal, download = false) =>
      request<{ url: string; expires_in_seconds: number }>(
        `${root}/${encodeURIComponent(id)}/original?download=${download}`,
        { token, signal },
      ),
  };
}
export type AlbumApi = ReturnType<typeof albumApi>;
