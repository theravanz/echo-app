'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { safeChar } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  TbArrowLeft as ArrowBack,
  TbLoader,
  TbFlag,
  TbMessageCircle,
  TbExternalLink,
  TbBell,
  TbDownload,
} from 'react-icons/tb';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface ProfilePublic {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  avatar_color: string | null;
  bio: string | null;
  background: string | null;
  is_channel: boolean;
  subscribers?: number;
}

const BG_PRESETS: Record<string, string> = {
  violet:
    'radial-gradient(circle at 25% 20%,#4a3d8f,transparent 55%),radial-gradient(circle at 75% 70%,#2a2440,transparent 60%),#0d0d14',
  teal:
    'radial-gradient(circle at 70% 20%,#1a4a4a,transparent 55%),radial-gradient(circle at 20% 80%,#123028,transparent 60%),#0a1614',
  rose:
    'radial-gradient(circle at 30% 70%,#5a2a3a,transparent 55%),radial-gradient(circle at 80% 20%,#2a1420,transparent 60%),#150a10',
  amber:
    'radial-gradient(circle at 50% 30%,#4a3a1a,transparent 55%),radial-gradient(circle at 20% 80%,#2a2010,transparent 60%),#14100a',
};

function resolveBackground(bg: string | null): string {
  if (!bg) return BG_PRESETS.violet;
  if (bg.startsWith('http')) return `url(${bg}) center/cover no-repeat`;
  return bg;
}


export default function PublicProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <TbLoader className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <PublicProfilePageInner />
    </Suspense>
  );
}

function PublicProfilePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const username = searchParams.get('u') || '';
  const [profile, setProfile] = useState<ProfilePublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!username) return;
      try {
        const { data: channel } = await supabase
          .from('channels')
          .select('*')
          .eq('username', username)
          .maybeSingle();

        if (channel) {
          setProfile({
            id: channel.id,
            display_name: channel.name,
            username: channel.username,
            avatar_url: channel.avatar_url,
            avatar_color: null,
            bio: null,
            background: null,
            is_channel: true,
            subscribers: channel.subscribers_count,
          });
          setLoading(false);
          document.title = `${channel.name} (@${channel.username}) — Echo`;
          return;
        }

        const { data: p } = await supabase
          .from('profiles')
          .select('*')
          .eq('username', username)
          .maybeSingle();

        if (p) {
          setProfile({
            id: p.id,
            display_name: p.display_name || p.username,
            username: p.username,
            avatar_url: p.avatar_url,
            avatar_color: p.avatar_color,
            bio: p.bio,
            background: p.background,
            is_channel: false,
          });
          setLoading(false);
          document.title = `${p.display_name || p.username} (@${p.username}) — Echo`;
          return;
        }

        setNotFound(true);
        setLoading(false);
        document.title = 'Profile not found — Echo';
      } catch (err) {
        console.error('Profile fetch error:', err);
        setLoading(false);
        document.title = 'Error — Echo';
      }
    };

    fetchProfile();
  }, [username]);

  // В самом приложении главное действие — открыть чат/канал.
  // Если пользователь не авторизован — отправляем на авторизацию с возвратом.
  const handlePrimaryAction = async () => {
    if (!profile) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push(`/app?chat=${profile.username}`);
      } else {
        router.push(`/auth?returnTo=/app?chat=${profile.username}`);
      }
    } catch {
      router.push(`/auth?returnTo=/app?chat=${profile.username}`);
    }
  };

  // Вторичная кнопка — открыть публичную страницу в браузере.
  const handleOpenInBrowser = () => {
    if (!profile) return;
    window.open(`https://echo-mes.vercel.app/@${profile.username}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <TbLoader className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-background flex items-center justify-center">
          <TbFlag className="w-8 h-8 text-muted-foreground/60" />
        </div>
        <h1 className="text-xl font-semibold">Профиль не найден</h1>
        <p className="text-muted-foreground text-sm text-center">
          Пользователь или канал @{username} не существует.
        </p>
        <Button onClick={() => router.push('/')} variant="outline" className="mt-4 rounded-xl">
          На главную
        </Button>
      </div>
    );
  }

  const bg = profile.background
    ? resolveBackground(profile.background)
    : BG_PRESETS.violet;

  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      {/* Шапка */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 sm:px-6 h-14 bg-background/80 backdrop-blur-md border-b border-border">
        <button
          onClick={() => router.push('/')}
          className="flex items-center"
          aria-label="Echo home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-full.svg" alt="Echo" className="h-7 w-auto" />
        </button>
        <Button
          variant="default"
          className="rounded-xl gap-2"
          onClick={() => {
            // Заглушка — пока никуда не ведёт
          }}
        >
          <TbDownload className="w-4 h-4" />
          Скачать
        </Button>
      </header>

      <div className="relative h-64 sm:h-80 w-full overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ background: bg }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

        <div className="absolute top-4 left-4 z-10">
          <Button
            variant="ghost"
            size="icon"
            className="w-9 h-9 rounded-full bg-background/40 backdrop-blur-sm hover:bg-background/60 text-foreground"
            onClick={() => router.back()}
          >
            <ArrowBack className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="relative -mt-16 flex flex-col items-center px-6 pb-12">
        <Avatar className="w-28 h-28 border-4 border-background shadow-2xl">
          {profile.avatar_url ? (
            <AvatarImage src={profile.avatar_url} alt={profile.display_name} />
          ) : (
            <AvatarFallback
              className="text-3xl font-bold"
              style={{ backgroundColor: profile.avatar_color || 'oklch(0.2 0.02 280)' }}
            >
              {safeChar(profile.display_name || profile.username)}
            </AvatarFallback>
          )}
          {profile.is_channel && (
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center border-2 border-background">
              <TbBell className="w-3 h-3 text-primary-foreground" />
            </div>
          )}
        </Avatar>

        <div className="mt-4 text-center">
          <h1 className="text-2xl font-bold flex items-center justify-center gap-2">
            {profile.display_name}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">@{profile.username}</p>

          {profile.is_channel && profile.subscribers !== undefined && (
            <p className="text-foreground/80 text-sm mt-2">
              {profile.subscribers.toLocaleString()} подписчиков
            </p>
          )}
        </div>

        {profile.bio && (
          <p className="mt-4 text-muted-foreground text-sm text-center max-w-md leading-relaxed">
            {profile.bio}
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3 w-full max-w-sm">
          {/* Главная кнопка — открыть чат/канал (или авторизацию, если нет сессии) */}
          <Button
            className="w-full py-6 text-base font-semibold rounded-xl gap-2"
            onClick={handlePrimaryAction}
          >
            <TbMessageCircle className="w-5 h-5" />
            {profile.is_channel ? 'Перейти в канал' : 'Написать сообщение'}
          </Button>

          {/* Вторичная кнопка — открыть публичную страницу в браузере */}
          <Button
            variant="secondary"
            className="w-full py-5 text-sm rounded-xl gap-2"
            onClick={handleOpenInBrowser}
          >
            <TbExternalLink className="w-4 h-4" />
            Открыть в браузере
          </Button>
        </div>

        <div className="mt-12 text-center">
          <p className="text-muted-foreground/50 text-xs">Echo — Secure Mesh Messenger</p>
        </div>
      </div>
    </main>
  );
}
