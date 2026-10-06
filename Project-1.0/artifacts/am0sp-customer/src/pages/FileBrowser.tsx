import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  getFiles, uploadFile, renameFile, toggleFavorite, moveFile,
  softDeleteFile, downloadFile, getFileUrl, getThumbnailUrl, getStreamingUrl, inspectVideo,
} from '@/lib/fileService';
import type { VideoInspectResult, DownloadProgress } from '@/lib/fileService';
import { getFolders, createFolder, getFolderPath, deleteFolder } from '@/lib/folderService';
import type { FileItem, FileCategory, Folder } from '@/lib/types';
import { formatBytes, formatDate, getFileIcon, cn } from '@/lib/utils';
import {
  Upload, Download, Trash2, Star, Folder as FolderIcon, FolderPlus,
  Search, ArrowLeft, X, ChevronRight, MoreVertical, File as FileIcon,
  AlertCircle, ArrowDownToLine,
  FolderInput, Pencil, AlertTriangle, CheckCircle2, Loader2,
  CheckSquare, Square, Check, RotateCcw,
} from 'lucide-react';
import { Am0spVideoPlayer } from '@/components/Am0spVideoPlayer';
import { PhotoViewer } from '@/components/PhotoViewer';
import { findSubtitlesForVideo } from '@/lib/subtitleService';

interface FileBrowserProps {
  category?: FileCategory | 'all' | 'favorites' | 'recent' | 'trash';
  onNavigate: (page: string) => void;
  onGoBack: () => void;
  backRef: React.MutableRefObject<() => void>;
}

const PAGE_SIZE = 50;

