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
    networkStats,
    debugNetworkConnectivity
  } = useWebRTC();

  // State for connection timeout
  const [connectionTimeout, setConnectionTimeout] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [networkCheckResult, setNetworkCheckResult] = useState(null);

  // Request fullscreen function
  const requestFullscreen = () => {
    if (viewerVideoRef.current && viewerVideoRef.current.requestFullscreen) {
      viewerVideoRef.current.requestFullscreen();
    } else if (viewerVideoRef.current && viewerVideoRef.current.webkitRequestFullscreen) {
      viewerVideoRef.current.webkitRequestFullscreen();
    }
  };

  // Set connection timeout if stuck in connecting state
  useEffect(() => {
    let timeoutId = null;
    
    if (connectionStatus === 'connecting') {
      timeoutId = setTimeout(() => {
        setConnectionTimeout(true);
      }, 15000); // 15 seconds timeout
    } else {
      setConnectionTimeout(false);
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [connectionStatus]);
  
  // Add detailed event listeners for debugging
  useEffect(() => {
    if (viewerVideoRef.current) {
      viewerVideoRef.current.addEventListener('loadedmetadata', () => {
        console.log('Video metadata loaded');
      });
      
      viewerVideoRef.current.addEventListener('loadeddata', () => {
        console.log('Video data loaded');
      });
      
      viewerVideoRef.current.addEventListener('playing', () => {
        console.log('Video started playing');
      });
      
      viewerVideoRef.current.addEventListener('waiting', () => {
        console.log('Video waiting for data');
      });
      
      viewerVideoRef.current.addEventListener('stalled', () => {
        console.log('Video playback stalled');
      });
      
      viewerVideoRef.current.addEventListener('canplay', () => {
        console.log('Video can play');
      });
      
      viewerVideoRef.current.addEventListener('error', (e) => {
        console.error('Video error:', e);
      });
    }
  }, [viewerVideoRef.current]);
  
  // Function to check network connectivity
  const checkNetworkConnectivity = async () => {
    try {
      const result = await debugNetworkConnectivity();
      setNetworkCheckResult(result);
      setShowDebugInfo(true);
    } catch (err) {
      console.error('Error checking network:', err);
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
            autoPlay
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
                  {connectionTimeout && (
                    <button 
                      onClick={checkNetworkConnectivity}
                      className="network-check-button"
                      style={{
                        marginLeft: '10px',
                        background: '#f39c12',
                        border: 'none',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Check Connection
                    </button>
                  )}
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
                  <button 
                    onClick={checkNetworkConnectivity}
                    className="network-check-button"
                    style={{
                      marginLeft: '10px',
                      background: '#e74c3c',
                      border: 'none',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Check Connection
                  </button>
                </>
              ) : (
                <>
                  <div className="status-dot ready"></div>
                  <span>Stream connected</span>
                </>
              )}
            </div>
          </div>
          
          {/* Network stats panel when debugging */}
          {(showDebugInfo || connectionStatus === 'connecting') && (
            <div className="network-stats-panel" style={{
              position: 'absolute',
              bottom: '50px',
              left: '10px',
              background: 'rgba(0,0,0,0.7)',
              padding: '10px',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
              maxWidth: '350px',
              zIndex: 20
            }}>
              <h4 style={{ margin: '0 0 5px 0' }}>Connection Info</h4>
              
              {connectionStatus === 'connecting' && networkStats.bytesReceived > 0 && (
                <div>
                  <p style={{ color: '#f39c12', margin: '0 0 8px 0' }}>
                    Data is being received but video hasn't started playing.
                    Try clicking on the video.
                  </p>
                </div>
              )}
              
              {networkStats.bytesReceived > 0 ? (
                <div>
                  <p style={{ margin: '2px 0' }}>Data received: {(networkStats.bytesReceived / 1024 / 1024).toFixed(2)} MB</p>
                  <p style={{ margin: '2px 0' }}>Packets: {networkStats.packetsReceived} ({networkStats.packetsLost || 0} lost)</p>
                  <p style={{ margin: '2px 0' }}>Jitter: {(networkStats.jitter || 0).toFixed(2)} ms</p>
                  <p style={{ margin: '2px 0' }}>Frames: {networkStats.framesDecoded || 0} decoded, {networkStats.framesDropped || 0} dropped</p>
                </div>
              ) : (
                <p>No data received yet.</p>
              )}
              
              {networkCheckResult && (
                <div style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '5px' }}>
                  <h4 style={{ margin: '0 0 5px 0' }}>Network Check Results</h4>
                  <p style={{ margin: '2px 0' }}>Internet: {networkCheckResult.internet ? '✅ Connected' : '❌ Not detected'}</p>
                  <p style={{ margin: '2px 0' }}>STUN: {networkCheckResult.stunWorking ? '✅ Working' : '❌ Not working'}</p>
                  <p style={{ margin: '2px 0' }}>TURN: {networkCheckResult.turnWorking ? '✅ Working' : '❌ Not working'}</p>
                  <p style={{ margin: '2px 0' }}>ICE Candidates: {networkCheckResult.candidates}</p>
                </div>
              )}
              
              <button 
                onClick={() => setShowDebugInfo(false)} 
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  marginTop: '10px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Hide Debug Info
              </button>
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
            {!showDebugInfo && (
              <button 
                className="control-button debug-button"
                onClick={() => setShowDebugInfo(true)}
                style={{
                  background: '#3498db'
                }}
              >
                Debug Info
              </button>
            )}
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