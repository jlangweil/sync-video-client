import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import UserList from './Sidebar/UserList';
import ChatPanel from './Sidebar/ChatPanel';
import './ChatOnlyRoom.css';

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

const SERVER_URL = getServerUrl();

function ChatOnlyRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  
  const [username, setUsername] = useState('');
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [copySuccess, setCopySuccess] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [isUserListExpanded, setIsUserListExpanded] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  
  // Socket reference
  const socketRef = useRef(null);
  
  // Chat container reference for auto-scrolling
  const chatContainerRef = useRef(null);
  
  // Detect iOS device on mount
  useEffect(() => {
    // Check if this is an iOS device
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(iOS);
    
    // Add viewport meta tag to prevent zooming when focusing on inputs
    if (iOS) {
      let viewportMeta = document.querySelector('meta[name="viewport"]');
      if (!viewportMeta) {
        viewportMeta = document.createElement('meta');
        viewportMeta.name = 'viewport';
        document.head.appendChild(viewportMeta);
      }
      viewportMeta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
    }
    
    // Add specific class for iOS devices
    if (iOS) {
      document.body.classList.add('ios-device');
    }
  }, []);
  
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
    
    if (!storedUsername) {
      navigate('/');
      return;
    }
    
    setUsername(storedUsername);
    setIsHost(storedIsHost);
    
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
        isHost: storedIsHost,
        isChatOnly: true
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
        isHost: storedIsHost,
        isChatOnly: true
      });
    });
    
    // Handle user joined
    socketRef.current.on('userJoined', (data) => {
      console.log('User joined event:', data);
      setUsers(data.users);
      
      // Add system message
      if (data.user.id !== socketRef.current.id) {
        const userTypeInfo = data.user.isChatOnly ? ' (Chat Only)' : data.user.isHost ? ' (Host)' : '';
        addSystemMessage(`${data.user.username}${userTypeInfo} has joined the room`);
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
    
    // Setup regular heartbeats to maintain connection
    const heartbeatInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('heartbeat', {
          roomId,
          timestamp: Date.now(),
          isHost: storedIsHost
        });
      }
    }, 25000); // Every 25 seconds
    
    // Cleanup function
    return () => {
      clearInterval(heartbeatInterval);
      socketRef.current.disconnect();
      localStorage.removeItem('chatOnly'); // Clean up chat-only flag on exit
    };
  }, [roomId, navigate]);
  
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
        
        // Fallback for iOS
        if (isIOS) {
          const textArea = document.createElement('textarea');
          textArea.value = roomId;
          textArea.style.position = 'absolute';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          
          try {
            document.execCommand('copy');
            setCopySuccess('Copied!');
            setTimeout(() => setCopySuccess(''), 2000);
          } catch (err) {
            console.error('Fallback copy failed:', err);
          }
          
          document.body.removeChild(textArea);
        }
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
      
      // For iOS, ensure the input remains focused
      if (isIOS) {
        const inputElement = document.querySelector('.chat-input input');
        if (inputElement) {
          setTimeout(() => {
            inputElement.focus();
          }, 10);
        }
      }
    }
  };

  // Toggle user list visibility for mobile
  const toggleUserList = () => {
    setIsUserListExpanded(!isUserListExpanded);
  };

  // Navigate back to home
  const handleBackToHome = () => {
    navigate('/');
  };

  return (
    <div className={`chat-only-room ${isIOS ? 'ios-device' : ''}`}>
      <div className="chat-only-header">
        <div className="header-left">
          <button onClick={handleBackToHome} className="back-button">
            <span>←</span> Home
          </button>
        </div>
        <div className="header-center">
          <h1>Chat Room</h1>
          <div className="room-id-display">
            <span>Room ID: {roomId}</span>
            <button onClick={copyRoomId} className="copy-button">
              {copySuccess || 'Copy'}
            </button>
          </div>
        </div>
        <div className="header-right">
          <button onClick={toggleUserList} className="user-list-toggle">
            <span className="user-count">{users.length}</span>
            <span className="user-icon">👥</span>
          </button>
        </div>
      </div>
      
      <div className="chat-only-content">
        <div className={`user-list-panel ${isUserListExpanded ? 'expanded' : ''}`}>
          <div className="user-list-header">
            <h3>Users ({users.length})</h3>
            <button onClick={toggleUserList} className="close-user-list">✕</button>
          </div>
          <UserList users={users} currentUserId={socketRef.current?.id} />
        </div>
        
        <div className="chat-only-main">
          <ChatPanel
            messages={messages}
            newMessage={newMessage}
            setNewMessage={setNewMessage}
            handleSendMessage={handleSendMessage}
            chatContainerRef={chatContainerRef}
            isChatOnly={true}
          />
        </div>
      </div>
    </div>
  );
}

export default ChatOnlyRoom;