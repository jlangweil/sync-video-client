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
  const [uploadProgress,   setUploadProgress]   = useState(0);
  const [downloadProgress, setDownloadProgress] = useState(0); // 0-100, viewer only
  const [serverVideoUrl,   setServerVideoUrl]   = useState(''); // HTTP URL → shows <video> element
  // Incremented on every stream-ready for viewers so the setup effect always re-runs,
  // even when serverVideoUrl doesn't change (e.g. after a failed previous attempt).
  const [streamTrigger,    setStreamTrigger]    = useState(0);

  const hostVideoRef    = useRef(null);
  const viewerVideoRef  = useRef(null);
  const fileUrlRef      = useRef(null);
  const uploadIdRef     = useRef(null);
  const isStreamingRef  = useRef(false);
  const blobUrlRef      = useRef(null);    // local blob URL after full download
  const downloadingRef  = useRef(false);   // prevent duplicate downloads
  const streamFileType  = useRef('video/mp4');

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

    const onStreamReady = ({ uploadId, streamUrl, fileType }) => {
      uploadIdRef.current = uploadId;
      streamFileType.current = fileType || 'video/mp4';
      setStreamLoading(false);
      setUploadProgress(100);

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

    socketRef.current.on('stream-ready', onStreamReady);
    socketRef.current.on('stream-error', onStreamError);
    return () => {
      if (!socketRef.current) return;
      socketRef.current.off('stream-ready', onStreamReady);
      socketRef.current.off('stream-error', onStreamError);
    };
  }, [socketReady, isHost]);

  // ─── Viewer setup: runs after <video> is in the DOM ───────────────────────
  // serverVideoUrl changing to a truthy value means ViewerVideo just rendered
  // the <video ref={viewerVideoRef}> element. By the time this effect fires,
  // the DOM commit is done and viewerVideoRef.current is populated.
  useEffect(() => {
    if (isHost || !serverVideoUrl) return;
    const v = viewerVideoRef.current;
    if (!v) {
      console.warn('[viewer-setup] viewerVideoRef.current is null — skipping');
      return;
    }

    downloadingRef.current = true;
    setConnectionStatus('buffering');
    setDownloadProgress(1);

    // Start HTTP playback immediately
    v.src = serverVideoUrl;
    v.load();

    let readyFired = false;
    const markReady = () => {
      if (readyFired) return;
      readyFired = true;
      clearTimeout(readyTimeout);
      setConnectionStatus('ready');
      v.play().catch(() => addSystemMessage('Click video to start playback'));
      setIsStreaming(true);
      isStreamingRef.current = true;
    };

    const onError = () => {
      if (!readyFired) {
        readyFired = true;
        clearTimeout(readyTimeout);
        downloadingRef.current = false; // allow retry on next stream-ready
        console.error('[viewer-setup] video element error — url:', serverVideoUrl);
        addSystemMessage('Video load error — waiting for next sync');
        setConnectionStatus('disconnected');
      }
    };

    // canplay fires when the browser thinks it can play without stalling.
    // loadeddata fires earlier (first frame decoded). Use either.
    v.addEventListener('canplay',    markReady, { once: true });
    v.addEventListener('loadeddata', markReady, { once: true });
    v.addEventListener('error',      onError,   { once: true });

    // Hard timeout: if neither event fires in 12s, try to play anyway.
    const readyTimeout = setTimeout(markReady, 12000);

    // Download full file in background while video plays
    downloadToBlob(serverVideoUrl, streamFileType.current, v);

    return () => {
      clearTimeout(readyTimeout);
      v.removeEventListener('canplay',    markReady);
      v.removeEventListener('loadeddata', markReady);
      v.removeEventListener('error',      onError);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, serverVideoUrl, streamTrigger]);

  // ─── Background full-file download → swap to local blob on completion ─────
  const downloadToBlob = async (httpUrl, fileType, videoEl) => {
    try {
      const response = await fetch(httpUrl);
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setDownloadProgress(Math.min(99, Math.round((received / contentLength) * 100)));
        }
      }

      // Build local blob and swap video source at the current playback position
      const blob = new Blob(chunks, { type: fileType || 'video/mp4' });
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      const v = videoEl || viewerVideoRef.current;
      if (v) {
        const currentTime = v.currentTime;
        const wasPaused   = v.paused;
        v.src = blobUrl;
        v.load();
        v.currentTime = currentTime;
        if (!wasPaused) v.play().catch(() => {});
      }

      setDownloadProgress(100);

    } catch (err) {
      console.error('Background download failed:', err);
      // HTTP playback is still running — don't show an error to the user
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

    const onFallbackSync = ({ currentTime, isPlaying, uploadId }) => {
      if (isHost) return;
      if (uploadId) {
        // Late joiner — same flow as stream-ready. Always reset so we can retry.
        streamFileType.current = null;
        uploadIdRef.current = uploadId;
        downloadingRef.current = false;
        setServerVideoUrl(SERVER_URL + '/stream/' + uploadId);
        setStreamTrigger(t => t + 1);
      }
      // Sync playback position after video has a moment to load
      setTimeout(() => {
        const v = viewerVideoRef.current;
        if (v && isStreamingRef.current) {
          v.currentTime = currentTime;
          if (isPlaying) v.play().catch(() => {});
        }
      }, 1500);
    };

    socketRef.current.on('videoStateUpdate',    onStateUpdate);
    socketRef.current.on('videoSeekOperation',  onSeek);
    socketRef.current.on('fallback-sync-state', onFallbackSync);
    return () => {
      if (!socketRef.current) return;
      socketRef.current.off('videoStateUpdate',    onStateUpdate);
      socketRef.current.off('videoSeekOperation',  onSeek);
      socketRef.current.off('fallback-sync-state', onFallbackSync);
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

      socketRef.current.emit('streaming-status-update', { roomId, streaming: true, fileName, fileType });
      addSystemMessage('Upload complete — assembling on server...');
      return true;
    } catch (err) {
      console.error('Upload error:', err);
      setStreamError('Upload failed: ' + err.message);
      setStreamLoading(false);
      return false;
    }
  };

  const stopStreaming = () => {
    if (!isStreaming) return;
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
    setConnectionStatus('disconnected');
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
    connectionStatus, uploadProgress, downloadProgress, serverVideoUrl,
    fileUrlRef, hostVideoRef, viewerVideoRef,
    startStreaming, stopStreaming, handleSeekEvent, debugWebRTCConnections,
    setStreamError, setStreamLoading, setConnectionStatus
  };

  return <WebRTCContext.Provider value={contextValue}>{children}</WebRTCContext.Provider>;
};