export function FileBrowser({ category, onGoBack, backRef }: FileBrowserProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [uploadQueue, setUploadQueue] = useState<{ name: string; progress: number; status: 'uploading' | 'complete' | 'error'; errorMsg?: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showMoveMenu, setShowMoveMenu] = useState<FileItem | null>(null);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadState, setDownloadState] = useState<{
    file: FileItem;
    progress: DownloadProgress | null;
    status: 'transferring' | 'complete' | 'error';
    errorMsg?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isTrash = category === 'trash';
  const isFavorites = category === 'favorites';
  const isRecent = category === 'recent';
  const isAll = category === 'all';
  const actualCategory = (isTrash || isFavorites || isRecent || isAll) ? undefined : category as FileCategory;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const opts = {
        search: search || undefined,
        sortBy: isRecent ? 'date' as const : sortBy,
        favoritesOnly: isFavorites,
        trashOnly: isTrash,
        pageSize: PAGE_SIZE,
      };

      const [fileResult, folderData] = await Promise.all([
        getFiles(actualCategory, isTrash || isFavorites || isRecent ? undefined : currentFolder, opts),
        (isTrash || isFavorites || isRecent) ? Promise.resolve([] as Folder[]) : getFolders(currentFolder),
      ]);

      setFiles(fileResult.files);
      setFolders(folderData);

      if (currentFolder) {
        const path = await getFolderPath(currentFolder);
        setFolderPath(path);
      } else {
        setFolderPath([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [currentFolder, search, sortBy, isTrash, isFavorites, isRecent, actualCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    backRef.current = () => {
      if (selectedFile) {
        setSelectedFile(null);
      } else if (selectMode) {
        exitSelectMode();
      } else if (openMenuId) {
        setOpenMenuId(null);
      } else if (openFolderMenuId) {
        setOpenFolderMenuId(null);
      } else if (showMoveMenu) {
        setShowMoveMenu(null);
      } else if (currentFolder) {
        setCurrentFolder(null);
      } else {
        onGoBack();
      }
    };
  });

  useEffect(() => {
    if (!openFolderMenuId) return;

    const closeOnOutsideTap = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-folder-menu], [data-folder-menu-trigger]')) setOpenFolderMenuId(null);
    };

    document.addEventListener('pointerdown', closeOnOutsideTap);
    document.addEventListener('touchstart', closeOnOutsideTap);
    document.addEventListener('click', closeOnOutsideTap);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideTap);
      document.removeEventListener('touchstart', closeOnOutsideTap);
      document.removeEventListener('click', closeOnOutsideTap);
    };
  }, [openFolderMenuId]);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      loadData();
    }, 300);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setError(null);
    const fileArray = Array.from(selectedFiles);
    setUploadQueue(fileArray.map((f) => ({ name: f.name, progress: 0, status: 'uploading' as const })));

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      try {
        await uploadFile(file, currentFolder, (progress) => {
          setUploadQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, progress } : item));
        });
        setUploadQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, progress: 100, status: 'complete' as const } : item));
      } catch (err) {
        const msg = err instanceof Error ? err.message : `Upload failed for ${file.name}`;
        setUploadQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, progress: 0, status: 'error' as const, errorMsg: msg } : item));
        setError(msg);
      }
    }
    setTimeout(() => setUploadQueue([]), 3000);
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadData();
  };

  const handleCreateFolder = async () => {
    const name = prompt('Folder name:');
    if (!name) return;
    try {
      await createFolder(name.trim(), currentFolder);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    }
  };

  const handleRename = async (file: FileItem) => {
    const name = prompt('New name:', file.original_name);
    if (!name) return;
    try {
      await renameFile(file.id, name.trim());
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename file');
    }
  };

  const handleDelete = async (file: FileItem) => {
    if (!confirm(`Move "${file.original_name}" to trash?`)) return;
    try {
      await softDeleteFile(file.id);
      setSelectedFile(null);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  const handleDownload = async (file: FileItem) => {
    setDownloadState({ file, progress: null, status: 'transferring' });
    try {
      await downloadFile(file, (p) => {
        setDownloadState((prev) => prev ? { ...prev, progress: p } : prev);
      });
      setDownloadState((prev) => prev ? {
        ...prev,
        progress: { loaded: file.size_bytes, total: file.size_bytes, percent: 100 },
        status: 'complete',
      } : prev);
      setTimeout(() => setDownloadState(null), 3000);
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        setDownloadState(null);
        return;
      }
      setDownloadState({ file, progress: null, status: 'error', errorMsg: err instanceof Error ? err.message : 'Unable to retrieve file' });
    }
  };

  const handleMove = async (file: FileItem, targetFolderId: string | null) => {
    try {
      await moveFile(file.id, targetFolderId);
      setShowMoveMenu(null);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move file');
    }
  };

  const openMoveMenu = async (file: FileItem) => {
    const all = await getFolders();
    setAllFolders(all);
    setShowMoveMenu(file);
  };

  const canSelect = !isTrash && files.length > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(files.map((f) => f.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Move ${selectedIds.size} file${selectedIds.size > 1 ? 's' : ''} to trash?`)) return;
    setDeleting(true);
    try {
      for (const id of selectedIds) {
        await softDeleteFile(id);
      }
      exitSelectMode();
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete files');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteFolder = async (folder: Folder) => {
    if (!confirm(`Delete folder "${folder.name}"? Files inside will remain but become unfiled.`)) return;
    try {
      await deleteFolder(folder.id);
      setOpenFolderMenuId(null);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete folder');
    }
  };

  const pageTitle = () => {
    if (isTrash) return 'TRASH';
    if (isFavorites) return 'FAVORITES';
    if (isRecent) return 'RECENTLY ADDED';
    if (isAll) return 'ALL FILES';
    switch (actualCategory) {
      case 'video': return 'VIDEOS';
      case 'photo': return 'PHOTOS';
      case 'document': return 'DOCUMENTS';
      default: return 'OTHER FILES';
    }
  };

  const canUpload = !isTrash && !isFavorites && !isRecent;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => { if (currentFolder) { setCurrentFolder(null); } else { onGoBack(); } }} className="p-2 rounded-xl border border-vault-600/60 hover:border-cyber-green/30 hover:bg-cyber-green/5 transition-colors">
            <ArrowLeft className="w-4 h-4 text-gray-400" />
          </button>
          <div>
            <div className="cyber-section-label mb-0.5">FILE BROWSER</div>
            <h1 className="text-lg font-bold cyber-text tracking-[0.14em]">{pageTitle()}</h1>
          </div>
        </div>
        {canUpload && !selectMode && (
          <div className="flex items-center gap-2">
            <button onClick={handleCreateFolder} className="btn-secondary flex items-center gap-2 !py-2">
              <FolderPlus className="w-4 h-4" /> <span className="hidden sm:inline">New Folder</span>
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="btn-primary flex items-center gap-2 !py-2">
              <Upload className="w-4 h-4" /> Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        )}
      </div>

      {/* Selection mode action bar */}
      {canSelect && selectMode && (
        <div className="flex items-center justify-between gap-2 glass-panel px-3 py-2.5">
          <button
            onClick={selectedIds.size === files.length ? deselectAll : selectAll}
            className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            {selectedIds.size === files.length && files.length > 0 ? 'Deselect All' : 'Select All'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0 || deleting}
              className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5 !border-cyber-red/30 !text-cyber-red/80 hover:!bg-cyber-red/10 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </button>
            <button onClick={exitSelectMode} className="btn-secondary !py-1.5 !px-3 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Normal action bar: Select button */}
      {canSelect && !selectMode && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectMode(true)}
            className="btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1.5"
          >
            <CheckSquare className="w-3.5 h-3.5" /> Select
          </button>
        </div>
      )}

      {/* Breadcrumb */}
      {(folderPath.length > 0 || currentFolder === null) && !isTrash && !isFavorites && !isRecent && (
        <div className="flex items-center gap-1.5 text-xs flex-wrap terminal-text">
          <button
            onClick={() => { setCurrentFolder(null); }}
            className="text-cyber-gray-text hover:text-cyber-green transition-colors"
          >
            MY VAULT
          </button>
          {folderPath.map((f) => (
            <div key={f.id} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-vault-400" />
              <button
                onClick={() => setCurrentFolder(f.id)}
                className="text-cyber-gray-text hover:text-cyber-green transition-colors"
              >
                {f.name.toUpperCase()}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search + Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyber-gray-text" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search files…"
            className="input-field pl-10 !py-2 text-xs"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}
          className="input-field !py-2 !w-auto text-xs"
        >
          <option value="date">Sort: Date</option>
          <option value="name">Sort: Name</option>
          <option value="size">Sort: Size</option>
        </select>
      </div>

      {/* Upload Progress Queue */}
      {uploadQueue.length > 0 && (
        <div className="space-y-2">
          {uploadQueue.map((item, i) => (
            <UploadProgressPanel
              key={i}
              name={item.name}
              progress={item.progress}
              status={item.status}
              errorMsg={item.errorMsg}
              onDismiss={() => setUploadQueue((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-lg bg-cyber-red/10 border border-cyber-red/30 text-cyber-red text-xs">
          {error}
        </div>
      )}

      {/* Folders */}
      {folders.length > 0 && !isTrash && !isFavorites && !isRecent && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="glass-panel glass-panel-hover p-4 flex items-center gap-3 text-left relative border-l-2 border-l-cyber-green/30"
            >
              <button
                onClick={() => setOpenFolderMenuId(openFolderMenuId === folder.id ? null : folder.id)}
                data-folder-menu-trigger
                className="absolute top-1 right-1 p-1.5 rounded-lg hover:bg-vault-700 transition-colors flex-shrink-0"
              >
                <MoreVertical className={cn('w-3.5 h-3.5 transition-colors', openFolderMenuId === folder.id ? 'text-cyber-green' : 'text-gray-500')} />
              </button>
              <button
                onClick={() => { if (!selectMode) setCurrentFolder(folder.id); }}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <FolderIcon className="w-5 h-5 text-cyber-green flex-shrink-0" />
                <span className="text-sm text-gray-200 truncate">{folder.name}</span>
              </button>
              {openFolderMenuId === folder.id && (
                <>
                  <div data-folder-menu className="absolute top-8 right-1 z-50 w-32 rounded-lg bg-vault-900 border border-vault-600/50 backdrop-blur-xl py-1 shadow-xl">
                    <button
                      onClick={() => handleDeleteFolder(folder)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-cyber-red/80 hover:bg-cyber-red/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Files */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 glass-panel animate-pulse" />
          ))}
        </div>
      ) : files.length === 0 && folders.length === 0 ? (
        <div className="glass-panel p-12 text-center">
          <FileIcon className="w-12 h-12 text-cyber-green/30 mx-auto mb-4" />
          <p className="text-sm text-cyber-gray-text">
            {isTrash ? 'Trash is empty' : 'No files here yet'}
          </p>
          {canUpload && (
            <button onClick={() => fileInputRef.current?.click()} className="btn-primary mt-4">
              Upload your first file
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              isTrash={isTrash}
              isMenuOpen={openMenuId === file.id}
              selectMode={selectMode}
              isSelected={selectedIds.has(file.id)}
              onToggleSelect={() => toggleSelect(file.id)}
              onToggleMenu={() => setOpenMenuId(openMenuId === file.id ? null : file.id)}
              onCloseMenu={() => setOpenMenuId(null)}
              onView={() => { setOpenMenuId(null); if (!selectMode) setSelectedFile(file); }}
              onDownload={() => { setOpenMenuId(null); handleDownload(file); }}
              onRename={() => { setOpenMenuId(null); handleRename(file); }}
              onDelete={() => { setOpenMenuId(null); handleDelete(file); }}
              onFavorite={async () => { setOpenMenuId(null); await toggleFavorite(file.id, file.is_favorite); loadData(); }}
              onMove={() => { setOpenMenuId(null); openMoveMenu(file); }}
            />
          ))}
        </div>
      )}

      {/* File Viewer Modal */}
      {selectedFile && (
        <FileViewer
          file={selectedFile}
          allFiles={files}
          onClose={() => setSelectedFile(null)}
          onFileChange={setSelectedFile}
          onDownload={handleDownload}
        />
      )}

      {/* Move Menu Modal */}
      {showMoveMenu && (
        <MoveModal
          file={showMoveMenu}
          folders={allFolders}
          onSelect={(folderId) => handleMove(showMoveMenu, folderId)}
          onClose={() => setShowMoveMenu(null)}
        />
      )}

      {/* Download Progress Panel — single instance, no remount */}
      {downloadState && (
        <DownloadProgressPanel
          file={downloadState.file}
          progress={downloadState.progress}
          status={downloadState.status}
          errorMsg={downloadState.errorMsg}
          onRetry={() => handleDownload(downloadState.file)}
          onDismiss={() => setDownloadState(null)}
        />
      )}
    </div>
  );
}



function FileRow({
  file, isTrash, isMenuOpen, selectMode, isSelected, onToggleSelect, onToggleMenu, onCloseMenu, onView, onDownload, onRename, onDelete, onFavorite, onMove,
}: {
  file: FileItem;
  isTrash: boolean;
  isMenuOpen: boolean;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onView: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onMove: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState(false);
  const [thumbRetry, setThumbRetry] = useState(0);
  const [thumbAutoRetried, setThumbAutoRetried] = useState(false);

  useEffect(() => {
    if ((file.category !== 'photo' && file.category !== 'video') || isTrash) {
      setThumbUrl(null);
      setThumbError(false);
      return;
    }
    setThumbError(false);
    let cancelled = false;
    let objectUrl: string | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (file.category === 'photo') {
      getThumbnailUrl(file)
        .then((url) => {
          if (cancelled) { URL.revokeObjectURL(url); return; }
          objectUrl = url;
          setThumbUrl(url);
        })
        .catch(() => { if (!cancelled) setThumbError(true); });
    } else {
      timeoutId = setTimeout(() => {
        if (!cancelled) setThumbError(true);
      }, 8000);
      getStreamingUrl(file)
        .then((url) => {
          if (cancelled) return;
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
          setThumbUrl(url);
        })
        .catch(() => {
          if (cancelled) return;
          if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
          setThumbError(true);
        });
    }
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, isTrash, thumbRetry]);

  const handleThumbError = () => {
    if (!thumbAutoRetried) {
      setThumbAutoRetried(true);
      setThumbRetry((c) => c + 1);
    } else {
      setThumbError(true);
    }
  };

  return (
    <div className={cn(
      'glass-panel glass-panel-hover flex flex-col group',
      isMenuOpen && 'ring-1 ring-cyber-green/30 border-cyber-green/20',
      selectMode && isSelected && 'ring-1 ring-cyber-green/50 border-cyber-green/20',
    )}>
      <div className="p-3.5 flex items-center gap-3">
        {selectMode && (
          <button
            onClick={onToggleSelect}
            className="flex-shrink-0 p-1"
          >
            {isSelected
              ? <CheckSquare className="w-5 h-5 text-cyber-green" />
              : <Square className="w-5 h-5 text-gray-500" />}
          </button>
        )}
        <button onClick={selectMode ? onToggleSelect : onView} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          {(file.category === 'photo' || file.category === 'video') && !isTrash ? (
            <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-vault-900 border border-cyber-green/10 flex items-center justify-center">
              {thumbError ? (
                <span className="text-xl">{getFileIcon(file.category, file.mime_type)}</span>
              ) : thumbUrl ? (
                file.category === 'video' ? (
                  <video
                    src={thumbUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="w-full h-full object-cover"
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      if (v.duration > 0) v.currentTime = Math.min(0.1, v.duration / 2);
                    }}
                    onError={handleThumbError}
                  />
                ) : (
                  <img
                    src={thumbUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={handleThumbError}
                  />
                )
              ) : (
                <div className="w-4 h-4 border-2 border-cyber-green/30 border-t-cyber-green rounded-full animate-spin" />
              )}
            </div>
          ) : (
            <span className="text-xl flex-shrink-0 w-10 text-center">{getFileIcon(file.category, file.mime_type)}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm text-gray-200 truncate">{file.original_name}</div>
            <div className="terminal-text flex items-center gap-2">
              <span>{formatBytes(file.size_bytes)}</span>
              <span>·</span>
              <span>{formatDate(file.created_at)}</span>
              {file.is_favorite && <Star className="w-3 h-3 text-cyber-amber fill-cyber-amber" />}
            </div>
          </div>
        </button>

        {!selectMode && (
          <button
            onClick={onToggleMenu}
            data-file-menu-trigger
            className="p-2 rounded-lg hover:bg-vault-700 transition-colors flex-shrink-0"
          >
            <MoreVertical className={cn('w-4 h-4 transition-colors', isMenuOpen ? 'text-cyber-green' : 'text-gray-400')} />
          </button>
        )}
      </div>

      {isMenuOpen && (
        <FileCommandPanel
          file={file}
          isTrash={isTrash}
          onDownload={onDownload}
          onRename={onRename}
          onDelete={onDelete}
          onFavorite={onFavorite}
          onMove={onMove}
          onClose={onCloseMenu}
        />
      )}
    </div>
  );
}

function FileCommandPanel({
  file, isTrash, onDownload, onRename, onDelete, onFavorite, onMove, onClose,
}: {
  file: FileItem;
  isTrash: boolean;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onMove: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsidePointer = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!panelRef.current?.contains(target) && !target.closest('[data-file-menu-trigger]')) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer);
    document.addEventListener('click', handleOutsidePointer);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
      document.removeEventListener('click', handleOutsidePointer);
    };
  }, [onClose]);

  return (
    <div ref={panelRef} data-file-menu className="relative z-50 border-t border-cyber-green/20 bg-vault-black/95 backdrop-blur-xl px-3 py-2.5">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="terminal-text text-cyber-green/80 tracking-wider">FILE_COMMANDS</span>
        <span className="terminal-text text-cyber-green/40">STATUS: READY_</span>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-cyber-green/20 to-transparent mb-2" />
      <div className="grid grid-cols-5 gap-1.5">
        <CmdButton icon={ArrowDownToLine} label="DOWNLOAD" onClick={onDownload} />
        <CmdButton icon={Star} label={file.is_favorite ? 'UNFAV' : 'SAVE'} onClick={onFavorite} />
        {!isTrash && <CmdButton icon={FolderInput} label="MOVE" onClick={onMove} />}
        <CmdButton icon={Pencil} label="RENAME" onClick={onRename} />
        <CmdButton icon={Trash2} label="DELETE" onClick={onDelete} danger />
      </div>
    </div>
  );
}

function CmdButton({
  icon: Icon, label, onClick, danger,
}: {
  icon: typeof Star; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 px-1.5 py-2.5 rounded-lg border transition-all duration-200 active:scale-95',
        danger
          ? 'border-cyber-red/20 text-cyber-red/70 hover:bg-cyber-red/10 hover:border-cyber-red/40'
          : 'border-vault-500/50 text-gray-400 hover:bg-cyber-green/5 hover:border-cyber-green/30 hover:text-cyber-green',
      )}
    >
      <Icon className="w-4 h-4" />
      <span className="font-mono text-[9px] tracking-wider">{label}</span>
    </button>
  );
}

function UploadProgressPanel({
  name, progress, status, errorMsg, onDismiss,
}: {
  name: string;
  progress: number;
  status: 'uploading' | 'complete' | 'error';
  errorMsg?: string;
  onDismiss: () => void;
}) {
  const barBlocks = 20;
  const filledBlocks = Math.round((progress / 100) * barBlocks);
  const progressBar = '[' + '█'.repeat(filledBlocks) + '░'.repeat(barBlocks - filledBlocks) + ']';

  return (
    <div className="glass-panel p-3 animate-fade-in border-cyber-green/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {status === 'uploading' && <Loader2 className="w-3.5 h-3.5 text-cyber-green animate-spin" />}
          {status === 'complete' && <CheckCircle2 className="w-3.5 h-3.5 text-cyber-green" />}
          {status === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-cyber-red" />}
          <span className={cn(
            'terminal-text tracking-wider text-xs',
            status === 'error' ? 'text-cyber-red' : 'text-cyber-green',
          )}>
            {status === 'uploading' && progress === 0 && 'UPLOAD_INITIALIZED'}
            {status === 'uploading' && progress > 0 && 'TRANSFERRING…'}
            {status === 'complete' && 'UPLOAD_COMPLETE ✓'}
            {status === 'error' && 'UPLOAD_FAILED'}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded hover:bg-vault-700 transition-colors"
        >
          <X className="w-3 h-3 text-gray-500" />
        </button>
      </div>

      <p className="text-xs text-gray-300 truncate font-mono mb-1.5">{name}</p>

      {status === 'uploading' && (
        <>
          <pre className="font-mono text-xs text-cyber-green leading-tight overflow-hidden whitespace-nowrap">
            <span className="text-cyber-green/80">{progressBar}</span>
            <span className="text-cyber-green ml-2">{progress}%</span>
          </pre>
          {progress === 0 && (
            <div className="h-0.5 mt-2 bg-cyber-green/10 rounded-full overflow-hidden">
              <div className="h-full w-1/3 bg-cyber-green/40 rounded-full animate-indeterminate" />
            </div>
          )}
        </>
      )}

      {status === 'complete' && (
        <pre className="font-mono text-xs text-cyber-green leading-tight">
          [████████████████████] 100%
        </pre>
      )}

      {status === 'error' && (
        <p className="text-xs text-cyber-red font-mono">ERROR: {errorMsg || 'Upload failed'}</p>
      )}
    </div>
  );
}

function DownloadProgressPanel({
  file, progress, status, errorMsg, onRetry, onDismiss,
}: {
  file: FileItem;
  progress: DownloadProgress | null;
  status: 'transferring' | 'complete' | 'error';
  errorMsg?: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const percent = progress?.percent;
  const hasRealProgress = percent !== null && percent !== undefined;
  const loaded = progress?.loaded || 0;
  const total = progress?.total || file.size_bytes || 0;

  const barBlocks = 20;
  const filledBlocks = hasRealProgress ? Math.round((percent! / 100) * barBlocks) : 0;
  const progressBar = hasRealProgress
    ? '[' + '█'.repeat(filledBlocks) + '░'.repeat(barBlocks - filledBlocks) + ']'
    : '[░░░░░░░░░░░░░░░░░░░░]';

  return createPortal(
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(380px,calc(100vw-2rem))]">
      <div className="relative overflow-hidden bg-vault-black/95 border border-cyber-green/40 shadow-[0_0_28px_rgba(0,255,153,0.16)] p-4 rounded-xl">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyber-green to-transparent" />
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {status === 'transferring' && <Loader2 className="w-4 h-4 text-cyber-green animate-spin" />}
            {status === 'complete' && <CheckCircle2 className="w-4 h-4 text-cyber-green" />}
            {status === 'error' && <AlertTriangle className="w-4 h-4 text-cyber-red" />}
            <div>
              <span className="terminal-text text-cyber-green/50 text-[9px] tracking-[0.2em] block">SECURE_TRANSFER</span>
              <span className={cn(
                'terminal-text tracking-wider',
                status === 'error' ? 'text-cyber-red' : 'text-cyber-green',
              )}>
                {status === 'transferring' && 'DOWNLOAD_INITIATED'}
                {status === 'complete' && 'DOWNLOAD_COMPLETE'}
                {status === 'error' && 'DOWNLOAD_FAILED'}
              </span>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="p-1 rounded hover:bg-vault-700 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>

        <div className="mb-2">
          <p className="text-xs text-gray-300 truncate font-mono mb-1.5">{file.original_name}</p>

          {status === 'transferring' && (
            <>
              <pre className="font-mono text-xs text-cyber-green leading-tight overflow-hidden whitespace-nowrap">
                <span className="text-cyber-green/80">{progressBar}</span>
                {hasRealProgress && <span className="text-cyber-green ml-2">{percent}%</span>}
              </pre>
              <div className="flex items-center justify-between mt-1.5">
                <span className="terminal-text">
                  {hasRealProgress ? 'TRANSFERRING…' : 'TRANSFERRING…'}
                </span>
                <span className="terminal-text">
                  {hasRealProgress && total > 0
                    ? `${formatBytes(loaded)} / ${formatBytes(total)}`
                    : formatBytes(loaded)}
                </span>
              </div>
              {!hasRealProgress && (
                <div className="h-0.5 mt-2 bg-cyber-green/10 rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-cyber-green/40 rounded-full animate-indeterminate" />
                </div>
              )}
            </>
          )}

          {status === 'complete' && (
            <div className="py-1">
              <pre className="font-mono text-xs text-cyber-green leading-tight">
                [████████████████████] 100%
              </pre>
              <p className="terminal-text mt-1">{formatBytes(file.size_bytes)} transferred</p>
            </div>
          )}

          {status === 'error' && (
            <div className="py-1">
              <p className="text-xs text-cyber-red font-mono">ERROR: {errorMsg || 'Unable to retrieve file'}</p>
              <button
                onClick={onRetry}
                className="btn-secondary mt-3 text-xs !py-1.5 !px-3"
              >
                <RotateCcw className="w-3 h-3 inline mr-1.5" /> RETRY
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MoveModal({ file, folders, onSelect, onClose }: {
  file: FileItem;
  folders: Folder[];
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-vault-black/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="glass-panel p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-200">MOVE "{file.original_name}"</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-vault-700"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          <button
            onClick={() => onSelect(null)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-vault-700 transition-colors text-left"
          >
            <FolderIcon className="w-4 h-4 text-cyber-green" />
            <span className="text-sm text-gray-300">My Vault (root)</span>
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => onSelect(f.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-vault-700 transition-colors text-left"
            >
              <FolderIcon className="w-4 h-4 text-cyber-green" />
              <span className="text-sm text-gray-300">{f.name}</span>
            </button>
          ))}
          {folders.length === 0 && (
            <p className="terminal-text p-3">No folders available. Create one first.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FileViewer({
  file, allFiles, onClose, onFileChange, onDownload,
}: {
  file: FileItem;
  allFiles: FileItem[];
  onClose: () => void;
  onFileChange: (file: FileItem) => void;
  onDownload: (file: FileItem) => void;
}) {
  const photos = allFiles.filter((f) => f.category === 'photo');
  const currentPhotoIdx = photos.findIndex((f) => f.id === file.id);
  const isPhoto = file.category === 'photo' && currentPhotoIdx >= 0;

  const videos = allFiles.filter((f) => f.category === 'video');
  const currentVideoIdx = videos.findIndex((f) => f.id === file.id);
  const isVideo = file.category === 'video' && currentVideoIdx >= 0;

  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [autoRetried, setAutoRetried] = useState(false);
  const [manualRetry, setManualRetry] = useState(0);
  const [videoDiagnostics, setVideoDiagnostics] = useState<VideoInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [videoErrorMsg, setVideoErrorMsg] = useState<string | null>(null);

  const urlCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    setLoading(true);
    setError(null);
    setImgError(false);
    let cancelled = false;
    let objectUrl: string | null = null;
    const cache = urlCache.current;

    const cached = cache.get(file.id);
    if (cached) {
      setUrl(cached);
      setLoading(false);
      return;
    }

    getFileUrl(file)
      .then((blobUrl) => {
        if (cancelled) { URL.revokeObjectURL(blobUrl); return; }
        objectUrl = blobUrl;
        cache.set(file.id, blobUrl);
        setUrl(blobUrl);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      if (objectUrl && !cache.has(file.id)) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file, manualRetry]);

  useEffect(() => {
    if (isPhoto && currentPhotoIdx >= 0) {
      const next = photos[currentPhotoIdx + 1];
      const prev = photos[currentPhotoIdx - 1];
      for (const f of [prev, next]) {
        if (f && !urlCache.current.has(f.id)) {
          getFileUrl(f).then((u) => urlCache.current.set(f.id, u)).catch(() => {});
        }
      }
    }
    if (isVideo && currentVideoIdx >= 0) {
      const next = videos[currentVideoIdx + 1];
      const prev = videos[currentVideoIdx - 1];
      for (const f of [prev, next]) {
        if (f && !urlCache.current.has(f.id)) {
          getFileUrl(f).then((u) => urlCache.current.set(f.id, u)).catch(() => {});
        }
      }
    }
  }, [currentPhotoIdx, isPhoto, photos, currentVideoIdx, isVideo, videos]);

  useEffect(() => {
    const cache = urlCache.current;
    return () => {
      cache.forEach((u) => URL.revokeObjectURL(u));
      cache.clear();
    };
  }, []);

  const handleImageError = () => {
    if (!autoRetried) {
      setAutoRetried(true);
      urlCache.current.delete(file.id);
      setUrl(null);
      setManualRetry((c) => c + 1);
    } else {
      setImgError(true);
      if (file.category === 'video') {
        const video = document.querySelector('video');
        if (video && video.error) {
          const code = video.error.code;
          const msgs: Record<number, string> = {
            1: 'MEDIA_ERR_ABORTED - Loading aborted',
            2: 'MEDIA_ERR_NETWORK - Network error while loading',
            3: 'MEDIA_ERR_DECODE - Decoding error (codec may be unsupported)',
            4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - Source not supported by browser',
          };
          setVideoErrorMsg(msgs[code] || `Error code ${code}`);
        }
      }
    }
  };

  const handleRunDiagnostics = async () => {
    setInspecting(true);
    setVideoDiagnostics(null);
    try {
      const result = await inspectVideo(file.id);
      setVideoDiagnostics(result);
    } catch (err) {
      setVideoDiagnostics(null);
      setVideoErrorMsg(err instanceof Error ? err.message : 'Diagnostics failed');
    } finally {
      setInspecting(false);
    }
  };

  const handleManualRetry = () => {
    urlCache.current.delete(file.id);
    setUrl(null);
    setImgError(false);
    setAutoRetried(false);
    setVideoDiagnostics(null);
    setVideoErrorMsg(null);
    setManualRetry((c) => c + 1);
  };

  const goToPhoto = useCallback((idx: number) => {
    if (idx < 0 || idx >= photos.length) return;
    onFileChange(photos[idx]);
  }, [photos, onFileChange]);

  const goToVideo = useCallback((idx: number) => {
    if (idx < 0 || idx >= videos.length) return;
    onFileChange(videos[idx]);
  }, [videos, onFileChange]);

  if (isPhoto) {
    return (
      <PhotoViewer
        photos={photos}
        currentIndex={currentPhotoIdx}
        url={url}
        loading={loading}
        error={error}
        imgError={imgError}
        onIndexChange={(idx) => goToPhoto(idx)}
        onClose={onClose}
        onDownload={onDownload}
        onRetry={handleManualRetry}
        onError={handleImageError}
        onLoad={() => setImgError(false)}
      />
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-vault-black/95 backdrop-blur-md animate-fade-in"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onClick={onClose}
    >
      <div
        className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0 px-4 sm:px-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Viewer toolbar: navigation only */}
        <div className="flex items-center gap-1.5 pt-3 pb-2 flex-shrink-0">
          {isVideo && currentVideoIdx > 0 && (
            <button
              onClick={() => goToVideo(currentVideoIdx - 1)}
              className="btn-secondary !py-1.5 !px-2.5 text-xs flex items-center gap-1"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Prev
            </button>
          )}
          {isVideo && currentVideoIdx < videos.length - 1 && (
            <button
              onClick={() => goToVideo(currentVideoIdx + 1)}
              className="btn-secondary !py-1.5 !px-2.5 text-xs flex items-center gap-1"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* File info — separate readable area */}
        <div className="min-w-0 pb-2 flex-shrink-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-200 truncate">{file.original_name}</h3>
            <div className="terminal-text flex items-center gap-1.5 flex-wrap">
              <span>{formatBytes(file.size_bytes)}</span>
              <span>·</span>
              <span>{formatDate(file.created_at)}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">{file.mime_type}</span>
            </div>
            {isVideo && videos.length > 1 && (
              <p className="terminal-text text-xs text-cyber-gray-text mt-0.5">
                {currentVideoIdx + 1} / {videos.length} · swipe to navigate
              </p>
            )}
          </div>
          <button
            onClick={() => onDownload(file)}
            className="btn-secondary !py-1.5 !px-2.5 text-xs flex items-center gap-1 flex-shrink-0"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>

        {loading && (
          <div className="glass-panel p-20 text-center flex-shrink-0">
            <div className="w-6 h-6 border-2 border-cyber-green/30 border-t-cyber-green rounded-full animate-spin mx-auto mb-3" />
            <div className="terminal-text animate-pulse">GENERATING SECURE URL…</div>
          </div>
        )}
        {error && (
          <div className="glass-panel p-8 text-center flex-shrink-0">
            <AlertCircle className="w-8 h-8 text-cyber-red mx-auto mb-2" />
            <p className="text-sm text-cyber-red mb-3">{error}</p>
            <button onClick={handleManualRetry} className="btn-secondary text-xs">Retry</button>
          </div>
        )}
        {url && !loading && !error && (
          <div className={cn(
            'relative overflow-hidden flex-1 min-h-0 flex flex-col',
            file.category === 'video' && !imgError
              ? 'rounded-xl'
              : 'glass-panel p-2'
          )}>
            <button
              onClick={onClose}
              className="absolute top-3 right-3 z-10 p-2 text-gray-300 hover:text-white transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            {file.category === 'video' && !imgError && (
              <Am0spVideoPlayer
                src={url}
                fileName={file.original_name}
                fileSize={file.size_bytes}
                mimeType={file.mime_type}
                fileId={file.id}
                onError={handleImageError}
                subtitleTracks={findSubtitlesForVideo(file, allFiles)}
                onSwipeLeft={() => {
                  if (currentVideoIdx < videos.length - 1) goToVideo(currentVideoIdx + 1);
                }}
                onSwipeRight={() => {
                  if (currentVideoIdx > 0) goToVideo(currentVideoIdx - 1);
                }}
                onAutoNext={() => {
                  if (currentVideoIdx < videos.length - 1) goToVideo(currentVideoIdx + 1);
                }}
              />
            )}
            {file.category === 'video' && imgError && (
              <div className="p-8 text-center">
                <AlertCircle className="w-10 h-10 text-cyber-red mx-auto mb-3" />
                <p className="text-sm text-gray-300 mb-2">Failed to play video.</p>
                {videoErrorMsg && (
                  <p className="terminal-text text-xs text-cyber-red mb-2">{videoErrorMsg}</p>
                )}
                <p className="terminal-text mb-4">The format may be unsupported by this browser, or the URL expired.</p>
                <div className="flex items-center justify-center gap-2 mb-4">
                  <button onClick={handleManualRetry} className="btn-primary text-xs">Retry Playback</button>
                  <button onClick={handleRunDiagnostics} className="btn-secondary text-xs" disabled={inspecting}>
                    {inspecting ? 'Inspecting…' : 'Run Diagnostics'}
                  </button>
                </div>
                {videoDiagnostics && (
                  <div className="text-left glass-panel p-4 rounded-lg max-w-md mx-auto space-y-1.5">
                    <p className="terminal-text text-xs text-cyber-green mb-2">VIDEO DIAGNOSTICS</p>
                    <p className="text-xs text-gray-400">File: <span className="text-gray-200">{videoDiagnostics.fileName}</span></p>
                    <p className="text-xs text-gray-400">MIME: <span className="text-gray-200">{videoDiagnostics.mimeType}</span></p>
                    <p className="text-xs text-gray-400">Size: <span className="text-gray-200">{formatBytes(videoDiagnostics.size)}</span></p>
                    <p className="text-xs text-gray-400">Codec: <span className={videoDiagnostics.codec?.found ? 'text-cyber-green' : 'text-cyber-red'}>{videoDiagnostics.codec?.found || 'NOT DETECTED'}</span></p>
                    <p className="text-xs text-gray-400">moov atom: <span className={videoDiagnostics.moovFound ? 'text-cyber-green' : 'text-cyber-red'}>{videoDiagnostics.moovFound ? 'Found' : 'Not found in first 256KB'}</span></p>
                    <p className="text-xs text-gray-400">Streaming optimized: <span className={videoDiagnostics.moovBeforeMdat ? 'text-cyber-green' : 'text-amber-400'}>{videoDiagnostics.moovBeforeMdat ? 'Yes (moov before mdat)' : 'No (moov after mdat — needs full download before playback)'}</span></p>
                    <p className="text-xs text-gray-400">Header bytes: <span className="text-gray-200">{videoDiagnostics.headerBytesRead}</span></p>
                    <div className="pt-2 border-t border-vault-700">
                      <p className="text-xs text-gray-400">Browser: <span className="text-gray-200">{navigator.userAgent.substring(0, 80)}</span></p>
                      <p className="text-xs text-gray-400 mt-1">Can play video/mp4: <span className={document.createElement('video').canPlayType('video/mp4') ? 'text-cyber-green' : 'text-cyber-red'}>{document.createElement('video').canPlayType('video/mp4') || 'No'}</span></p>
                      {videoDiagnostics.codec?.found && (
                        <p className="text-xs text-gray-400 mt-1">Can play {videoDiagnostics.codec.found}: <span className={document.createElement('video').canPlayType(`video/mp4; codecs="${videoDiagnostics.codec.found}"`) ? 'text-cyber-green' : 'text-cyber-red'}>{document.createElement('video').canPlayType(`video/mp4; codecs="${videoDiagnostics.codec.found}"`) || 'No'}</span></p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {file.category === 'document' && file.mime_type === 'application/pdf' && (
              <iframe src={url} className="w-full flex-1 min-h-0 rounded-lg" title={file.original_name} />
            )}
            {file.category === 'document' && file.mime_type.startsWith('text/') && (
              <TextPreview url={url} />
            )}
            {(file.category === 'other' || (file.category === 'document' && file.mime_type !== 'application/pdf' && !file.mime_type.startsWith('text/'))) && (
              <div className="p-12 text-center">
                <FileIcon className="w-12 h-12 text-vault-400 mx-auto mb-3" />
                <p className="text-sm text-gray-300">Preview not available for this file type</p>
                <button onClick={() => onDownload(file)} className="btn-primary mt-4">
                  <Download className="w-4 h-4 inline mr-2" /> Download
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function TextPreview({ url }: { url: string }) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then(setContent)
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) return <div className="terminal-text p-8 text-center animate-pulse">LOADING…</div>;
  return (
    <pre className="p-4 text-xs text-gray-300 flex-1 min-h-0 overflow-auto whitespace-pre-wrap">{content}</pre>
  );
}
