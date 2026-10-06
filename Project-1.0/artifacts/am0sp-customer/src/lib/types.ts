export type FileCategory = 'video' | 'photo' | 'document' | 'other';

export interface Folder {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FileItem {
  id: string;
  user_id: string;
  folder_id: string | null;
  original_name: string;
  storage_key: string;
  bucket_id: string;
  mime_type: string;
  size_bytes: number;
  category: FileCategory;
  is_favorite: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  user_id: string;
  user_agent: string | null;
  device_name: string | null;
  ip_address: string | null;
  login_at: string;
  last_active_at: string;
  is_current: boolean;
  session_id: string | null;
  created_at: string;
}

export interface SecurityEvent {
  id: string;
  user_id: string;
  event_type: string;
  description: string | null;
  device_name: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface Passkey {
  id: string;
  user_id: string;
  credential_id: string;
  device_name: string | null;
  created_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  terminal_effects: boolean;
  animation_intensity: 'full' | 'reduced' | 'off';
  reduced_motion: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorageStats {
  totalBytes: number;
  videoBytes: number;
  photoBytes: number;
  documentBytes: number;
  otherBytes: number;
  totalFiles: number;
  videoCount: number;
  photoCount: number;
  documentCount: number;
  otherCount: number;
}
