import React, { createContext, useState, useEffect, useRef, useContext } from 'react';

export const WebRTCContext = createContext(null);

export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (context === null) throw new Error('useWebRTC must be used within a WebRTCProvider');
  return context;
};

const getServerUrl = () => {
  const h = window.location.hostname;
  const local = h === 'localhost' || h === '127.0.0.1' || /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h);
  return local ? window.location.protocol + '//' + h + ':10000' : 'https://sync-video-app.onrender.com';
};
const SERVER_URL = getServerUrl();
const CHUNK_SIZE = 5 * 1024 * 1024;
const PARALLEL_UPLOADS = 6; // concurrent chunk uploads

export const WebRTCProvider = ({ children, socketRef, socketReady, roomId, isHost, users, addSystemMessage }) => {
  const [isStreaming,      setIsStreaming]      = useState(false);
  const [streamError,      setStreamError]      = useState('');
  const [streamLoading,    setStreamLoading]    = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [uploadProgress,        setUploadProgress]        = useState(0);
  const [downloadProgress,      setDownloadProgress]      = useState(0);   // 0-100, viewer only
  const [serverBufferingProgress, setServerBufferingProgress] = useState(0); // 0-100, viewer pre-start
  const [serverVideoUrl,        setServerVideoUrl]        = useState(''); // HTTP URL → shows <video> element
  // Incremented on every stream-ready for viewers so the setup effect always re-runs,
  // even when serverVideoUrl doesn't change (e.g. after a failed previous attempt).
  const [streamTrigger,         setStreamTrigger]         = useState(0);
  // True while host is waiting for server assembly to reach a seek position
  const [isSeekBuffering,       setIsSeekBuffering]       = useState(false);

  const hostVideoRef      = useRef(null);
  const viewerVideoRef    = useRef(null);
  const fileUrlRef        = useRef(null);
  const uploadIdRef       = useRef(null);
  const isStreamingRef    = useRef(false);
  const blobUrlRef        = useRef(null);    // local blob URL after full download
  const downloadingRef    = useRef(false);   // prevent duplicate downloads
  const streamFileType    = useRef('video/mp4');
  const streamFileSizeRef = useRef(0);       // file size from stream-ready; gating blob download
  const downloadAbortRef  = useRef(null);    // AbortController for in-flight blob download

  // Files larger than this skip the background blob download entirely.
  // Accumulating a 4GB file in JS heap (as Uint8Array chunks then a Blob)
  // doubles browser memory usage and OOMs the tab; HTTP range requests handle
  // seeking well enough without the local blob.
  const MAX_BLOB_DOWNLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

  // Load host file URL from sessionStorage
  useEffect(() => {
    if (!isHost) return;
    const url = sessionStorage.getItem('hostFileUrl');
    if (url) fileUrlRef.current = url;
  }, [isHost]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    };
  }, []);

  // ─── Socket: stream-ready ──────────────────────────────────────────────────
  useEffect(() => {
    if (!socketRef.current || !socketReady) return;

    const onStreamBuffering = ({ progress }) => {
      setServerBufferingProgress(progress);
    };

    const onStreamReady = ({ uploadId, streamUrl, fileType }) => {
      uploadIdRef.current = uploadId;
      streamFileType.current = fileType || 'video/mp4';
      setStreamLoading(false);
      setUploadProgress(100);
      setServerBufferingProgress(100); // threshold reached — reset to full

      if (isHost) {
        console.log('[stream-ready] host path — hostVideoRef:', !!hostVideoRef.current, 'fileUrlRef:', fileUrlRef.current, '__hostFile:', !!window.__hostFile);

        // Build the most reliable URL: prefer the live File object, fall back to
        // the sessionStorage blob URL, fall back to the server HTTP URL.
        let localUrl;
        if (window.__hostFile) {
          // Create a fresh object URL from the still-live File reference
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          localUrl = URL.createObjectURL(window.__hostFile);
          blobUrlRef.current = localUrl;
        } else if (fileUrlRef.current) {
          localUrl = fileUrlRef.current;
        } else {
          localUrl = SERVER_URL + streamUrl;
        }

        console.log('[stream-ready] host video url:', localUrl);

        setIsStreaming(true);
        isStreamingRef.current = true;

        // hostVideoRef.current is guaranteed populated because HostVideo renders
        // <video ref={hostVideoRef}> as a permanent JSX element (no conditional).
        if (hostVideoRef.current) {
          const v = hostVideoRef.current;
          v.src = localUrl;
          v.play().catch(err => {
            console.warn('[stream-ready] play() failed:', err.message, '— waiting for user click');
            addSystemMessage('Click the video to start playback');
          });
        }
      } else if (!isHost) {
        // Reset any stale download state from a prior failed attempt so the
        // viewer setup effect always re-runs, even if serverVideoUrl is the same URL.
        downloadingRef.current = false;
        streamFileSizeRef.current = fileSize || 0;
        setServerVideoUrl(SERVER_URL + streamUrl);
        // Bump the trigger so the viewer setup effect re-runs unconditionally.
        // React skips effects whose deps haven't changed, so if serverVideoUrl is
        // already the same URL (e.g. after a 404 retry), we need this extra dep.
        setStreamTrigger(t => t + 1);
      }
    };

    const onStreamError = ({ message }) => {
      setStreamError(message || 'Server assembly failed');
      setStreamLoading(false);
    };

    socketRef.current.on('stream-buffering', onStreamBuffering);
    socketRef.current.on('stream-ready',    onStreamReady);
    socketRef.current.on('stream-error',    onStreamError);
    return () => {
      if (!socketRef.current) return;
      socketRef.current.off('stream-buffering', onStreamBuffering);
      socketRef.current.off('stream-ready',    onStreamReady);
      socketRef.current.off('stream-error',    onStreamError);
    };
  }, [socketReady, isHost]);

  // ─── Viewer setup: runs after <video> is in the DOM ───────────────────────
  useEffect(() => {
    if (isHost || !serverVideoUrl) return;
    const v = viewerVideoRef.current;
    if (!v) {
      console.warn('[viewer-setup] viewerVideoRef.current is null — skipping');
      return;
    }

    // Cancel any in-flight blob download from a previous stream attempt
    if (downloadAbortRef.current) {
      downloadAbortRef.current.abort();
      downloadAbortRef.current = null;
    }

    downloadingRef.current = true;
    setConnectionStatus('buffering');
    setDownloadProgress(0);

    // Start HTTP playback immediately
    v.src = serverVideoUrl;
    v.load();

    let readyFired = false;
    const markReady = () => {
      if (readyFired) return;
      readyFired = true;
      clearTimeout(readyTimeout);
      setConnectionStatus('ready');
      setIsStreaming(true);
      isStreamingRef.current = true;
      // Attempt autoplay; if rejected (browser policy), add a persistent canplay
      // listener so the video starts as soon as the user interacts or data arrives.
      v.play().catch(() => {
        const onCanPlayRetry = () => {
          v.play().catch(() => {});
          v.removeEventListener('canplay', onCanPlayRetry);
        };
        v.addEventListener('canplay', onCanPlayRetry);
        addSystemMessage('Click the video to start playback');
      });
    };

    const onError = () => {
      if (!readyFired) {
        readyFired = true;
        clearTimeout(readyTimeout);
        downloadingRef.current = false;
        console.error('[viewer-setup] video element error — url:', serverVideoUrl);
        addSystemMessage('Video load error — waiting for next sync');
        setConnectionStatus('disconnected');
      }
    };

    v.addEventListener('canplay',    markReady, { once: true });
    v.addEventListener('loadeddata', markReady, { once: true });
    v.addEventListener('error',      onError,   { once: true });

    // Hard timeout: if neither event fires in 15s, mark ready anyway.
    // play() inside markReady will catch the case where no data is actually
    // available yet — the persistent canplay listener above handles retry.
    const readyTimeout = setTimeout(markReady, 15000);

    // Background full-file download — only for small files.
    // For large files (> MAX_BLOB_DOWNLOAD_BYTES), HTTP range requests via
    // pipeGrowingFile handle seeking adequately without loading the whole
    // file into JS heap (which OOMs the browser tab for feature-length movies).
    const fileSize = streamFileSizeRef.current;
    if (fileSize === 0 || fileSize <= MAX_BLOB_DOWNLOAD_BYTES) {
      const abortCtrl = new AbortController();
      downloadAbortRef.current = abortCtrl;
      downloadToBlob(serverVideoUrl, streamFileType.current, v, abortCtrl.signal);
    } else {
      console.log(`[viewer] file ${(fileSize / 1024 / 1024).toFixed(0)} MB — skipping blob download, using HTTP streaming`);
      // Don't show the "Buffering locally" progress bar for large files
      setDownloadProgress(0);
    }

    return () => {
      clearTimeout(readyTimeout);
      v.removeEventListener('canplay',    markReady);
      v.removeEventListener('loadeddata', markReady);
      v.removeEventListener('error',      onError);
      if (downloadAbortRef.current) {
        downloadAbortRef.current.abort();
        downloadAbortRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, serverVideoUrl, streamTrigger]);

  // ─── Background full-file download → swap to local blob on completion ─────
  // Only runs for files ≤ MAX_BLOB_DOWNLOAD_BYTES. Abortable via signal.
  const downloadToBlob = async (httpUrl, fileType, videoEl, signal) => {
    try {
      const response = await fetch(httpUrl, { signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal?.aborted) { reader.cancel(); return; }
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setDownloadProgress(Math.min(99, Math.round((received / contentLength) * 100)));
        }
      }

      if (signal?.aborted) return;

      // Build local blob and swap video source at the current playback position
      const blob = new Blob(chunks, { type: fileType || 'video/mp4' });
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      const v = videoEl || viewerVideoRef.current;
      if (v && !signal?.aborted) {
        const currentTime = v.currentTime;
        const wasPaused   = v.paused;
        v.src = blobUrl;
        v.load();
        v.currentTime = currentTime;
        if (!wasPaused) v.play().catch(() => {});
      }

      setDownloadProgress(100);

    } catch (err) {
      if (err.name === 'AbortError') return; // normal cancellation — no log needed
      console.error('Background download failed:', err);
      downloadingRef.current = false;
    }
  };

  // ─── Socket: play/pause/seek sync ─────────────────────────────────────────
  useEffect(() => {
    if (!socketRef.current || !socketReady) return;

    const onStateUpdate = ({ isPlaying, currentTime }) => {
      if (isHost || !viewerVideoRef.current) return;
      const v = viewerVideoRef.current;
      if (Math.abs(v.currentTime - currentTime) > 2) v.currentTime = currentTime;
      isPlaying ? v.play().catch(() => {}) : v.pause();
    };

    const onSeek = ({ seekTime }) => {
      if (isHost || !viewerVideoRef.current) return;
      viewerVideoRef.current.currentTime = seekTime;
      // On HTTP: triggers a range request. On blob: instant.
    };

    const onFallbackSync = ({ currentTime, isPlaying }) => {
      // uploadId was previously sent here but caused a double-trigger race with
      // the stream-ready replay. Video URL is now handled exclusively by stream-ready.
      if (isHost) return;
      // Sync playback position after video has a moment to load
      setTimeout(() => {
        const v = viewerVideoRef.current;
        if (v && isStreamingRef.current) {
          v.currentTime = currentTime;
          if (isPlaying) v.play().catch(() => {});
        }
      }, 1500);
    };

    // Host: server says the seek position is not yet assembled — pause and show buffering UI
    const onSeekNeedsBuffering = () => {
      if (!isHost) return;
      setIsSeekBuffering(true);
      if (hostVideoRef.current) hostVideoRef.current.pause();
    };

    // Host + viewers: assembly has reached the seek position — resume playback
    const onSeekBuffered = () => {
      setIsSeekBuffering(false);
      if (isHost && hostVideoRef.current) {
        hostVideoRef.current.play().catch(() => {});
      }
    };

    socketRef.current.on('videoStateUpdate',      onStateUpdate);
    socketRef.current.on('videoSeekOperation',    onSeek);
    socketRef.current.on('fallback-sync-state',   onFallbackSync);
    socketRef.current.on('seek-needs-buffering',  onSeekNeedsBuffering);
    socketRef.current.on('seek-buffered',         onSeekBuffered);
    return () => {
      if (!socketRef.current) return;
      socketRef.current.off('videoStateUpdate',      onStateUpdate);
      socketRef.current.off('videoSeekOperation',    onSeek);
      socketRef.current.off('fallback-sync-state',   onFallbackSync);
      socketRef.current.off('seek-needs-buffering',  onSeekNeedsBuffering);
      socketRef.current.off('seek-buffered',         onSeekBuffered);
    };
  }, [socketReady, isHost]);

  // ─── Upload: chunk file to server ─────────────────────────────────────────
  const startStreaming = async () => {
    if (!fileUrlRef.current) {
      setStreamError('No file URL available. Please refresh and try again.');
      return false;
    }
    setStreamLoading(true);
    setStreamError('');
    setUploadProgress(0);

    try {
      const fileName    = localStorage.getItem('hostFileName') || 'video';
      const fileType    = localStorage.getItem('hostFileType') || 'video/mp4';
      const fileSize    = parseInt(localStorage.getItem('hostFileSize') || '0', 10);
      const hostFile    = window.__hostFile || null;
      const srcSize     = hostFile ? hostFile.size : fileSize;
      const totalChunks = Math.ceil(srcSize / CHUNK_SIZE);

      const initRes = await fetch(SERVER_URL + '/upload/init', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fileName, fileType, fileSize: srcSize, roomId, totalChunks })
      });
      if (!initRes.ok) throw new Error('Failed to initialise upload on server');
      const { uploadId } = await initRes.json();
      uploadIdRef.current = uploadId;

      // Notify viewers immediately so they show the buffering UI while chunks upload.
      // Must happen before the chunk loop — assembly runs concurrently with upload and
      // stream-ready can fire before all chunks finish, meaning viewers would miss the UI.
      socketRef.current.emit('streaming-status-update', { roomId, streaming: true, fileName, fileType });

      // Load blob fallback once if no File object
      let fullBlob = null;
      if (!hostFile) {
        if (fileSize > 500 * 1024 * 1024) addSystemMessage('Warning: large file — keep this tab open during upload.');
        fullBlob = await (await fetch(fileUrlRef.current)).blob();
      }

      // Upload PARALLEL_UPLOADS chunks at a time for speed
      let completed = 0;
      for (let batchStart = 0; batchStart < totalChunks; batchStart += PARALLEL_UPLOADS) {
        const batchEnd = Math.min(batchStart + PARALLEL_UPLOADS, totalChunks);
        const batch = [];
        for (let i = batchStart; i < batchEnd; i++) {
          const start = i * CHUNK_SIZE;
          const chunk = hostFile ? hostFile.slice(start, start + CHUNK_SIZE)
                                 : fullBlob.slice(start, start + CHUNK_SIZE);
          const form = new FormData();
          form.append('chunk', chunk, fileName);
          batch.push(
            fetch(SERVER_URL + '/upload/chunk/' + uploadId + '/' + i, { method: 'POST', body: form })
              .then(r => {
                if (!r.ok) throw new Error('Chunk ' + i + ' upload failed');
                completed++;
                setUploadProgress(Math.round((completed / totalChunks) * 90));
              })
          );
        }
        await Promise.all(batch);
      }

      addSystemMessage('Upload complete — assembling on server...');
      return true;
    } catch (err) {
      console.error('Upload error:', err);
      setStreamError('Upload failed: ' + err.message);
      setStreamLoading(false);
      // Roll back the streaming status we optimistically sent at init time
      if (socketRef.current) {
        socketRef.current.emit('streaming-status-update', { roomId, streaming: false, fileName: null, fileType: null });
      }
      return false;
    }
  };

  const stopStreaming = () => {
    if (!isStreaming) return;
    // Cancel any in-flight blob download before clearing state
    if (downloadAbortRef.current) {
      downloadAbortRef.current.abort();
      downloadAbortRef.current = null;
    }
    if (hostVideoRef.current)  { hostVideoRef.current.pause(); hostVideoRef.current.src = ''; hostVideoRef.current.load(); }
    if (viewerVideoRef.current) { viewerVideoRef.current.pause(); viewerVideoRef.current.src = ''; viewerVideoRef.current.load(); }
    if (blobUrlRef.current)    { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    if (uploadIdRef.current) {
      fetch(SERVER_URL + '/upload/' + uploadIdRef.current, { method: 'DELETE' }).catch(() => {});
      uploadIdRef.current = null;
    }
    socketRef.current.emit('streaming-status-update', { roomId, streaming: false, fileName: null, fileType: null });
    setIsStreaming(false);
    isStreamingRef.current = false;
    setServerVideoUrl('');
    setUploadProgress(0);
    setDownloadProgress(0);
    setServerBufferingProgress(0);
    setConnectionStatus('disconnected');
    setIsSeekBuffering(false);
    downloadingRef.current = false;
    addSystemMessage('Stopped streaming.');
  };

  const handleSeekEvent = (currentTime) => {
    if (!isHost || !isStreamingRef.current || !socketRef.current) return;
    socketRef.current.emit('videoSeekOperation', { roomId, seekTime: currentTime, sourceTimestamp: Date.now() });
  };

  const debugWebRTCConnections = () => ({ peerConnected: false, peerId: 'N/A', connectionCount: 0, streamActive: isStreaming });

  const contextValue = {
    isStreaming, streamError, streamLoading,
    connectionStatus, uploadProgress, downloadProgress, serverBufferingProgress, serverVideoUrl,
    isSeekBuffering,
    fileUrlRef, hostVideoRef, viewerVideoRef,
    startStreaming, stopStreaming, handleSeekEvent, debugWebRTCConnections,
    setStreamError, setStreamLoading, setConnectionStatus
  };

  return <WebRTCContext.Provider value={contextValue}>{children}</WebRTCContext.Provider>;
};
