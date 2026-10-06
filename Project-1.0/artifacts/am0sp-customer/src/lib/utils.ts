export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

export function getFileCategory(mimeType: string): 'video' | 'photo' | 'document' | 'other' {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'photo';
  if (
    mimeType.startsWith('text/') ||
    mimeType.startsWith('application/pdf') ||
    mimeType.startsWith('application/msword') ||
    mimeType.startsWith('application/vnd.openxmlformats-officedocument') ||
    mimeType.startsWith('application/vnd.ms-excel') ||
    mimeType.startsWith('application/vnd.ms-powerpoint') ||
    mimeType.startsWith('application/vnd.oasis.opendocument') ||
    mimeType === 'application/rtf' ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  ) {
    return 'document';
  }
  return 'other';
}

export function getFileIcon(category: string, mimeType: string): string {
  switch (category) {
    case 'video':
      return '🎬';
    case 'photo':
      return '🖼️';
    case 'document':
      return '📄';
    default:
      if (mimeType.startsWith('audio/')) return '🎵';
      if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return '🗜️';
      return '📦';
  }
}

export function parseUserAgent(ua: string): string {
  if (!ua) return 'Unknown Device';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/);
    return `Android ${match ? match[1] : ''}`.trim();
  }
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Device';
}

export function parseBrowser(ua: string): string {
  if (!ua) return 'Browser';
  if (/Edg/i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  if (/Firefox/i.test(ua)) return 'Firefox';
  return 'Browser';
}

export function getDeviceName(): string {
  const ua = navigator.userAgent;
  return `${parseUserAgent(ua)} · ${parseBrowser(ua)}`;
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
