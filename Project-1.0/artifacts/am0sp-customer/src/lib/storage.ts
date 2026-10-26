import { supabase, STORAGE_BUCKET, SUPABASE_ANON_KEY } from './supabase';
import type { FileCategory } from './types';

export interface UploadResult {
  storageKey: string;
  bucketId: string;
  sizeBytes: number;
  mimeType: string;
}

const API_BASE_URL = `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/api`;

export function isB2StorageBucket(bucketId: string | null | undefined): boolean {
  return bucketId?.startsWith('b2:') ?? false;
}

function fileIdFromStorageKey(storageKey: string): string {
  const fileId = storageKey.split('/').at(-1);
  if (!fileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId)) {
    throw new Error('Invalid storage key.');
  }
  return fileId;
}

async function getActiveSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('An active session is required for private storage.');
  return session;
}

async function getSessionHeaders(): Promise<Record<string, string>> {
  const session = await getActiveSession();
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: SUPABASE_ANON_KEY,
  };
}

async function getResponseError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json() as { error?: unknown };
    if (typeof data.error === 'string' && data.error) return new Error(data.error);
  } catch {
    // Keep the operation-specific fallback for non-JSON responses.
  }
  return new Error(`${fallback} (${response.status})`);
}

function getUploadHttpError(status: number, responseText: string): Error {
  try {
    const response = JSON.parse(responseText) as { error?: unknown };
    if (typeof response.error === 'string' && response.error) {
      return new Error(response.error);
    }
  } catch {
    // The preview proxy can return HTML for errors before the API route handles them.
  }

  if (status === 0) {
    return new Error('The upload service could not be reached. Check your connection and retry.');
  }
  if (status === 401) {
    return new Error('Your sign-in session expired. Sign in again, then retry the upload.');
  }
  if (status === 413) {
    return new Error('This file exceeds the upload service size limit. Try a smaller file.');
  }
  if (status === 502 || status === 503) {
    return new Error('The upload service is unavailable or could not reach Backblaze B2. Retry shortly; if it continues, ask an administrator to check the API service.');
  }
  if (status === 404) {
    return new Error('The upload API route was not found. Reload the app and retry; if it continues, ask an administrator to check the API service.');
  }
  return new Error(`Backblaze B2 upload failed (HTTP ${status}). Retry; if it continues, ask an administrator to check the storage service.`);
}

