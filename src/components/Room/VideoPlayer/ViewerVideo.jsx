import React, { useState, useEffect } from 'react';
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
    connectionStatus,
    bufferPercentage
  } = useWebRTC();

  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectTimer, setReconnectTimer] = useState(null);
  const [lastConnectionChange, setLastConnectionChange] = useState(Date.now());

  // Handle connection status changes
  useEffect(() => {
    setLastConnectionChange(Date.now());
    
    if (connectionStatus === 'disconnected') {
      // If disconnected for more than a few seconds, show reconnecting UI
      const timer = setTimeout(() => {
        setReconnecting(true);
      }, 3000);
      
      setReconnectTimer(timer);
      
      return () => clearTimeout(timer);
    } else if (connectionStatus === 'ready') {
      // Clear reconnecting UI when connected
      setReconnecting(false);
    }
    
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
  }, [connectionStatus]);

  // Request fullscreen function
  const requestFullscreen = () => {
    if (viewerVideoRef.current && viewerVideoRef.current.requestFullscreen) {
      viewerVideoRef.current.requestFullscreen();
    } else if (viewerVideoRef.current && viewerVideoRef.current.webkitRequestFullscreen) {
      viewerVideoRef.current.webkitRequestFullscreen();
    }
  };

  // Get connection status text
  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'disconnected':
        return 'Disconnected from host';
      case 'connecting':
        return 'Connecting to stream...';
      case 'buffering':
        return 'Buffering content...';
      case 'error':
        return 'Connection error';
      case 'ready':
        return 'Stream connected';
      default:
        return 'Waiting for host';
    }
  };

  // Calculate time since last connection change
  const getTimeSinceChange = () => {
    const secondsElapsed = Math.floor((Date.now() - lastConnectionChange) / 1000);
    if (secondsElapsed < 60) {
      return `${secondsElapsed}s ago`;
    } else {
      return `${Math.floor(secondsElapsed / 60)}m ${secondsElapsed % 60}s ago`;
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
                  <span>Disconnected {reconnecting ? '(reconnecting...)' : ''}</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <div className="status-dot connecting"></div>
                  <span>Connecting to stream...</span>
                </>
              ) : connectionStatus === 'buffering' ? (
                <>
                  <div className="status-dot buffering"></div>
                  <span>Buffering content... {bufferPercentage > 0 ? `${bufferPercentage}%` : ''}</span>
                </>
              ) : connectionStatus === 'error' ? (
                <>
                  <div className="status-dot error"></div>
                  <span>Connection error - try refreshing</span>
                </>
              ) : (
                <>
                  <div className="status-dot ready"></div>
                  <span>Stream connected</span>
                </>
              )}
            </div>
          </div>
          
          {/* Extended reconnection UI */}
          {reconnecting && connectionStatus === 'disconnected' && (
            <div className="reconnection-overlay">
              <div className="reconnection-message">
                <div className="reconnection-spinner"></div>
                <p>Connection lost</p>
                <p className="small">Attempting to reconnect...</p>
                <p className="status-time">Disconnected {getTimeSinceChange()}</p>
                <button 
                  onClick={() => window.location.reload()} 
                  className="refresh-button"
                >
                  Refresh Page
                </button>
              </div>
            </div>
          )}
          
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