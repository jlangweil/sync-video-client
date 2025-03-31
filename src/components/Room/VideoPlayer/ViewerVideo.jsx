import React from 'react';
import { useWebRTC } from '../WebRTC/WebRTCProvider';
import './VideoPlayer.css';

function ViewerVideo({ 
  videoUrl,
  videoFit,
  isTheaterMode,
  toggleTheaterMode
}) {
  const { 
    viewerVideoRef, 
    connectionStatus
  } = useWebRTC();

  // Request fullscreen function
  const requestFullscreen = () => {
    if (viewerVideoRef.current && viewerVideoRef.current.requestFullscreen) {
      viewerVideoRef.current.requestFullscreen();
    } else if (viewerVideoRef.current && viewerVideoRef.current.webkitRequestFullscreen) {
      viewerVideoRef.current.webkitRequestFullscreen();
    }
  };

  return (
    <div className="video-wrapper">
      {videoUrl && videoUrl.startsWith('streaming:') ? (
        // Show video when host is streaming
        <>
          <video
            ref={viewerVideoRef}
            controls={false}
            style={{ objectFit: videoFit }}
            className="viewer-video"
            playsInline
          />
          
          {/* Connection status indicator */}
          <div className="connection-status">
            <div className="status-indicator">
              {connectionStatus === 'disconnected' ? (
                <>
                  <div className="status-dot disconnected"></div>
                  <span>Disconnected</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <div className="status-dot connecting"></div>
                  <span>Connecting to stream...</span>
                </>
              ) : connectionStatus === 'buffering' ? (
                <>
                  <div className="status-dot buffering"></div>
                  <span>Buffering content...</span>
                </>
              ) : connectionStatus === 'error' ? (
                <>
                  <div className="status-dot error"></div>
                  <span>Connection error</span>
                </>
              ) : (
                <>
                  <div className="status-dot ready"></div>
                  <span>Stream connected</span>
                </>
              )}
            </div>
          </div>
          
          <div className="viewer-controls">
            <button onClick={toggleTheaterMode} className="control-button theater-button">
              {isTheaterMode ? 'Exit Theater' : 'Theater Mode'}
            </button>
            <button 
              className="control-button fullscreen-button" 
              onClick={requestFullscreen}
            >
              Fullscreen
            </button>
          </div>
          <div className="viewer-message">
            <p>Streaming from host - only the host can control playback</p>
          </div>
        </>
      ) : videoUrl && videoUrl.startsWith('local:') ? (
        // Host has a file but hasn't started streaming yet
        <div className="waiting-for-video">
          <p>Host has selected: {videoUrl.replace('local:', '')}</p>
          <p>Waiting for host to start streaming...</p>
        </div>
      ) : (
        // No video available yet
        <div className="waiting-for-video">
          <p>Waiting for host to select a video...</p>
        </div>
      )}
    </div>
  );
}

export default ViewerVideo;