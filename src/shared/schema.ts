export interface Contact {
  id: number;
  phoneNumber: string;
  name: string | null;
  source: string | null;
  messageContext?: string | null;
  saved: boolean;
  createdAt: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface Message {
  id: number;
  sender: string;
  content: string;
  phoneNumbersDetected: string[] | null;
  createdAt: string | Date | null;
}

export interface ExportHistory {
  id: string;
  filename: string;
  contactCount: number;
  createdAt: string | Date | null;
}
