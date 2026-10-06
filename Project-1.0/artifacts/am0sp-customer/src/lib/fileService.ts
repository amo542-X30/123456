import { supabase } from './supabase';
import { isB2StorageBucket, storageProvider } from './storage';
import { getFileCategory } from './utils';
import type { FileItem, FileCategory, StorageStats } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function getCurrentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

async function waitForUser(maxWaitMs: number = 3000): Promise<string> {
  let user = await getCurrentUser();
  if (user) return user.id;

  const start = Date.now();
  while (!user && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 100));
    user = await getCurrentUser();
  }
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

function getMediaProxyUrl(fileId: string, action: 'proxy' | 'download' | 'inspect' | 'signed'): string {
  return `${SUPABASE_URL}/functions/v1/media-proxy/${action}/${fileId}`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${session?.access_token || ''}`,
  };
}

export async function uploadFile(
  file: File,
  folderId: string | null,
  onProgress?: (progress: number) => void
): Promise<FileItem> {
  const userId = await waitForUser();

  const fileId = crypto.randomUUID();
  const mimeType = getUploadMimeType(file);
  const category = getFileCategory(mimeType);

  const uploadResult = await storageProvider.uploadFile(userId, fileId, file, onProgress, mimeType);

  const { data, error } = await supabase
    .from('files')
    .insert({
      id: fileId,
      folder_id: folderId,
      original_name: file.name,
      storage_key: uploadResult.storageKey,
      bucket_id: uploadResult.bucketId,
      mime_type: uploadResult.mimeType,
      size_bytes: uploadResult.sizeBytes,
      category,
    })
    .select()
    .single();

  if (error) {
    await storageProvider.deleteFile(uploadResult.storageKey, uploadResult.bucketId);
    throw new Error(`Failed to save file metadata: ${error.message}`);
  }

  return data;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  mpe: 'video/mpeg',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mts: 'video/mp2t',
  webm: 'video/webm',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  xml: 'application/xml',
  json: 'application/json',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function getUploadMimeType(file: File): string {
  const browserMimeType = file.type.split(';', 1)[0]?.trim().toLowerCase();
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const extensionMimeType = extension ? MIME_BY_EXTENSION[extension] : undefined;

  if (
    browserMimeType &&
    browserMimeType !== 'application/octet-stream' &&
    getFileCategory(browserMimeType) !== 'other'
  ) {
    return browserMimeType;
  }
  return extensionMimeType || browserMimeType || 'application/octet-stream';
}

export async function getFiles(
  category?: FileCategory,
  folderId?: string | null,
  options?: {
    search?: string;
    sortBy?: 'name' | 'size' | 'date';
    favoritesOnly?: boolean;
    trashOnly?: boolean;
    page?: number;
    pageSize?: number;
  }
): Promise<{ files: FileItem[]; total: number }> {
  const userId = await waitForUser();

  let query = supabase
    .from('files')
    .select('*', { count: 'exact' })
    .eq('user_id', userId);

  if (category) {
    query = query.eq('category', category);
  }

  if (folderId === null) {
    query = query.is('folder_id', null);
  } else if (folderId) {
    query = query.eq('folder_id', folderId);
  }

  if (options?.trashOnly) {
    query = query.not('deleted_at', 'is', null);
  } else if (options?.favoritesOnly) {
    query = query.eq('is_favorite', true).is('deleted_at', null);
  } else {
    query = query.is('deleted_at', null);
  }

  if (options?.search) {
    query = query.ilike('original_name', `%${options.search}%`);
  }

  const sortBy = options?.sortBy || 'date';
  if (sortBy === 'name') {
    query = query.order('original_name', { ascending: true });
  } else if (sortBy === 'size') {
    query = query.order('size_bytes', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const page = options?.page || 1;
  const pageSize = options?.pageSize || 50;
  query = query.range((page - 1) * pageSize, page * pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch files: ${error.message}`);
  }

  return { files: data || [], total: count || 0 };
}

