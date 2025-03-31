import React, { createContext, useState, useEffect, useRef, useContext } from 'react';
import Peer from 'peerjs';

export const WebRTCContext = createContext(null);

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
  
  // Refs
  const peerRef = useRef(null);
  const peersRef = useRef({});
  const hostVideoRef = useRef(null);
  const viewerVideoRef = useRef(null);
  const fileUrlRef = useRef(null);
  const localStreamRef = useRef(null);

  // Load file URL from sessionStorage
  useEffect(() => {
    if (isHost) {
      const storedFileUrl = sessionStorage.getItem('hostFileUrl');
      if (storedFileUrl) {
        fileUrlRef.current = storedFileUrl;
      }
    }
  }, [isHost]);

  // handle peer ID registrations
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
  
  return () => {
    socketRef.current.off('peer-id', handlePeerIdRegistration);
  };
}, [socketRef.current, isHost, isStreaming, localStreamRef.current]);

  // Initialize PeerJS
  useEffect(() => {
    if (!socketRef.current) return;
    
    // Create a unique peer ID based on room and socket ID
    const peerId = `${roomId}-${socketRef.current.id}`;
    
    try {
      // Initialize PeerJS
      const peer = new Peer(peerId, PEER_CONFIG);
      peerRef.current = peer;
      
      // Log connection events
      peer.on('open', id => {
        console.log('PeerJS connection opened with ID:', id);
        
        // Notify other users about our peer ID
        socketRef.current.emit('peer-id', {
          roomId,
          peerId: id,
          isHost
        });
      });
      
      peer.on('error', err => {
        console.error('PeerJS error:', err);
        addSystemMessage(`Connection error: ${err.type}`);
        
        if (err.type === 'peer-unavailable') {
          // Try to reconnect after delay
          setTimeout(() => {
            if (peerRef.current && peerRef.current.destroyed) {
              initializePeer();
            }
          }, 5000);
        }
      });
      
      // For viewers: handle incoming connections from host
      if (!isHost) {
        peer.on('call', call => {
          console.log('Receiving call from host');
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
                });
            }
          });
          
          call.on('close', () => {
            console.log('Call closed');
            setConnectionStatus('disconnected');
            addSystemMessage('Host disconnected');
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
      
      return () => {
        if (peer && !peer.destroyed) {
          peer.destroy();
        }
      };
    } catch (err) {
      console.error('Error initializing PeerJS:', err);
      addSystemMessage(`Failed to initialize connection: ${err.message}`);
    }
  }, [socketRef.current, roomId, isHost]);
  
  // Handle peer ID registration for host
  useEffect(() => {
    if (!socketRef.current || !isHost) return;
    
    const handlePeerIdRegistration = ({ peerId, isHost: peerIsHost }) => {
      if (!peerIsHost && isStreaming && localStreamRef.current) {
        console.log(`New viewer joined with peerId ${peerId}, calling them`);
        callPeer(peerId);
      }
    };
    
    socketRef.current.on('peer-id', handlePeerIdRegistration);
    
    return () => {
      socketRef.current.off('peer-id', handlePeerIdRegistration);
    };
  }, [socketRef.current, isHost, isStreaming]);
  
  // Function to call a peer
  const callPeer = (peerId) => {
    if (!peerRef.current || !localStreamRef.current) {
      console.error('Cannot call peer: No peer connection or stream');
      return;
    }
    
    try {
      console.log(`Calling peer ${peerId}`);
      const call = peerRef.current.call(peerId, localStreamRef.current);
      
      // Add timeout to detect connection failures
      const callTimeout = setTimeout(() => {
        console.log(`Call to ${peerId} timed out`);
        if (peersRef.current[peerId]) {
          call.close();
          delete peersRef.current[peerId];
          setPeerConnections(prev => {
            const newPeers = { ...prev };
            delete newPeers[peerId];
            return newPeers;
          });
        }
      }, 30000);
      
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
    } catch (err) {
      console.error(`Error calling peer ${peerId}:`, err);
    }
  };

  // Add this function inside the WebRTCProvider component, before the useEffect hooks

// Function to initialize the PeerJS connection
const initializePeer = () => {
  // Clean up existing peer if any
  if (peerRef.current && !peerRef.current.destroyed) {
    peerRef.current.destroy();
  }
  
  try {
    console.log('Initializing PeerJS with random ID');
    
    // Initialize PeerJS without specifying an ID (PeerJS will generate a random one)
    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;
    
    peer.on('open', id => {
      console.log('PeerJS connection opened with random ID:', id);
      
      // Notify other users about our peer ID
      socketRef.current.emit('peer-id', {
        roomId,
        peerId: id,
        isHost,
        socketId: socketRef.current.id
      });
    });
    
    peer.on('error', err => {
      console.error('PeerJS error:', err);
      
      if (err.type === 'peer-unavailable') {
        // This is normal when trying to connect to a peer that's not yet available
        console.log('Peer unavailable, may retry later');
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
    
    // For viewers: handle incoming connections from host
    if (!isHost) {
      peer.on('call', call => {
        console.log('Receiving call from host');
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
              });
          }
        });
        
        call.on('close', () => {
          console.log('Call closed');
          setConnectionStatus('disconnected');
          addSystemMessage('Host disconnected');
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
    
    return peer;
  } catch (err) {
    console.error('Error initializing PeerJS:', err);
    addSystemMessage(`Failed to initialize connection: ${err.message}`);
    return null;
  }
};
  
  // Start streaming function
  const startStreaming = async () => {
    if (!fileUrlRef.current) {
      setStreamError('No file selected');
      return false;
    }
    
    if (!peerRef.current || peerRef.current.destroyed) {
      setStreamError('Connection not initialized');
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
        hostVideoRef.current.src = fileUrlRef.current;
        hostVideoRef.current.muted = false;
        hostVideoRef.current.load();
        
        // Wait for metadata to load
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Video load timeout')), 10000);
          hostVideoRef.current.onloadedmetadata = () => {
            clearTimeout(timeout);
            resolve();
          };
          hostVideoRef.current.onerror = (e) => {
            clearTimeout(timeout);
            reject(new Error('Error loading video'));
          };
        });
        
        // Get video duration
        setVideoDuration(hostVideoRef.current.duration || 0);
        
        // Try to play the video
        try {
          await hostVideoRef.current.play();
          console.log('Host video playing');
        } catch (playError) {
          console.warn('Auto-play failed, require user interaction:', playError);
          addSystemMessage('Click the video to start playback');
        }
        
        // Capture the video stream
        console.log('Capturing video stream');
        const stream = hostVideoRef.current.captureStream();
        if (!stream) {
          throw new Error('Failed to capture stream from video');
        }
        
        localStreamRef.current = stream;
        
        // Call all existing viewers
        console.log('Calling all viewers');
        const peersToCall = [];

        // Find the registered peer IDs from socketRef
        socketRef.current.on('peer-id', ({ peerId, isHost: peerIsHost, socketId }) => {
          // Store peer IDs by their socket ID for easier lookup
          if (!peerIsHost && socketId) {
            peersToCall.push(peerId);
          }
        });

        // Call each peer
        for (const viewerId of peersToCall) {
          callPeer(viewerId);
        }
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
    
    // Refs
    fileUrlRef,
    hostVideoRef,
    viewerVideoRef,
    localStreamRef,
    peersRef,
    
    // Functions
    startStreaming,
    stopStreaming,
    
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