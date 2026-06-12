"use client";

import React, { useState, useEffect } from 'react';
// @ts-ignore
import EmojiPicker from 'emoji-picker-react';
import { Search, Film, StickyNote, Smile, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

interface MediaPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (url: string) => void;
  onStickerSelect: (url: string) => void;
}

const TENOR_API_KEY = 'LIVDSRZULEUB'; 
const CLIENT_KEY = 'echo_messenger';

export const MediaPicker: React.FC<MediaPickerProps> = ({ 
  onEmojiSelect, 
  onGifSelect, 
  onStickerSelect
}) => {
  const [gifSearch, setGifSearch] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);

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
    fetchGifs();
  }, []);

  const handleGifSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchGifs(gifSearch);
  };

  return (
    <div className="w-full max-w-[400px] bg-card/50 backdrop-blur-3xl border border-white/5 rounded-[32px] overflow-hidden shadow-2xl">
      <Tabs defaultValue="emoji" className="w-full">
        <TabsList className="w-full h-12 bg-white/5 rounded-none border-b border-white/5 grid grid-cols-3">
          <TabsTrigger value="emoji" className="data-[state=active]:bg-white/10"><Smile className="w-4 h-4 mr-2" /> Emojis</TabsTrigger>
          <TabsTrigger value="sticker" className="data-[state=active]:bg-white/10"><StickyNote className="w-4 h-4 mr-2" /> Stickers</TabsTrigger>
          <TabsTrigger value="gif" className="data-[state=active]:bg-white/10"><Film className="w-4 h-4 mr-2" /> GIFs</TabsTrigger>
        </TabsList>

        <TabsContent value="emoji" className="p-0 m-0">
          <div className="emoji-picker-wrapper dark">
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
        </TabsContent>

        <TabsContent value="sticker" className="p-4 m-0">
          <ScrollArea className="h-[350px]">
            <div className="grid grid-cols-4 gap-2">
              {sampleStickers.map(sticker => (
                <button 
                  key={sticker.id} 
                  className="aspect-square p-2 rounded-xl hover:bg-white/10 transition-colors"
                  onClick={() => onStickerSelect(sticker.url)}
                >
                  <img src={sticker.url} alt="Sticker" className="w-full h-full object-contain" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="gif" className="p-4 m-0 space-y-4">
          <form className="relative group" onSubmit={handleGifSearch}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-primary transition-colors" />
            <Input 
              placeholder="Search GIFs..." 
              value={gifSearch}
              onChange={(e) => setGifSearch(e.target.value)}
              className="bg-white/5 border-white/5 rounded-xl pl-10"
            />
          </form>
          <ScrollArea className="h-[290px]">
            {loadingGifs ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {gifs.map(gif => (
                  <button 
                    key={gif.id} 
                    className="aspect-video rounded-lg overflow-hidden border border-white/5 hover:border-primary/50 transition-all"
                    onClick={() => onGifSelect(gif.media_formats.tinygif.url)}
                  >
                    <img src={gif.media_formats.tinygif.url} alt={gif.content_description} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};
