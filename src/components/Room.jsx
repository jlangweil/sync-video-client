import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import './Room.css';

// Get the server URL dynamically based on the current browser location
const getServerUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = 3000; // Your server port
  
  return `${protocol}//${hostname}:${port}`;
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
  
  // Flag to prevent event loop when receiving remote updates
  const [processingRemoteUpdate, setProcessingRemoteUpdate] = useState(false);
  
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const chatContainerRef = useRef(null);
  
  // Use a ref to track last sent state to avoid unnecessary rerenders
  const lastSentState = useRef(null);
  
  // Handle sync status
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  
  // Function to get absolute URL for video
  const getAbsoluteVideoUrl = (url) => {
    if (!url) return '';
    
    // If it's already an absolute URL, return it
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Make sure it starts with a slash
    if (!url.startsWith('/')) {
      url = '/' + url;
    }
    
    // Convert to absolute URL using the dynamic server URL
    return `${SERVER_URL}${url}`;
  };
  
  // Initialize socket and room
  useEffect(() => {
    // Get data from localStorage
    const storedUsername = localStorage.getItem('username');
    const storedVideoUrl = localStorage.getItem('videoUrl');
    const storedIsHost = localStorage.getItem('isHost') === 'true';
    
    if (!storedUsername) {
      navigate('/');
      return;
    }
    
    setUsername(storedUsername);
    setIsHost(storedIsHost);
    
    if (storedVideoUrl) {
      console.log('Retrieved stored video URL:', storedVideoUrl);
      setVideoUrl(storedVideoUrl);
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
      
      // If this user is the host and has a video URL, share it with the room after a delay
      if (storedIsHost && storedVideoUrl) {
        console.log('Host is sharing video URL:', storedVideoUrl);
        setTimeout(() => {
          console.log('Emitting shareVideo event');
          socketRef.current.emit('shareVideo', {
            roomId,
            videoUrl: storedVideoUrl
          });
        }, 2000); // Delay to ensure room is joined first
      }
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
        
        // If we're the host and have a video, re-share it when a new user joins
        if (storedIsHost && videoUrl) {
          console.log('Re-sharing video URL after new user joined:', videoUrl);
          setTimeout(() => {
            socketRef.current.emit('shareVideo', {
              roomId,
              videoUrl
            });
            
            // Also send current playback state
            if (videoRef.current) {
              socketRef.current.emit('videoStateChange', {
                roomId,
                videoState: {
                  isPlaying: !videoRef.current.paused,
                  currentTime: videoRef.current.currentTime
                }
              });
            }
          }, 1000);
        }
      }
    });
    
    // Handle user left
    socketRef.current.on('userLeft', (data) => {
      setUsers(data.users);
      addSystemMessage(`${data.username} has left the room`);
    });
    
    // Handle system messages
    socketRef.current.on('systemMessage', (data) => {
      addSystemMessage(data.text);
    });
    
    // Handle video state updates from server
    socketRef.current.on('videoStateUpdate', (videoState) => {
      if (videoRef.current) {
        console.log('Received video state update:', videoState);
        
        // Set this flag to prevent triggering our own events while updating
        setProcessingRemoteUpdate(true);
        
        // For non-hosts, always follow the host's state
        // For hosts, only apply if it wasn't our own update
        const shouldUpdateTime = !isHost || 
          Math.abs(videoRef.current.currentTime - videoState.currentTime) > 2.0;
        
        if (shouldUpdateTime) {
          videoRef.current.currentTime = videoState.currentTime;
        }
        
        // Set play/pause state (for both host and viewers)
        if (videoState.isPlaying && videoRef.current.paused) {
          videoRef.current.play()
            .catch(err => console.error('Error playing video:', err));
        } else if (!videoState.isPlaying && !videoRef.current.paused) {
          videoRef.current.pause();
        }
        
        setIsSyncing(true);
        setLastSyncTime(new Date());
        
        // Reset sync indicator after 2 seconds
        setTimeout(() => {
          setIsSyncing(false);
        }, 2000);
        
        // Clear the processing flag after a short delay
        // This prevents event handlers from firing during the update
        setTimeout(() => {
          setProcessingRemoteUpdate(false);
        }, 500);
      } else {
        console.log('Received video state update but video element not ready');
      }
    });
    
    // Handle new messages
    socketRef.current.on('newMessage', (message) => {
      setMessages(prevMessages => [...prevMessages, message]);
    });
    
    // Handle video URL updates from other users (mainly the host)
    socketRef.current.on('videoUrlUpdate', ({ videoUrl }) => {
      console.log('Received video URL update:', videoUrl);
      if (videoUrl) {
        setVideoUrl(videoUrl);
        addSystemMessage('Video has been shared by the host');
      }
    });
    
    return () => {
      socketRef.current.disconnect();
    };
  }, [roomId, navigate]);
  
  // Add event listeners to intercept unwanted control attempts for viewers
  useEffect(() => {
    if (!isHost && videoRef.current) {
      // Function to intercept and prevent playback control
      const preventPlaybackControl = (e) => {
        // Allow these events to propagate to enable fullscreen and other features
        const allowedEvents = ['mousemove', 'mouseenter', 'mouseleave', 'mouseover'];
        
        // Check if it's a click that could trigger play/pause
        if (e.type === 'click') {
          // Get click position relative to video element
          const rect = videoRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          
          // Determine if click is in the center play/pause area (rough estimation)
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const clickRadius = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
          
          // If click is in the center area or bottom controls area, prevent it
          const isInPlayPauseArea = clickRadius < rect.width / 6; // Circle in the middle
          const isInControlsArea = y > rect.height - 40; // Bottom controls area
          
          if (isInPlayPauseArea || isInControlsArea) {
            e.preventDefault();
            e.stopPropagation();
            
            // Show message to user
            setIsSyncing(true);
            setTimeout(() => {
              setIsSyncing(false);
            }, 1000);
            
            return false;
          }
        }
        
        // Always allow these events
        if (allowedEvents.includes(e.type)) {
          return true;
        }
        
        // For other events related to playback control, check more carefully
        if (['play', 'pause', 'seeking', 'timeupdate'].includes(e.type)) {
          if (!processingRemoteUpdate) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
        }
        
        return true;
      };
      
      // Add our custom event listeners
      videoRef.current.addEventListener('click', preventPlaybackControl, true);
      videoRef.current.addEventListener('play', preventPlaybackControl, true);
      videoRef.current.addEventListener('pause', preventPlaybackControl, true);
      videoRef.current.addEventListener('seeking', preventPlaybackControl, true);
      
      return () => {
        // Clean up event listeners when component unmounts
        if (videoRef.current) {
          videoRef.current.removeEventListener('click', preventPlaybackControl, true);
          videoRef.current.removeEventListener('play', preventPlaybackControl, true);
          videoRef.current.removeEventListener('pause', preventPlaybackControl, true);
          videoRef.current.removeEventListener('seeking', preventPlaybackControl, true);
        }
      };
    }
  }, [isHost, processingRemoteUpdate]);
  
  // Periodic sync for host - less frequent and with throttling
  useEffect(() => {
    const handleVideoStateSync = () => {
      if (!videoRef.current || !socketRef.current || !isHost || processingRemoteUpdate) return;
      
      const currentState = {
        isPlaying: !videoRef.current.paused,
        currentTime: videoRef.current.currentTime
      };
      
      // Only send updates if the state has changed significantly
      if (lastSentState.current === null || 
          lastSentState.current.isPlaying !== currentState.isPlaying ||
          Math.abs(lastSentState.current.currentTime - currentState.currentTime) > 5) {
        
        console.log('Sending periodic sync update:', currentState);
        socketRef.current.emit('videoStateChange', {
          roomId,
          videoState: currentState
        });
        
        // Update the last sent state
        lastSentState.current = currentState;
      }
    };
    
    // Set up periodic sync for the host (every 10 seconds instead of 5)
    let syncInterval;
    if (isHost && videoRef.current) {
      syncInterval = setInterval(handleVideoStateSync, 10000);
    }
    
    return () => {
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [isHost, roomId, processingRemoteUpdate]);
  
  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);
  
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
  
  // Video event handlers - only for host and only when not processing remote updates
  const handlePlay = () => {
    if (socketRef.current && isHost && !processingRemoteUpdate) {
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying: true,
          currentTime: videoRef.current.currentTime
        }
      });
    }
  };
  
  const handlePause = () => {
    if (socketRef.current && isHost && !processingRemoteUpdate) {
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying: false,
          currentTime: videoRef.current.currentTime
        }
      });
    }
  };
  
  const handleSeek = () => {
    if (socketRef.current && isHost && !processingRemoteUpdate) {
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying: !videoRef.current.paused,
          currentTime: videoRef.current.currentTime
        }
      });
    }
  };
  
  // Explicitly share video with all users
  const handleShareVideo = () => {
    if (socketRef.current && videoUrl && isHost) {
      console.log('Manually sharing video with room:', videoUrl);
      socketRef.current.emit('shareVideo', {
        roomId,
        videoUrl
      });
      addSystemMessage('You shared the video with everyone in the room');
    }
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

  return (
    <div className="room-container">
      <div className="room-info">
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
          {lastSyncTime && !isSyncing && (
            <span className="synced">
              ✓ Synced
            </span>
          )}
        </div>
      </div>
      
      <div className="main-content">
        <div className="video-container">
          {videoUrl ? (
            <div className="video-wrapper">
              <video
                ref={videoRef}
                src={getAbsoluteVideoUrl(videoUrl)}
                controls={isHost}
                style={{ objectFit: videoFit }}
                onPlay={isHost ? handlePlay : null}
                onPause={isHost ? handlePause : null}
                onSeeked={isHost ? handleSeek : null}
                className={!isHost ? "viewer-video" : ""}
              />
              {!isHost && (
                <>
                  <div className="viewer-controls">
                    <button className="control-button" onClick={() => {
                      setVideoFit(videoFit === 'contain' ? 'cover' : 'contain');
                    }}>
                      {videoFit === 'contain' ? 'Fill Screen' : 'Fit Screen'}
                    </button>
                    <button className="control-button fullscreen-button" onClick={() => {
                      if (videoRef.current.requestFullscreen) {
                        videoRef.current.requestFullscreen();
                      } else if (videoRef.current.webkitRequestFullscreen) {
                        videoRef.current.webkitRequestFullscreen();
                      } else if (videoRef.current.msRequestFullscreen) {
                        videoRef.current.msRequestFullscreen();
                      }
                    }}>
                      Fullscreen
                    </button>
                  </div>
                  <div className="viewer-message">
                    <p>Only the host can control playback</p>
                  </div>
                </>
              )}
              {isHost && (
                <div className="host-controls">
                  <button onClick={handleShareVideo} className="share-button">
                    Re-share Video with Room
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="waiting-for-video">
              <p>Waiting for host to share a video...</p>
              <p className="small">Server URL: {SERVER_URL}</p>
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