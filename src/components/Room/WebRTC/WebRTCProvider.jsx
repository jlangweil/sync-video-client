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
      { urls: 'stun:stun.stunprotocol.org:3478' },
      // Free TURN servers for more reliable connections
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
      },
      {
        urls: 'turn:relay.backups.cz:3478',
        username: 'webrtc',
        credential: 'webrtc'
      },
      {
        urls: 'turn:relay.backups.cz:3478?transport=tcp',
        username: 'webrtc',
        credential: 'webrtc'
      }
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
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
  const connectionStatsRef = useRef({});
  const heartbeatTimestampRef = useRef(Date.now());
  const peerConnectionHealthRef = useRef({});
  const socketReconnectingRef = useRef(false);
  const lastSyncStateRef = useRef(null);
  
  const maxReconnectAttempts = 8; // Increased from 5
  const reconnectBackoffBase = 1.5; // Exponential backoff factor

  // HEARTBEAT SYSTEM
  useEffect(() => {
    if (!socketRef.current) return;
    
    // Store initial socket ID
    const initialSocketId = socketRef.current.id;
    
    // Setup socket heartbeat 
    const heartbeatInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('heartbeat', {
          roomId,
          timestamp: Date.now(),
          isHost
        });
        heartbeatTimestampRef.current = Date.now();
      } else {
        console.warn('Socket disconnected, cannot send heartbeat');
        
        // If disconnected for more than 5 seconds, try to reconnect
        if (Date.now() - heartbeatTimestampRef.current > 5000 && !socketReconnectingRef.current) {
          console.log('Socket disconnected for 5s, initiating reconnection...');
          socketReconnectingRef.current = true;
          
          // Try to reconnect socket
          if (socketRef.current) {
            socketRef.current.connect();
            
            // After reconnection, re-join room
            socketRef.current.once('connect', () => {
              console.log('Socket reconnected, re-joining room with ID:', socketRef.current.id);
              socketReconnectingRef.current = false;
              heartbeatTimestampRef.current = Date.now();
              
              // Rejoin with same user info
              socketRef.current.emit('joinRoom', {
                roomId,
                username: localStorage.getItem('username'),
                isHost
              });
              
              // Re-register peer ID if we have one
              if (peerRef.current && peerRef.current.id) {
                socketRef.current.emit('peer-id', {
                  roomId,
                  peerId: peerRef.current.id,
                  isHost,
                  previousSocketId: initialSocketId
                });
              }
              
              // Send reconnection notification
              addSystemMessage('Reconnected to server');
              
              // If host and streaming, notify viewers
              if (isHost && isStreaming) {
                socketRef.current.emit('streaming-status-update', {
                  roomId,
                  streaming: true,
                  fileName: localStorage.getItem('hostFileName'),
                  fileType: localStorage.getItem('hostFileType')
                });
              }
            });
          }
        }
      }
    }, 3000);

    // Listen for heartbeat acknowledgments
    socketRef.current.on('heartbeat-ack', ({ viewerCount, hostConnected }) => {
      heartbeatTimestampRef.current = Date.now();
      
      // Update connection status based on heartbeat info
      if (!isHost && hostConnected === false) {
        if (connectionStatus !== 'host-disconnected') {
          setConnectionStatus('host-disconnected');
          addSystemMessage('Host appears to be disconnected');
        }
      }
    });
    
    return () => {
      clearInterval(heartbeatInterval);
    };
  }, [socketRef.current, roomId, isHost]);

  // PEER RECONNECTION MONITORING 
  useEffect(() => {
    if (!isStreaming) return;

    // For host: Monitor viewer connections
    if (isHost) {
      const monitorInterval = setInterval(() => {
        // Check each peer connection health
        Object.keys(peersRef.current).forEach(peerId => {
          const connection = peersRef.current[peerId]?.peerConnection;
          if (connection) {
            const health = peerConnectionHealthRef.current[peerId] || { 
              lastChecked: 0, 
              state: 'unknown',
              iceState: 'unknown'
            };
            
            // Update connection health status
            health.lastChecked = Date.now();
            health.state = connection.connectionState || connection.iceConnectionState || 'unknown';
            health.iceState = connection.iceConnectionState || 'unknown';
            
            peerConnectionHealthRef.current[peerId] = health;
            
            // Check for problematic states
            if (['disconnected', 'failed', 'closed'].includes(health.state) || 
                ['disconnected', 'failed', 'closed'].includes(health.iceState)) {
              console.warn(`Detected problematic connection with peer ${peerId}:`, health);
              
              // Try to reconnect if not already in progress
              if (!disconnectedViewersRef.current[peerId]) {
                console.log(`Adding ${peerId} to disconnected viewers list for reconnection`);
                disconnectedViewersRef.current[peerId] = true;
                reconnectAttemptsRef.current[peerId] = 0;
                
                // Start reconnection process if not already in progress
                if (!isReconnecting && !isSeekInProgress) {
                  console.log('Initiating reconnection process');
                  setIsReconnecting(true);
                  reconnectToViewers();
                }
              }
            }
          }
        });
      }, 5000);
      
      return () => clearInterval(monitorInterval);
    }
  }, [isStreaming, isHost, isReconnecting, isSeekInProgress]);

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
    
    // Save last sync state
    lastSyncStateRef.current = {
      currentTime,
      isPlaying: !hostVideoRef.current?.paused,
      timestamp: Date.now()
    };
    
    // Notify viewers about the seek operation
    if (socketRef.current) {
      socketRef.current.emit('videoSeekOperation', {
        roomId,
        seekTime: currentTime,
        isPlaying: !hostVideoRef.current?.paused,
        sourceTimestamp: Date.now()
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
        // Stop old tracks
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
      }
      
      localStreamRef.current = newStream;
      console.log('New stream created with tracks:', newStream.getTracks().length);
      
      return true;
    } catch (err) {
      console.error('Error refreshing stream:', err);
      return false;
    }
  };

  // Reconnect to viewers with improved exponential backoff
  const reconnectToViewers = () => {
    const disconnectedIds = Object.keys(disconnectedViewersRef.current);
    console.log(`Attempting to reconnect to ${disconnectedIds.length} viewers`);
    
    if (disconnectedIds.length === 0) {
      setIsSeekInProgress(false);
      setIsReconnecting(false);
      return;
    }
    
    // Get current time
    const now = Date.now();
    
    // Process each disconnected viewer
    disconnectedIds.forEach(async (peerId) => {
      // Initialize reconnect attempts if needed
      if (!reconnectAttemptsRef.current[peerId]) {
        reconnectAttemptsRef.current[peerId] = {
          count: 0,
          lastAttempt: 0
        };
      }
      
      const attempts = reconnectAttemptsRef.current[peerId];
      
      // Only attempt reconnection if we're under max attempts
      if (attempts.count < maxReconnectAttempts) {
        // Calculate backoff time: 1s, 1.5s, 2.25s, 3.4s, etc.
        const backoffTime = Math.pow(reconnectBackoffBase, attempts.count) * 1000;
        
        // Check if enough time has passed since last attempt
        if (now - attempts.lastAttempt > backoffTime) {
          attempts.count++;
          attempts.lastAttempt = now;
          
          console.log(`Reconnect attempt ${attempts.count}/${maxReconnectAttempts} to ${peerId} (backoff: ${(backoffTime/1000).toFixed(1)}s)`);
          
          try {
            await callPeer(peerId);
            console.log(`Successfully reconnected to ${peerId}`);
            // If successful, remove from disconnected list
            delete disconnectedViewersRef.current[peerId];
          } catch (err) {
            console.error(`Failed to reconnect to ${peerId}:`, err);
            
            // If this was the last attempt, remove from list to avoid infinite retries
            if (attempts.count >= maxReconnectAttempts) {
              console.warn(`Max reconnect attempts (${maxReconnectAttempts}) reached for ${peerId}, giving up`);
              delete disconnectedViewersRef.current[peerId];
              
              // Try to notify this user through the signaling channel
              if (socketRef.current) {
                const socketId = Object.keys(peerIdMap).find(key => peerIdMap[key] === peerId);
                if (socketId) {
                  socketRef.current.emit('reconnection-failed', {
                    roomId,
                    targetSocketId: socketId,
                    message: 'Host could not reconnect to your client after multiple attempts.'
                  });
                }
              }
            }
          }
        }
      } else {
        // We've reached max attempts, remove from the list
        delete disconnectedViewersRef.current[peerId];
      }
    });
    
    // Continue reconnection process if needed
    if (Object.keys(disconnectedViewersRef.current).length > 0) {
      setTimeout(reconnectToViewers, 1000);
    } else {
      console.log('Reconnection process completed');
      setIsSeekInProgress(false);
      setIsReconnecting(false);
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
    const handleSeekNotification = ({ seekTime, isPlaying }) => {
      if (!isHost && viewerVideoRef.current) {
        console.log('Host seeking to:', seekTime);
        // Update viewer UI to show we're waiting for reconnection
        setConnectionStatus('buffering');
        addSystemMessage(`Host is seeking to ${Math.floor(seekTime / 60)}:${Math.floor(seekTime % 60).toString().padStart(2, '0')}`);
        
        // Store the seek state to sync with once reconnected
        lastSyncStateRef.current = {
          currentTime: seekTime,
          isPlaying: isPlaying !== undefined ? isPlaying : true,
          timestamp: Date.now()
        };
      }
    };
    
    // Handle reconnection failures
    const handleReconnectionFailed = ({ message }) => {
      console.warn('Reconnection failed:', message);
      setConnectionStatus('error');
      addSystemMessage(`Connection error: ${message}. Please refresh the page.`);
    };
    
    socketRef.current.on('peer-id', handlePeerIdRegistration);
    socketRef.current.on('videoSeekOperation', handleSeekNotification);
    socketRef.current.on('reconnection-failed', handleReconnectionFailed);
    
    // Handle fallback state synchronization
    socketRef.current.on('fallback-sync-state', (syncState) => {
      if (!isHost && viewerVideoRef.current) {
        console.log('Received fallback sync state:', syncState);
        
        // Store the sync state for reconnection
        lastSyncStateRef.current = {
          ...syncState,
          timestamp: Date.now()
        };
        
        // If not connected via WebRTC, try to apply the state directly
        if (connectionStatus !== 'ready') {
          addSystemMessage('Received sync update from host via signaling channel');
        }
      }
    });
    
    return () => {
      socketRef.current.off('peer-id', handlePeerIdRegistration);
      socketRef.current.off('videoSeekOperation', handleSeekNotification);
      socketRef.current.off('reconnection-failed', handleReconnectionFailed);
      socketRef.current.off('fallback-sync-state');
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
  
  // Setup peer event listeners with improved ICE monitoring
  const setupPeerListeners = (peer) => {
    // For viewers: handle incoming connections from host
    if (!isHost) {
      peer.on('call', call => {
        console.log('Receiving call from host:', call.peer);
        setConnectionStatus('connecting');
        
        // Monitor ICE connection state
        if (call.peerConnection) {
          call.peerConnection.oniceconnectionstatechange = () => {
            const state = call.peerConnection.iceConnectionState;
            console.log(`ICE connection state changed to: ${state}`);
            
            // Update connection status based on ICE state
            if (state === 'checking') {
              setConnectionStatus('connecting');
            } else if (state === 'connected' || state === 'completed') {
              setConnectionStatus('ready');
            } else if (state === 'disconnected') {
              setConnectionStatus('unstable');
              // Don't immediately show as disconnected, it might recover
            } else if (state === 'failed') {
              setConnectionStatus('error');
              addSystemMessage('Connection to host failed. Attempting to reconnect...');
              
              // Try to reconnect via signaling
              if (socketRef.current) {
                socketRef.current.emit('webrtc-connection-failed', {
                  roomId,
                  peerId: call.peer
                });
              }
            } else if (state === 'closed') {
              setConnectionStatus('disconnected');
            }
          };
        }
        
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
                
                // Apply stored sync state if available
                if (lastSyncStateRef.current) {
                  const { currentTime, isPlaying } = lastSyncStateRef.current;
                  
                  // Apply current time
                  if (Math.abs(viewerVideoRef.current.currentTime - currentTime) > 1) {
                    console.log(`Applying stored sync time: ${currentTime}`);
                    viewerVideoRef.current.currentTime = currentTime;
                  }
                }
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
              
            // Add connection stats monitoring
            if (call.peerConnection) {
              const statsInterval = setInterval(async () => {
                if (call.peerConnection.connectionState === 'connected') {
                  try {
                    const stats = await call.peerConnection.getStats();
                    const statsReport = {};
                    
                    stats.forEach(report => {
                      if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        statsReport.packetsLost = report.packetsLost;
                        statsReport.jitter = report.jitter;
                        statsReport.framesDecoded = report.framesDecoded;
                        statsReport.framesDropped = report.framesDropped;
                      }
                      
                      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        statsReport.currentRoundTripTime = report.currentRoundTripTime;
                        statsReport.availableOutgoingBitrate = report.availableOutgoingBitrate;
                      }
                    });
                    
                    connectionStatsRef.current = statsReport;
                    
                    // Log significant quality issues
                    if (statsReport.packetsLost > 100 || 
                        (statsReport.framesDropped && statsReport.framesDecoded && 
                         statsReport.framesDropped / statsReport.framesDecoded > 0.1)) {
                      console.warn('Connection quality issues detected:', statsReport);
                    }
                  } catch (e) {
                    console.error('Error getting connection stats:', e);
                  }
                } else {
                  clearInterval(statsInterval);
                }
              }, 5000);
            }
          }
        });
        
        call.on('close', () => {
          console.log('Call closed');
          // Don't set to disconnected immediately, could be a seek operation
          setTimeout(() => {
            if (viewerVideoRef.current && !viewerVideoRef.current.srcObject) {
              setConnectionStatus('disconnected');
              addSystemMessage('Host disconnected. Please wait for reconnection.');
              
              // Request reconnection via signaling after short delay
              setTimeout(() => {
                if (connectionStatus === 'disconnected' && socketRef.current) {
                  console.log('Requesting reconnection via signaling');
                  socketRef.current.emit('request-reconnection', {
                    roomId,
                    viewerPeerId: peer.id
                  });
                }
              }, 5000);
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
  
  // Function to call a peer with enhanced error handling and monitoring
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
        
        // Set up monitoring for the call's RTCPeerConnection
        if (call.peerConnection) {
          // Monitor ICE connection state
          call.peerConnection.oniceconnectionstatechange = () => {
            const state = call.peerConnection.iceConnectionState;
            console.log(`ICE connection state changed to: ${state} for peer ${peerId}`);
            
            // Track connection state
            peerConnectionHealthRef.current[peerId] = {
              ...peerConnectionHealthRef.current[peerId],
              iceState: state,
              lastStateChange: Date.now()
            };
            
            // If connection is experiencing issues, log it
            if (state === 'disconnected' || state === 'failed') {
              console.warn(`ICE connection issue with ${peerId}: ${state}`);
              
              // For failed state, try immediate reconnection
              if (state === 'failed' && !disconnectedViewersRef.current[peerId]) {
                console.log(`Adding ${peerId} to disconnected list due to ICE failure`);
                disconnectedViewersRef.current[peerId] = true;
                reconnectAttemptsRef.current[peerId] = {
                  count: 0,
                  lastAttempt: 0
                };
                
                // Start reconnection process if not already in progress
                if (!isReconnecting && !isSeekInProgress) {
                  setIsReconnecting(true);
                  setTimeout(() => reconnectToViewers(), 1000);
                }
              }
            }
          };
          
          // Monitor connection state
          call.peerConnection.onconnectionstatechange = () => {
            const state = call.peerConnection.connectionState;
            console.log(`Connection state changed to: ${state} for peer ${peerId}`);
            
            peerConnectionHealthRef.current[peerId] = {
              ...peerConnectionHealthRef.current[peerId],
              connectionState: state,
              lastStateChange: Date.now()
            };
          };
        }
        
        call.on('stream', () => {
          console.log(`Connected to viewer ${peerId}`);
          clearTimeout(callTimeout);
          
          // If this was a disconnected viewer, remove from disconnected list
          if (disconnectedViewersRef.current[peerId]) {
            delete disconnectedViewersRef.current[peerId];
            delete reconnectAttemptsRef.current[peerId];
            
            // Send a system message if this was a reconnection
            addSystemMessage(`Reconnected to viewer`);
            
            // Send current playback state to newly reconnected viewer
            if (hostVideoRef.current && socketRef.current) {
              // Store and send via signaling as a backup
              lastSyncStateRef.current = {
                currentTime: hostVideoRef.current.currentTime,
                isPlaying: !hostVideoRef.current.paused,
                timestamp: Date.now()
              };
              
              // Find socket ID for this peer ID
              const socketId = Object.keys(peerIdMap).find(key => peerIdMap[key] === peerId);
              if (socketId) {
                socketRef.current.emit('fallback-sync-state', {
                  roomId,
                  targetSocketId: socketId,
                  ...lastSyncStateRef.current
                });
              }
            }
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
            
            // Initialize reconnect attempts if needed
            if (!reconnectAttemptsRef.current[peerId]) {
              reconnectAttemptsRef.current[peerId] = {
                count: 0,
                lastAttempt: 0
              };
            }
            
            // Try to reconnect automatically
            setTimeout(() => {
              if (disconnectedViewersRef.current[peerId] && isStreaming) {
                console.log(`Attempting to reconnect to ${peerId} after disconnect`);
                callPeer(peerId).catch(err => {
                  console.error(`Failed to reconnect to ${peerId}:`, err);
                  
                  // Start reconnection process if not already in progress
                  if (!isReconnecting && !isSeekInProgress) {
                    setIsReconnecting(true);
                    reconnectToViewers();
                  }
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
  
  // Enhanced startStreaming with better stream capture and error recovery
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
        
        // Capture the video stream with browser compatibility and fallbacks
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
          
          // Create fallback stream with canvas if needed
          if (stream.getVideoTracks().length === 0) {
            console.warn('No video tracks in captured stream, trying canvas fallback');
            
            // Create a canvas element
            const canvas = document.createElement('canvas');
            canvas.width = hostVideoRef.current.videoWidth || 640;
            canvas.height = hostVideoRef.current.videoHeight || 360;
            
            // Set up canvas context
            const ctx = canvas.getContext('2d');
            
            // Draw video frames to canvas
            const drawFrame = () => {
              if (hostVideoRef.current && !hostVideoRef.current.paused && !hostVideoRef.current.ended) {
                ctx.drawImage(hostVideoRef.current, 0, 0, canvas.width, canvas.height);
                requestAnimationFrame(drawFrame);
              }
            };
            
            // Start drawing frames
            drawFrame();
            
            // Capture stream from canvas
            const canvasStream = canvas.captureStream(30); // 30fps
            
            // If original stream has audio tracks, add them to canvas stream
            if (stream.getAudioTracks().length > 0) {
              stream.getAudioTracks().forEach(track => {
                canvasStream.addTrack(track);
              });
            }
            
            // Use canvas stream instead
            stream = canvasStream;
            console.log('Using canvas-based stream fallback');
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
        
        // Save stream reference
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
          
          // Periodically send fallback sync info via signaling
          if (isHost && lastSyncStateRef.current) {
            const now = Date.now();
            // Only send every 30 seconds to avoid flooding
            if (!lastSyncStateRef.current.lastBroadcast || now - lastSyncStateRef.current.lastBroadcast > 30000) {
              lastSyncStateRef.current = {
                currentTime: hostVideoRef.current.currentTime,
                isPlaying: !hostVideoRef.current.paused,
                timestamp: now,
                lastBroadcast: now
              };
              
              // Broadcast to room via signaling as backup
              if (socketRef.current) {
                socketRef.current.emit('fallback-sync-state', {
                  roomId,
                  ...lastSyncStateRef.current
                });
              }
            }
          }
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
  
  // Stop streaming function with enhanced cleanup
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
    
    // Log connection health info
    console.log('Connection health:', peerConnectionHealthRef.current);
    
    // Return a summary for UI display
    return {
      peerConnected: !!peerRef.current,
      peerId: peerRef.current ? peerRef.current.id : 'None',
      connectionCount: Object.keys(peersRef.current).length,
      streamActive: !!localStreamRef.current,
      trackCount: localStreamRef.current ? localStreamRef.current.getTracks().length : 0,
      isSeekInProgress,
      isReconnecting,
      disconnectedViewers: Object.keys(disconnectedViewersRef.current).length,
      connectionHealth: peerConnectionHealthRef.current
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