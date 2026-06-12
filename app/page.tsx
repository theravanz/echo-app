// app/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import WelcomeScreen from './components/WelcomeScreen';

export default function Home() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          router.push('/app');
        } else {
          setCheckingAuth(false);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        setCheckingAuth(false);
      }
    }
    checkAuth();
  }, [router]);

  if (checkingAuth) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#0a0a0c]">
        {/* Simple elegant modern loader */}
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 border-2 border-white/5 rounded-full" />
          <div className="absolute inset-0 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#0a0a0c]">
      <AnimatePresence>
        <WelcomeScreen onComplete={() => router.push('/auth')} />
      </AnimatePresence>
    </main>
  );
}