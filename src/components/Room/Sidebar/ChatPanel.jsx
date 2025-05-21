import React from 'react';
import './Sidebar.css';

function ChatPanel({ 
  messages, 
  newMessage, 
  setNewMessage, 
  handleSendMessage, 
  chatContainerRef,
  isChatOnly = false 
}) {
  // Handler for Enter key submission
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  return (
    <div className={`chat-panel ${isChatOnly ? 'chat-only-panel' : ''}`}>
      {!isChatOnly && <h3>Chat</h3>}
      <div className="chat-messages" ref={chatContainerRef}>
        {messages.length === 0 ? (
          <div className="empty-chat-message">
            <p>No messages yet. Be the first to say hello!</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div 
              key={index} 
              className={`message ${msg.isSystem ? 'system-message' : ''}`}
            >
              <span className="message-user">{msg.user}:</span>
              <span className="message-text">{msg.text}</span>
              <span className="message-time">{msg.time}</span>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSendMessage} className="chat-input">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          aria-label="Chat message input"
        />
        <button type="submit" aria-label="Send message">
          {isChatOnly ? 'Send' : '→'}
        </button>
      </form>
    </div>
  );
}

export default ChatPanel;