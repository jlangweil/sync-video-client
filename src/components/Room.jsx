import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import axios from 'axios';
import './Room.css';

// Get the server URL dynamically based on the current browser location
const getServerUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  // Check if we're in local development or production
  const isLocalhost = hostname === 'localhost' || hostname === 'https://sync-video-app.onrender.com';
  
  // Only add port for localhost; in production the hostname already includes everything needed
  const port = isLocalhost ? ':10000' : '';
  
  return `${protocol}//${hostname}${port}`;
};

// Use this server URL for both API calls and Socket.io connections
const SERVER_URL = getServerUrl();

function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  const [videoUrl, setVideoUrl] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [username, setUsername] = useState('');
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [copySuccess, setCopySuccess] = useState('');
  const [videoFit, setVideoFit] = useState('contain'); // 'contain' or 'cover'
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingViewers, setPendingViewers] = useState([]);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState('');
  const [hostCanWatch, setHostCanWatch] = useState(false);
  
  // WebRTC state
  const [peerConnections, setPeerConnections] = useState({});
  const peersRef = useRef({});
  const localStreamRef = useRef(null);
  const hostVideoRef = useRef(null);
  const viewerVideoRef = useRef(null);
  const fileUrlRef = useRef(null);
  
  // Flag to prevent event loop when receiving remote updates
  const [processingRemoteUpdate, setProcessingRemoteUpdate] = useState(false);
  
  const socketRef = useRef(null);
  const chatContainerRef = useRef(null);
  
  // Use a ref to track last sent state to avoid unnecessary rerenders
  const lastSentState = useRef(null);
  
  // Handle sync status
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  const toggleTheaterMode = () => {
    setIsTheaterMode(!isTheaterMode);
    // Focus back on the video element after toggling
    setTimeout(() => {
      if (hostVideoRef.current) {
        hostVideoRef.current.focus();
      } else if (viewerVideoRef.current) {
        viewerVideoRef.current.focus();
      }
    }, 100);
  };
  
  // Initialize socket and room
  useEffect(() => {
    // Get data from localStorage
    const storedUsername = localStorage.getItem('username');
    const storedIsHost = localStorage.getItem('isHost') === 'true';
    const storedFileUrl = sessionStorage.getItem('hostFileUrl');
    
    if (!storedUsername) {
      navigate('/');
      return;
    }
    
    setUsername(storedUsername);
    setIsHost(storedIsHost);
    
    if (storedIsHost && storedFileUrl) {
      fileUrlRef.current = storedFileUrl;
      setVideoUrl(`local:${localStorage.getItem('hostFileName')}`);
    }
    
    // Initialize socket with dynamic server URL
    console.log('Connecting to socket server at:', SERVER_URL);
    socketRef.current = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });
    
    // Add connection logging
    socketRef.current.on('connect', () => {
      console.log('Connected to server with socket ID:', socketRef.current.id);
      
      // Join room after successful connection
      socketRef.current.emit('joinRoom', {
        roomId,
        username: storedUsername,
        isHost: storedIsHost
      });
    });
    
    socketRef.current.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });
    
    // Handle user joined
    socketRef.current.on('userJoined', (data) => {
      console.log('User joined event:', data);
      setUsers(data.users);
      
      // Add system message
      if (data.user.id !== socketRef.current.id) {
        addSystemMessage(`${data.user.username} has joined the room`);
        
        // If we're the host and streaming, add this user to pending viewers
        if (storedIsHost && isStreaming) {
          setPendingViewers(prev => [...prev, data.user.id]);
        }
      }
    });
    
    // Handle user left
    socketRef.current.on('userLeft', (data) => {
      setUsers(data.users);
      addSystemMessage(`${data.username} has left the room`);
      
      // Clean up peer connection if exists
      if (peersRef.current[data.userId]) {
        try {
          peersRef.current[data.userId].destroy();
          delete peersRef.current[data.userId];
          setPeerConnections(prev => {
            const newPeers = {...prev};
            delete newPeers[data.userId];
            return newPeers;
          });
        } catch (err) {
          console.error('Error cleaning up peer connection:', err);
        }
      }
    });
    
    // Handle system messages
    socketRef.current.on('systemMessage', (data) => {
      addSystemMessage(data.text);
    });
    
    // Handle new messages
    socketRef.current.on('newMessage', (message) => {
      setMessages(prevMessages => [...prevMessages, message]);
    });
    
    // Handle streaming status updates
    socketRef.current.on('streaming-status', (data) => {
      if (!isHost) {
        if (data.isStreaming) {
          setVideoUrl(`streaming:${data.fileName}`);
          addSystemMessage(`Host is streaming: ${data.fileName}`);
        } else {
          setVideoUrl('');
          addSystemMessage('Host has stopped streaming');
        }
      }
    });
    
    return () => {
      // Stop all tracks in the local stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
      }
      
      // Destroy all peer connections
      Object.values(peersRef.current).forEach(peer => {
        if (peer && peer.destroy) {
          try {
            peer.destroy();
          } catch (err) {
            console.error('Error destroying peer:', err);
          }
        }
      });
      
      // Disconnect socket
      socketRef.current.disconnect();
    };
  }, [roomId, navigate]);
  
  // Set up WebRTC for host
  useEffect(() => {
    if (!socketRef.current || !isHost) return;
    
    // Handle stream requests from viewers
    socketRef.current.on('stream-requested', async ({ from, roomId }) => {
      console.log(`Stream requested by viewer ${from}`);
      
      try {
        // Create a new peer connection for this viewer
        await createPeerConnection(from, true);
      } catch (err) {
        console.error('Error creating peer connection:', err);
      }
    });
    
    // Handle WebRTC signals from peers
    socketRef.current.on('webrtc-signal', async ({ from, signal }) => {
      console.log(`Received WebRTC signal from ${from}`);
      
      // If we already have a peer for this user, pass the signal
      if (peersRef.current[from]) {
        try {
          peersRef.current[from].signal(signal);
        } catch (err) {
          console.error('Error processing signal:', err);
        }
      } else if (isHost) {
        // If we don't have a peer yet, create one (as host)
        try {
          await createPeerConnection(from, true);
          // After creating, try signaling again
          setTimeout(() => {
            if (peersRef.current[from]) {
              peersRef.current[from].signal(signal);
            }
          }, 1000);
        } catch (err) {
          console.error('Error creating peer on signal:', err);
        }
      }
    });
    
    return () => {
      // Clean up listeners
      socketRef.current.off('stream-requested');
      socketRef.current.off('webrtc-signal');
    };
  }, [socketRef.current, isHost, roomId, isStreaming]);
  
  // Set up WebRTC for viewers
  useEffect(() => {
    if (!socketRef.current || isHost) return;
    
    // Handle WebRTC signals as viewer
    socketRef.current.on('webrtc-signal', ({ from, signal }) => {
      console.log(`Viewer received WebRTC signal from host: ${from}`);
      
      // If we don't have a peer yet, create one (as viewer)
      if (!peersRef.current[from]) {
        const peer = new Peer({
          initiator: false,
          trickle: true,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });
        
        peer.on('signal', (data) => {
          console.log('Viewer sending signal back to host');
          socketRef.current.emit('webrtc-signal', {
            roomId,
            signal: data,
            to: from
          });
        });
        
        peer.on('stream', (stream) => {
          console.log('Viewer received stream from host!');
          
          // Connect the stream to the video element
          if (viewerVideoRef.current) {
            viewerVideoRef.current.srcObject = stream;
            viewerVideoRef.current.play().catch(err => console.error('Error playing stream:', err));
          }
        });
        
        peer.on('error', (err) => {
          console.error('Peer connection error:', err);
          addSystemMessage('Connection error. Try refreshing the page.');
        });
        
        peer.on('close', () => {
          console.log('Peer connection closed');
          addSystemMessage('Connection to host closed.');
        });
        
        // Store the peer connection
        peersRef.current[from] = peer;
        setPeerConnections(prev => ({ ...prev, [from]: peer }));
      }
      
      // Pass the signal to the peer
      try {
        peersRef.current[from].signal(signal);
      } catch (err) {
        console.error('Error processing signal as viewer:', err);
      }
    });
    
    // If the video URL indicates streaming, request the stream
    if (videoUrl && videoUrl.startsWith('streaming:')) {
      // Request stream after a short delay to ensure socket connection is ready
      const requestTimeout = setTimeout(() => {
        console.log('Viewer requesting stream from host');
        socketRef.current.emit('request-stream', { roomId });
      }, 2000);
      
      return () => {
        clearTimeout(requestTimeout);
      };
    }
    
    return () => {
      socketRef.current.off('webrtc-signal');
    };
  }, [socketRef.current, isHost, roomId, videoUrl]);
  
  // Handle pending viewers when streaming starts
  useEffect(() => {
    if (isHost && isStreaming && pendingViewers.length > 0) {
      // Create peer connections for all pending viewers
      pendingViewers.forEach(async (viewerId) => {
        try {
          await createPeerConnection(viewerId, true);
        } catch (err) {
          console.error(`Error creating peer connection for viewer ${viewerId}:`, err);
        }
      });
      
      setPendingViewers([]);
    }
  }, [isHost, isStreaming, pendingViewers]);
  
  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);
  
  // Function to create a peer connection
  const createPeerConnection = async (userId, initiator = false) => {
    // Don't create duplicate connections
    if (peersRef.current[userId]) {
      console.log(`Peer connection to ${userId} already exists`);
      return peersRef.current[userId];
    }
    
    console.log(`Creating ${initiator ? 'initiator' : 'receiver'} peer connection to ${userId}`);
    
    // Create a new peer connection
    const peer = new Peer({
      initiator,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    
    peer.on('signal', (data) => {
      console.log(`Sending signal to ${userId}`);
      socketRef.current.emit('webrtc-signal', {
        roomId,
        signal: data,
        to: userId
      });
    });
    
    peer.on('error', (err) => {
      console.error('Peer connection error:', err);
      addSystemMessage(`Connection error with ${users.find(u => u.id === userId)?.username || 'a user'}`);
    });
    
    peer.on('close', () => {
      console.log(`Peer connection to ${userId} closed`);
    });
    
    // For host: add the stream to the peer connection
    if (isHost && localStreamRef.current) {
      peer.addStream(localStreamRef.current);
    }
    
    // Store the peer connection
    peersRef.current[userId] = peer;
    setPeerConnections(prev => ({ ...prev, [userId]: peer }));
    
    return peer;
  };
  
// Add this to your state variables at the top of Room component
const streamVideoRef = useRef(null); // Separate video element for streaming

// Replace your startStreaming function with this version
const startStreaming = async () => {
  if (!fileUrlRef.current) {
    setStreamError('No file selected');
    return;
  }
  
  setStreamLoading(true);
  setStreamError('');
  
  try {
    const fileName = localStorage.getItem('hostFileName');
    console.log('Starting to stream file:', fileName);
    
    // Create a hidden video element for streaming
    const streamVideo = document.createElement('video');
    streamVideo.src = fileUrlRef.current;
    streamVideo.muted = true; // Mute this hidden element
    
    // Wait for the hidden video to be ready
    await new Promise((resolve, reject) => {
      streamVideo.onloadedmetadata = () => resolve();
      streamVideo.onerror = (e) => reject(new Error('Error loading video file'));
      streamVideo.load();
      
      // Set a timeout in case loading takes too long
      setTimeout(() => reject(new Error('Timeout loading video')), 10000);
    });
    
    // Start the hidden video playing
    await streamVideo.play();
    
    // Capture the stream from the hidden video
    const stream = streamVideo.captureStream();
    localStreamRef.current = stream;
    
    // Update streaming status
    setIsStreaming(true);
    setStreamLoading(false);
    
    // Notify server about streaming status
    socketRef.current.emit('streaming-status-update', {
      roomId,
      streaming: true,
      fileName,
      fileType: localStorage.getItem('hostFileType')
    });
    
    // Update the video URL for the host
    setVideoUrl(`streaming:${fileName}`);
    
    // Create peer connections for all non-host users in the room
    const viewerIds = users.filter(user => !user.isHost).map(user => user.id);
    
    for (const viewerId of viewerIds) {
      try {
        const peer = await createPeerConnection(viewerId, true);
        // Add the stream to the peer
        if (localStreamRef.current && peer.addStream) {
          peer.addStream(localStreamRef.current);
        }
      } catch (err) {
        console.error(`Error creating peer connection for viewer ${viewerId}:`, err);
      }
    }
    
    // Create a local viewer for the host
    setTimeout(() => {
      if (hostVideoRef.current) {
        // Set the source of the host video to the original file
        hostVideoRef.current.src = fileUrlRef.current;
        hostVideoRef.current.muted = false;
        hostVideoRef.current.load();
        hostVideoRef.current.play().catch(err => {
          console.error('Auto-play failed for host:', err);
        });
        setHostCanWatch(true);
      }
    }, 1000);
    
    addSystemMessage('Started streaming. Viewers can now watch.');
    
    // Setup sync loop to match the host video with streaming video
    const syncInterval = setInterval(() => {
      if (streamVideo && hostVideoRef.current && !processingRemoteUpdate) {
        // Sync the hidden streaming video with the host video
        if (Math.abs(streamVideo.currentTime - hostVideoRef.current.currentTime) > 1) {
          streamVideo.currentTime = hostVideoRef.current.currentTime;
        }
        
        if (hostVideoRef.current.paused && !streamVideo.paused) {
          streamVideo.pause();
          handleVideoStateChange(false, streamVideo.currentTime);
        } else if (!hostVideoRef.current.paused && streamVideo.paused) {
          streamVideo.play();
          handleVideoStateChange(true, streamVideo.currentTime);
        }
      }
    }, 1000);
    
    // Store the interval ID for cleanup
    window.syncIntervalId = syncInterval;
    
    return stream;
  } catch (err) {
    console.error('Error starting stream:', err);
    setStreamError(`Error starting stream: ${err.message}`);
    setStreamLoading(false);
    return null;
  }
};

// Also update your stopStreaming function
const stopStreaming = () => {
  if (!isStreaming) return;
  
  // Clear sync interval
  if (window.syncIntervalId) {
    clearInterval(window.syncIntervalId);
    window.syncIntervalId = null;
  }
  
  // Stop all tracks in the local stream
  if (localStreamRef.current) {
    localStreamRef.current.getTracks().forEach(track => {
      track.stop();
    });
    localStreamRef.current = null;
  }
  
  // Clear the host video element
  if (hostVideoRef.current) {
    hostVideoRef.current.pause();
    hostVideoRef.current.src = '';
    hostVideoRef.current.load();
  }
  
  // Destroy all peer connections
  Object.values(peersRef.current).forEach(peer => {
    if (peer && peer.destroy) {
      try {
        peer.destroy();
      } catch (err) {
        console.error('Error destroying peer:', err);
      }
    }
  });
  
  // Reset peer connections
  peersRef.current = {};
  setPeerConnections({});
  
  // Update state
  setIsStreaming(false);
  setHostCanWatch(false);
  
  // Notify server about streaming status
  socketRef.current.emit('streaming-status-update', {
    roomId,
    streaming: false,
    fileName: null,
    fileType: null
  });
  
  // Update the video URL
  setVideoUrl('');
  
  addSystemMessage('Stopped streaming.');
};
  // Helper to add system messages
  const addSystemMessage = (text) => {
    setMessages(prevMessages => [
      ...prevMessages,
      {
        user: 'System',
        text,
        time: new Date().toLocaleTimeString(),
        isSystem: true
      }
    ]);
  };
  
  // Handle sending messages
  const handleSendMessage = (e) => {
    e.preventDefault();
    
    if (newMessage.trim() && socketRef.current) {
      socketRef.current.emit('sendMessage', {
        roomId,
        message: newMessage,
        username
      });
      
      setNewMessage('');
    }
  };
  
  // Copy room ID to clipboard
  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId)
      .then(() => {
        setCopySuccess('Copied!');
        setTimeout(() => setCopySuccess(''), 2000);
      })
      .catch(err => {
        console.error('Failed to copy:', err);
      });
  };
  
  // Handle video state change (play/pause/seek)
  const handleVideoStateChange = (isPlaying, currentTime) => {
    if (socketRef.current && isHost) {
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying,
          currentTime
        }
      });
    }
  };
  
  // Handle host video playback events
  const handlePlay = () => {
    if (isHost && hostVideoRef.current) {
      handleVideoStateChange(true, hostVideoRef.current.currentTime);
    }
  };
  
  const handlePause = () => {
    if (isHost && hostVideoRef.current) {
      handleVideoStateChange(false, hostVideoRef.current.currentTime);
    }
  };
  
  const handleSeek = () => {
    if (isHost && hostVideoRef.current) {
      handleVideoStateChange(!hostVideoRef.current.paused, hostVideoRef.current.currentTime);
    }
  };
  
  // Handle video state updates from server (for viewers)
  useEffect(() => {
    if (!socketRef.current) return;
    
    socketRef.current.on('videoStateUpdate', (videoState) => {
      console.log('Received video state update:', videoState);
      
      // Set this flag to prevent triggering our own events
      setProcessingRemoteUpdate(true);
      
      // For viewers with WebRTC stream
      if (!isHost && viewerVideoRef.current && viewerVideoRef.current.srcObject) {
        if (videoState.isPlaying && viewerVideoRef.current.paused) {
          viewerVideoRef.current.play()
            .catch(err => console.error('Error playing video:', err));
        } else if (!videoState.isPlaying && !viewerVideoRef.current.paused) {
          viewerVideoRef.current.pause();
        }
        
        // Only update time if it's significantly different
        if (Math.abs(viewerVideoRef.current.currentTime - videoState.currentTime) > 2) {
          viewerVideoRef.current.currentTime = videoState.currentTime;
        }
      }
      
      // For hosts, ignore state updates (they control playback)
      
      setIsSyncing(true);
      setLastSyncTime(new Date());
      
      // Reset sync indicator after 2 seconds
      setTimeout(() => {
        setIsSyncing(false);
      }, 2000);
      
      // Clear the processing flag after a short delay
      setTimeout(() => {
        setProcessingRemoteUpdate(false);
      }, 500);
    });
    
    return () => {
      socketRef.current.off('videoStateUpdate');
    };
  }, [socketRef.current, isHost]);
  
  return (
    <div className={`room-container ${isTheaterMode ? 'theater-container' : ''}`}>
      <div className={`room-info ${isTheaterMode ? 'theater-room-info' : ''}`}>
        <div className="room-id">
          <span>Room ID: {roomId}</span>
          <button onClick={copyRoomId} className="copy-button">
            {copySuccess || 'Copy'}
          </button>
        </div>
        <div className="sync-status">
          {isSyncing && (
            <span className="syncing">
              ⟳ Syncing...
            </span>
          )}
          {!isSyncing && isStreaming && (
            <span className="streaming">
              ↑ Streaming
            </span>
          )}
          {lastSyncTime && !isSyncing && !isStreaming && (
            <span className="synced">
              ✓ Synced
            </span>
          )}
        </div>
      </div>
      
      <div className={`main-content ${isTheaterMode ? 'theater-mode' : ''}`}>
        <div className="video-container">
          {isHost ? (
            // Host view
            <div className="video-wrapper">
              {!isStreaming ? (
                // Show streaming controls before streaming starts
                <div className="streaming-controls">
                  <h3>Stream your selected video</h3>
                  <p className="file-info">
                    File: {localStorage.getItem('hostFileName') || 'No file selected'}
                  </p>
                  
                  <button 
                    onClick={startStreaming} 
                    className="primary-button"
                    disabled={streamLoading || !fileUrlRef.current}
                  >
                    {streamLoading ? 'Starting Stream...' : 'Start Streaming'}
                  </button>
                  
                  {streamError && <p className="error-message">{streamError}</p>}
                  
                  <p className="hint">
                    Click to start streaming the selected file to viewers
                  </p>
                </div>
              ) : (
                // Show video player when streaming
                <>
                  <video
                    ref={hostVideoRef}
                    controls={true}
                    style={{ objectFit: videoFit }}
                    className="host-video"
                    playsInline
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onSeeked={handleSeek}
                    onTimeUpdate={() => {
                      // Optionally send periodic time updates
                      if (socketRef.current && !processingRemoteUpdate) {
                        // Throttle updates to avoid overloading (every 2 seconds)
                        const now = Date.now();
                        if (!lastSentState.current || 
                            now - lastSentState.current.timestamp > 2000) {
                          socketRef.current.emit('videoStateChange', {
                            roomId,
                            videoState: {
                              isPlaying: !hostVideoRef.current.paused,
                              currentTime: hostVideoRef.current.currentTime
                            }
                          });
                          
                          lastSentState.current = {
                            timestamp: now,
                            isPlaying: !hostVideoRef.current.paused,
                            currentTime: hostVideoRef.current.currentTime
                          };
                        }
                      }
                    }}
                  />
                  
                  <div className="host-controls">
                    <div className="connection-info">
                      <p className="streaming-status">
                        Streaming to {Object.keys(peerConnections).length} viewer(s)
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
                </>
              )}
            </div>
          ) : (
            // Viewer view
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
                  <div className="viewer-controls">
                    <button onClick={toggleTheaterMode} className="control-button theater-button">
                      {isTheaterMode ? 'Exit Theater' : 'Theater Mode'}
                    </button>
                    <button 
                      className="control-button fullscreen-button" 
                      onClick={() => {
                        if (viewerVideoRef.current && viewerVideoRef.current.requestFullscreen) {
                          viewerVideoRef.current.requestFullscreen();
                        }
                      }}
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
          )}
        </div>
        
        <div className="sidebar">
          <div className="users-panel">
            <h3>Users ({users.length})</h3>
            <ul>
              {users.map(user => (
                <li key={user.id}>
                  {user.username} {user.id === socketRef.current?.id && '(You)'}
                  {(isHost && user.id === socketRef.current?.id) || 
                   (user.isHost && user.id !== socketRef.current?.id) ? ' (Host)' : ''}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="chat-panel">
            <h3>Chat</h3>
            <div className="chat-messages" ref={chatContainerRef}>
              {messages.map((msg, index) => (
                <div 
                  key={index} 
                  className={`message ${msg.isSystem ? 'system-message' : ''}`}
                >
                  <span className="message-user">{msg.user}:</span>
                  <span className="message-text">{msg.text}</span>
                  <span className="message-time">{msg.time}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendMessage} className="chat-input">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
              />
              <button type="submit">Send</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Room;