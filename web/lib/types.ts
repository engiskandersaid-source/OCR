export type OcrLine = { text: string; score: number; page: number };

export type Extraction = {
  is_bank_transfer: boolean;
  sender: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null; // YYYY-MM-DD
};

export type ExtractResult = Extraction & {
  needs_review: boolean;
  warnings: string[];
};

export type HistoryItem = {
  id: string;
  fileName: string;
  at: number;
  /** Admins only: the uploader's name, or null for a transfer with no known uploader. */
  owner?: string | null;
  result: ExtractResult;
};
