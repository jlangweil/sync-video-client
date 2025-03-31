import React from 'react';
import './Sidebar.css';

function ChatPanel({ 
  messages, 
  newMessage, 
  setNewMessage, 
  handleSendMessage, 
  chatContainerRef 
}) {
  return (
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
  );
}

export default ChatPanel;