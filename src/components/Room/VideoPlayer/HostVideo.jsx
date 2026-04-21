import React, { useEffect, useState, useRef } from 'react';
import { useWebRTC } from '../WebRTC/WebRTCProvider';
import './VideoPlayer.css';

function HostVideo({
  videoUrl,
  videoFit,
  isTheaterMode,
  toggleTheaterMode,
  handleVideoStateChange,
  processingRemoteUpdate
}) {
  const {
    hostVideoRef,
    isStreaming,
    startStreaming,
    streamError,
    streamLoading,
    uploadProgress,
    serverBufferingProgress,
    setStreamError,
    fileUrlRef,
  } = useWebRTC();

  const [seekingInfo, setSeekingInfo] = useState(null);
  const lastSentTimeUpdateRef = useRef(0);

  // Update objectFit when prop changes
  useEffect(() => {
    if (hostVideoRef.current) {
      hostVideoRef.current.style.objectFit = videoFit || 'contain';
    }
  }, [videoFit, hostVideoRef]);

  // Auto-clear seeking overlay
  useEffect(() => {
    if (!seekingInfo) return;
    const t = setTimeout(() => setSeekingInfo(null), 1500);
    return () => clearTimeout(t);
  }, [seekingInfo]);

  const handlePlay = () => {
    if (!processingRemoteUpdate && hostVideoRef.current) {
      handleVideoStateChange(true, hostVideoRef.current.currentTime);
    }
  };

  const handlePause = () => {
    if (!processingRemoteUpdate && hostVideoRef.current) {
      handleVideoStateChange(false, hostVideoRef.current.currentTime);
    }
  };

  const handleSeeked = () => {
    if (!processingRemoteUpdate && hostVideoRef.current) {
      handleVideoStateChange(!hostVideoRef.current.paused, hostVideoRef.current.currentTime);
      setSeekingInfo(null);
    }
  };

  const handleSeeking = () => {
    if (isStreaming && hostVideoRef.current) {
      setSeekingInfo({ targetTime: hostVideoRef.current.currentTime });
    }
  };

  const handleTimeUpdate = () => {
    if (!processingRemoteUpdate && hostVideoRef.current) {
      const now = Date.now();
      if (now - lastSentTimeUpdateRef.current > 2000) {
        handleVideoStateChange(!hostVideoRef.current.paused, hostVideoRef.current.currentTime);
        lastSentTimeUpdateRef.current = now;
      }
    }
  };

  const handleStartStreaming = async () => {
    if (!fileUrlRef.current) {
      const stored = sessionStorage.getItem('hostFileUrl');
      if (stored) {
        fileUrlRef.current = stored;
      } else {
        setStreamError('File URL is missing. Please try refreshing the page.');
        return;
      }
    }
    await startStreaming();
  };

  const videoStyle = {
    width: '100%',
    height: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'block',
    margin: '0 auto',
    backgroundColor: '#000',
    objectFit: videoFit || 'contain',
    position: 'relative',
    zIndex: 1
  };

  const wrapperStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    overflow: 'hidden'
  };

  return (
    <div className="video-wrapper" style={wrapperStyle}>

      {/* Video is always rendered — guarantees hostVideoRef is populated on mount */}
      <video
        ref={hostVideoRef}
        controls
        playsInline
        preload="auto"
        style={videoStyle}
        className="host-video maintain-aspect"
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeked={handleSeeked}
        onSeeking={handleSeeking}
        onTimeUpdate={handleTimeUpdate}
        onError={(e) => setStreamError(`Video error: ${e.target.error?.message || 'Unknown error'}`)}
      />

      {/* Upload / assembly progress overlay */}
      {streamLoading && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 30, color: 'white', gap: '16px'
        }}>
          {uploadProgress < 90 ? (
            // Phase 1: chunks uploading
            <>
              <div style={{ fontSize: '18px', fontWeight: 500 }}>Uploading video to server...</div>
              <div style={{ width: '300px', height: '10px', background: 'rgba(255,255,255,0.2)', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#e74c3c', borderRadius: '5px', transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ fontSize: '14px', opacity: 0.8 }}>{uploadProgress}%</div>
              <div style={{ fontSize: '12px', opacity: 0.6 }}>Keep this tab open during upload</div>
            </>
          ) : (
            // Phase 2: upload done, server assembling — show same progress clients see
            <>
              <div style={{ fontSize: '18px', fontWeight: 500 }}>
                {serverBufferingProgress < 100
                  ? 'Buffering for viewers — playback starts soon'
                  : 'Starting playback…'}
              </div>
              <div style={{ width: '300px', height: '10px', background: 'rgba(255,255,255,0.2)', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: `${serverBufferingProgress}%`, height: '100%', background: '#e74c3c', borderRadius: '5px', transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '300px', marginTop: '-8px', fontSize: '12px', opacity: 0.65 }}>
                <span>{serverBufferingProgress}% buffered</span>
                <span>playback starts at 100%</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Start streaming button */}
      {!streamLoading && !isStreaming && (
        <div style={{ position: 'absolute', bottom: '20px', left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 50 }}>
          <button
            onClick={handleStartStreaming}
            disabled={!videoUrl || !videoUrl.startsWith('local:')}
            style={{
              backgroundColor: '#e74c3c', color: 'white', border: 'none',
              borderRadius: '4px', padding: '12px 28px', fontSize: '16px',
              fontWeight: '500', cursor: 'pointer', display: 'flex',
              alignItems: 'center', gap: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
            }}
          >
            <span style={{ fontSize: '18px' }}>▶</span>
            Start Streaming
          </button>
        </div>
      )}

      {/* Seeking indicator */}
      {seekingInfo && (
        <div className="seeking-overlay">
          <div className="seeking-message">
            <div className="seeking-spinner"></div>
            <p>
              Seeking to {Math.floor(seekingInfo.targetTime / 60)}:{Math.floor(seekingInfo.targetTime % 60).toString().padStart(2, '0')}
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {streamError && !isStreaming && !streamLoading && (
        <div style={{
          position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: 'rgba(231,76,60,0.9)', color: 'white',
          padding: '12px 20px', textAlign: 'center', borderRadius: '4px',
          maxWidth: '80%', zIndex: 51, fontSize: '14px'
        }}>
          {streamError}
        </div>
      )}
    </div>
  );
}

export default HostVideo;
