export type IconSpec = { kind: 'emoji'; value: string } | { kind: 'img'; dataUrl: string };

export interface Company {
  id: string;
  name: string;
  icon: IconSpec;
  createdAt: string; // ISO
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  createdAt: string; // ISO
}

export type TxType = 'expense' | 'revenue';
export type SyncState = 'local' | 'uploading' | 'synced' | 'error';

export interface ReceiptInfo {
  /** Original (compressed) image. ArrayBuffer — NOT Blob: iOS Safari cannot
   *  reliably store Blobs in IndexedDB (they come back empty/null). */
  blobData: ArrayBuffer | null;
  blobType: string; // e.g. 'image/jpeg'
  /** Small JPEG data URL, always kept locally (list thumbnails + export). */
  thumbDataUrl: string;
  thumbW?: number;
  thumbH?: number;
  driveFileId?: string;
  driveUrl?: string;
  driveName?: string;
  syncState: SyncState;
  syncError?: string;
}

/** Candidates returned by the LLM, kept for audit and the review UI. */
export interface TxLLM {
  amountCandidates: { amount: number; currency: string; label: string }[];
  dateCandidates: { date: string; label: string }[];
  reasonCandidates: string[];
  merchant?: string;
  raw?: unknown;
}

export interface Transaction {
  id: string;
  projectId: string;
  type: TxType;
  /** Positive number; sign implied by `type`. */
  amount: number;
  /** ISO 4217 code. */
  currency: string;
  /** Local calendar date of the transaction: YYYY-MM-DD (no TZ drift). */
  date: string;
  merchant?: string;
  description?: string;
  receipt?: ReceiptInfo;
  llmExtraction?: TxLLM;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Receipt record inside a backup: no binary blob, but flags whether one existed. */
export type BackupReceipt = Omit<ReceiptInfo, 'blobData'> & { hasBlob: boolean };

export type BackupTransaction = Omit<Transaction, 'receipt'> & { receipt?: BackupReceipt };

/** Everything needed to rebuild the app, minus receipt binary blobs
 *  (originals live in Drive; thumbnails are kept for visual restore). */
export interface BackupJSON {
  version: 1;
  exportedAt: string;
  companies: Company[];
  projects: Project[];
  transactions: BackupTransaction[];
  settings: Record<string, unknown>;
}

export interface DriveTokens {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  account?: string;
}

export type DriveStatus =
  | 'unconfigured' // no client id set
  | 'signedOut'
  | 'connecting'
  | 'ready'
  | 'needsReconnect'
  | 'error';

export interface Totals {
  byCurrency: Map<string, number>;
  /** Sum converted to the home currency at each transaction's date rate. */
  home: number;
}
