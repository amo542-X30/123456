import { getFileUrl } from './fileService';
import type { FileItem } from './types';

export interface SubtitleTrack {
  id: string;
  label: string;
  file: FileItem;
}

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'];
const SUBTITLE_MIME_TYPES = [
  'text/vtt',
  'application/x-subrip',
  'text/x-srt',
  'text/plain',
];

export function isSubtitleFile(file: FileItem): boolean {
  const name = file.original_name.toLowerCase();
  if (SUBTITLE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (SUBTITLE_MIME_TYPES.includes(file.mime_type.toLowerCase())) {
    if (SUBTITLE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  }
  return false;
}

function getBaseName(fileName: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  return dotIdx > 0 ? fileName.substring(0, dotIdx).toLowerCase() : fileName.toLowerCase();
}

export function findSubtitlesForVideo(videoFile: FileItem, allFiles: FileItem[]): SubtitleTrack[] {
  const videoBase = getBaseName(videoFile.original_name);
  return allFiles
    .filter((f) => isSubtitleFile(f) && !f.deleted_at)
    .filter((f) => {
      const subBase = getBaseName(f.original_name);
      if (subBase === videoBase) return true;
      if (subBase.startsWith(videoBase + '.')) return true;
      return false;
    })
    .map((f) => ({
      id: f.id,
      label: f.original_name,
      file: f,
    }));
}

export function srtToVtt(srtContent: string): string {
  let vtt = 'WEBVTT\n\n';
  const blocks = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const timing = lines[idx].replace(/,/g, '.');
    const text = lines.slice(idx + 1).join('\n');
    vtt += `${timing}\n${text}\n\n`;
  }
  return vtt;
}

export async function loadSubtitleBlobUrl(track: SubtitleTrack): Promise<string> {
  const blobUrl = await getFileUrl(track.file);
  const isVtt = track.file.original_name.toLowerCase().endsWith('.vtt');
  if (isVtt) return blobUrl;

  const response = await fetch(blobUrl);
  const srtText = await response.text();
  URL.revokeObjectURL(blobUrl);
  const vttText = srtToVtt(srtText);
  const vttBlob = new Blob([vttText], { type: 'text/vtt' });
  return URL.createObjectURL(vttBlob);
}
