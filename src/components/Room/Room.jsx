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
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  // New state for resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  
  // Processing flag for playback events
  const [processingRemoteUpdate, setProcessingRemoteUpdate] = useState(false);
  
  // Socket reference
  const socketRef = useRef(null);
  
  // Chat container reference for auto-scrolling
  const chatContainerRef = useRef(null);
  
  // Use a ref to track last sent state to avoid unnecessary rerenders
  const lastSentState = useRef(null);
  
  // Ref to track last reported playback time for seek detection
  const lastReportedTime = useRef(null);
  
  // Ref to store starting mouse position and sidebar width for resize
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Toggle theater mode with fullscreen
  const toggleTheaterMode = () => {
    const newTheaterMode = !isTheaterMode;
    setIsTheaterMode(newTheaterMode);
    
    // If entering theater mode, request fullscreen
    if (newTheaterMode) {
      const roomContainer = document.querySelector('.room-container');
      if (roomContainer) {
        // Request fullscreen using the appropriate method for the browser
        if (roomContainer.requestFullscreen) {
          roomContainer.requestFullscreen().catch(err => {
            console.error('Error attempting to enable fullscreen:', err);
          });
        } else if (roomContainer.mozRequestFullScreen) { // Firefox
          roomContainer.mozRequestFullScreen();
        } else if (roomContainer.webkitRequestFullscreen) { // Chrome, Safari
          roomContainer.webkitRequestFullscreen();
        } else if (roomContainer.msRequestFullscreen) { // IE/Edge
          roomContainer.msRequestFullscreen();
        }
      }
    } else {
      // If exiting theater mode, exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => {
          console.error('Error attempting to exit fullscreen:', err);
        });
      } else if (document.mozCancelFullScreen) { // Firefox
        document.mozCancelFullScreen();
      } else if (document.webkitExitFullscreen) { // Chrome, Safari
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) { // IE/Edge
        document.msExitFullscreen();
      }
    }
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
  
  // Basic resize functions
  const handleMouseDown = (e) => {
    console.log('MouseDown - starting resize');
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    setIsResizing(true);
    e.preventDefault();
  };
  
  const handleMouseMove = (e) => {
    if (!isResizing) return;
    
    const deltaX = startXRef.current - e.clientX;
    const newWidth = Math.max(200, Math.min(800, startWidthRef.current + deltaX));
    
    setSidebarWidth(newWidth);
  };
  
  const handleMouseUp = () => {
    console.log('MouseUp - stopping resize');
    setIsResizing(false);
    // Save to localStorage
    localStorage.setItem('sidebarWidth', sidebarWidth.toString());
  };
  
  // Get sidebar width from localStorage on initial load
  useEffect(() => {
    const storedWidth = localStorage.getItem('sidebarWidth');
    if (storedWidth) {
      setSidebarWidth(parseInt(storedWidth, 10));
    }
  }, []);
  
  // Handle fullscreen changes (like when user presses Escape)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement || 
                          document.webkitFullscreenElement || 
                          document.mozFullScreenElement || 
                          document.msFullscreenElement;
      
      // If fullscreen was exited but theater mode is still on, turn it off
      if (!isFullscreen && isTheaterMode) {
        setIsTheaterMode(false);
      }
    };
    
    // Add listeners for all browsers
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      // Clean up listeners
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [isTheaterMode]);
  
  // Set up event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, sidebarWidth]);
  
  // Initialize socket and room
  useEffect(() => {
    // Get data from localStorage
    const storedUsername = localStorage.getItem('username');
    const storedIsHost = localStorage.getItem('isHost') === 'true';
    
    if (!storedUsername) {
      navigate('/');
      return;
    }
    
    setUsername(storedUsername);
    setIsHost(storedIsHost);
    
    // Check for file URL in session storage
    if (storedIsHost) {
      console.log('Host detected, checking for file URL...');
      
      const fileUrl = sessionStorage.getItem('hostFileUrl');
      const fileName = localStorage.getItem('hostFileName');
      
      if (fileUrl && fileName) {
        console.log(`File URL found for ${fileName}`);
        // IMPORTANT: Here we set the URL correctly with the local: prefix
        setVideoUrl(`local:${fileName}`);
      } else {
        console.error('Host missing file URL or file name', { 
          fileUrl: fileUrl ? 'Available' : 'Missing', 
          fileName: fileName || 'Missing' 
        });
        addSystemMessage('Error: File information is missing. Please return to home and try again.');
      }
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
      if (!storedIsHost) {
        if (data.isStreaming) {
          setVideoUrl(`streaming:${data.fileName}`);
          addSystemMessage(`Host is streaming: ${data.fileName}`);
        } else {
          setVideoUrl('');
          addSystemMessage('Host has stopped streaming');
        }
      }
    });
    
    // Handle seek operations from host
    socketRef.current.on('videoSeekOperation', (data) => {
      console.log('Host is seeking to:', data.seekTime);
      
      if (!storedIsHost) {
        // For viewers, update connection status to show buffering
        setConnectionStatus('buffering');
        addSystemMessage(`Host is seeking to ${Math.floor(data.seekTime / 60)}:${Math.floor(data.seekTime % 60).toString().padStart(2, '0')}`);
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
  }, []);
  
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
      // Send regular state update
      socketRef.current.emit('videoStateChange', {
        roomId,
        videoState: {
          isPlaying,
          currentTime
        }
      });
      
      // Track significant seek operations (more than 10 seconds)
      if (lastReportedTime.current !== null) {
        const seekDistance = Math.abs(currentTime - lastReportedTime.current);
        if (seekDistance > 10) {
          console.log(`Major seek detected: ${seekDistance.toFixed(2)}s`);
          socketRef.current.emit('videoSeekOperation', {
            roomId,
            seekTime: currentTime
          });
        }
      }
      
      // Remember this time for future seek distance calculation
      lastReportedTime.current = currentTime;
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
          <div 
            className="video-container" 
            style={{ width: `calc(100% - ${sidebarWidth + 20}px)` }}
          >
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
            
            {/* Exit theater mode button */}
            {isTheaterMode && (
              <button 
                className="exit-theater-button"
                onClick={toggleTheaterMode}
              >
                Exit Theater Mode
              </button>
            )}
          </div>
          
          {/* Simple resizable divider */}
          <div 
            className="resizable-divider"
            onMouseDown={handleMouseDown}
          ></div>
          
          <div 
            className="sidebar" 
            style={{ width: `${sidebarWidth}px` }}
          >
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