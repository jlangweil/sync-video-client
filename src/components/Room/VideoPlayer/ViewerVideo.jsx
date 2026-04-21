import React, { useState, useEffect } from 'react';
import { useWebRTC } from '../WebRTC/WebRTCProvider';
import './VideoPlayer.css';

function ViewerVideo({
  videoUrl,
  videoFit,
  isTheaterMode,
  isFullscreen,
  toggleTheaterMode,
  toggleFullscreen
}) {
  const {
    viewerVideoRef,
    connectionStatus,
    serverVideoUrl,
    downloadProgress,
    serverBufferingProgress
  } = useWebRTC();

  const [reconnecting, setReconnecting] = useState(false);
  const [lastConnectionChange, setLastConnectionChange] = useState(Date.now());

  useEffect(() => {
    setLastConnectionChange(Date.now());
    if (connectionStatus === 'disconnected') {
      const timer = setTimeout(() => setReconnecting(true), 3000);
      return () => clearTimeout(timer);
    } else if (connectionStatus === 'ready') {
      setReconnecting(false);
    }
  }, [connectionStatus]);

  const getTimeSinceChange = () => {
    const s = Math.floor((Date.now() - lastConnectionChange) / 1000);
    return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`;
  };

  const videoContainerStyle = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: isTheaterMode ? '100vw' : '100%',
    height: isTheaterMode ? '100vh' : '100%',
    position: 'relative',
    backgroundColor: '#000',
    overflow: 'hidden'
  };

  const videoStyle = {
    width: isTheaterMode ? '100vw' : '100%',
    height: isTheaterMode ? '100vh' : '100%',
    maxWidth: isTheaterMode ? '100vw' : '100%',
    maxHeight: isTheaterMode ? '100vh' : '100%',
    objectFit: videoFit || 'contain',
    display: 'block',
    margin: '0 auto',
    backgroundColor: '#000',
    position: 'relative',
    zIndex: 1
  };

  return (
    <div className="video-wrapper" style={videoContainerStyle}>
      {serverVideoUrl ? (
        // Video URL is set (HTTP or local blob) — show player
        <>
          <video
            ref={viewerVideoRef}
            controls={false}
            style={videoStyle}
            className="viewer-video maintain-aspect"
            playsInline
            muted={false}
            preload="auto"
          />

          {/* Initial HTTP buffering overlay (only before first canplay) */}
          {connectionStatus === 'buffering' && downloadProgress < 5 && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 30,
              color: 'white',
              gap: '12px'
            }}>
              <div style={{ fontSize: '17px', fontWeight: 500 }}>Starting playback...</div>
              <div style={{ fontSize: '13px', opacity: 0.6 }}>Buffering first few seconds</div>
            </div>
          )}

          {/* Non-intrusive background download progress bar at the bottom */}
          {downloadProgress > 0 && downloadProgress < 100 && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 20,
              padding: '6px 10px 8px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.6))'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '4px'
              }}>
                <div style={{ flex: 1, height: '3px', background: 'rgba(255,255,255,0.2)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${downloadProgress}%`,
                    height: '100%',
                    background: '#e74c3c',
                    borderRadius: '2px',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  Buffering locally {downloadProgress}%
                </span>
              </div>
            </div>
          )}

          {/* Brief "fully buffered" confirmation */}
          {downloadProgress === 100 && (
            <DownloadCompleteToast />
          )}

          {/* Status dot (top-left, subtle) */}
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: 'rgba(0,0,0,0.5)',
            padding: '3px 8px',
            borderRadius: '10px'
          }}>
            <div style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: connectionStatus === 'ready' ? '#2ecc71'
                        : connectionStatus === 'buffering' ? '#f39c12'
                        : '#e74c3c'
            }} />
            <span style={{ color: 'white', fontSize: '11px' }}>
              {connectionStatus === 'ready' && downloadProgress === 100
                ? 'Local buffer'
                : connectionStatus === 'ready'
                ? 'Streaming'
                : connectionStatus === 'buffering'
                ? 'Buffering...'
                : 'Reconnecting...'}
            </span>
          </div>

          {/* Reconnection overlay */}
          {reconnecting && connectionStatus === 'disconnected' && downloadProgress < 100 && (
            <div className="reconnection-overlay">
              <div className="reconnection-message">
                <div className="reconnection-spinner"></div>
                <p>Connection lost</p>
                <p className="small">Attempting to reconnect...</p>
                <p className="status-time">Disconnected {getTimeSinceChange()}</p>
                <button onClick={() => window.location.reload()} className="refresh-button">
                  Refresh Page
                </button>
              </div>
            </div>
          )}
        </>
      ) : videoUrl && videoUrl.startsWith('streaming:') ? (
        // Host is uploading — show buffering progress toward the 10% start threshold
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'white',
          textAlign: 'center',
          padding: '20px',
          gap: '16px'
        }}>
          <div style={{ fontSize: '17px', fontWeight: 500 }}>
            {serverBufferingProgress === 0
              ? 'Waiting for upload to begin…'
              : serverBufferingProgress < 100
              ? 'Buffering — playback starts soon'
              : 'Starting playback…'}
          </div>

          {/* Progress bar */}
          <div style={{ width: '260px' }}>
            <div style={{
              width: '100%', height: '8px',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: '4px', overflow: 'hidden'
            }}>
              <div style={{
                width: `${serverBufferingProgress}%`,
                height: '100%',
                background: '#e74c3c',
                borderRadius: '4px',
                transition: 'width 0.4s ease'
              }} />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: '6px', fontSize: '12px', opacity: 0.65
            }}>
              <span>{serverBufferingProgress}% buffered</span>
              <span>starts at 100%</span>
            </div>
          </div>

          <div style={{ fontSize: '12px', opacity: 0.5 }}>
            {videoUrl.replace('streaming:', '')}
          </div>
        </div>
      ) : videoUrl && videoUrl.startsWith('local:') ? (
        // Host selected file, hasn't started yet
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'white',
          textAlign: 'center',
          padding: '20px'
        }}>
          <p style={{ margin: '10px 0', fontSize: '16px' }}>
            Host has selected: {videoUrl.replace('local:', '')}
          </p>
          <p style={{ margin: '10px 0', fontSize: '14px', opacity: 0.7 }}>
            Waiting for host to start streaming...
          </p>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'white',
          fontSize: '16px'
        }}>
          Waiting for host to select a video...
        </div>
      )}
    </div>
  );
}

// Fades in then out after a few seconds
function DownloadCompleteToast() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div style={{
      position: 'absolute',
      bottom: '16px',
      right: '16px',
      background: 'rgba(46,204,113,0.85)',
      color: 'white',
      padding: '6px 14px',
      borderRadius: '6px',
      fontSize: '13px',
      zIndex: 20,
      pointerEvents: 'none'
    }}>
      Fully buffered — instant seeking enabled
    </div>
  );
}

export default ViewerVideo;
