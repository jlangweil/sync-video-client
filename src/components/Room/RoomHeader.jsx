import React from 'react';
import { useWebRTC } from './WebRTC/WebRTCProvider';
import './RoomHeader.css';

function RoomHeader({ 
  roomId, 
  copyRoomId, 
  copySuccess, 
  isSyncing, 
  isHost, 
  isTheaterMode 
}) {
  // Get WebRTC context
  const { isStreaming, bufferPercentage } = useWebRTC();

  return (
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
        {isHost && isStreaming ? (
          <span className="streaming">
            ↑ Streaming
          </span>
        ) : (!isHost && isStreaming) ? (
          <span className="buffer-indicator">
            Progress: {bufferPercentage}%
            <div className="buffer-bar">
              <div className="buffer-progress" style={{ width: `${bufferPercentage}%` }}></div>
            </div>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default RoomHeader;