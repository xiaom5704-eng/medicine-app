export interface Session {
  id: string;
  title: string;
  created_at: string;
}

export interface Message {
  id?: number;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface MedicationFile {
  id: string;
  preview: string;
  name: string;
}
