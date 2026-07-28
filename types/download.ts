export interface ComposedUploadResponse {
  token: string;
  downloadUrl: string;
  qrUrl?: string;
  linkedInShareUrl?: string;
  /** ISO timestamp after which the download link stops working. */
  expiresAt?: string;
}
