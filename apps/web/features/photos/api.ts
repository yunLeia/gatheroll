import { request } from "@/lib/api";
import { toUploadPhoto } from "./wire";
import type {
  Authorization,
  PhotoInput,
  PhotoLimits,
  PhotoPage,
} from "./types";

export function photoApi(share: string, token: string) {
  const root = `/events/${encodeURIComponent(share)}/photos`;
  return {
    limits: (signal: AbortSignal) =>
      request<PhotoLimits>(`${root}/limits`, { token, signal }),
    list: (signal: AbortSignal, offset = 0) =>
      request<PhotoPage>(`${root}?offset=${offset}`, { token, signal }),
    initialize: (photos: PhotoInput[], signal: AbortSignal) =>
      request<Authorization[]>(`${root}/uploads`, {
        method: "POST",
        body: { photos: photos.map(toUploadPhoto) },
        token,
        signal,
      }),
    complete: (id: string, signal: AbortSignal) =>
      request(`${root}/${encodeURIComponent(id)}/complete`, {
        method: "POST",
        token,
        signal,
      }),
  };
}
