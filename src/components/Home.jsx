import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';

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

// Use this server URL for API calls
const SERVER_URL = getServerUrl();

function Home() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [activeTab, setActiveTab] = useState('join'); // Changed to 'join' as default tab
  const [creatingRoom, setCreatingRoom] = useState(false);
  
  const navigate = useNavigate();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError('');
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a video file');
      return;
    }
    
    if (!username) {
      setError('Please enter a username');
      return;
    }

    console.log('Selected file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2) + 'MB', 'Type:', file.type);

    setLoading(true);
    setError('');
    setCreatingRoom(true);
    
    try {
      // Step 1: Create a room and get roomId
      console.log('Creating room...');
      const roomResponse = await axios.post(`${SERVER_URL}/create-room`);
      
      const { roomId } = roomResponse.data;
      console.log(`Room created: ${roomId}`);
      
      // Store user info right away so we can navigate to the room
      localStorage.setItem('username', username);
      localStorage.setItem('isHost', 'true');
      
      // Store file info in localStorage
      localStorage.setItem('hostFileName', file.name);
      localStorage.setItem('hostFileType', file.type);
      localStorage.setItem('hostFileSize', file.size.toString());
      
      // Create a file URL that can be accessed in the Room component
      // IMPORTANT: This is a critical part that was causing the streaming issue
      const fileUrl = URL.createObjectURL(file);
      console.log('Creating object URL for file:', fileUrl ? 'URL created successfully' : 'Failed to create URL');
      
      // Store in both sessionStorage (primary) and localStorage (backup indicator)
      sessionStorage.setItem('hostFileUrl', fileUrl);
      localStorage.setItem('hostFileUrlBackup', 'file_url_stored');
      
      // Create a timestamp to help with debugging
      localStorage.setItem('fileUrlCreatedAt', new Date().toISOString());
      
      setCreatingRoom(false);
      
      // Navigate to the room where WebRTC streaming will be set up
      navigate(`/room/${roomId}`);
      
    } catch (err) {
      console.error('Error creating room:', err);
      setCreatingRoom(false);
      setLoading(false);
      
      // Show appropriate error message
      if (err.response) {
        setError(`Server error: ${err.response.status} - ${err.response.data.error || 'Unknown error'}`);
      } else if (err.request) {
        setError('No response from server. Please check your connection.');
      } else {
        setError(`Error: ${err.message}`);
      }
    }
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    
    if (!roomId) {
      setError('Please enter a room ID');
      return;
    }
    
    if (!username) {
      setError('Please enter a username');
      return;
    }
    
    localStorage.setItem('username', username);
    localStorage.setItem('isHost', 'false');
    
    navigate(`/room/${roomId}`);
  };

  const handleJoinChatOnly = (e) => {
    e.preventDefault();
    
    if (!roomId) {
      setError('Please enter a room ID');
      return;
    }
    
    if (!username) {
      setError('Please enter a username');
      return;
    }
    
    localStorage.setItem('username', username);
    localStorage.setItem('isHost', 'false');
    
    // Use the dedicated chat route instead
    navigate(`/chat/${roomId}`);
  };

  return (
    <div className="home-container">
      <div className="tabs">
        <button 
          className={activeTab === 'join' ? 'active' : ''} 
          onClick={() => setActiveTab('join')}
        >
          Join Room
        </button>
        <button 
          className={activeTab === 'create' ? 'active' : ''} 
          onClick={() => setActiveTab('create')}
        >
          Create Room
        </button>
        <button 
          className={activeTab === 'chat' ? 'active' : ''} 
          onClick={() => setActiveTab('chat')}
        >
          Chat Only
        </button>
      </div>
      
      {activeTab === 'join' && (
        <div className="join-room">
          <h2>Join an existing room</h2>
          <form onSubmit={handleJoinRoom}>
            <div className="form-group">
              <label htmlFor="join-username">Your Name:</label>
              <input
                type="text"
                id="join-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="room-id">Room ID:</label>
              <input
                type="text"
                id="room-id"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID"
                required
              />
            </div>
            
            <button type="submit" className="primary-button">
              Join Room
            </button>
          </form>
        </div>
      )}
      
      {activeTab === 'create' && (
        <div className="create-room">
          <h2>Create a new viewing room</h2>
          <form onSubmit={handleUpload}>
            <div className="form-group">
              <label htmlFor="username">Your Name:</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name"
                required
              />
            </div>
            
            <div className="form-group file-input">
              <label htmlFor="video">Select Video to Stream:</label>
              <input
                type="file"
                id="video"
                accept="video/*"
                onChange={handleFileChange}
              />
              <p className="file-name">{file ? file.name : 'No file selected'}</p>
              {file && (
                <p className="file-size">
                  Size: {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              )}
            </div>
            
            {loading && (
              <div className="progress-container">
                <p>{creatingRoom ? 'Creating room...' : 'Processing...'}</p>
              </div>
            )}
            
            <button 
              type="submit" 
              disabled={loading}
              className="primary-button"
            >
              {loading ? 'Processing...' : 'Create Room'}
            </button>
            
            <p className="info-text">
              The video will stream directly from your device to your viewers. 
              No uploading necessary!
            </p>
          </form>
        </div>
      )}

      {activeTab === 'chat' && (
        <div className="chat-only">
          <h2>Join chat only</h2>
          <form onSubmit={handleJoinChatOnly}>
            <div className="form-group">
              <label htmlFor="chat-username">Your Name:</label>
              <input
                type="text"
                id="chat-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your name"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="chat-room-id">Room ID:</label>
              <input
                type="text"
                id="chat-room-id"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID"
                required
              />
            </div>
            
            <button type="submit" className="primary-button">
              Join Chat Only
            </button>
            
            <p className="info-text">
              Join just the chat without video streaming. Perfect for mobile devices or when you want to conserve bandwidth.
            </p>
            
            <div className="device-indicator">
              <p><strong>Recommended for:</strong> Mobile phones, tablets, or connections with limited bandwidth</p>
              <div className="device-icons">
                <span className="device-icon">📱</span>
                <span className="device-icon">💻</span>
                <span className="device-icon">📶</span>
              </div>
            </div>
          </form>
        </div>
      )}
      
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}

export default Home;