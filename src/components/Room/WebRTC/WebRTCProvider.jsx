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

  // Handle seek operations
  const handleSeekEvent = (currentTime) => {
    if (!isHost || !isStreaming) return;
    
    console.log('Handling seek event to time:', currentTime);
    setIsSeekInProgress(true);
    
    // Store list of current viewers to reconnect
    disconnectedViewersRef.current = { ...peerConnections };
    
    // Notify viewers about the seek operation
    if (socketRef.current) {
      socketRef.current.emit('videoSeekOperation', {
        roomId,
        seekTime: currentTime
      });
    }
    
    // Close current connections to prepare for reconnection
    Object.keys(peersRef.current).forEach(peerId => {
      if (peersRef.current[peerId]) {
        console.log(`Temporarily closing connection to ${peerId} for seek operation`);
        peersRef.current[peerId].close();
      }
    });
    
    // Reset peer connections
    peersRef.current = {};
    setPeerConnections({});
    
    // Recreate the stream after a short delay
    setTimeout(async () => {
      try {
        console.log('Recreating stream after seek');
        await refreshStreamAfterSeek();
        
        // Start reconnection process
        setIsReconnecting(true);
        reconnectToViewers();
      } catch (err) {
        console.error('Error refreshing stream after seek:', err);
        setStreamError(`Seek failed: ${err.message}. Try refreshing the page.`);
        setIsSeekInProgress(false);
      }
    }, 500);
  };

  // Refresh stream after seek without restarting everything
  const refreshStreamAfterSeek = async () => {
    if (!hostVideoRef.current || !isStreaming) {
      console.error('Cannot refresh stream: Video element or stream not available');
      return false;
    }
    
    try {
      // Ensure video is in the right state
      console.log('Refreshing video stream after seek');
      
      // Recapture the stream
      let newStream;
      
      if (hostVideoRef.current.captureStream) {
        newStream = hostVideoRef.current.captureStream();
      } else if (hostVideoRef.current.mozCaptureStream) {
        newStream = hostVideoRef.current.mozCaptureStream();
      }
      
      if (!newStream) {
        throw new Error('Failed to recapture stream from video');
      }
      
      // Update the stream reference
      if (localStreamRef.current) {
        // Do NOT stop old tracks here, as this would terminate connections on pause
        // Instead, replace tracks on existing RTCPeerConnections if needed,
        // but for simple pause/play, the stream itself remains active.
        console.log('Replacing existing stream with new captured stream.');
      }
      
      localStreamRef.current = newStream;
      console.log('New stream created with tracks:', newStream.getTracks().length);
      
      return true;
    } catch (err) {
      console.error('Error refreshing stream:', err);
      return false;
    }
  };

  // Reconnect to viewers after seek
  const reconnectToViewers = () => {
    const disconnectedIds = Object.keys(disconnectedViewersRef.current);
    console.log(`Attempting to reconnect to ${disconnectedIds.length} viewers`);
    
    if (disconnectedIds.length === 0) {
      setIsSeekInProgress(false);
      setIsReconnecting(false);
      return;
    }
    
    // Initialize reconnect attempts if needed
    disconnectedIds.forEach(peerId => {
      if (!reconnectAttemptsRef.current[peerId]) {
        reconnectAttemptsRef.current[peerId] = 0;
      }
    });
    
    // Attempt to call each disconnected viewer
    disconnectedIds.forEach(async (peerId) => {
      if (reconnectAttemptsRef.current[peerId] < maxReconnectAttempts) {
        reconnectAttemptsRef.current[peerId]++;
        console.log(`Reconnect attempt ${reconnectAttemptsRef.current[peerId]} to ${peerId}`);
        
        try {
          await callPeer(peerId);
        } catch (err) {
          console.error(`Failed to reconnect to ${peerId}:`, err);
        }
      } else {
        console.warn(`Max reconnect attempts reached for ${peerId}`);
        delete disconnectedViewersRef.current[peerId];
      }
    });
    
    // Check if we still have viewers to reconnect to
    if (Object.keys(disconnectedViewersRef.current).length > 0) {
      // Try again after a delay
      setTimeout(reconnectToViewers, 2000);
    } else {
      console.log('Reconnection process completed');
      setIsSeekInProgress(false);
      setIsReconnecting(false);
      reconnectAttemptsRef.current = {};
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
        // Update viewer UI to show we're waiting for reconnection
        setConnectionStatus('buffering');
        addSystemMessage('Host is seeking to a new position, reconnecting...');
      }
    };

    // Handle host's video pause/play events
    const handleHostVideoPlayPause = ({ paused }) => {
        if (!isHost && viewerVideoRef.current) {
            console.log(`Host video is ${paused ? 'paused' : 'playing'}`);
            if (paused) {
                viewerVideoRef.current.pause();
                setConnectionStatus('paused'); // Indicate paused state for viewer
                addSystemMessage('Host paused the video.');
            } else {
                viewerVideoRef.current.play()
                    .then(() => {
                        console.log('Viewer video resumed playing.');
                        setConnectionStatus('ready');
                    })
                    .catch(err => {
                        console.error('Error resuming viewer video:', err);
                        addSystemMessage('Click to play the video (browser autoplay restriction)');
                    });
            }
        }
    };
    
    socketRef.current.on('peer-id', handlePeerIdRegistration);
    socketRef.current.on('videoSeekOperation', handleSeekNotification);
    socketRef.current.on('hostVideoPlayPause', handleHostVideoPlayPause); // New listener
    
    return () => {
      socketRef.current.off('peer-id', handlePeerIdRegistration);
      socketRef.current.off('videoSeekOperation', handleSeekNotification);
      socketRef.current.off('hostVideoPlayPause', handleHostVideoPlayPause); // Cleanup
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
        
        // Answer the call without sending a stream back
        call.answer();
        
        // Handle stream from host
        call.on('stream', stream => {
          console.log('Received stream from host');
          
          // Set the stream to the video element
          if (viewerVideoRef.current) {
            viewerVideoRef.current.srcObject = stream;
            
            // Try to play
            viewerVideoRef.current.play()
              .then(() => {
                console.log('Viewer video is playing');
                setConnectionStatus('ready');
              })
              .catch(err => {
                console.error('Error playing video:', err);
                addSystemMessage('Click to play the video (browser autoplay restriction)');
                
                // Add click handler to start playback
                viewerVideoRef.current.addEventListener('click', () => {
                  viewerVideoRef.current.play()
                    .then(() => setConnectionStatus('ready'))
                    .catch(err => console.error('Still cannot play:', err));
                }, { once: true });
              });
          }
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
          
          // Only add to disconnected if we're not intentionally seeking
          if (!isSeekInProgress && isStreaming) {
            disconnectedViewersRef.current[peerId] = true;
            reconnectAttemptsRef.current[peerId] = 0;
            
            // Try to reconnect automatically
            setTimeout(() => {
              if (disconnectedViewersRef.current[peerId] && isStreaming) {
                console.log(`Attempting to reconnect to ${peerId} after disconnect`);
                callPeer(peerId).catch(err => {
                  console.error(`Failed to reconnect to ${peerId}:`, err);
                });
              }
            }, 3000);
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
        
        // Add seek listener
        hostVideoRef.current.onseeking = () => {
          console.log('Video seeking detected');
          if (isHost && isStreaming && !isSeekInProgress) {
            handleSeekEvent(hostVideoRef.current.currentTime);
          }
        };

        // --- NEW: Add listeners for play and pause events on the host video ---
        hostVideoRef.current.onplay = () => {
            console.log('Host video started playing.');
            if (isHost && socketRef.current) {
                socketRef.current.emit('hostVideoPlayPause', { roomId, paused: false });
            }
        };

        hostVideoRef.current.onpause = () => {
            console.log('Host video paused.');
            if (isHost && socketRef.current) {
                socketRef.current.emit('hostVideoPlayPause', { roomId, paused: true });
            }
        };
        // --- END NEW ---
        
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
      setStreamLoading(false);
      
      // Notify server about streaming status
      socketRef.current.emit('streaming-status-update', {
        roomId,
        streaming: true,
        fileName,
        fileType: localStorage.getItem('hostFileType')
      });
      
      // Setup sync interval for progress tracking
      const progressInterval = setInterval(() => {
        if (hostVideoRef.current && hostVideoRef.current.duration) {
          const percentage = Math.round((hostVideoRef.current.currentTime / hostVideoRef.current.duration) * 100);
          setBufferPercentage(percentage);
        }
      }, 1000);
      
      window.progressIntervalId = progressInterval;
      
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
    if (window.progressIntervalId) {
      clearInterval(window.progressIntervalId);
      window.progressIntervalId = null;
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
    setIsSeekInProgress(false);
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