/*
# AM0SP Private Vault - Initial Schema

## Overview
This migration creates the complete database schema for the AM0SP Private Vault application.
It supports users, folders, files, devices/sessions, security events, favorites, trash,
user settings, and storage usage tracking.

## New Tables

1. **folders** — Real folder hierarchy for organizing files.
   - id (uuid PK)
   - user_id (uuid, references auth.users, defaults to auth.uid())
   - name (text, folder display name)
   - parent_id (uuid, self-reference for nested folders, nullable)
   - created_at, updated_at (timestamps)

2. **files** — Metadata for every uploaded file. The actual file content lives in
   Supabase Storage (object storage); this table only stores metadata.
   - id (uuid PK)
   - user_id (uuid, references auth.users, defaults to auth.uid())
   - folder_id (uuid, references folders, nullable for root-level files)
   - original_name (text)
   - storage_key (text, the path/key inside the storage bucket)
   - bucket_id (text, the storage bucket name)
   - mime_type (text)
   - size_bytes (bigint)
   - category (text: 'video' | 'photo' | 'document' | 'other')
   - is_favorite (boolean, default false)
   - deleted_at (timestamptz, nullable — when set, file is in trash)
   - created_at, updated_at (timestamps)

3. **devices** — Tracks every logged-in device/session for the account owner.
   - id (uuid PK)
   - user_id (uuid, references auth.users)
   - user_agent (text)
   - device_name (text, human-friendly name parsed from UA)
   - ip_address (inet, nullable)
   - login_at (timestamptz)
   - last_active_at (timestamptz)
   - is_current (boolean)
   - session_id (text)

4. **security_events** — Audit log of security-relevant actions.
   - id (uuid PK)
   - user_id (uuid)
   - event_type (text)
   - description (text)
   - device_name (text, nullable)
   - ip_address (inet, nullable)
   - created_at (timestamptz)

5. **passkeys** — WebAuthn credential records for passwordless/biometric login.
   - id (uuid PK)
   - user_id (uuid)
   - credential_id (text)
   - device_name (text)
   - created_at (timestamptz)

6. **user_settings** — Per-user appearance and feature preferences.
   - id (uuid PK)
   - user_id (uuid, unique)
   - terminal_effects (boolean, default true)
   - animation_intensity (text: full | reduced | off)
   - reduced_motion (boolean, default false)
   - created_at, updated_at (timestamps)

## Security (RLS)
- RLS enabled on ALL tables.
- Owner-scoped CRUD policies on every table (user_id = auth.uid()).
- user_id columns default to auth.uid() so inserts that omit the column still pass WITH CHECK.

## Important Notes
1. Large file content is NEVER stored in the database — only metadata.
2. Files are soft-deleted via deleted_at column (trash); permanent delete removes row + storage object.
3. Favorites are a boolean flag on files (no separate join table).
*/

-- ============================================================
-- folders
-- ============================================================
CREATE TABLE IF NOT EXISTS public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_folders" ON public.folders;
CREATE POLICY "select_own_folders" ON public.folders FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_folders" ON public.folders;
CREATE POLICY "insert_own_folders" ON public.folders FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_folders" ON public.folders;
CREATE POLICY "update_own_folders" ON public.folders FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_folders" ON public.folders;
CREATE POLICY "delete_own_folders" ON public.folders FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- files
-- ============================================================
CREATE TABLE IF NOT EXISTS public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  original_name text NOT NULL,
  storage_key text NOT NULL,
  bucket_id text NOT NULL DEFAULT 'am0sp-vault',
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('video','photo','document','other')),
  is_favorite boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_files" ON public.files;
CREATE POLICY "select_own_files" ON public.files FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_files" ON public.files;
CREATE POLICY "insert_own_files" ON public.files FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_files" ON public.files;
CREATE POLICY "update_own_files" ON public.files FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_files" ON public.files;
CREATE POLICY "delete_own_files" ON public.files FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_files_user_id ON public.files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON public.files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_category ON public.files(category);
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON public.files(deleted_at);
CREATE INDEX IF NOT EXISTS idx_files_is_favorite ON public.files(is_favorite);
CREATE INDEX IF NOT EXISTS idx_files_user_category_deleted ON public.files(user_id, category, deleted_at);
CREATE INDEX IF NOT EXISTS idx_folders_user_id ON public.folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON public.folders(parent_id);

-- ============================================================
-- devices
-- ============================================================
CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_agent text,
  device_name text,
  ip_address inet,
  login_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT false,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_devices" ON public.devices;
CREATE POLICY "select_own_devices" ON public.devices FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_devices" ON public.devices;
CREATE POLICY "insert_own_devices" ON public.devices FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_devices" ON public.devices;
CREATE POLICY "update_own_devices" ON public.devices FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_devices" ON public.devices;
CREATE POLICY "delete_own_devices" ON public.devices FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- security_events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text,
  device_name text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_security_events" ON public.security_events;
CREATE POLICY "select_own_security_events" ON public.security_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_security_events" ON public.security_events;
CREATE POLICY "insert_own_security_events" ON public.security_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_security_events" ON public.security_events;
CREATE POLICY "update_own_security_events" ON public.security_events FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_security_events" ON public.security_events;
CREATE POLICY "delete_own_security_events" ON public.security_events FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON public.security_events(user_id);

-- ============================================================
-- passkeys
-- ============================================================
CREATE TABLE IF NOT EXISTS public.passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.passkeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_passkeys" ON public.passkeys;
CREATE POLICY "select_own_passkeys" ON public.passkeys FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_passkeys" ON public.passkeys;
CREATE POLICY "insert_own_passkeys" ON public.passkeys FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_passkeys" ON public.passkeys;
CREATE POLICY "update_own_passkeys" ON public.passkeys FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_passkeys" ON public.passkeys;
CREATE POLICY "delete_own_passkeys" ON public.passkeys FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- user_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  terminal_effects boolean NOT NULL DEFAULT true,
  animation_intensity text NOT NULL DEFAULT 'full' CHECK (animation_intensity IN ('full','reduced','off')),
  reduced_motion boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_user_settings" ON public.user_settings;
CREATE POLICY "select_own_user_settings" ON public.user_settings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_user_settings" ON public.user_settings;
CREATE POLICY "insert_own_user_settings" ON public.user_settings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_user_settings" ON public.user_settings;
CREATE POLICY "update_own_user_settings" ON public.user_settings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_user_settings" ON public.user_settings;
CREATE POLICY "delete_own_user_settings" ON public.user_settings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_folders_updated_at ON public.folders;
CREATE TRIGGER trigger_folders_updated_at BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_files_updated_at ON public.files;
CREATE TRIGGER trigger_files_updated_at BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER trigger_user_settings_updated_at BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Storage bucket creation
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('am0sp-vault', 'am0sp-vault', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload own files" ON storage.objects;
CREATE POLICY "Users can upload own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'am0sp-vault' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can read own files" ON storage.objects;
CREATE POLICY "Users can read own files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'am0sp-vault' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can update own files" ON storage.objects;
CREATE POLICY "Users can update own files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'am0sp-vault' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'am0sp-vault' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete own files" ON storage.objects;
CREATE POLICY "Users can delete own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'am0sp-vault' AND (storage.foldername(name))[1] = auth.uid()::text);
