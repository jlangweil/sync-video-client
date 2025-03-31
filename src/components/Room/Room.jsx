import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import RoomHeader from './RoomHeader';
import HostVideo from './VideoPlayer/HostVideo';
import ViewerVideo from './VideoPlayer/ViewerVideo';
import UserList from './Sidebar/UserList';
import ChatPanel from './Sidebar/ChatPanel';
import { WebRTCProvider } from './WebRTC/WebRTCProvider';
import './Room.css';

// Get the server URL dynamically based on the current browser location
const getServerUrl = () => {
  const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1';
  
  if (isLocalhost) {
    return `${window.location.protocol}//${window.location.hostname}:10000`;
  } else {
    // In production, this should be your backend Render URL
    return 'https://sync-video-app.onrender.com';
  }
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  
  // Processing flag for playback events
  const [processingRemoteUpdate, setProcessingRemoteUpdate] = useState(false);
  
  // Socket reference
  const socketRef = useRef(null);
  
  // Chat container reference for auto-scrolling
  const chatContainerRef = useRef(null);
  
  // Use a ref to track last sent state to avoid unnecessary rerenders
  const lastSentState = useRef(null);

  // Toggle theater mode
  const toggleTheaterMode = () => {
    setIsTheaterMode(!isTheaterMode);
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
      setVideoUrl(`local:${localStorage.getItem('hostFileName')}`);
    }
    
    // Initialize socket with dynamic server URL
    console.log('Connecting to socket server at:', SERVER_URL);
    socketRef.current = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 60000,
      secure: window.location.protocol === 'https:',
      path: '/socket.io/'
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
      addSystemMessage('Error connecting to server. Please refresh the page.');
    });
    
    socketRef.current.on('reconnect', () => {
      console.log('Socket reconnected');
      addSystemMessage('Connection to server restored');
      
      // Re-join room after reconnection
      socketRef.current.emit('joinRoom', {
        roomId,
        username: storedUsername,
        isHost: storedIsHost
      });
    });
    
    // Handle user joined
    socketRef.current.on('userJoined', (data) => {
      console.log('User joined event:', data);
      setUsers(data.users);
      
      // Add system message
      if (data.user.id !== socketRef.current.id) {
        addSystemMessage(`${data.user.username} has joined the room`);
      }
    });
    
    // Handle user left
    socketRef.current.on('userLeft', (data) => {
      setUsers(data.users);
      addSystemMessage(`${data.username} has left the room`);
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
    
    // Cleanup function
    return () => {
      socketRef.current.disconnect();
    };
  }, [roomId, navigate]);
  
  // Handle video state updates from server
  useEffect(() => {
    if (!socketRef.current) return;
    
    socketRef.current.on('videoStateUpdate', (videoState) => {
      console.log('Received video state update:', videoState);
      
      // Set this flag to prevent triggering our own events
      setProcessingRemoteUpdate(true);
      
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
  }, [socketRef.current]);
  
  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);
  
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

  return (
    <WebRTCProvider
      socketRef={socketRef}
      roomId={roomId}
      isHost={isHost}
      users={users}
      addSystemMessage={addSystemMessage}
    >
      <div className={`room-container ${isTheaterMode ? 'theater-container' : ''}`}>
        <RoomHeader 
          roomId={roomId}
          copyRoomId={copyRoomId}
          copySuccess={copySuccess}
          isSyncing={isSyncing}
          isHost={isHost}
          isTheaterMode={isTheaterMode}
        />
        
        <div className={`main-content ${isTheaterMode ? 'theater-mode' : ''}`}>
          <div className="video-container">
            {isHost ? (
              <HostVideo 
                videoUrl={videoUrl}
                videoFit={videoFit}
                isTheaterMode={isTheaterMode}
                toggleTheaterMode={toggleTheaterMode}
                handleVideoStateChange={handleVideoStateChange}
                processingRemoteUpdate={processingRemoteUpdate}
              />
            ) : (
              <ViewerVideo 
                videoUrl={videoUrl}
                videoFit={videoFit}
                isTheaterMode={isTheaterMode}
                toggleTheaterMode={toggleTheaterMode}
              />
            )}
          </div>
          
          <div className="sidebar">
            <UserList users={users} currentUserId={socketRef.current?.id} />
            
            <ChatPanel
              messages={messages}
              newMessage={newMessage}
              setNewMessage={setNewMessage}
              handleSendMessage={handleSendMessage}
              chatContainerRef={chatContainerRef}
            />
          </div>
        </div>
      </div>
    </WebRTCProvider>
  );
}

export default Room;