export async function getStorageStats(): Promise<StorageStats> {
  const userId = await waitForUser();

  const { data, error } = await supabase
    .from('files')
    .select('size_bytes, category')
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to get storage stats: ${error.message}`);
  }

  const stats: StorageStats = {
    totalBytes: 0, videoBytes: 0, photoBytes: 0, documentBytes: 0, otherBytes: 0,
    totalFiles: 0, videoCount: 0, photoCount: 0, documentCount: 0, otherCount: 0,
  };

  for (const file of data || []) {
    stats.totalBytes += file.size_bytes;
    stats.totalFiles++;
    switch (file.category) {
      case 'video':
        stats.videoBytes += file.size_bytes;
        stats.videoCount++;
        break;
      case 'photo':
        stats.photoBytes += file.size_bytes;
        stats.photoCount++;
        break;
      case 'document':
        stats.documentBytes += file.size_bytes;
        stats.documentCount++;
        break;
      default:
        stats.otherBytes += file.size_bytes;
        stats.otherCount++;
    }
  }

  return stats;
}

export async function renameFile(fileId: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from('files')
    .update({ original_name: newName })
    .eq('id', fileId);

  if (error) throw new Error(`Failed to rename file: ${error.message}`);
}

export async function toggleFavorite(fileId: string, isFavorite: boolean): Promise<void> {
  const { error } = await supabase
    .from('files')
    .update({ is_favorite: !isFavorite })
    .eq('id', fileId);

  if (error) throw new Error(`Failed to toggle favorite: ${error.message}`);
}

export async function moveFile(fileId: string, folderId: string | null): Promise<void> {
  const { error } = await supabase
    .from('files')
    .update({ folder_id: folderId })
    .eq('id', fileId);

  if (error) throw new Error(`Failed to move file: ${error.message}`);
}

export async function softDeleteFile(fileId: string): Promise<void> {
  const { error } = await supabase
    .from('files')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', fileId);

  if (error) throw new Error(`Failed to move file to trash: ${error.message}`);
}

export async function restoreFile(fileId: string): Promise<void> {
  const { error } = await supabase
    .from('files')
    .update({ deleted_at: null })
    .eq('id', fileId);

  if (error) throw new Error(`Failed to restore file: ${error.message}`);
}

export async function permanentDeleteFile(file: FileItem): Promise<void> {
  await storageProvider.deleteFile(file.storage_key, file.bucket_id);

  const { error } = await supabase
    .from('files')
    .delete()
    .eq('id', file.id);

  if (error) throw new Error(`Failed to permanently delete file: ${error.message}`);
}

export async function getFileUrl(file: FileItem): Promise<string> {
  if (isB2StorageBucket(file.bucket_id)) {
    return storageProvider.getSignedUrl(file.storage_key, 3600, file.bucket_id);
  }

  if (file.category === 'video') {
    const headers = await getAuthHeaders();
    const resp = await fetch(getMediaProxyUrl(file.id, 'signed'), { headers });
    if (!resp.ok) throw new Error(`Failed to get video URL: ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data.signedUrl;
  }
  return storageProvider.getBlobUrl(file.storage_key, file.bucket_id);
}

