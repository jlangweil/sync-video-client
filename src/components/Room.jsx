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
  
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const chatContainerRef = useRef(null);
  
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
        username: storedUsername
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
          }, 1000);
        }
      }
    });
    
    // Handle user left
    socketRef.current.on('userLeft', (data) => {
      setUsers(data.users);
      addSystemMessage(`${data.username} has left the room`);
    });
    
    // Handle video state updates from server
    socketRef.current.on('videoStateUpdate', (videoState) => {
      if (videoRef.current) {
        console.log('Received video state update:', videoState);
        
        // Set video time
        if (Math.abs(videoRef.current.currentTime - videoState.currentTime) > 0.5) {
          videoRef.current.currentTime = videoState.currentTime;
        }
        
        // Set play/pause state
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
  
  // Video event handlers
  const handlePlay = () => {
    if (socketRef.current) {
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
    if (socketRef.current) {
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
    if (socketRef.current) {
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
    if (socketRef.current && videoUrl) {
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
            <>
              <video
                ref={videoRef}
                src={getAbsoluteVideoUrl(videoUrl)}
                controls
                onPlay={handlePlay}
                onPause={handlePause}
                onSeeked={handleSeek}
              />
              {isHost && (
                <div className="host-controls">
                  <button onClick={handleShareVideo} className="share-button">
                    Re-share Video with Room
                  </button>
                </div>
              )}
            </>
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
                  {isHost && user.id === socketRef.current?.id && ' (Host)'}
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