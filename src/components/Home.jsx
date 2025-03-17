import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';

// Get the server URL dynamically based on the current browser location
const getServerUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  // Check if we're in local development or production
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  
  // Only add port for localhost; in production the hostname already includes everything needed
  const port = isLocalhost ? ':10000' : '';
  
  return `${protocol}//${hostname}${port}`;
};

// Use this server URL for API calls
const SERVER_URL = getServerUrl();

function Home() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [joining, setJoining] = useState(false);
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
      // Note: We can't store the actual file in localStorage, but we'll store metadata
      localStorage.setItem('hostFileName', file.name);
      localStorage.setItem('hostFileType', file.type);
      localStorage.setItem('hostFileSize', file.size.toString());
      
      // Create a file URL that can be accessed in the Room component
      const fileUrl = URL.createObjectURL(file);
      sessionStorage.setItem('hostFileUrl', fileUrl);
      
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

  return (
    <div className="home-container">
      <div className="tabs">
        <button 
          className={!joining ? 'active' : ''} 
          onClick={() => setJoining(false)}
        >
          Create Room
        </button>
        <button 
          className={joining ? 'active' : ''} 
          onClick={() => setJoining(true)}
        >
          Join Room
        </button>
      </div>
      
      {!joining ? (
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
      ) : (
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
      
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}

export default Home;