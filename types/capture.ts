export interface CapturedPhoto {
  id?: string;
  dataUrl: string;
  blob?: Blob;
  width?: number;
  height?: number;
  createdAt?: string;
  composedDataUrl?: string;  // canvas-composed JPEG data URL (Story 3)
  composedId?: string;       // server-side ID of the composed image (Story 4)
  composedUrl?: string;      // server-side URL of the composed image (Story 4)
}
