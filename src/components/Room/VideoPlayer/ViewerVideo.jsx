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

  // Enhanced video container styles for consistent positioning
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

  // Enhanced video styles to match host exactly
  const videoStyle = {
    width: isTheaterMode ? '100vw' : '100%',
    height: isTheaterMode ? '100vh' : '100%',
    maxWidth: isTheaterMode ? '100vw' : '100%',
    maxHeight: isTheaterMode ? '100vh' : '100%',
    minWidth: isTheaterMode ? '100vw' : 'auto',
    minHeight: isTheaterMode ? '100vh' : 'auto',
    objectFit: videoFit || 'contain',
    display: 'block',
    margin: '0 auto',
    backgroundColor: '#000',
    position: 'relative',
    zIndex: 1
  };

  return (
    <div className="video-wrapper" style={videoContainerStyle}>
      {videoUrl && videoUrl.startsWith('streaming:') ? (
        // Show video when host is streaming
        <>
          <video
            ref={viewerVideoRef}
            controls={false}
            style={videoStyle}
            className="viewer-video maintain-aspect"
            playsInline
            muted={false}
            preload="metadata"
            onLoadedMetadata={() => {
              console.log('Viewer video metadata loaded:', {
                videoWidth: viewerVideoRef.current?.videoWidth,
                videoHeight: viewerVideoRef.current?.videoHeight,
                duration: viewerVideoRef.current?.duration
              });
            }}
            onResize={() => {
              // Log when video dimensions change to help debug sizing issues
              if (viewerVideoRef.current) {
                console.log('Viewer video resized:', {
                  videoWidth: viewerVideoRef.current.videoWidth,
                  videoHeight: viewerVideoRef.current.videoHeight,
                  clientWidth: viewerVideoRef.current.clientWidth,
                  clientHeight: viewerVideoRef.current.clientHeight
                });
              }
            }}
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
          
          {/* Only show this message when not in theater/fullscreen mode */}
          {!isTheaterMode && !isFullscreen && (
            <div 
              className="viewer-message"
              style={{
                position: 'absolute',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                fontSize: '14px',
                zIndex: 10,
                textAlign: 'center',
                whiteSpace: 'nowrap'
              }}
            >
            </div>
          )}
        </>
      ) : videoUrl && videoUrl.startsWith('local:') ? (
        // Host has a file but hasn't started streaming yet
        <div 
          className="waiting-for-video"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'white',
            textAlign: 'center',
            padding: '20px'
          }}
        >
          <p style={{ margin: '10px 0', fontSize: '16px' }}>
            Host has selected: {videoUrl.replace('local:', '')}
          </p>
          <p style={{ margin: '10px 0', fontSize: '14px', opacity: 0.8 }}>
            Waiting for host to start streaming...
          </p>
        </div>
      ) : (
        // No video available yet
        <div 
          className="waiting-for-video"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'white',
            textAlign: 'center',
            padding: '20px'
          }}
        >
          <p style={{ margin: '10px 0', fontSize: '16px' }}>
            Waiting for host to select a video...
          </p>
        </div>
      )}
    </div>
  );
}

export default ViewerVideo;