import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';

// Get the server URL dynamically based on the current browser location
const getServerUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = 3000; // Your server port
  
  return `${protocol}//${hostname}:${port}`;
};

// Use this server URL for API calls
const SERVER_URL = getServerUrl();

// Size of each chunk in bytes (5MB)
const CHUNK_SIZE = 5 * 1024 * 1024;

function Home() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [joining, setJoining] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [creatingRoom, setCreatingRoom] = useState(false);
  
  const navigate = useNavigate();

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError('');
  };

  // Function to handle chunked file upload
  const uploadFileInChunks = async (file, roomId, videoId) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let uploadedChunks = 0;
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const chunk = file.slice(start, end);
      
      // Create a new FormData for each chunk
      const formData = new FormData();
      formData.append('chunk', chunk, file.name);
      
      try {
        const response = await axios.post(
          `${SERVER_URL}/upload-chunk?videoId=${videoId}&roomId=${roomId}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data'
            },
            onUploadProgress: (progressEvent) => {
              // Calculate progress for this chunk
              const percentChunk = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              
              // Calculate overall progress across all chunks
              const overallProgress = Math.round(
                ((chunkIndex * CHUNK_SIZE + progressEvent.loaded) * 100) / file.size
              );
              
              setUploadProgress(overallProgress);
            }
          }
        );
        
        uploadedChunks++;
        
        // Check if this was the last chunk
        if (chunkIndex === totalChunks - 1) {
          return {
            success: true,
            videoUrl: response.data.videoUrl,
            message: 'Upload complete'
          };
        }
      } catch (error) {
        console.error(`Error uploading chunk ${chunkIndex}:`, error);
        throw new Error(`Failed to upload chunk ${chunkIndex}: ${error.message}`);
      }
    }
    
    return {
      success: true,
      message: 'Upload in progress',
      progress: Math.round((uploadedChunks / totalChunks) * 100)
    };
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

    console.log('Uploading file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2) + 'MB', 'Type:', file.type);

    setLoading(true);
    setError('');
    setUploadProgress(0);
    setCreatingRoom(true);
    
    try {
      // Step 1: Create a room and get videoId
      console.log('Creating room...');
      const roomResponse = await axios.post(`${SERVER_URL}/create-room`);
      
      const { roomId, videoId } = roomResponse.data;
      console.log(`Room created: ${roomId}, videoId: ${videoId}`);
      
      // Store user info right away so we can navigate to the room
      localStorage.setItem('username', username);
      localStorage.setItem('isHost', 'true');
      
      // No videoUrl yet - it will be sent via socket when chunks start uploading
      localStorage.removeItem('videoUrl');
      
      setCreatingRoom(false);
      
      // Step 2: Start uploading the file in chunks
      // We'll navigate to the room first and continue the upload in the background
      navigate(`/room/${roomId}`);
      
      // Step 3: Begin uploading chunks
      // This happens after navigation, but we start it here
      uploadFileInChunks(file, roomId, videoId)
        .then(result => {
          console.log('Upload result:', result);
        })
        .catch(err => {
          console.error('Upload failed:', err);
        });
      
    } catch (err) {
      console.error('Error starting upload:', err);
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
              <label htmlFor="video">Upload Video:</label>
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
                <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
                <p>{creatingRoom ? 'Creating room...' : `${uploadProgress}% Uploaded`}</p>
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
              The video will continue uploading after you enter the room. Others can join and start watching immediately as it uploads.
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