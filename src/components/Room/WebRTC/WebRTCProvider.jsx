import React, { createContext, useState, useEffect, useRef, useContext } from 'react';
import Peer from 'peerjs';

export const WebRTCContext = createContext(null);

// Enhanced PeerJS config with more reliable STUN/TURN servers for cross-network connectivity
const PEER_CONFIG = {
  debug: 3, // Log level (0-3)
  config: {
    iceServers: [
      // STUN servers
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.stunprotocol.org:3478' },
      
      // Free TURN servers - add more for better reliability
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
      // Additional TURN servers for better NAT traversal
      {
        urls: 'turn:numb.viagenie.ca',
        username: 'webrtc@live.com',
        credential: 'muazkh'
      },
      {
        urls: 'turn:relay.backups.cz',
        username: 'webrtc',
        credential: 'webrtc'
      },
      {
        urls: 'turn:relay.metered.ca:80',
        username: 'e8dd65f64e22e6cd30a7eb01',
        credential: 'uWdWNmkhvyqTEswO'
      },
      {
        urls: 'turn:relay.metered.ca:443',
        username: 'e8dd65f64e22e6cd30a7eb01',
        credential: 'uWdWNmkhvyqTEswO'
      },
      {
        urls: 'turn:relay.metered.ca:443?transport=tcp',
        username: 'e8dd65f64e22e6cd30a7eb01',
        credential: 'uWdWNmkhvyqTEswO'
      }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all' // Use 'all' for best chance of connection, 'relay' as fallback
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
  const [networkStats, setNetworkStats] = useState({});
  
  // Refs
  const peerRef = useRef(null);
  const peersRef = useRef({});
  const hostVideoRef = useRef(null);
  const viewerVideoRef = useRef(null);
  const fileUrlRef = useRef(null);
  const localStreamRef = useRef(null);
  const statsIntervalRef = useRef(null);

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
    
    socketRef.current.on('peer-id', handlePeerIdRegistration);
    
    // Handle viewer reconnect requests
    socketRef.current.on('viewer-reconnect-request', (data) => {
      console.log('Received viewer reconnect request');
      if (isHost && isStreaming && localStreamRef.current) {
        // Find the peer ID of the requester
        const viewerSocketId = data.socketId;
        const viewerPeerId = peerIdMap[viewerSocketId];
        
        if (viewerPeerId) {
          console.log(`Reconnecting to viewer ${viewerPeerId}`);
          // Close existing connection if any
          if (peersRef.current[viewerPeerId]) {
            peersRef.current[viewerPeerId].close();
            delete peersRef.current[viewerPeerId];
          }
          // Call the peer again
          callPeer(viewerPeerId);
        }
      }
    });
    
    return () => {
      socketRef.current.off('peer-id', handlePeerIdRegistration);
      socketRef.current.off('viewer-reconnect-request');
    };
  }, [socketRef.current, isHost, isStreaming]);

  // Function to create a safe peer ID
  const createSafePeerId = () => {
    // Create a unique ID using timestamp and random string to avoid collisions
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
      
      // Initialize PeerJS with a safe randomly generated ID
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
          // This is normal when trying to connect to a peer that's not yet available
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
        
        // Enhanced answer options
        const answerOptions = {
          sdpSemantics: 'unified-plan',
          iceRestart: true
        };
        
        // Answer the call without sending a stream back but with enhanced options
        call.answer(null, answerOptions);
        
        // Handle stream from host
        call.on('stream', stream => {
          console.log('Received stream from host:', stream);
          console.log('Stream tracks:', stream.getTracks().map(track => ({
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
          })));
          
          // Set the stream to the video element
          if (viewerVideoRef.current) {
            console.log('Setting stream to video element');
            viewerVideoRef.current.srcObject = stream;
            
            // Track metadata loading
            viewerVideoRef.current.onloadedmetadata = () => {
              console.log('Video metadata loaded');
            };
            
            viewerVideoRef.current.onloadeddata = () => {
              console.log('Video data loaded');
            };
            
            // Try to play
            viewerVideoRef.current.play()
              .then(() => {
                console.log('Viewer video is playing');
                setConnectionStatus('ready');
                addSystemMessage('Connected to host stream');
              })
              .catch(err => {
                console.error('Error playing video:', err);
                addSystemMessage('Click to play the video (browser autoplay restriction)');
                
                // Add click handler to start playback
                viewerVideoRef.current.addEventListener('click', () => {
                  viewerVideoRef.current.play()
                    .then(() => {
                      setConnectionStatus('ready');
                      addSystemMessage('Connected to host stream');
                    })
                    .catch(err => console.error('Still cannot play:', err));
                }, { once: true });
              });
            
            // Start collecting stats if we have a connection
            if (call.peerConnection) {
              // Clear any existing interval
              if (statsIntervalRef.current) {
                clearInterval(statsIntervalRef.current);
              }
              
              statsIntervalRef.current = setInterval(async () => {
                try {
                  const stats = await call.peerConnection.getStats();
                  let videoStats = {};
                  
                  stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                      videoStats = {
                        bytesReceived: report.bytesReceived,
                        packetsReceived: report.packetsReceived,
                        packetsLost: report.packetsLost || 0,
                        jitter: report.jitter || 0,
                        framesDecoded: report.framesDecoded || 0,
                        framesDropped: report.framesDropped || 0,
                        timestamp: report.timestamp
                      };
                    }
                  });
                  
                  if (Object.keys(videoStats).length > 0) {
                    setNetworkStats(videoStats);
                    console.log('Network stats:', videoStats);
                    
                    // If we're receiving data but still in 'connecting' state after 5 seconds,
                    // force the status to 'ready'
                    if (connectionStatus === 'connecting' && 
                        videoStats.bytesReceived > 0 && 
                        videoStats.packetsReceived > 0) {
                      setTimeout(() => {
                        if (connectionStatus === 'connecting') {
                          console.log('Forcing connection status to ready based on network stats');
                          setConnectionStatus('ready');
                        }
                      }, 5000);
                    }
                  }
                } catch (err) {
                  console.warn('Error getting connection stats:', err);
                }
              }, 2000);
            }
          } else {
            console.error('Viewer video element not found');
          }
        });
        
        call.on('close', () => {
          console.log('Call closed');
          setConnectionStatus('disconnected');
          addSystemMessage('Host disconnected');
          
          // Clear stats interval
          if (statsIntervalRef.current) {
            clearInterval(statsIntervalRef.current);
            statsIntervalRef.current = null;
          }
        });
        
        call.on('error', err => {
          console.error('Call error:', err);
          setConnectionStatus('error');
          addSystemMessage(`Call error: ${err.message || 'Unknown error'}`);
          
          // Try to reconnect by requesting reconnection from host
          if (socketRef.current) {
            setTimeout(() => {
              console.log('Requesting reconnection from host');
              socketRef.current.emit('viewer-reconnect-request', {
                roomId,
                socketId: socketRef.current.id
              });
            }, 5000);
          }
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
      
      // Clear any stats interval
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, [socketRef.current]);
  
  // Enhanced callPeer function with better connection handling
  const callPeer = (peerId) => {
    if (!peerRef.current || !localStreamRef.current) {
      console.error('Cannot call peer: No peer connection or stream');
      return;
    }
    
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
      
      // Set enhanced options for the call to improve NAT traversal
      const callOptions = {
        // Use SDPSemantics unified-plan for better compatibility
        sdpSemantics: 'unified-plan',
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: true, // Force ICE restart if connection failed previously
        constraints: {
          offerExtmapAllowMixed: true,
          voiceActivityDetection: false
        }
      };
      
      const call = peerRef.current.call(peerId, localStreamRef.current, callOptions);
      
      // Log call creation
      console.log(`Call created to ${peerId}`, call);
      
      // Add ICE connection state monitoring
      if (call.peerConnection) {
        call.peerConnection.oniceconnectionstatechange = () => {
          console.log(`ICE connection state to ${peerId}:`, call.peerConnection.iceConnectionState);
          
          // If connection failed, try restarting ICE
          if (call.peerConnection.iceConnectionState === 'failed') {
            console.log('ICE connection failed, attempting to restart');
            try {
              call.peerConnection.restartIce();
            } catch (err) {
              console.error('Error restarting ICE:', err);
            }
          }
        };
      }
      
      // Add timeout to detect connection failures but give more time for NAT traversal
      const callTimeout = setTimeout(() => {
        console.log(`Call to ${peerId} timed out after 45s`);
        if (peersRef.current[peerId]) {
          call.close();
          delete peersRef.current[peerId];
          setPeerConnections(prev => {
            const newPeers = { ...prev };
            delete newPeers[peerId];
            return newPeers;
          });
          
          // Try to reconnect one more time
          console.log(`Attempting to reconnect to ${peerId}...`);
          setTimeout(() => {
            if (!peersRef.current[peerId]) {
              // Only retry if we haven't already established a new connection
              const retryCall = peerRef.current.call(peerId, localStreamRef.current, callOptions);
              peersRef.current[peerId] = retryCall;
              setPeerConnections(prev => ({ ...prev, [peerId]: retryCall }));
              
              // Setup event handlers for the retry call
              setupCallEventHandlers(retryCall, peerId);
            }
          }, 2000);
        }
      }, 45000); // Longer timeout for NAT traversal
      
      // Setup event handlers
      call.on('stream', () => {
        console.log(`Connected to viewer ${peerId}`);
        clearTimeout(callTimeout);
      });
      
      call.on('close', () => {
        console.log(`Call to ${peerId} closed`);
        delete peersRef.current[peerId];
        setPeerConnections(prev => {
          const newPeers = { ...prev };
          delete newPeers[peerId];
          return newPeers;
        });
      });
      
      call.on('error', err => {
        console.error(`Call to ${peerId} error:`, err);
        addSystemMessage(`Error connecting to viewer: ${err.message || 'Unknown error'}`);
      });
      
      // Save the call reference
      peersRef.current[peerId] = call;
      setPeerConnections(prev => ({ ...prev, [peerId]: call }));
      
      console.log(`Call established to ${peerId}`);
    } catch (err) {
      console.error(`Error calling peer ${peerId}:`, err);
      addSystemMessage(`Failed to connect to viewer: ${err.message}`);
    }
  };
  
  // Helper function to setup call event handlers
  const setupCallEventHandlers = (call, peerId, callTimeout = null) => {
    call.on('stream', () => {
      console.log(`Connected to viewer ${peerId}`);
      if (callTimeout) {
        clearTimeout(callTimeout);
      }
    });
    
    call.on('close', () => {
      console.log(`Call to ${peerId} closed`);
      delete peersRef.current[peerId];
      setPeerConnections(prev => {
        const newPeers = { ...prev };
        delete newPeers[peerId];
        return newPeers;
      });
    });
    
    call.on('error', err => {
      console.error(`Call to ${peerId} error:`, err);
      addSystemMessage(`Error connecting to viewer: ${err.message || 'Unknown error'}`);
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
        
        // Apply cross-origin attribute for better browser compatibility
        hostVideoRef.current.crossOrigin = "anonymous";
        
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
        
        // Apply lower resolution constraints to improve streaming performance across networks
        if (stream && stream.getVideoTracks().length > 0) {
          const videoTrack = stream.getVideoTracks()[0];
          try {
            videoTrack.applyConstraints({
              width: 854,
              height: 480,
              frameRate: 30
            });
            console.log('Applied 480p resolution constraints to video track');
          } catch (e) {
            console.warn('Could not apply constraints:', e);
          }
        }
        
        // Log stream tracks with detailed settings
        console.log('Stream tracks:', stream.getTracks().map(track => ({
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings()  // This will show encoding parameters
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
          callPeer(viewerId);
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
    
    // Stop the host video
    if (hostVideoRef.current) {
      hostVideoRef.current.pause();
      hostVideoRef.current.src = '';
      hostVideoRef.current.load();
    }
    
    // Update state
    setIsStreaming(false);
    
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
      trackCount: localStreamRef.current ? localStreamRef.current.getTracks().length : 0
    };
  };
  
  // Function to debug network connectivity
  const debugNetworkConnectivity = async () => {
    console.log('=== Network Connectivity Debug ===');
    
    try {
      // Check if we can reach common servers
      const googleCheck = await fetch('https://www.google.com/generate_204', { 
        mode: 'no-cors',
        cache: 'no-cache'
      })
      .then(() => 'Success')
      .catch(err => `Error: ${err.message}`);
      
      console.log('Internet connectivity (Google):', googleCheck);
      
      // Check STUN server connectivity
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      pc.createDataChannel('connectivity_check');
      
      let candidates = [];
      
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidates.push({
            type: event.candidate.type,
            protocol: event.candidate.protocol,
            address: event.candidate.address
          });
        }
      };
      
      await pc.createOffer().then(offer => pc.setLocalDescription(offer));
      
      // Wait for ICE gathering to complete
      await new Promise(resolve => {
        setTimeout(resolve, 5000);
      });
      
      console.log('ICE candidates gathered:', candidates.length);
      
      const hasServerReflexive = candidates.some(c => c.type === 'srflx');
      const hasRelay = candidates.some(c => c.type === 'relay');
      
      console.log('Has server reflexive candidates (STUN working):', hasServerReflexive);
      console.log('Has relay candidates (TURN working):', hasRelay);
      
      // Cleanup
      pc.close();
      
      return {
        internet: googleCheck === 'Success',
        stunWorking: hasServerReflexive,
        turnWorking: hasRelay,
        candidates: candidates.length
      };
    } catch (err) {
      console.error('Error checking connectivity:', err);
      return {
        internet: false,
        stunWorking: false,
        turnWorking: false,
        error: err.message
      };
    }
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
    networkStats,
    
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
    debugNetworkConnectivity,
    
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

// Hook
export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (context === null) {
    throw new Error('useWebRTC must be used within a WebRTCProvider');
  }
  return context;
};