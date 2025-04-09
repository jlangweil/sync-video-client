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
    stopStreaming, 
    streamError, 
    peerConnections,
    setStreamError,
    debugWebRTCConnections,
    fileUrlRef,
    isSeekInProgress,
    isReconnecting
  } = useWebRTC();
  
  const [debugInfo, setDebugInfo] = useState({});
  const [showDebug, setShowDebug] = useState(false);
  const [seekingInfo, setSeekingInfo] = useState(null);
  
  // Use a ref to ensure video element is created properly
  const videoContainerRef = useRef(null);
  
  // Create video element immediately on mount
  useEffect(() => {
    if (!hostVideoRef.current) {
      console.log('Creating video element');
      // Create a new video element if it doesn't exist
      hostVideoRef.current = document.createElement('video');
      hostVideoRef.current.controls = true;
      hostVideoRef.current.playsInline = true;
      hostVideoRef.current.autoPlay = false;
      hostVideoRef.current.muted = false;
      hostVideoRef.current.style.width = '100%';
      hostVideoRef.current.style.height = '100%';
      hostVideoRef.current.style.objectFit = videoFit;
      hostVideoRef.current.className = 'host-video';
      
      // Add to the DOM
      if (videoContainerRef.current) {
        videoContainerRef.current.appendChild(hostVideoRef.current);
        console.log('Video element added to DOM');
      } else {
        console.error('Video container ref not available');
      }
    }
  }, []);

  // Fix the local file indicator
  useEffect(() => {
    // Check if the videoUrl is in the correct format
    if (videoUrl && !videoUrl.startsWith('local:') && localStorage.getItem('isHost') === 'true') {
      const fileName = localStorage.getItem('hostFileName');
      if (fileName) {
        console.log('Fixing video URL to use local: prefix');
      }
    }
  }, [videoUrl]);

  // Debug video element
  useEffect(() => {
    if (hostVideoRef.current) {
      // Add debug event listeners
      hostVideoRef.current.addEventListener('error', (e) => {
        console.error('Video error:', e);
        setStreamError(`Video error: ${e.target.error?.message || 'Unknown error'}`);
      });
      
      // Capture any playback issues
      hostVideoRef.current.addEventListener('stalled', () => {
        console.warn('Video playback stalled');
      });
      
      hostVideoRef.current.addEventListener('suspend', () => {
        console.warn('Video playback suspended');
      });
      
      hostVideoRef.current.addEventListener('waiting', () => {
        console.warn('Video waiting for more data');
      });
      
      // Add play/pause/seek event handlers
      hostVideoRef.current.onplay = handlePlay;
      hostVideoRef.current.onpause = handlePause;
      hostVideoRef.current.onseeked = handleSeek;
      hostVideoRef.current.ontimeupdate = handleTimeUpdate;
      
      // Track seeking status - this helps show visual feedback when seeking
      hostVideoRef.current.onseeking = () => {
        if (isStreaming) {
          setSeekingInfo({
            time: new Date(),
            targetTime: hostVideoRef.current.currentTime
          });
        }
      };
    }
  }, [hostVideoRef.current, setStreamError]);

  // Show seeking overlay when isSeekInProgress is true
  useEffect(() => {
    if (isSeekInProgress) {
      // Show seeking UI
      setSeekingInfo(prev => prev || { 
        time: new Date(),
        targetTime: hostVideoRef.current?.currentTime || 0
      });
    } else {
      // Clear seeking UI after a short delay
      const timer = setTimeout(() => {
        setSeekingInfo(null);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [isSeekInProgress]);

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

  // Handle start streaming with debug info
  const handleStartStreaming = async () => {
    console.log('Starting streaming...');
    try {
      // Check if videoUrl is in the correct format
      if (!videoUrl.startsWith('local:')) {
        const fileName = localStorage.getItem('hostFileName');
        console.log('Incorrect videoUrl format. Should start with local:. Current value:', videoUrl);
        console.log('Filename from localStorage:', fileName);
      }
      
      // Try to recreate the file URL if it's missing
      if (!fileUrlRef.current) {
        const fileUrl = sessionStorage.getItem('hostFileUrl');
        console.log('File URL from session storage:', fileUrl ? 'Available' : 'Not available');
        
        if (fileUrl) {
          fileUrlRef.current = fileUrl;
          console.log('Restored file URL to ref from session storage');
        } else {
          setStreamError('File URL is missing. Please try refreshing the page.');
          return;
        }
      }
      
      // Log file details
      console.log('File details:', {
        name: localStorage.getItem('hostFileName'),
        type: localStorage.getItem('hostFileType'),
        size: localStorage.getItem('hostFileSize'),
        url: fileUrlRef.current ? 'Available' : 'Not available'
      });
      
      // Ensure video element exists
      if (!hostVideoRef.current) {
        console.error('Video element not available');
        setStreamError('Video element not available. Please refresh and try again.');
        return;
      }
      
      // Attempt to start streaming
      const result = await startStreaming();
      console.log('Start streaming result:', result);
      
      if (!result) {
        console.warn('Streaming failed to start');
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      setStreamError(`Error starting stream: ${error.message}`);
    }
  };
  
  // Debug function to check status
  const runDebugCheck = () => {
    // Check WebRTC connections
    const webrtcInfo = debugWebRTCConnections();
    
    // Check session storage
    const fileUrl = sessionStorage.getItem('hostFileUrl');
    const fileName = localStorage.getItem('hostFileName');
    const fileType = localStorage.getItem('hostFileType');
    const fileSize = localStorage.getItem('hostFileSize');
    
    // Update debug info
    const debugData = {
      fileInfo: {
        name: fileName || 'Not found',
        type: fileType || 'Not found',
        size: fileSize ? `${Math.round(parseInt(fileSize) / (1024 * 1024))} MB` : 'Not found',
        url: fileUrl ? 'Available' : 'Not available',
        urlInRef: fileUrlRef.current ? 'Available' : 'Not available'
      },
      webrtc: webrtcInfo,
      videoElement: {
        created: hostVideoRef.current ? 'Yes' : 'No',
        readyState: hostVideoRef.current ? hostVideoRef.current.readyState : 'N/A',
        src: hostVideoRef.current && hostVideoRef.current.src ? 'Set' : 'Not set'
      }
    };
    
    console.log('Debug information:', debugData);
    setDebugInfo(debugData);
    setShowDebug(true);
  };

  // Fix video container style
  const videoWrapperStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  return (
    <div className="video-wrapper" style={videoWrapperStyle} ref={videoContainerRef}>
      {!isStreaming ? (
        // Show streaming controls before streaming starts
        <div className="streaming-controls">
          <h3>Stream your selected video</h3>
          <p className="file-info">
            File: {localStorage.getItem('hostFileName') || 'No file selected'}
          </p>
          
          <button 
            onClick={handleStartStreaming} 
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
        // The video is already in the DOM via the ref, controlled by WebRTCProvider
        <div className="host-controls">
          <div className="connection-info">
            <p className="streaming-status">
              Streaming to {Object.keys(peerConnections).length} viewer(s)
              {isSeekInProgress && " - Reconnecting viewers..."}
              {isReconnecting && " - Reestablishing connections..."}
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
      )}
      
      {/* Seeking indicator overlay */}
      {seekingInfo && (
        <div className="seeking-overlay">
          <div className="seeking-message">
            <div className="seeking-spinner"></div>
            <p>Seeking to {Math.floor(seekingInfo.targetTime / 60)}:{Math.floor(seekingInfo.targetTime % 60).toString().padStart(2, '0')}</p>
            {isSeekInProgress && <p className="small">Reconnecting viewers...</p>}
          </div>
        </div>
      )}
      
      {/* Viewer stats panel for host */}
      {isStreaming && (
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
      )}
    </div>
  );
}

export default HostVideo;