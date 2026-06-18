import React, { useState, useEffect } from 'react';
// @ts-ignore
import EmojiPicker from 'emoji-picker-react';
import './MediaPicker.css';

interface MediaPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (url: string) => void;
  onStickerSelect: (url: string) => void;
}

const TENOR_API_KEY = 'LIVDSRZULEUB'; // Public test key, user should replace with their own
const CLIENT_KEY = 'echo_messenger';

const MediaPicker: React.FC<MediaPickerProps> = ({ 
  onEmojiSelect, 
  onGifSelect, 
  onStickerSelect
}) => {
  const [activeTab, setActiveTab] = useState<'emoji' | 'sticker' | 'gif'>('emoji');
  const [gifSearch, setGifSearch] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);

  // Sample static stickers (URLs to public sticker assets)
  const sampleStickers = [
    { id: '1', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.gif' },
    { id: '2', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60d/512.gif' },
    { id: '3', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f602/512.gif' },
    { id: '4', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f62d/512.gif' },
    { id: '5', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d/512.gif' },
    { id: '6', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/512.gif' },
    { id: '7', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.gif' },
    { id: '8', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f4af/512.gif' },
  ];

  const fetchGifs = async (query: string = '') => {
    setLoadingGifs(true);
    try {
      const endpoint = query 
        ? `https://tenor.googleapis.com/v2/search?q=${query}&key=${TENOR_API_KEY}&client_key=${CLIENT_KEY}&limit=20`
        : `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=${CLIENT_KEY}&limit=20`;
      
      const response = await fetch(endpoint);
      const data = await response.json();
      setGifs(data.results || []);
    } catch (error) {
      console.error('Error fetching GIFs:', error);
    } finally {
      setLoadingGifs(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'gif' && gifs.length === 0) {
      fetchGifs();
    }
  }, [activeTab]);

  const handleGifSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchGifs(gifSearch);
  };

  return (
    <div className="media-picker-container" onClick={(e) => e.stopPropagation()}>
      <div className="media-picker-tabs">
        <button 
          className={`tab-btn ${activeTab === 'emoji' ? 'active' : ''}`}
          onClick={() => setActiveTab('emoji')}
        >
          <i className="fas fa-smile"></i>
        </button>
        <button 
          className={`tab-btn ${activeTab === 'sticker' ? 'active' : ''}`}
          onClick={() => setActiveTab('sticker')}
        >
          <i className="fas fa-sticky-note"></i>
        </button>
        <button 
          className={`tab-btn ${activeTab === 'gif' ? 'active' : ''}`}
          onClick={() => setActiveTab('gif')}
        >
          <i className="fas fa-film"></i>
        </button>
      </div>

      <div className="media-picker-content">
        {activeTab === 'emoji' && (
          <div className="emoji-picker-wrapper">
            <EmojiPicker 
              onEmojiClick={(emojiData: any) => onEmojiSelect(emojiData.emoji)}
              theme={"dark" as any}
              lazyLoadEmojis={true}
              width="100%"
              height="350px"
              searchDisabled={false}
              skinTonesDisabled={true}
              previewConfig={{ showPreview: false }}
            />
          </div>
        )}

        {activeTab === 'sticker' && (
          <div className="sticker-grid">
            {sampleStickers.map(sticker => (
              <div 
                key={sticker.id} 
                className="sticker-item"
                onClick={() => onStickerSelect(sticker.url)}
              >
                <img src={sticker.url} alt="Sticker" />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'gif' && (
          <div className="gif-container">
            <form className="gif-search" onSubmit={handleGifSearch}>
              <input 
                type="text" 
                placeholder="Поиск GIF в Tenor..." 
                value={gifSearch}
                onChange={(e) => setGifSearch(e.target.value)}
              />
              <button type="submit"><i className="fas fa-search"></i></button>
            </form>
            <div className="gif-grid">
              {loadingGifs ? (
                <div className="loading-spinner"></div>
              ) : (
                gifs.map(gif => (
                  <div 
                    key={gif.id} 
                    className="gif-item"
                    onClick={() => onGifSelect(gif.media_formats.tinygif.url)}
                  >
                    <img src={gif.media_formats.tinygif.url} alt={gif.content_description} />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaPicker;
