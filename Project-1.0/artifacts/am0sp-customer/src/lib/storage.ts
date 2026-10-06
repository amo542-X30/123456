import { supabase, STORAGE_BUCKET } from './supabase';
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

async function getSessionHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('An active session is required for B2 storage.');
  return { Authorization: `Bearer ${session.access_token}` };
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
    const mimeType = contentType?.trim() || file.type || 'application/octet-stream';

    return new Promise<UploadResult>((resolve, reject) => {
      void getSessionHeaders().then((headers) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/b2/objects/${encodeURIComponent(fileId)}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-File-Content-Type', mimeType);
        for (const [name, value] of Object.entries(headers)) {
          xhr.setRequestHeader(name, value);
        }

        xhr.upload.onprogress = (event) => {
          if (onProgress) {
            const pct = event.lengthComputable && event.total > 0
              ? Math.round((event.loaded / event.total) * 100)
              : 0;
            onProgress(pct);
          }
        };

        xhr.onerror = () => reject(new Error('Network error during B2 upload.'));
        xhr.onabort = () => reject(new DOMException('Upload aborted.', 'AbortError'));
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            let message = `B2 upload failed (${xhr.status})`;
            try {
              const response = JSON.parse(xhr.responseText) as { error?: unknown };
              if (typeof response.error === 'string') message = response.error;
            } catch {
              // Keep the status-based message for non-JSON responses.
            }
            reject(new Error(message));
            return;
          }

          try {
            const result = JSON.parse(xhr.responseText) as UploadResult;
            if (
              result.storageKey !== storageKey ||
              !isB2StorageBucket(result.bucketId) ||
              result.sizeBytes !== file.size
            ) {
              reject(new Error('B2 returned an invalid upload result.'));
              return;
            }
            resolve({ ...result, mimeType });
          } catch {
            reject(new Error('B2 returned an invalid upload response.'));
          }
        };

        xhr.send(file);
      }).catch(reject);
    });
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
      .createSignedUrl(storageKey, expiresIn);

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
