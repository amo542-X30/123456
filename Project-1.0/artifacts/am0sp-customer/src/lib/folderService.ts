import { supabase } from './supabase';
import type { Folder } from './types';

async function waitForUser(maxWaitMs: number = 3000): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user.id;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 100));
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user) return s.user.id;
  }
  throw new Error('Not authenticated');
}

export async function getFolders(parentId?: string | null): Promise<Folder[]> {
  const userId = await waitForUser();

  let query = supabase
    .from('folders')
    .select('*')
    .eq('user_id', userId);

  if (parentId === null) {
    query = query.is('parent_id', null);
  } else if (parentId) {
    query = query.eq('parent_id', parentId);
  }

  query = query.order('name', { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch folders: ${error.message}`);
  return data || [];
}

export async function getAllFolders(): Promise<Folder[]> {
  const userId = await waitForUser();

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });

  if (error) throw new Error(`Failed to fetch folders: ${error.message}`);
  return data || [];
}

export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const { data, error } = await supabase
    .from('folders')
    .insert({ name, parent_id: parentId })
    .select()
    .single();

  if (error) throw new Error(`Failed to create folder: ${error.message}`);
  return data;
}

export async function renameFolder(folderId: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from('folders')
    .update({ name: newName })
    .eq('id', folderId);

  if (error) throw new Error(`Failed to rename folder: ${error.message}`);
}

export async function deleteFolder(folderId: string): Promise<void> {
  const { error } = await supabase
    .from('folders')
    .delete()
    .eq('id', folderId);

  if (error) throw new Error(`Failed to delete folder: ${error.message}`);
}

export async function getFolderPath(folderId: string | null): Promise<Folder[]> {
  if (!folderId) return [];
  const path: Folder[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('id', currentId)
      .maybeSingle();

    if (error || !data) break;
    const folder = data as Folder;
    path.unshift(folder);
    currentId = folder.parent_id;
  }

  return path;
}