function uploadB2File(
  fileId: string,
  file: File,
  mimeType: string,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    void getActiveSession().then((session) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${API_BASE_URL}/b2/objects/${encodeURIComponent(fileId)}`);
      request.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
      request.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.setRequestHeader('X-File-Content-Type', mimeType);

      request.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
        }
      };
      request.onerror = () => reject(getUploadHttpError(0, ''));
      request.onabort = () => reject(new Error('The Backblaze B2 upload was interrupted.'));
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          reject(getUploadHttpError(request.status, request.responseText));
          return;
        }

        let response: unknown;
        try {
          response = JSON.parse(request.responseText);
        } catch {
          reject(new Error('The upload service returned an invalid success response. Retry; if it continues, ask an administrator to check the API service.'));
          return;
        }

        if (
          !response ||
          typeof response !== 'object' ||
          !('storageKey' in response) ||
          response.storageKey !== `${session.user.id}/${fileId}` ||
          !('bucketId' in response) ||
          typeof response.bucketId !== 'string' ||
          !response.bucketId.startsWith('b2:') ||
          !('sizeBytes' in response) ||
          typeof response.sizeBytes !== 'number' ||
          !Number.isSafeInteger(response.sizeBytes) ||
          response.sizeBytes < 0 ||
          !('mimeType' in response) ||
          typeof response.mimeType !== 'string'
        ) {
          reject(new Error('Backblaze B2 returned an incomplete upload result.'));
          return;
        }

        onProgress?.(100);
        resolve({
          storageKey: response.storageKey,
          bucketId: response.bucketId,
          sizeBytes: response.sizeBytes,
          mimeType: response.mimeType,
        });
      };

      onProgress?.(0);
      request.send(file);
    }).catch(reject);
  });
}

export class StorageProvider {
  private bucket = STORAGE_BUCKET;

  async uploadFile(
    userId: string,
    fileId: string,
    file: File,
    onProgress?: (progress: number) => void,
    contentType?: string,
  ): Promise<UploadResult> {
    const storageKey = `${userId}/${fileId}`;
    const mimeType = contentType?.split(';', 1)[0]?.trim() || file.type || 'application/octet-stream';
    if (!(await this.verifyFileOwnership(storageKey))) {
      throw new Error('Access denied: upload path does not belong to current user');
    }

    const result = await uploadB2File(fileId, file, mimeType, onProgress);
    if (result.storageKey !== storageKey) {
      throw new Error('Backblaze B2 returned a storage key that does not match the signed-in user.');
    }
    return result;
  }

  getB2ObjectUrl(storageKey: string, downloadName?: string): string {
    const fileId = fileIdFromStorageKey(storageKey);
    const query = downloadName ? `?download=${encodeURIComponent(downloadName)}` : '';
    return `${API_BASE_URL}/b2/objects/${encodeURIComponent(fileId)}${query}`;
  }

  getB2InspectUrl(storageKey: string): string {
    const fileId = fileIdFromStorageKey(storageKey);
    return `${API_BASE_URL}/b2/objects/${encodeURIComponent(fileId)}/inspect`;
  }

  async getB2SignedUrl(
    storageKey: string,
    expiresIn: number = 3600,
    downloadName?: string,
  ): Promise<string> {
    const fileId = fileIdFromStorageKey(storageKey);
    const query = new URLSearchParams({ expiresIn: String(expiresIn) });
    if (downloadName) query.set('download', downloadName);

    const response = await fetch(
      `${API_BASE_URL}/b2/objects/${encodeURIComponent(fileId)}/signed-url?${query}`,
      { headers: await getSessionHeaders() },
    );
    if (!response.ok) throw await getResponseError(response, 'Failed to generate a B2 URL');

    const data = await response.json() as { signedUrl?: unknown };
    if (typeof data.signedUrl !== 'string' || !data.signedUrl) {
      throw new Error('B2 did not return a signed URL.');
    }
    return data.signedUrl;
  }

  async inspectB2Object<T>(storageKey: string): Promise<T> {
    const response = await fetch(this.getB2InspectUrl(storageKey), {
      headers: await getSessionHeaders(),
    });
    if (!response.ok) throw await getResponseError(response, 'Failed to inspect the B2 object');
    return response.json() as Promise<T>;
  }

  async verifyFileOwnership(storageKey: string): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return false;
    const prefix = `${user.id}/`;
    return storageKey.startsWith(prefix);
  }

  async getSignedUrl(
    storageKey: string,
    expiresIn: number = 3600,
    bucketId?: string,
    downloadName?: string,
  ): Promise<string> {
    const owns = await this.verifyFileOwnership(storageKey);
    if (!owns) throw new Error('Access denied: file does not belong to current user');

    if (isB2StorageBucket(bucketId)) {
      return this.getB2SignedUrl(storageKey, expiresIn, downloadName);
    }

    const { data, error } = await supabase.storage
      .from(this.bucket)
      .createSignedUrl(storageKey, expiresIn, downloadName ? { download: downloadName } : undefined);

    if (error) {
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }

    if (!data || !data.signedUrl) {
      throw new Error('Signed URL was not returned by storage provider');
    }

    return data.signedUrl;
  }

  async getBlobUrl(storageKey: string, bucketId?: string): Promise<string> {
    const owns = await this.verifyFileOwnership(storageKey);
    if (!owns) throw new Error('Access denied: file does not belong to current user');

    if (isB2StorageBucket(bucketId)) {
      const response = await fetch(this.getB2ObjectUrl(storageKey), {
        headers: await getSessionHeaders(),
      });
      if (!response.ok) throw await getResponseError(response, 'Failed to download B2 file');
      return URL.createObjectURL(await response.blob());
    }

    const { data, error } = await supabase.storage
      .from(this.bucket)
      .download(storageKey);

    if (error) throw new Error(`Failed to download file: ${error.message}`);
    if (!data) throw new Error('No data returned from storage');

    return URL.createObjectURL(data);
  }

  async deleteFile(storageKey: string, bucketId?: string): Promise<void> {
    if (isB2StorageBucket(bucketId)) {
      const owns = await this.verifyFileOwnership(storageKey);
      if (!owns) throw new Error('Access denied: file does not belong to current user');

      const response = await fetch(this.getB2ObjectUrl(storageKey), {
        method: 'DELETE',
        headers: await getSessionHeaders(),
      });
      if (!response.ok) throw await getResponseError(response, 'Failed to delete B2 file');
      return;
    }

    const { error } = await supabase.storage
      .from(this.bucket)
      .remove([storageKey]);

    if (error) {
      throw new Error(`Failed to delete file from storage: ${error.message}`);
    }
  }

  async getStorageUsage(): Promise<{ totalBytes: number; byCategory: Record<string, number> }> {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return { totalBytes: 0, byCategory: {} };

    const { data, error } = await supabase
      .from('files')
      .select('size_bytes, category')
      .eq('user_id', user.id)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`Failed to get storage usage: ${error.message}`);
    }

    const byCategory: Record<string, number> = {
      video: 0,
      photo: 0,
      document: 0,
      other: 0,
    };

    let totalBytes = 0;
    for (const file of data || []) {
      totalBytes += file.size_bytes;
      byCategory[file.category] = (byCategory[file.category] || 0) + file.size_bytes;
    }

    return { totalBytes, byCategory };
  }

  getCategoryInfo(category: FileCategory) {
    const info: Record<FileCategory, { label: string; color: string }> = {
      video: { label: 'Videos', color: 'text-red-400' },
      photo: { label: 'Photos', color: 'text-blue-400' },
      document: { label: 'Documents', color: 'text-green-400' },
      other: { label: 'Other Files', color: 'text-amber-400' },
    };
    return info[category];
  }
}

export const storageProvider = new StorageProvider();
