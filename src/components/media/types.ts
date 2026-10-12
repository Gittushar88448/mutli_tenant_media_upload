export type MediaItem = {
  id: string;
  kind: "image" | "video" | "audio";
  filename?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  mime?: string;
  createdAt: string;
};

export const mediaUrl = (id: string) => `/api/media/${id}/file`;
