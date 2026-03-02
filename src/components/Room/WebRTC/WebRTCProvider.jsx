import React, { createContext, useState, useEffect, useRef, useContext } from 'react';
import Peer from 'peerjs';

export const WebRTCContext = createContext(null);

// Hook for using WebRTC context
export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (context === null) {
    throw new Error('useWebRTC must be used within a WebRTCProvider');
  }
  return context;
};

// PeerJS config with more reliable STUN/TURN servers
const PEER_CONFIG = {
  debug: 3, // Log level (0-3)
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      // Free TURN servers
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  }
};

export const WebRTCProvider = ({ 
  children, 
  socketRef, 
  roomId, 
  isHost, 
  users, 
  addSystemMessage 
}) => {
  // State
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState('');
  const [streamLoading, setStreamLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [bufferPercentage, setBufferPercentage] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [peerConnections, setPeerConnections] = useState({});
  const [peerIdMap, setPeerIdMap] = useState({});
  const [isSeekInProgress, setIsSeekInProgress] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  // Refs
  const peerRef = useRef(null);
  const peersRef = useRef({});
  const hostVideoRef = useRef(null);
  const viewerVideoRef = useRef(null);
  const fileUrlRef = useRef(null);
  const localStreamRef = useRef(null);
  const disconnectedViewersRef = useRef({});
  const reconnectAttemptsRef = useRef({});
  const maxReconnectAttempts = 5;
  const isStreamingRef = useRef(false);
  const isSeekInProgressRef = useRef(false);
  const progressIntervalRef = useRef(null);

  // Load file URL from sessionStorage
  useEffect(() => {
    if (isHost) {
      const storedFileUrl = sessionStorage.getItem('hostFileUrl');
      console.log('Retrieved file URL from sessionStorage:', storedFileUrl ? 'URL found' : 'URL not found');
      
      if (storedFileUrl) {
        fileUrlRef.current = storedFileUrl;
        console.log('File URL set in ref');
      } else {
        console.error('No file URL found in sessionStorage');
        // Check if we have indication that a URL was stored
        const backupIndicator = localStorage.getItem('hostFileUrlBackup');
        if (backupIndicator === 'file_url_stored') {
          addSystemMessage('Session storage issue detected. Please refresh and try again.');
        }
      }
    }
  }, [isHost, addSystemMessage]);

  // Monitor page visibility to warn host if they background the tab
  useEffect(() => {
    if (!isHost || !isStreaming) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.warn('Host tab backgrounded - stream may be throttled by browser');
        addSystemMessage('⚠️ Warning: Backgrounding this tab may cause streaming issues. Keep this tab visible.');
      } else {
        console.log('Host tab visible again');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHost, isStreaming, addSystemMessage]);

  // Monitor page visibility to warn host if they background the tab
  useEffect(() => {
    if (!isHost || !isStreaming) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.warn('Host tab backgrounded - stream may be throttled by browser');
        addSystemMessage('⚠️ Warning: Backgrounding this tab may cause streaming issues. Keep this tab visible.');
      } else {
        console.log('Host tab visible again');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHost, isStreaming, addSystemMessage]);

  // Handle seek operations
  // captureStream() returns a live MediaStream tied to the video element —
  // it automatically follows seeks. No peer teardown needed.
  const handleSeekEvent = (currentTime) => {
   if (!isHost || !isStreamingRef.current) return;

   console.log('Handling seek event to time:', currentTime);

   if (socketRef.current) {
    socketRef.current.emit('videoSeekOperation', {
     roomId,
     seekTime: currentTime,
     sourceTimestamp: Date.now()
    });
   }
  };

  // Handle peer ID registrations
  useEffect(() => {
    if (!socketRef.current) return;
    
    const handlePeerIdRegistration = ({ peerId, isHost: peerIsHost, socketId }) => {
      console.log(`Peer ID registered: ${peerId} for socket ${socketId}`);
      
      // Store the mapping of socket ID to peer ID
      setPeerIdMap(prev => ({
        ...prev,
        [socketId]: peerId
      }));
      
      // If we're the host and streaming, call any new viewers
      if (isHost && isStreaming && localStreamRef.current && !peerIsHost) {
        console.log(`New viewer joined, calling peer ID: ${peerId}`);
        callPeer(peerId);
      }
    };
    
   // Handle seek notifications from the host
   const handleSeekNotification = ({ seekTime }) => {
    if (!isHost && viewerVideoRef.current) {
     console.log('Host seeking to:', seekTime);
     setConnectionStatus('buffering');
     addSystemMessage(`Host is seeking, please wait...`);
    }
   };

   // Handle video state updates — used by viewers to mirror host pause/play
   const handleVideoStateUpdate = ({ isPlaying }) => {
    if (!isHost && viewerVideoRef.current) {
     if (isPlaying) {
      viewerVideoRef.current.play()
       .then(() => setConnectionStatus('ready'))
       .catch(() => addSystemMessage('Click to resume playback'));
     } else {
      viewerVideoRef.current.pause();
     }
    }
   };

   socketRef.current.on('peer-id', handlePeerIdRegistration);
   socketRef.current.on('videoSeekOperation', handleSeekNotification);
   socketRef.current.on('videoStateUpdate', handleVideoStateUpdate);

   return () => {
    socketRef.current.off('peer-id', handlePeerIdRegistration);
    socketRef.current.off('videoSeekOperation', handleSeekNotification);
    socketRef.current.off('videoStateUpdate', handleVideoStateUpdate);
   };
  }, [socketRef.current, isHost, isStreaming]);

  // Function to create a safe peer ID
  const createSafePeerId = () => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    return `jtvr-${timestamp}-${randomString}`;
  };

  // Function to initialize PeerJS with a randomly generated ID
  const initializePeer = () => {
    // Clean up existing peer if any
    if (peerRef.current && !peerRef.current.destroyed) {
      peerRef.current.destroy();
    }
    
    try {
      console.log('Initializing PeerJS with random ID');
      
      const safeId = createSafePeerId();
      console.log('Using safe peer ID:', safeId);
      
      const peer = new Peer(safeId, PEER_CONFIG);
      peerRef.current = peer;
      
      peer.on('open', id => {
        console.log('PeerJS connection opened with ID:', id);
        
        // Notify other users about our peer ID
        if (socketRef.current) {
          socketRef.current.emit('peer-id', {
            roomId,
            peerId: id,
            isHost,
            socketId: socketRef.current.id
          });
        }
      });
      
      peer.on('error', err => {
        console.error('PeerJS error:', err);
        
        if (err.type === 'peer-unavailable') {
          console.log('Peer unavailable, may retry later');
        } else if (err.type === 'invalid-id') {
          console.error('Invalid peer ID, regenerating with random ID');
          // Try again with a completely random ID
          setTimeout(() => {
            const newPeer = new Peer(PEER_CONFIG);
            peerRef.current = newPeer;
            
            newPeer.on('open', id => {
              console.log('PeerJS connection opened with random ID:', id);
              if (socketRef.current) {
                socketRef.current.emit('peer-id', {
                  roomId,
                  peerId: id,
                  isHost,
                  socketId: socketRef.current.id
                });
              }
            });
            
            setupPeerListeners(newPeer);
          }, 1000);
        } else {
          // For other errors, show message to user
          addSystemMessage(`Connection error: ${err.type || err.message}`);
          
          // Try to reconnect for certain errors
          if (err.type === 'network' || err.type === 'disconnected') {
            setTimeout(() => {
              console.log('Reconnecting after error...');
              initializePeer();
            }, 3000);
          }
        }
      });
      
      setupPeerListeners(peer);
      
      return peer;
    } catch (err) {
      console.error('Error initializing PeerJS:', err);
      addSystemMessage(`Failed to initialize connection: ${err.message}`);
      return null;
    }
  };
  
  // Setup peer event listeners
  const setupPeerListeners = (peer) => {
    // For viewers: handle incoming connections from host
    if (!isHost) {
      peer.on('call', call => {
        console.log('Receiving call from host:', call.peer);
        setConnectionStatus('connecting');
        
        // Answer with a minimal dummy stream so the host's call.on('stream') fires
        // An empty MediaStream() has no tracks and won't trigger the event
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const dummyStream = canvas.captureStream(1); // 1x1px at 1fps - minimal bandwidth
        call.answer(dummyStream);
        
        // Handle stream from host
        call.on('stream', stream => {
          console.log('Received stream from host');

          // Retry attaching the stream in case the <video> element hasn't rendered yet
          // (race: PeerJS call can arrive before streaming-status triggers the video element)
          const attachStream = (attemptsLeft) => {
            if (viewerVideoRef.current) {
              viewerVideoRef.current.srcObject = stream;
              viewerVideoRef.current.play()
                .then(() => {
                  console.log('Viewer video is playing');
                  setConnectionStatus('ready');
                })
                .catch(err => {
                  console.error('Error playing video:', err);
                  addSystemMessage('Click to play the video (browser autoplay restriction)');
                  viewerVideoRef.current.addEventListener('click', () => {
                    viewerVideoRef.current.play()
                      .then(() => setConnectionStatus('ready'))
                      .catch(e => console.error('Still cannot play:', e));
                  }, { once: true });
                });
            } else if (attemptsLeft > 0) {
              setTimeout(() => attachStream(attemptsLeft - 1), 200);
            } else {
              console.error('Viewer video element never appeared — stream lost');
              setConnectionStatus('error');
            }
          };
          attachStream(15); // retry up to 15 × 200ms = 3s
        });
        
        call.on('close', () => {
          console.log('Call closed');
          // Don't set to disconnected immediately, could be a seek operation or pause
          setTimeout(() => {
            if (viewerVideoRef.current && !viewerVideoRef.current.srcObject) {
              setConnectionStatus('disconnected');
              addSystemMessage('Host disconnected. Please wait for reconnection.');
            }
          }, 5000);
        });
        
        call.on('error', err => {
          console.error('Call error:', err);
          setConnectionStatus('error');
          addSystemMessage(`Call error: ${err.message || 'Unknown error'}`);
        });
        
        // Save the call reference
        peersRef.current[call.peer] = call;
        setPeerConnections(prev => ({ ...prev, [call.peer]: call }));
      });
    }
  };

  // Initialize PeerJS on component mount
  useEffect(() => {
    if (!socketRef.current) return;
    
    // Initialize PeerJS with a random ID to avoid collisions
    initializePeer();
    
    return () => {
      if (peerRef.current && !peerRef.current.destroyed) {
        peerRef.current.destroy();
      }
    };
  }, [socketRef.current]);
  
  // Function to call a peer
  const callPeer = (peerId) => {
    if (!peerRef.current || !localStreamRef.current) {
      console.error('Cannot call peer: No peer connection or stream');
      return Promise.reject(new Error('Missing peer connection or stream'));
    }
    
    return new Promise((resolve, reject) => {
      try {
        console.log(`Calling peer ${peerId}...`);
        
        // Check if we already have a connection to this peer
        if (peersRef.current[peerId]) {
          console.log(`Already have a connection to ${peerId}, closing existing connection`);
          peersRef.current[peerId].close();
          delete peersRef.current[peerId];
          
          setPeerConnections(prev => {
            const newPeers = { ...prev };
            delete newPeers[peerId];
            return newPeers;
          });
        }
        
        // Log stream details before calling
        const streamInfo = {
          tracks: localStreamRef.current.getTracks().length,
          videoTracks: localStreamRef.current.getVideoTracks().length,
          audioTracks: localStreamRef.current.getAudioTracks().length,
          active: localStreamRef.current.active
        };
        
        console.log(`Calling with stream:`, streamInfo);
        
        // Ensure stream is valid
        if (streamInfo.videoTracks === 0) {
          console.warn('Warning: No video tracks in stream');
        }
        
        const call = peerRef.current.call(peerId, localStreamRef.current);
        
        // Log call creation
        console.log(`Call created to ${peerId}`, call);
        
        // Add timeout to detect connection failures
        const callTimeout = setTimeout(() => {
          console.log(`Call to ${peerId} timed out after 30s`);
          if (peersRef.current[peerId]) {
            call.close();
            delete peersRef.current[peerId];
            setPeerConnections(prev => {
              const newPeers = { ...prev };
              delete newPeers[peerId];
              return newPeers;
            });
            reject(new Error('Call timed out'));
          }
        }, 30000);

        // Monitor ICE connection state for stability
        if (call.peerConnection) {
          call.peerConnection.oniceconnectionstatechange = () => {
            const iceState = call.peerConnection.iceConnectionState;
            console.log(`ICE connection state for ${peerId}: ${iceState}`);

            if (iceState === 'connected' || iceState === 'completed') {
              clearTimeout(callTimeout);
              console.log(`ICE connected to ${peerId}, timeout cleared`);
            } else if (iceState === 'disconnected') {
              console.warn(`ICE disconnected for ${peerId}, waiting for recovery...`);
              // Give ICE 5 seconds to recover before considering it failed
              setTimeout(() => {
                if (call.peerConnection.iceConnectionState === 'disconnected') {
                  console.error(`ICE recovery timeout for ${peerId}, attempting ICE restart`);
                  // Trigger ICE restart by creating a new offer
                  call.peerConnection.createOffer({ iceRestart: true })
                    .then(offer => call.peerConnection.setLocalDescription(offer))
                    .catch(err => console.error('ICE restart failed:', err));
                }
              }, 5000);
            } else if (iceState === 'failed') {
              console.error(`ICE failed for ${peerId}, will attempt reconnection`);
              // Close the call and let auto-reconnect handle it
              call.close();
            }
          };
        }

        call.on('stream', () => {
          console.log(`Connected to viewer ${peerId}`);
          clearTimeout(callTimeout);
          
          // If this was a disconnected viewer, remove from disconnected list
          if (disconnectedViewersRef.current[peerId]) {
            delete disconnectedViewersRef.current[peerId];
            delete reconnectAttemptsRef.current[peerId];
          }
          
          resolve(call);
        });
        
        call.on('close', () => {
          console.log(`Call to ${peerId} closed`);
          delete peersRef.current[peerId];
          setPeerConnections(prev => {
            const newPeers = { ...prev };
            delete newPeers[peerId];
            return newPeers;
          });
          
          // Mark as disconnected for tracking
          // Removed aggressive auto-reconnect - ICE restart will handle temporary disconnects
          if (!isSeekInProgressRef.current && isStreamingRef.current) {
            console.log(`Viewer ${peerId} disconnected`);
            disconnectedViewersRef.current[peerId] = true;
          }
        });
        
        call.on('error', err => {
          console.error(`Call to ${peerId} error:`, err);
          reject(err);
          addSystemMessage(`Error connecting to viewer: ${err.message || 'Unknown error'}`);
        });
        
        // Save the call reference
        peersRef.current[peerId] = call;
        setPeerConnections(prev => ({ ...prev, [peerId]: call }));
        
        console.log(`Call established to ${peerId}`);
      } catch (err) {
        console.error(`Error calling peer ${peerId}:`, err);
        reject(err);
        addSystemMessage(`Failed to connect to viewer: ${err.message}`);
      }
    });
  };
  
  // Enhanced startStreaming function with better debug and media handling
  const startStreaming = async () => {
    if (!fileUrlRef.current) {
      console.error('No file URL found when starting streaming');
      const fileName = localStorage.getItem('hostFileName');
      const fileType = localStorage.getItem('hostFileType');
      
      setStreamError(`No file URL available. Please refresh and try again. 
        Debug info: [Filename: ${fileName || 'none'}, Type: ${fileType || 'none'}]`);
      return false;
    }
    
    if (!peerRef.current || peerRef.current.destroyed) {
      console.log('Peer connection not ready, initializing...');
      initializePeer();
      setStreamError('Establishing connection, please try again in a few seconds');
      return false;
    }
    
    if (!hostVideoRef.current) {
      console.error('Host video element not found');
      setStreamError('Video element not initialized. Please refresh the page.');
      return false;
    }
    
    setStreamLoading(true);
    setStreamError('');
    
    try {
      const fileName = localStorage.getItem('hostFileName');
      console.log('Starting to stream file:', fileName);
      
      // Notify viewers that streaming is about to start
      socketRef.current.emit('streamingAboutToStart', { roomId });
      
      // Play the file locally for the host
      if (hostVideoRef.current) {
        console.log('Setting up host video with URL:', fileUrlRef.current.substring(0, 50) + '...');
        
        // Directly set the source on the video element
        hostVideoRef.current.src = fileUrlRef.current;
        hostVideoRef.current.muted = false;
        hostVideoRef.current.load();
        
        // Log video element readiness
        console.log('Video element state:', {
          readyState: hostVideoRef.current.readyState,
          networkState: hostVideoRef.current.networkState,
          paused: hostVideoRef.current.paused,
          error: hostVideoRef.current.error,
          src: hostVideoRef.current.src ? 'Set (not empty)' : 'Empty'
        });
        
        // Wait for metadata to load
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            console.error('Video load timeout - metadata not received after 10s');
            reject(new Error('Video load timeout'));
          }, 10000);
          
          hostVideoRef.current.onloadedmetadata = () => {
            clearTimeout(timeout);
            console.log('Video metadata loaded successfully');
            console.log('Video details:', {
              duration: hostVideoRef.current.duration,
              videoWidth: hostVideoRef.current.videoWidth,
              videoHeight: hostVideoRef.current.videoHeight
            });
            resolve();
          };
          
          hostVideoRef.current.onerror = (e) => {
            clearTimeout(timeout);
            console.error('Video error during metadata loading:', e, hostVideoRef.current.error);
            reject(new Error(`Error loading video: ${hostVideoRef.current.error?.message || 'Unknown error'}`));
          };
        });
        
        // Get video duration
        setVideoDuration(hostVideoRef.current.duration || 0);
        
        // Try to play the video
        try {
          console.log('Attempting to play video');
          await hostVideoRef.current.play();
          console.log('Host video playing successfully');
        } catch (playError) {
          console.warn('Auto-play failed, require user interaction:', playError);
          addSystemMessage('Click the video to start playback');
          
          // Add click handler to start playback
          hostVideoRef.current.addEventListener('click', () => {
            console.log('User clicked video, attempting to play');
            hostVideoRef.current.play()
              .then(() => console.log('Video playing after click'))
              .catch(err => console.error('Still cannot play after click:', err));
          }, { once: true });
        }
        
        // Verify video has access to MediaStream API
        if (!hostVideoRef.current.captureStream && !hostVideoRef.current.mozCaptureStream) {
          console.error('captureStream API not available on this browser');
          setStreamError('Your browser does not support video streaming. Please try Chrome or Edge.');
          setStreamLoading(false);
          return false;
        }
        
        // Capture the video stream with browser compatibility
        console.log('Capturing video stream');
        let stream;
        
        try {
          // Try standard method first
          if (hostVideoRef.current.captureStream) {
            stream = hostVideoRef.current.captureStream();
            console.log('Used standard captureStream');
          } 
          // Fall back to Mozilla's implementation
          else if (hostVideoRef.current.mozCaptureStream) {
            stream = hostVideoRef.current.mozCaptureStream();
            console.log('Used Mozilla captureStream');
          }
          
          if (!stream) {
            throw new Error('Failed to capture stream from video');
          }
        } catch (streamError) {
          console.error('Error capturing stream:', streamError);
          setStreamError(`Failed to capture video stream: ${streamError.message}`);
          setStreamLoading(false);
          return false;
        }
        
        // Log stream tracks
        console.log('Stream tracks:', stream.getTracks().map(track => ({
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        })));
        
        // Ensure we have video and audio tracks
        if (stream.getVideoTracks().length === 0) {
          console.warn('No video tracks in the captured stream');
          addSystemMessage('Warning: No video tracks found. Video may not stream properly.');
        }
        
        localStreamRef.current = stream;
        
        // Call all existing viewers
        console.log('Calling all viewers');
        
        // Find peers to call from the peerIdMap
        const peersToCall = [];
        
        // Find all non-host peers
        users.forEach(user => {
          if (!user.isHost && peerIdMap[user.id]) {
            console.log(`Found viewer to call: ${peerIdMap[user.id]}`);
            peersToCall.push(peerIdMap[user.id]);
          }
        });
        
        console.log(`Found ${peersToCall.length} viewers to call`);
        
        // Call each peer
        for (const viewerId of peersToCall) {
          callPeer(viewerId).catch(err => {
            console.error(`Failed to call viewer ${viewerId}:`, err);
          });
        }
        
        // If no peers found, log a warning
        if (peersToCall.length === 0) {
          console.warn('No viewers found to call. Ensure they are connected first.');
          addSystemMessage('No viewers found. Ask viewers to refresh and reconnect.');
        }
      } else {
        throw new Error('Video element not found');
      }
      
    // Update state
    setIsStreaming(true);
    isStreamingRef.current = true;
    setStreamLoading(false);
    
      // Notify server about streaming status
      socketRef.current.emit('streaming-status-update', {
        roomId,
        streaming: true,
        fileName,
        fileType: localStorage.getItem('hostFileType')
      });
      
    progressIntervalRef.current = setInterval(() => {
     if (hostVideoRef.current && hostVideoRef.current.duration) {
      const percentage = Math.round((hostVideoRef.current.currentTime / hostVideoRef.current.duration) * 100);
      setBufferPercentage(percentage);
     }
    }, 1000);
    
      addSystemMessage('Started streaming to viewers');
      return true;
    } catch (err) {
      console.error('Error starting stream:', err);
      setStreamError(`Error starting stream: ${err.message}`);
      setStreamLoading(false);
      return false;
    }
  };
  
  // Stop streaming function
  const stopStreaming = () => {
    if (!isStreaming) return;
    
   // Clear intervals
   if (progressIntervalRef.current) {
    clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = null;
   }
   
    // Stop all tracks in the local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      localStreamRef.current = null;
    }
    
    // Close all peer connections
    Object.values(peersRef.current).forEach(call => {
      if (call && typeof call.close === 'function') {
        call.close();
      }
    });
    
    // Reset peer connections
    peersRef.current = {};
    setPeerConnections({});
    disconnectedViewersRef.current = {};
    reconnectAttemptsRef.current = {};
    
    // Stop the host video
    if (hostVideoRef.current) {
      hostVideoRef.current.pause();
      hostVideoRef.current.src = '';
      hostVideoRef.current.load();
    }
    
   // Update state
   setIsStreaming(false);
   isStreamingRef.current = false;
   setIsSeekInProgress(false);
   isSeekInProgressRef.current = false;
   setIsReconnecting(false);
   
    // Notify server
    socketRef.current.emit('streaming-status-update', {
      roomId,
      streaming: false,
      fileName: null,
      fileType: null
    });
    
    addSystemMessage('Stopped streaming.');
  };
  
  // Debug helper function for WebRTC connections
  const debugWebRTCConnections = () => {
    // Log current state
    console.log('=== WebRTC Debug Info ===');
    console.log('Current peer:', peerRef.current ? 'Connected' : 'Not connected');
    console.log('Peer ID:', peerRef.current ? peerRef.current.id : 'None');
    console.log('Peer connections:', Object.keys(peersRef.current).length);
    console.log('Local stream:', localStreamRef.current ? 'Active' : 'Not active');
    
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks();
      console.log('Stream tracks:', tracks.length);
      tracks.forEach((track, i) => {
        console.log(`Track ${i}:`, track.kind, track.readyState, track.enabled);
      });
    }
    
    // Return a summary for UI display
    return {
      peerConnected: !!peerRef.current,
      peerId: peerRef.current ? peerRef.current.id : 'None',
      connectionCount: Object.keys(peersRef.current).length,
      streamActive: !!localStreamRef.current,
      trackCount: localStreamRef.current ? localStreamRef.current.getTracks().length : 0,
      isSeekInProgress,
      isReconnecting,
      disconnectedViewers: Object.keys(disconnectedViewersRef.current).length
    };
  };

  // Create context value
  const contextValue = {
    // State
    isStreaming,
    streamError,
    streamLoading,
    connectionStatus,
    bufferPercentage,
    videoDuration,
    peerConnections,
    isSeekInProgress,
    isReconnecting,
    
    // Refs
    fileUrlRef,
    hostVideoRef,
    viewerVideoRef,
    localStreamRef,
    peersRef,
    
    // Functions
    startStreaming,
    stopStreaming,
    debugWebRTCConnections,
    handleSeekEvent,
    
    // Setters
    setStreamError,
    setStreamLoading,
    setConnectionStatus,
    setBufferPercentage
  };

  return (
    <WebRTCContext.Provider value={contextValue}>
      {children}
    </WebRTCContext.Provider>
  );
};