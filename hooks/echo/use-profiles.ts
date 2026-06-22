"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { UserProfile, Chat } from "./types";

const RECENT_SEARCHES_KEY = "echo_recent_searches";

interface UseProfilesReturn {
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  searchResults: UserProfile[];
  isSearching: boolean;
  isSearchFocused: boolean;
  setIsSearchFocused: (v: boolean) => void;
  recentSearches: UserProfile[];
  searchRef: React.RefObject<HTMLDivElement | null>;
  searchTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  handleSearch: (query: string) => void;
  handleStartChat: (profile: UserProfile, chats: Chat[], onSelectChat: (chat: Chat) => void, onAddChat: (profile: UserProfile) => void) => void;
  clearSearch: () => void;
}

export function useProfiles(): UseProfilesReturn {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<UserProfile[]>([]);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const userRef = useRef<string | null>(null);

  // Load recent searches on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) setRecentSearches(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const setCurrentUserId = useCallback((id: string) => {
    userRef.current = id;
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
          .neq("id", userRef.current ?? "")
          .limit(10);

        if (error) throw error;
        setSearchResults(data || []);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleStartChat = useCallback((
    profile: UserProfile,
    chats: Chat[],
    onSelectChat: (chat: Chat) => void,
    onAddChat: (profile: UserProfile) => void,
  ) => {
    const updated = [profile, ...recentSearches.filter((p) => p.id !== profile.id)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    clearSearch();

    const existingChat = chats.find((c) => c.id === profile.id);
    if (existingChat) {
      onSelectChat(existingChat);
    } else {
      onAddChat(profile);
      onSelectChat(profile as Chat);
    }
    toast.success("Chat with " + (profile.display_name || profile.username) + " opened");
  }, [recentSearches]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setIsSearchFocused(false);
    setSearchOpen(false);
  }, []);

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    searchResults,
    isSearching,
    isSearchFocused,
    setIsSearchFocused,
    recentSearches,
    searchRef,
    searchTimeoutRef,
    handleSearch,
    handleStartChat,
    clearSearch,
  };
}
