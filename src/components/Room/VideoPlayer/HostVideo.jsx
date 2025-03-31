import React from 'react';
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
    stopStreaming, 
    streamError, 
    peerConnections
  } = useWebRTC();

  // Handle play/pause/seek events 
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
  
  const handleSeek = () => {
    if (!processingRemoteUpdate && hostVideoRef.current) {
      handleVideoStateChange(!hostVideoRef.current.paused, hostVideoRef.current.currentTime);
    }
  };
  
  // Handle time updates - throttled to reduce network traffic
  const handleTimeUpdate = () => {
    if (!processingRemoteUpdate && hostVideoRef.current) {
      // Throttle updates to avoid overloading (every 2 seconds)
      const now = Date.now();
      if (!window.lastSentTimeUpdate || now - window.lastSentTimeUpdate > 2000) {
        handleVideoStateChange(
          !hostVideoRef.current.paused, 
          hostVideoRef.current.currentTime
        );
        window.lastSentTimeUpdate = now;
      }
    }
  };

  return (
    <div className="video-wrapper">
      {!isStreaming ? (
        // Show streaming controls before streaming starts
        <div className="streaming-controls">
          <h3>Stream your selected video</h3>
          <p className="file-info">
            File: {localStorage.getItem('hostFileName') || 'No file selected'}
          </p>
          
          <button 
            onClick={startStreaming} 
            className="primary-button"
            disabled={!videoUrl.startsWith('local:')}
          >
            Start Streaming
          </button>
          
          {streamError && <p className="error-message">{streamError}</p>}
          
          <p className="hint">
            Click to start streaming the selected file to viewers
          </p>
        </div>
      ) : (
        // Show video player when streaming
        <>
          <video
            ref={hostVideoRef}
            controls={true} // Give the host full video controls
            style={{ objectFit: videoFit }}
            className="host-video"
            playsInline
            autoPlay
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeek}
            onTimeUpdate={handleTimeUpdate}
          />
          
          <div className="host-controls">
            <div className="connection-info">
              <p className="streaming-status">
                Streaming to {Object.keys(peerConnections).length} viewer(s)
              </p>
            </div>
            
            <div className="control-buttons">
              <button onClick={toggleTheaterMode} className="control-button theater-button">
                {isTheaterMode ? 'Exit Theater' : 'Theater Mode'}
              </button>
              <button onClick={stopStreaming} className="control-button stop-button">
                Stop Streaming
              </button>
            </div>
          </div>
          
          {/* Viewer stats panel for host */}
          <div className="viewer-stats-panel">
            <h4>Viewer Stats</h4>
            {Object.keys(peerConnections).length === 0 ? (
              <p>No viewers connected yet</p>
            ) : (
              <ul>
                {Object.keys(peerConnections).map(viewerId => (
                  <li key={viewerId} className="viewer-stat">
                    {viewerId.substring(0, 6)}: Connected
                    <span className="connection-quality good">
                      (streaming)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default HostVideo;