export type PhotoMetadata = {
  captured_at: string | null;
  latitude: number | null;
  longitude: number | null;
  width: number | null;
  height: number | null;
  has_camera_exif: boolean;
};
export type PhotoInput = PhotoMetadata & {
  client_id: string;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  thumbnail_size_bytes: number | null;
  blur_score: number | null;
  is_likely_screenshot: boolean;
  content_hash: string | null;
};
export type UploadTarget = { url: string; headers: Record<string, string> };
export type Authorization = {
  id: string;
  client_id: string;
  status: "pending_upload" | "uploaded_private";
  original: UploadTarget | null;
  thumbnail: UploadTarget | null;
  expires_in_seconds: number;
};
export type PhotoJob = {
  input: PhotoInput;
  file: File;
  thumbnail: Blob | null;
  preview: string | null;
  state: "selected" | "uploading" | "failed" | "uploaded";
  originalUploaded: boolean;
  thumbnailUploaded: boolean;
  error?: string;
};
export type PhotoLimits = {
  batch_limit: number;
  max_bytes: number;
  thumbnail_max_bytes: number;
  accepted_types: string[];
};
export type StoredPhoto = {
  id: string;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  status: "uploaded_private";
  preview_url: string | null;
  preview_expires_in_seconds: number;
};
export type PhotoPage = { photos: StoredPhoto[]; next_offset: number | null };