export async function getStreamingUrl(file: FileItem): Promise<string> {
  if (isB2StorageBucket(file.bucket_id)) {
    return storageProvider.getSignedUrl(file.storage_key, 3600, file.bucket_id);
  }

  const headers = await getAuthHeaders();
  const resp = await fetch(getMediaProxyUrl(file.id, 'signed'), { headers });
  if (!resp.ok) throw new Error(`Failed to get streaming URL: ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.signedUrl;
}

export async function getThumbnailUrl(file: FileItem): Promise<string> {
  return storageProvider.getBlobUrl(file.storage_key, file.bucket_id);
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number | null;
}

const SMALL_FILE_THRESHOLD = 30 * 1024 * 1024;

function fetchWithProgress(
  url: string,
  headers: Record<string, string>,
  onProgress?: (p: DownloadProgress) => void,
): { promise: Promise<Blob>; abort: () => void } {
  let xhr: XMLHttpRequest | null = new XMLHttpRequest();

  const promise = new Promise<Blob>((resolve, reject) => {
    xhr!.open('GET', url, true);
    for (const [key, val] of Object.entries(headers)) {
      xhr!.setRequestHeader(key, val);
    }
    xhr!.responseType = 'blob';

    xhr!.onprogress = (e) => {
      if (onProgress) {
        const total = e.lengthComputable ? e.total : 0;
        const percent = e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null;
        onProgress({ loaded: e.loaded, total, percent });
      }
    };

    xhr!.onload = () => {
      const status = xhr!.status;
      const response = xhr!.response as Blob;
      xhr = null;
      if (status >= 200 && status < 300) {
        resolve(response);
      } else {
        response.text().then((t) => {
          let msg = `Download failed: ${status}`;
          try { const j = JSON.parse(t); if (j.error) msg = j.error; } catch { /* Non-JSON responses retain the HTTP status error. */ }
          reject(new Error(msg));
        }).catch(() => reject(new Error(`Download failed: ${status}`)));
      }
    };

    xhr!.onerror = () => { xhr = null; reject(new Error('Network error during download')); };
    xhr!.onabort = () => { xhr = null; reject(new DOMException('Download aborted', 'AbortError')); };

    xhr!.send();
  });

  return {
    promise,
    abort: () => { if (xhr) { xhr.abort(); xhr = null; } },
  };
}

function triggerNativeDownload(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function downloadFile(
  file: FileItem,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const headers = await getAuthHeaders();
  const isB2File = isB2StorageBucket(file.bucket_id);
  let signedData: {
    signedUrl: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
  };

  if (isB2File) {
    signedData = {
      signedUrl: await storageProvider.getSignedUrl(
        file.storage_key,
        3600,
        file.bucket_id,
        file.original_name,
      ),
      fileName: file.original_name,
      mimeType: file.mime_type,
      size: file.size_bytes,
    };
  } else {
    const signedResp = await fetch(getMediaProxyUrl(file.id, 'signed'), { headers });
    if (!signedResp.ok) {
      let errMsg = `Download failed: ${signedResp.status}`;
      try { const e = await signedResp.json(); if (e.error) errMsg = e.error; } catch { /* Non-JSON responses retain the HTTP status error. */ }
      throw new Error(errMsg);
    }
    signedData = await signedResp.json();
    if ('error' in signedData && signedData.error) throw new Error(String(signedData.error));
  }

  const fileName = signedData.fileName || file.original_name;
  const mimeType = signedData.mimeType || file.mime_type || 'application/octet-stream';
  const totalSize = signedData.size || file.size_bytes || 0;
  const signedUrl = signedData.signedUrl;

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isSmallFile = totalSize > 0 && totalSize < SMALL_FILE_THRESHOLD;

  if (isSmallFile) {
    const downloadUrl = isB2File
      ? storageProvider.getB2ObjectUrl(file.storage_key, fileName)
      : signedUrl;
    const { promise: blobPromise } = fetchWithProgress(downloadUrl, isB2File ? headers : {}, (p) => {
      if (onProgress) {
        onProgress({ loaded: p.loaded, total: p.total || totalSize, percent: p.percent });
      }
    });

    const rawBlob = await blobPromise;
    const typedBlob = new Blob([rawBlob], { type: mimeType });

    if (isIOS && navigator.canShare) {
      const sharedFile = new File([typedBlob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [sharedFile] })) {
        try {
          await navigator.share({ files: [sharedFile], title: fileName });
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        }
      }
    }

    const blobUrl = URL.createObjectURL(typedBlob);
    try {
      triggerNativeDownload(blobUrl, fileName);
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }
    return;
  }

  // Large files: use a signed URL directly — the browser handles the download
  // without loading file bytes into JavaScript memory. The URL includes an
  // attachment disposition so cross-origin navigation still downloads the file.
  onProgress?.({ loaded: 0, total: totalSize, percent: null });

  const downloadUrl = isB2File
    ? signedUrl
    : signedUrl + (signedUrl.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(fileName);
  triggerNativeDownload(downloadUrl, fileName);
}

export interface VideoInspectResult {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  codec: { found?: string };
  moovBeforeMdat: boolean;
  moovFound: boolean;
  mdatFound: boolean;
  atoms: Record<string, unknown>;
  headerBytesRead: number;
}

export async function inspectVideo(fileId: string): Promise<VideoInspectResult> {
  const { data: fileRecord, error: fileLookupError } = await supabase
    .from('files')
    .select('storage_key, bucket_id, original_name, mime_type, size_bytes')
    .eq('id', fileId)
    .maybeSingle();

  if (fileLookupError) {
    throw new Error(`Failed to identify video storage: ${fileLookupError.message}`);
  }

  if (fileRecord && isB2StorageBucket(fileRecord.bucket_id)) {
    const inspection = await storageProvider.inspectB2Object<VideoInspectResult>(fileRecord.storage_key);
    return {
      ...inspection,
      fileName: fileRecord.original_name,
      mimeType: fileRecord.mime_type,
      size: fileRecord.size_bytes,
    };
  }

  const headers = await getAuthHeaders();
  const resp = await fetch(getMediaProxyUrl(fileId, 'inspect'), { headers });
  if (!resp.ok) {
    let errMsg = `Inspect failed: ${resp.status}`;
    try { const e = await resp.json(); if (e.error) errMsg = e.error; } catch { /* Non-JSON responses retain the HTTP status error. */ }
    throw new Error(errMsg);
  }
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data as VideoInspectResult;
}

export async function emptyTrash(): Promise<void> {
  const userId = await waitForUser();

  const { data: trashFiles, error: fetchError } = await supabase
    .from('files')
    .select('id, storage_key, bucket_id')
    .eq('user_id', userId)
    .not('deleted_at', 'is', null);

  if (fetchError) throw new Error(`Failed to fetch trash: ${fetchError.message}`);

  for (const file of trashFiles || []) {
    try {
      await storageProvider.deleteFile(file.storage_key, file.bucket_id);
    } catch (error) {
      if (isB2StorageBucket(file.bucket_id)) {
        throw new Error(
          `Failed to permanently delete B2 file ${file.id}: ${
            error instanceof Error ? error.message : 'storage error'
          }`,
        );
      }
      // Storage object may already be gone — continue with DB cleanup
    }
  }

  const { error: deleteError } = await supabase
    .from('files')
    .delete()
    .eq('user_id', userId)
    .not('deleted_at', 'is', null);

  if (deleteError) throw new Error(`Failed to empty trash: ${deleteError.message}`);
}
