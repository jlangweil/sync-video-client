import React from 'react';

const JoshTVBanner = () => {

    const bannerStyle = {
    background: 'linear-gradient(135deg, #3498db, #2c3e50)',
    color: 'white',
    padding: '15px 20px',
    textAlign: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    borderRadius: '6px',
    margin: '0 auto 10px',
    maxWidth: '1200px',
    position: 'relative',
    overflow: 'hidden',
    boxSizing: 'border-box',
    width: '100%'
    };

  const titleStyle = {
    margin: '5px 0',
    fontSize: '32px',
    fontWeight: 'bold',
    letterSpacing: '2px',
    textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
  };

  const subtitleStyle = {
    margin: '5px 0',
    fontSize: '16px',
    opacity: '0.9',
    fontWeight: 'normal'
  };

  const decorationStyle = {
    position: 'absolute',
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.1)',
    top: '-30px',
    right: '-30px',
    zIndex: '1'
  };

  const decoration2Style = {
    position: 'absolute',
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.1)',
    bottom: '-20px',
    left: '30px',
    zIndex: '1'
  };

  const contentStyle = {
    position: 'relative',
    zIndex: '2'
  };

  return (
    <div style={bannerStyle}>
      <div style={decorationStyle}></div>
      <div style={decoration2Style}></div>
      <div style={contentStyle}>
        <h1 style={titleStyle}>Josh TV</h1>
        <p style={subtitleStyle}>Morristown Movie Meetup Theatre</p>
      </div>
    </div>
  );
};

export default JoshTVBanner;