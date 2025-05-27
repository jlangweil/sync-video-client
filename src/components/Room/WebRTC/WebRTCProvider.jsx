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

// Updated PeerJS config with TURN-only option for testing
const PEER_CONFIG = {
  debug: 3, // Log level (0-3)
  config: {
    // Uncomment the line below to force TURN-only for testing NAT/router timeout issues
    // iceTransportPolicy: 'relay', // Forces TURN servers only
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

// Improved silent audio track generator - COMPLETELY SILENT
function createSilentAudioTrack() {
  try {
    const ctx = new AudioContext();
    
    // Create a completely silent audio buffer
    const bufferSize = ctx.sampleRate * 0.1; // 0.1 seconds of silence
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Fill with silence (zeros)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = 0;
    }
    
    // Create buffer source and destination
    const source = ctx.createBufferSource();
    const destination = ctx.createMediaStreamDestination();
    
    source.buffer = buffer;
    source.loop = true; // Loop the silent buffer
    source.connect(destination);
    
    source.start();
    ctx.resume();
    
    const track = destination.stream.getAudioTracks()[0];
    track.enabled = true;
    
    console.log('Created completely silent audio track:', {
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      id: track.id
    });
    
    return track;
  } catch (error) {
    console.error('Failed to create silent audio track:', error);
    return null;
  }
}

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
  const keepAliveStreamRef = useRef(null);
  const keepAliveCanvasRef = useRef(null);
  const keepAliveAnimationRef = useRef(null);
  const disconnectedViewersRef = useRef({});
  const reconnectAttemptsRef = useRef({});
  const connectionStatsRef = useRef({});
  const heartbeatTimestampRef = useRef(Date.now());
  const peerConnectionHealthRef = useRef({});
  const socketReconnectingRef = useRef(false);
  const lastSyncStateRef = useRef(null);
  
  const maxReconnectAttempts = 8;
  const reconnectBackoffBase = 1.5;

  // Create keep-alive canvas stream that mirrors the paused video frame
  const createKeepAliveStream = () => {
    try {
      console.log('Creating keep-alive canvas stream...');
      
      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      
      // Store canvas reference
      keepAliveCanvasRef.current = canvas;
      
      // Capture the current frame from the video if available
      if (hostVideoRef.current && hostVideoRef.current.videoWidth > 0) {
        canvas.width = hostVideoRef.current.videoWidth;
        canvas.height = hostVideoRef.current.videoHeight;
        
        // Draw the current video frame
        ctx.drawImage(hostVideoRef.current, 0, 0, canvas.width, canvas.height);
      } else {
        // Fallback to black screen with text
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Stream Paused', canvas.width / 2, canvas.height / 2);
      }
      
      // Create stream from canvas at higher frame rate
      const canvasStream = canvas.captureStream(60); // Higher FPS for better compatibility
      
      // Add silent audio track
      const silentAudioTrack = createSilentAudioTrack();
      if (silentAudioTrack) {
        canvasStream.addTrack(silentAudioTrack);
      }
      
      // Start keep-alive frame drawing loop with micro-changes
      let frameCount = 0;
      const drawKeepAliveFrame = () => {
        if (keepAliveCanvasRef.current && keepAliveAnimationRef.current !== null) {
          const ctx = keepAliveCanvasRef.current.getContext('2d');
          
          // Redraw the paused frame
          if (hostVideoRef.current && hostVideoRef.current.videoWidth > 0) {
            ctx.drawImage(hostVideoRef.current, 0, 0, canvas.width, canvas.height);
          } else {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Stream Paused', canvas.width / 2, canvas.height / 2);
          }
          
          // Add very subtle pixel changes to ensure frame differences
          // This makes browsers think the stream is still "active"
          const pixelNoise = frameCount % 4; // Cycle through 0,1,2,3
          const x = (frameCount * 7) % canvas.width;
          const y = (frameCount * 11) % canvas.height;
          
          // Add almost invisible pixel changes
          ctx.fillStyle = `rgba(255,255,255,${0.001 + pixelNoise * 0.0005})`;
          ctx.fillRect(x, y, 1, 1);
          
          frameCount++;
          
          // Continue the animation loop at 30fps
          keepAliveAnimationRef.current = requestAnimationFrame(drawKeepAliveFrame);
        }
      };
      
      // Start the animation loop
      keepAliveAnimationRef.current = requestAnimationFrame(drawKeepAliveFrame);
      
      console.log('Keep-alive stream created with tracks:', {
        video: canvasStream.getVideoTracks().length,
        audio: canvasStream.getAudioTracks().length,
        active: canvasStream.active,
        frameRate: 60
      });
      
      // Log track details
      canvasStream.getTracks().forEach(track => {
        console.log(`Keep-alive track [${track.kind}]:`, {
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          id: track.id
        });
      });
      
      return canvasStream;
    } catch (error) {
      console.error('Failed to create keep-alive stream:', error);
      return null;
    }
  };

  // Replace tracks in all peer connections with enhanced logging
  const replaceTracksInConnections = async (newStream, streamType = 'unknown') => {
    console.log(`Replacing tracks with ${streamType} stream`);
    
    if (!newStream) {
      console.error('Cannot replace tracks: newStream is null');
      return;
    }
    
    // Log new stream details
    console.log(`New ${streamType} stream details:`, {
      active: newStream.active,
      tracks: newStream.getTracks().length,
      videoTracks: newStream.getVideoTracks().length,
      audioTracks: newStream.getAudioTracks().length
    });
    
    newStream.getTracks().forEach(track => {
      console.log(`New ${streamType} track [${track.kind}]:`, {
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        id: track.id
      });
    });
    
    const replacementPromises = [];
    
    Object.keys(peersRef.current).forEach(peerId => {
      const call = peersRef.current[peerId];
      
      // Check if call and peerConnection exist and are valid
      if (call && call.peerConnection && 
          call.peerConnection.connectionState !== undefined &&
          call.peerConnection.getSenders) {
        console.log(`Replacing tracks for peer: ${peerId}`);
        
        try {
          // Get all senders
          const senders = call.peerConnection.getSenders();
          console.log(`Found ${senders.length} senders for peer ${peerId}`);
          
          senders.forEach(async (sender, index) => {
            const oldTrack = sender.track;
            if (oldTrack) {
              console.log(`Sender ${index} current track [${oldTrack.kind}]:`, {
                enabled: oldTrack.enabled,
                muted: oldTrack.muted,
                readyState: oldTrack.readyState,
                id: oldTrack.id
              });
              
              // Find matching track in new stream
              const newTrack = newStream.getTracks().find(track => track.kind === oldTrack.kind);
              
              if (newTrack) {
                console.log(`Replacing ${oldTrack.kind} track for peer ${peerId}`);
                
                const replacePromise = sender.replaceTrack(newTrack)
                  .then(() => {
                    console.log(`Successfully replaced ${oldTrack.kind} track for peer ${peerId}`);
                    
                    // Log post-replacement details
                    console.log(`Post-replacement sender track [${newTrack.kind}]:`, {
                      enabled: newTrack.enabled,
                      muted: newTrack.muted,
                      readyState: newTrack.readyState,
                      id: newTrack.id
                    });
                  })
                  .catch(error => {
                    console.error(`Failed to replace ${oldTrack.kind} track for peer ${peerId}:`, error);
                  });
                
                replacementPromises.push(replacePromise);
              } else {
                console.warn(`No matching ${oldTrack.kind} track found in new stream for peer ${peerId}`);
              }
            } else {
              console.log(`Sender ${index} has no current track`);
            }
          });
        } catch (error) {
          console.error(`Error accessing senders for peer ${peerId}:`, error);
          // Clean up invalid peer connection
          delete peersRef.current[peerId];
          setPeerConnections(prev => {
            const newPeers = { ...prev };
            delete newPeers[peerId];
            return newPeers;
          });
        }
      } else {
        console.warn(`No valid peer connection found for peer: ${peerId}`);
        // Clean up invalid peer reference
        if (call) {
          delete peersRef.current[peerId];
          setPeerConnections(prev => {
            const newPeers = { ...prev };
            delete newPeers[peerId];
            return newPeers;
          });
        }
      }
    });
    
    // Wait for all replacements to complete
    try {
      await Promise.all(replacementPromises);
      console.log(`Completed track replacement for ${Object.keys(peersRef.current).length} peers`);
    } catch (error) {
      console.error('Error during track replacement:', error);
    }
    
    // Update local stream reference
    localStreamRef.current = newStream;
  };

  // Enhanced video pause/play handlers with connection keepalive
  useEffect(() => {
    if (!hostVideoRef.current || !isHost) return;
    
    const videoElement = hostVideoRef.current;
    let connectionKeepAliveInterval = null;
    
    const startConnectionKeepAlive = () => {
      console.log('Starting connection keep-alive during pause');
      
      // Send periodic data to keep connections alive
      connectionKeepAliveInterval = setInterval(() => {
        Object.keys(peersRef.current).forEach(peerId => {
          const call = peersRef.current[peerId];
          if (call && call.peerConnection && call.peerConnection.connectionState === 'connected') {
            // Send keep-alive data via datachannel if available
            try {
              const dataChannel = call.peerConnection.createDataChannel('keepalive', { ordered: false });
              dataChannel.send(JSON.stringify({ 
                type: 'keepalive', 
                timestamp: Date.now() 
              }));
              dataChannel.close();
            } catch (err) {
              console.log('DataChannel keep-alive failed, connection may be unstable');
            }
          }
        });
      }, 5000); // Every 5 seconds
    };
    
    const stopConnectionKeepAlive = () => {
      if (connectionKeepAliveInterval) {
        clearInterval(connectionKeepAliveInterval);
        connectionKeepAliveInterval = null;
        console.log('Stopped connection keep-alive');
      }
    };
    
    const handlePause = async () => {
      console.log('Video paused - switching to keep-alive stream and starting connection maintenance');
      
      // Start connection keep-alive
      startConnectionKeepAlive();
      
      // Create keep-alive stream if it doesn't exist
      if (!keepAliveStreamRef.current) {
        keepAliveStreamRef.current = createKeepAliveStream();
      }
      
      if (keepAliveStreamRef.current) {
        // Store current viewer list before track replacement
        const currentViewers = Object.keys(peersRef.current);
        console.log('Current viewers before pause:', currentViewers);
        
        await replaceTracksInConnections(keepAliveStreamRef.current, 'keep-alive');
        addSystemMessage('Stream paused - maintaining connection (silent)');
        
        // Monitor for disconnections more frequently during pause
        const monitorInterval = setInterval(() => {
          const remainingViewers = Object.keys(peersRef.current);
          const disconnectedViewers = currentViewers.filter(id => !remainingViewers.includes(id));
          
          if (disconnectedViewers.length > 0) {
            console.log('Detected disconnected viewers during pause:', disconnectedViewers);
            
            // Add to disconnected list for reconnection
            disconnectedViewers.forEach(peerId => {
              if (!disconnectedViewersRef.current[peerId]) {
                disconnectedViewersRef.current[peerId] = true;
                reconnectAttemptsRef.current[peerId] = {
                  count: 0,
                  lastAttempt: 0
                };
              }
            });
            
            // Start reconnection process
            if (!isReconnecting && disconnectedViewers.length > 0) {
              setIsReconnecting(true);
              setTimeout(() => reconnectToViewers(), 1000);
            }
          }
        }, 10000); // Check every 10 seconds during pause
        
        // Store interval reference for cleanup
        videoElement._pauseMonitorInterval = monitorInterval;
      }
    };
    
    const handlePlay = async () => {
      console.log('Video playing - switching back to live stream');
      
      // Stop connection keep-alive
      stopConnectionKeepAlive();
      
      // Clear pause monitoring
      if (videoElement._pauseMonitorInterval) {
        clearInterval(videoElement._pauseMonitorInterval);
        videoElement._pauseMonitorInterval = null;
      }
      
      // Stop keep-alive animation
      if (keepAliveAnimationRef.current) {
        cancelAnimationFrame(keepAliveAnimationRef.current);
        keepAliveAnimationRef.current = null;
      }
      
      // Stop keep-alive stream tracks to clean up audio context
      if (keepAliveStreamRef.current) {
        keepAliveStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
        keepAliveStreamRef.current = null;
      }
      
      // Create new live stream
      let liveStream;
      
      if (videoElement.captureStream) {
        liveStream = videoElement.captureStream();
      } else if (videoElement.mozCaptureStream) {
        liveStream = videoElement.mozCaptureStream();
      }
      
      if (liveStream) {
        // Add audio track if video stream doesn't have one
        if (liveStream.getAudioTracks().length === 0) {
          const silentAudioTrack = createSilentAudioTrack();
          if (silentAudioTrack) {
            liveStream.addTrack(silentAudioTrack);
          }
        }
        
        // Store current viewer list before track replacement
        const currentViewers = Object.keys(peersRef.current);
        console.log('Current viewers before resume:', currentViewers);
        
        await replaceTracksInConnections(liveStream, 'live-video');
        addSystemMessage('Resumed live streaming');
        
        // Check for disconnected viewers after resuming
        setTimeout(async () => {
          const remainingViewers = Object.keys(peersRef.current);
          const disconnectedViewers = currentViewers.filter(id => !remainingViewers.includes(id));
          
          if (disconnectedViewers.length > 0) {
            console.log('Detected disconnected viewers after resume:', disconnectedViewers);
            
            // Add to disconnected list for reconnection
            disconnectedViewers.forEach(peerId => {
              if (!disconnectedViewersRef.current[peerId]) {
                disconnectedViewersRef.current[peerId] = true;
                reconnectAttemptsRef.current[peerId] = {
                  count: 0,
                  lastAttempt: 0
                };
              }
            });
            
            // Start reconnection process
            if (!isReconnecting) {
              setIsReconnecting(true);
              setTimeout(() => reconnectToViewers(), 500);
            }
          }
        }, 2000);
      }
    };
    
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('play', handlePlay);
    
    return () => {
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('play', handlePlay);
      
      // Clean up intervals
      stopConnectionKeepAlive();
      if (videoElement._pauseMonitorInterval) {
        clearInterval(videoElement._pauseMonitorInterval);
        videoElement._pauseMonitorInterval = null;
      }
      
      // Clean up keep-alive animation
      if (keepAliveAnimationRef.current) {
        cancelAnimationFrame(keepAliveAnimationRef.current);
        keepAliveAnimationRef.current = null;
      }
      
      // Clean up keep-alive stream
      if (keepAliveStreamRef.current) {
        keepAliveStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
        keepAliveStreamRef.current = null;
      }
    };
  }, [isHost, isStreaming]);

  // HEARTBEAT SYSTEM
  useEffect(() => {
    if (!socketRef.current) return;
    
    const initialSocketId = socketRef.current.id;
    
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
        
        if (Date.now() - heartbeatTimestampRef.current > 5000 && !socketReconnectingRef.current) {
          console.log('Socket disconnected for 5s, initiating reconnection...');
          socketReconnectingRef.current = true;
          
          if (socketRef.current) {
            socketRef.current.connect();
            
            socketRef.current.once('connect', () => {
              console.log('Socket reconnected, re-joining room with ID:', socketRef.current.id);
              socketReconnectingRef.current = false;
              heartbeatTimestampRef.current = Date.now();
              
              socketRef.current.emit('joinRoom', {
                roomId,
                username: localStorage.getItem('username'),
                isHost
              });
              
              if (peerRef.current && peerRef.current.id) {
                socketRef.current.emit('peer-id', {
                  roomId,
                  peerId: peerRef.current.id,
                  isHost,
                  previousSocketId: initialSocketId
                });
              }
              
              addSystemMessage('Reconnected to server');
              
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

    socketRef.current.on('heartbeat-ack', ({ viewerCount, hostConnected }) => {
      heartbeatTimestampRef.current = Date.now();
      
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

  // ENHANCED PEER RECONNECTION MONITORING with aggressive pause handling
  useEffect(() => {
    if (!isStreaming) return;

    if (isHost) {
      const monitorInterval = setInterval(() => {
        Object.keys(peersRef.current).forEach(peerId => {
          const call = peersRef.current[peerId];
          const connection = call?.peerConnection;
          
          // Check if connection exists and is not null/destroyed
          if (connection && connection.connectionState !== undefined) {
            const health = peerConnectionHealthRef.current[peerId] || { 
              lastChecked: 0, 
              state: 'unknown',
              iceState: 'unknown'
            };
            
            try {
              health.lastChecked = Date.now();
              health.state = connection.connectionState || connection.iceConnectionState || 'unknown';
              health.iceState = connection.iceConnectionState || 'unknown';
              
              peerConnectionHealthRef.current[peerId] = health;
              
              // More aggressive detection of problematic states
              if (['disconnected', 'failed', 'closed'].includes(health.state) || 
                  ['disconnected', 'failed', 'closed'].includes(health.iceState)) {
                console.warn(`Detected problematic connection with peer ${peerId}:`, health);
                
                if (!disconnectedViewersRef.current[peerId]) {
                  console.log(`Adding ${peerId} to disconnected viewers list for reconnection`);
                  disconnectedViewersRef.current[peerId] = true;
                  reconnectAttemptsRef.current[peerId] = {
                    count: 0,
                    lastAttempt: 0
                  };
                  
                  if (!isReconnecting && !isSeekInProgress) {
                    console.log('Initiating reconnection process');
                    setIsReconnecting(true);
                    // Faster reconnection during monitoring
                    setTimeout(() => reconnectToViewers(), 500);
                  }
                }
              }
              
              // Also check for stale connections (no activity for too long)
              const timeSinceLastCheck = Date.now() - health.lastChecked;
              if (timeSinceLastCheck > 60000 && health.state === 'connected') { // 1 minute
                console.log(`Connection to ${peerId} appears stale, testing...`);
                
                // Try to send a test message to verify connection
                try {
                  const testChannel = connection.createDataChannel('test', { ordered: false });
                  testChannel.send('ping');
                  testChannel.close();
                } catch (err) {
                  console.warn(`Stale connection detected for ${peerId}, marking for reconnection`);
                  if (!disconnectedViewersRef.current[peerId]) {
                    disconnectedViewersRef.current[peerId] = true;
                    reconnectAttemptsRef.current[peerId] = {
                      count: 0,
                      lastAttempt: 0
                    };
                  }
                }
              }
              
            } catch (error) {
              console.warn(`Error accessing connection state for peer ${peerId}:`, error);
              // Clean up invalid peer reference
              delete peersRef.current[peerId];
              setPeerConnections(prev => {
                const newPeers = { ...prev };
                delete newPeers[peerId];
                return newPeers;
              });
            }
          } else if (call) {
            // Connection is null but call exists, clean it up
            console.log(`Cleaning up null connection for peer ${peerId}`);
            delete peersRef.current[peerId];
            setPeerConnections(prev => {
              const newPeers = { ...prev };
              delete newPeers[peerId];
              return newPeers;
            });
          }
        });
      }, 3000); // More frequent monitoring (every 3 seconds)
      
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
    
    disconnectedViewersRef.current = { ...peerConnections };
    
    lastSyncStateRef.current = {
      currentTime,
      isPlaying: !hostVideoRef.current?.paused,
      timestamp: Date.now()
    };
    
    if (socketRef.current) {
      socketRef.current.emit('videoSeekOperation', {
        roomId,
        seekTime: currentTime,
        isPlaying: !hostVideoRef.current?.paused,
        sourceTimestamp: Date.now()
      });
    }
    
    Object.keys(peersRef.current).forEach(peerId => {
      if (peersRef.current[peerId]) {
        console.log(`Temporarily closing connection to ${peerId} for seek operation`);
        peersRef.current[peerId].close();
      }
    });
    
    peersRef.current = {};
    setPeerConnections({});
    
    setTimeout(async () => {
      try {
        console.log('Recreating stream after seek');
        await refreshStreamAfterSeek();
        
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
      console.log('Refreshing video stream after seek');
      
      let newStream;
      
      if (hostVideoRef.current.captureStream) {
        newStream = hostVideoRef.current.captureStream();
      } else if (hostVideoRef.current.mozCaptureStream) {
        newStream = hostVideoRef.current.mozCaptureStream();
      }
      
      if (!newStream) {
        throw new Error('Failed to recapture stream from video');
      }
      
      if (newStream.getAudioTracks().length === 0) {
        const silentAudioTrack = createSilentAudioTrack();
        if (silentAudioTrack) {
          newStream.addTrack(silentAudioTrack);
        }
      }
      
      if (localStreamRef.current) {
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
      console.log('No disconnected viewers, ending reconnection process');
      setIsSeekInProgress(false);
      setIsReconnecting(false);
      return;
    }
    
    const now = Date.now();
    const reconnectionPromises = [];
    
    disconnectedIds.forEach(async (peerId) => {
      if (!reconnectAttemptsRef.current[peerId]) {
        reconnectAttemptsRef.current[peerId] = {
          count: 0,
          lastAttempt: 0
        };
      }
      
      const attempts = reconnectAttemptsRef.current[peerId];
      
      if (attempts.count < maxReconnectAttempts) {
        const backoffTime = Math.pow(reconnectBackoffBase, attempts.count) * 1000;
        
        if (now - attempts.lastAttempt > backoffTime) {
          attempts.count++;
          attempts.lastAttempt = now;
          
          console.log(`Reconnect attempt ${attempts.count}/${maxReconnectAttempts} to ${peerId} (backoff: ${(backoffTime/1000).toFixed(1)}s)`);
          
          const reconnectPromise = callPeer(peerId)
            .then(() => {
              console.log(`Successfully reconnected to ${peerId}`);
              delete disconnectedViewersRef.current[peerId];
              delete reconnectAttemptsRef.current[peerId];
            })
            .catch(err => {
              console.error(`Failed to reconnect to ${peerId}:`, err);
              
              if (attempts.count >= maxReconnectAttempts) {
                console.warn(`Max reconnect attempts (${maxReconnectAttempts}) reached for ${peerId}, giving up`);
                delete disconnectedViewersRef.current[peerId];
                delete reconnectAttemptsRef.current[peerId];
                
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
            });
          
          reconnectionPromises.push(reconnectPromise);
        }
      } else {
        delete disconnectedViewersRef.current[peerId];
        delete reconnectAttemptsRef.current[peerId];
      }
    });
    
    // Wait for all reconnection attempts to complete
    Promise.all(reconnectionPromises).finally(() => {
      // Continue reconnection process if needed
      const remainingDisconnected = Object.keys(disconnectedViewersRef.current).length;
      
      if (remainingDisconnected > 0) {
        console.log(`${remainingDisconnected} viewers still disconnected, continuing reconnection in 2s`);
        setTimeout(reconnectToViewers, 2000);
      } else {
        console.log('All viewers reconnected successfully');
        setIsSeekInProgress(false);
        setIsReconnecting(false);
        addSystemMessage('All viewers reconnected');
      }
    });
  };

  // Handle peer ID registrations
  useEffect(() => {
    if (!socketRef.current) return;
    
    const handlePeerIdRegistration = ({ peerId, isHost: peerIsHost, socketId }) => {
      console.log(`Peer ID registered: ${peerId} for socket ${socketId}`);
      
      setPeerIdMap(prev => ({
        ...prev,
        [socketId]: peerId
      }));
      
      if (isHost && isStreaming && localStreamRef.current && !peerIsHost) {
        console.log(`New viewer joined, calling peer ID: ${peerId}`);
        callPeer(peerId);
      }
    };
    
    const handleSeekNotification = ({ seekTime, isPlaying }) => {
      if (!isHost && viewerVideoRef.current) {
        console.log('Host seeking to:', seekTime);
        setConnectionStatus('buffering');
        addSystemMessage(`Host is seeking to ${Math.floor(seekTime / 60)}:${Math.floor(seekTime % 60).toString().padStart(2, '0')}`);
        
        lastSyncStateRef.current = {
          currentTime: seekTime,
          isPlaying: isPlaying !== undefined ? isPlaying : true,
          timestamp: Date.now()
        };
      }
    };
    
    const handleReconnectionFailed = ({ message }) => {
      console.warn('Reconnection failed:', message);
      setConnectionStatus('error');
      addSystemMessage(`Connection error: ${message}. Please refresh the page.`);
    };
    
    // Handle reconnection requests from viewers
    const handleReconnectionRequest = ({ viewerPeerId }) => {
      if (isHost && isStreaming && localStreamRef.current) {
        console.log(`Received reconnection request from viewer: ${viewerPeerId}`);
        
        // Add to disconnected list if not already there
        if (!disconnectedViewersRef.current[viewerPeerId]) {
          disconnectedViewersRef.current[viewerPeerId] = true;
          reconnectAttemptsRef.current[viewerPeerId] = {
            count: 0,
            lastAttempt: 0
          };
          
          // Try to reconnect immediately
          callPeer(viewerPeerId).catch(err => {
            console.error(`Failed to reconnect to requesting viewer ${viewerPeerId}:`, err);
            
            // Start reconnection process if not already in progress
            if (!isReconnecting) {
              setIsReconnecting(true);
              setTimeout(() => reconnectToViewers(), 1000);
            }
          });
        }
      }
    };
    
    socketRef.current.on('peer-id', handlePeerIdRegistration);
    socketRef.current.on('videoSeekOperation', handleSeekNotification);
    socketRef.current.on('reconnection-failed', handleReconnectionFailed);
    socketRef.current.on('request-reconnection', handleReconnectionRequest);
    
    socketRef.current.on('fallback-sync-state', (syncState) => {
      if (!isHost && viewerVideoRef.current) {
        console.log('Received fallback sync state:', syncState);
        
        lastSyncStateRef.current = {
          ...syncState,
          timestamp: Date.now()
        };
        
        if (connectionStatus !== 'ready') {
          addSystemMessage('Received sync update from host via signaling channel');
        }
      }
    });
    
    return () => {
      socketRef.current.off('peer-id', handlePeerIdRegistration);
      socketRef.current.off('videoSeekOperation', handleSeekNotification);
      socketRef.current.off('reconnection-failed', handleReconnectionFailed);
      socketRef.current.off('request-reconnection', handleReconnectionRequest);
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
          addSystemMessage(`Connection error: ${err.type || err.message}`);
          
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
  
  // Setup peer event listeners with enhanced ICE monitoring and disconnect detection
  const setupPeerListeners = (peer) => {
    // For viewers: handle incoming connections from host
    if (!isHost) {
      peer.on('call', call => {
        console.log('Receiving call from host:', call.peer);
        setConnectionStatus('connecting');
        
        // Enhanced connection monitoring for client side
        if (call.peerConnection) {
          // Connection state monitoring
          call.peerConnection.onconnectionstatechange = () => {
            // Check if connection still exists before accessing properties
            if (call.peerConnection && call.peerConnection.connectionState !== undefined) {
              const state = call.peerConnection.connectionState;
              console.log('Client connectionState changed to:', state);
              
              if (state === 'connected') {
                setConnectionStatus('ready');
              } else if (state === 'disconnected') {
                setConnectionStatus('unstable');
                console.log('Client connection became unstable');
              } else if (state === 'failed') {
                setConnectionStatus('error');
                addSystemMessage('Connection to host failed. Attempting to reconnect...');
              } else if (state === 'closed') {
                setConnectionStatus('disconnected');
              }
            }
          };
          
          // ICE connection state monitoring  
          call.peerConnection.oniceconnectionstatechange = () => {
            // Check if connection still exists before accessing properties
            if (call.peerConnection && call.peerConnection.iceConnectionState !== undefined) {
              const state = call.peerConnection.iceConnectionState;
              console.log('Client ICE state:', state);
              
              if (state === 'checking') {
                setConnectionStatus('connecting');
              } else if (state === 'connected' || state === 'completed') {
                setConnectionStatus('ready');
              } else if (state === 'disconnected') {
                setConnectionStatus('unstable');
              } else if (state === 'failed') {
                setConnectionStatus('error');
                addSystemMessage('Connection to host failed. Attempting to reconnect...');
                
                if (socketRef.current) {
                  socketRef.current.emit('webrtc-connection-failed', {
                    roomId,
                    peerId: call.peer
                  });
                }
              } else if (state === 'closed') {
                setConnectionStatus('disconnected');
              }
            }
          };
        }
        
        // Answer the call without sending a stream back
        call.answer();
        
        // Handle stream from host
        call.on('stream', stream => {
          console.log('Received stream from host');
          
          if (viewerVideoRef.current) {
            viewerVideoRef.current.srcObject = stream;
            
            viewerVideoRef.current.play()
              .then(() => {
                console.log('Viewer video is playing');
                setConnectionStatus('ready');
                
                if (lastSyncStateRef.current) {
                  const { currentTime, isPlaying } = lastSyncStateRef.current;
                  
                  if (Math.abs(viewerVideoRef.current.currentTime - currentTime) > 1) {
                    console.log(`Applying stored sync time: ${currentTime}`);
                    viewerVideoRef.current.currentTime = currentTime;
                  }
                }
              })
              .catch(err => {
                console.error('Error playing video:', err);
                addSystemMessage('Click to play the video (browser autoplay restriction)');
                
                viewerVideoRef.current.addEventListener('click', () => {
                  viewerVideoRef.current.play()
                    .then(() => setConnectionStatus('ready'))
                    .catch(err => console.error('Still cannot play:', err));
                }, { once: true });
              });
              
            // Add connection stats monitoring
            if (call.peerConnection) {
              const statsInterval = setInterval(async () => {
                // Check if connection still exists and is connected
                if (call.peerConnection && 
                    call.peerConnection.connectionState === 'connected' && 
                    call.peerConnection.getStats) {
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
                    
                    if (statsReport.packetsLost > 100 || 
                        (statsReport.framesDropped && statsReport.framesDecoded && 
                         statsReport.framesDropped / statsReport.framesDecoded > 0.1)) {
                      console.warn('Connection quality issues detected:', statsReport);
                    }
                  } catch (e) {
                    console.error('Error getting connection stats:', e);
                  }
                } else {
                  // Connection is no longer available, clear the interval
                  clearInterval(statsInterval);
                }
              }, 5000);
            }
          }
        });
        
        call.on('close', () => {
          console.log('Call closed - attempting to maintain connection');
          
          // Don't immediately set to disconnected, give time for track replacement
          setTimeout(() => {
            // Check if we still don't have a stream after giving time for reconnection
            if (viewerVideoRef.current && !viewerVideoRef.current.srcObject) {
              console.log('No stream detected after delay, requesting reconnection');
              setConnectionStatus('disconnected');
              addSystemMessage('Connection lost. Attempting to reconnect...');
              
              // Request reconnection via signaling after short delay
              setTimeout(() => {
                if (connectionStatus === 'disconnected' && socketRef.current) {
                  console.log('Requesting reconnection via signaling');
                  socketRef.current.emit('request-reconnection', {
                    roomId,
                    viewerPeerId: peer.id
                  });
                }
              }, 2000);
            } else {
              console.log('Stream still active after call close, maintaining connection');
            }
          }, 5000);
        });
        
        call.on('error', err => {
          console.error('Call error:', err);
          setConnectionStatus('error');
          addSystemMessage(`Call error: ${err.message || 'Unknown error'}`);
        });
        
        peersRef.current[call.peer] = call;
        setPeerConnections(prev => ({ ...prev, [call.peer]: call }));
      });
    }
  };

  // Initialize PeerJS on component mount
  useEffect(() => {
    if (!socketRef.current) return;
    
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
        
        const streamInfo = {
          tracks: localStreamRef.current.getTracks().length,
          videoTracks: localStreamRef.current.getVideoTracks().length,
          audioTracks: localStreamRef.current.getAudioTracks().length,
          active: localStreamRef.current.active
        };
        
        console.log(`Calling with stream:`, streamInfo);
        console.log('keepAliveStream active:', localStreamRef.current.active);
        localStreamRef.current.getTracks().forEach(t => {
          console.log(`[${t.kind}] enabled=${t.enabled}, muted=${t.muted}, state=${t.readyState}`);
        });
        
        if (streamInfo.videoTracks === 0) {
          console.warn('Warning: No video tracks in stream');
        }
        
        const call = peerRef.current.call(peerId, localStreamRef.current);
        
        console.log(`Call created to ${peerId}`, call);
        
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
        
        if (call.peerConnection) {
          call.peerConnection.oniceconnectionstatechange = () => {
            // Check if connection still exists before accessing properties
            if (call.peerConnection && call.peerConnection.iceConnectionState !== undefined) {
              const state = call.peerConnection.iceConnectionState;
              console.log(`ICE connection state changed to: ${state} for peer ${peerId}`);
              
              peerConnectionHealthRef.current[peerId] = {
                ...peerConnectionHealthRef.current[peerId],
                iceState: state,
                lastStateChange: Date.now()
              };
              
              if (state === 'disconnected' || state === 'failed') {
                console.warn(`ICE connection issue with ${peerId}: ${state}`);
                
                if (state === 'failed' && !disconnectedViewersRef.current[peerId]) {
                  console.log(`Adding ${peerId} to disconnected list due to ICE failure`);
                  disconnectedViewersRef.current[peerId] = true;
                  reconnectAttemptsRef.current[peerId] = {
                    count: 0,
                    lastAttempt: 0
                  };
                  
                  if (!isReconnecting && !isSeekInProgress) {
                    setIsReconnecting(true);
                    setTimeout(() => reconnectToViewers(), 1000);
                  }
                }
              }
            }
          };
          
          call.peerConnection.onconnectionstatechange = () => {
            // Check if connection still exists before accessing properties
            if (call.peerConnection && call.peerConnection.connectionState !== undefined) {
              const state = call.peerConnection.connectionState;
              console.log(`Connection state changed to: ${state} for peer ${peerId}`);
              
              peerConnectionHealthRef.current[peerId] = {
                ...peerConnectionHealthRef.current[peerId],
                connectionState: state,
                lastStateChange: Date.now()
              };
            }
          };
        }
        
        call.on('stream', () => {
          console.log(`Connected to viewer ${peerId}`);
          clearTimeout(callTimeout);
          
          if (disconnectedViewersRef.current[peerId]) {
            delete disconnectedViewersRef.current[peerId];
            delete reconnectAttemptsRef.current[peerId];
            
            addSystemMessage(`Reconnected to viewer`);
            
            if (hostVideoRef.current && socketRef.current) {
              lastSyncStateRef.current = {
                currentTime: hostVideoRef.current.currentTime,
                isPlaying: !hostVideoRef.current.paused,
                timestamp: Date.now()
              };
              
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
          
          if (!isSeekInProgress && isStreaming) {
            disconnectedViewersRef.current[peerId] = true;
            
            if (!reconnectAttemptsRef.current[peerId]) {
              reconnectAttemptsRef.current[peerId] = {
                count: 0,
                lastAttempt: 0
              };
            }
            
            setTimeout(() => {
              if (disconnectedViewersRef.current[peerId] && isStreaming) {
                console.log(`Attempting to reconnect to ${peerId} after disconnect`);
                callPeer(peerId).catch(err => {
                  console.error(`Failed to reconnect to ${peerId}:`, err);
                  
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
      
      socketRef.current.emit('streamingAboutToStart', { roomId });
      
      if (hostVideoRef.current) {
        console.log('Setting up host video with URL:', fileUrlRef.current.substring(0, 50) + '...');
        
        hostVideoRef.current.src = fileUrlRef.current;
        hostVideoRef.current.muted = false;
        hostVideoRef.current.load();
        
        hostVideoRef.current.onseeking = () => {
          console.log('Video seeking detected');
          if (isHost && isStreaming && !isSeekInProgress) {
            handleSeekEvent(hostVideoRef.current.currentTime);
          }
        };
        
        console.log('Video element state:', {
          readyState: hostVideoRef.current.readyState,
          networkState: hostVideoRef.current.networkState,
          paused: hostVideoRef.current.paused,
          error: hostVideoRef.current.error,
          src: hostVideoRef.current.src ? 'Set (not empty)' : 'Empty'
        });
        
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
        
        setVideoDuration(hostVideoRef.current.duration || 0);
        
        try {
          console.log('Attempting to play video');
          await hostVideoRef.current.play();
          console.log('Host video playing successfully');
        } catch (playError) {
          console.warn('Auto-play failed, require user interaction:', playError);
          addSystemMessage('Click the video to start playback');
          
          hostVideoRef.current.addEventListener('click', () => {
            console.log('User clicked video, attempting to play');
            hostVideoRef.current.play()
              .then(() => console.log('Video playing after click'))
              .catch(err => console.error('Still cannot play after click:', err));
          }, { once: true });
        }
        
        if (!hostVideoRef.current.captureStream && !hostVideoRef.current.mozCaptureStream) {
          console.error('captureStream API not available on this browser');
          setStreamError('Your browser does not support video streaming. Please try Chrome or Edge.');
          setStreamLoading(false);
          return false;
        }
        
        console.log('Capturing video stream');
        let stream;
        
        try {
          if (hostVideoRef.current.captureStream) {
            stream = hostVideoRef.current.captureStream();
            console.log('Used standard captureStream');
          } 
          else if (hostVideoRef.current.mozCaptureStream) {
            stream = hostVideoRef.current.mozCaptureStream();
            console.log('Used Mozilla captureStream');
          }
          
          if (!stream) {
            throw new Error('Failed to capture stream from video');
          }
          
          if (stream.getAudioTracks().length === 0) {
            const silentAudioTrack = createSilentAudioTrack();
            if (silentAudioTrack) {
              stream.addTrack(silentAudioTrack);
              console.log('Added silent audio track to video stream');
            }
          }
          
          if (stream.getVideoTracks().length === 0) {
            console.warn('No video tracks in captured stream, trying canvas fallback');
            
            const canvas = document.createElement('canvas');
            canvas.width = hostVideoRef.current.videoWidth || 640;
            canvas.height = hostVideoRef.current.videoHeight || 360;
            
            const ctx = canvas.getContext('2d');
            
            const drawFrame = () => {
              if (hostVideoRef.current && !hostVideoRef.current.paused && !hostVideoRef.current.ended) {
                ctx.drawImage(hostVideoRef.current, 0, 0, canvas.width, canvas.height);
                requestAnimationFrame(drawFrame);
              }
            };
            
            drawFrame();
            
            const canvasStream = canvas.captureStream(30);
            
            if (stream.getAudioTracks().length > 0) {
              stream.getAudioTracks().forEach(track => {
                canvasStream.addTrack(track);
              });
            }
            
            stream = canvasStream;
            console.log('Using canvas-based stream fallback');
          }
        } catch (streamError) {
          console.error('Error capturing stream:', streamError);
          setStreamError(`Failed to capture video stream: ${streamError.message}`);
          setStreamLoading(false);
          return false;
        }
        
        console.log('Stream tracks:', stream.getTracks().map(track => ({
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        })));
        
        localStreamRef.current = stream;
        
        keepAliveStreamRef.current = createKeepAliveStream();
        
        console.log('Calling all viewers');
        
        const peersToCall = [];
        
        users.forEach(user => {
          if (!user.isHost && peerIdMap[user.id]) {
            console.log(`Found viewer to call: ${peerIdMap[user.id]}`);
            peersToCall.push(peerIdMap[user.id]);
          }
        });
        
        console.log(`Found ${peersToCall.length} viewers to call`);
        
        for (const viewerId of peersToCall) {
          callPeer(viewerId).catch(err => {
            console.error(`Failed to call viewer ${viewerId}:`, err);
          });
        }
        
        if (peersToCall.length === 0) {
          console.warn('No viewers found to call. Ensure they are connected first.');
          addSystemMessage('No viewers found. Ask viewers to refresh and reconnect.');
        }
      } else {
        throw new Error('Video element not found');
      }
      
      setIsStreaming(true);
      setStreamLoading(false);
      
      socketRef.current.emit('streaming-status-update', {
        roomId,
        streaming: true,
        fileName,
        fileType: localStorage.getItem('hostFileType')
      });
      
      const progressInterval = setInterval(() => {
        if (hostVideoRef.current && hostVideoRef.current.duration) {
          const percentage = Math.round((hostVideoRef.current.currentTime / hostVideoRef.current.duration) * 100);
          setBufferPercentage(percentage);
          
          if (isHost && lastSyncStateRef.current) {
            const now = Date.now();
            if (!lastSyncStateRef.current.lastBroadcast || now - lastSyncStateRef.current.lastBroadcast > 30000) {
              lastSyncStateRef.current = {
                currentTime: hostVideoRef.current.currentTime,
                isPlaying: !hostVideoRef.current.paused,
                timestamp: now,
                lastBroadcast: now
              };
              
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
    
    if (window.progressIntervalId) {
      clearInterval(window.progressIntervalId);
      window.progressIntervalId = null;
    }
    
    if (keepAliveAnimationRef.current) {
      cancelAnimationFrame(keepAliveAnimationRef.current);
      keepAliveAnimationRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      localStreamRef.current = null;
    }
    
    if (keepAliveStreamRef.current) {
      keepAliveStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      keepAliveStreamRef.current = null;
    }
    
    Object.values(peersRef.current).forEach(call => {
      if (call && typeof call.close === 'function') {
        call.close();
      }
    });
    
    peersRef.current = {};
    setPeerConnections({});
    disconnectedViewersRef.current = {};
    reconnectAttemptsRef.current = {};
    
    if (hostVideoRef.current) {
      hostVideoRef.current.pause();
      hostVideoRef.current.src = '';
      hostVideoRef.current.load();
    }
    
    setIsStreaming(false);
    setIsSeekInProgress(false);
    setIsReconnecting(false);
    
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
    console.log('=== WebRTC Debug Info ===');
    console.log('Current peer:', peerRef.current ? 'Connected' : 'Not connected');
    console.log('Peer ID:', peerRef.current ? peerRef.current.id : 'None');
    console.log('Peer connections:', Object.keys(peersRef.current).length);
    console.log('Local stream:', localStreamRef.current ? 'Active' : 'Not active');
    console.log('Keep-alive stream:', keepAliveStreamRef.current ? 'Available' : 'Not available');
    
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks();
      console.log('Stream tracks:', tracks.length);
      tracks.forEach((track, i) => {
        console.log(`Track ${i}:`, track.kind, track.readyState, track.enabled);
      });
    }
    
    console.log('Connection health:', peerConnectionHealthRef.current);
    
    return {
      peerConnected: !!peerRef.current,
      peerId: peerRef.current ? peerRef.current.id : 'None',
      connectionCount: Object.keys(peersRef.current).length,
      streamActive: !!localStreamRef.current,
      trackCount: localStreamRef.current ? localStreamRef.current.getTracks().length : 0,
      keepAliveAvailable: !!keepAliveStreamRef.current,
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