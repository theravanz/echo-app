"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { clearCryptoKeys } from "@/lib/db";
import { clearAuthProgress } from "@/lib/auth-storage";
import { registerNavLayer } from "@/lib/back-nav";

import { useNotificationSettings } from "@/hooks/echo/use-notification-settings";
import InterfaceSettings from "@/components/echo/app/interface-settings";
import { QrLoginScanner } from "@/components/echo/app/qr-login-scanner";

import type { SettingsModalProps, ViewType } from "./settings-config";
import ProfileView from "./views/profile-view";
import DevicesView from "./views/devices-view";
import PrivacyView from "./views/privacy-view";
import LanguageView from "./views/language-view";
import AlertsView from "./views/alerts-view";
import SettingsMenuMobile from "./settings-menu-mobile";
import SettingsSidebar from "./settings-sidebar";

const SettingsModal: React.FC<SettingsModalProps> = ({ user, onClose, isQuarantined, quarantineTime, onUpdateUser }) => {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [activeView, setActiveView] = useState<ViewType>(null);
  const [desktopBooted, setDesktopBooted] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [isLastSeenVisible, setIsLastSeenVisible] = useState(user?.user_metadata?.privacy_last_seen !== false);
  const [currentLang, setCurrentLang] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('echo_language') || 'ru';
    }
    return 'ru';
  });

  const { settings: notifSettings, updateSetting: updateNotifSetting } = useNotificationSettings(user!);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[Settings] Logout failed', e);
    }

    try {
      await clearAuthProgress();
    } catch {
      // ignore
    }
    try {
      await clearCryptoKeys();
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem('echo_public_key');
      localStorage.removeItem('echo_mnemonic_backup');
    } catch {
      // ignore
    }

    onClose?.();
    router.push('/auth');
  };

  useEffect(() => {
    if (isMobile || desktopBooted) return;
    setDesktopBooted(true);
    setActiveView('profile');
  }, [isMobile, desktopBooted]);

  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showQrScanner) { setShowQrScanner(false); return; }
      if (activeView && activeView !== 'profile') { setActiveView('profile'); return; }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, activeView, showQrScanner, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!showQrScanner) return;
    return registerNavLayer({
      id: "settings-qr-scanner",
      priority: 120,
      isOpen: () => true,
      close: () => setShowQrScanner(false),
    });
  }, [showQrScanner]);

  useEffect(() => {
    if (!activeView) return;
    return registerNavLayer({
      id: "settings-sub-view",
      priority: 115,
      isOpen: () => true,
      close: () => setActiveView(null),
    });
  }, [activeView]);

  const toggleLastSeen = async () => {
    if (isQuarantined) {
      alert('Action limited. New devices must pass 32-hour quarantine before changing privacy settings.');
      return;
    }
    if (!user) return;
    const newValue = !isLastSeenVisible;
    setIsLastSeenVisible(newValue);
    await supabase.from('profiles').update({
      user_metadata: { ...user.user_metadata, privacy_last_seen: newValue }
    }).eq('id', user.id);
  };

  // ─── Main Render ───

  // If a sub-view is active on mobile, show it fullscreen
  if (isMobile && activeView) {
    let viewContent: React.ReactNode;
    switch (activeView) {
      case 'profile':
        viewContent = <ProfileView user={user} onUpdateUser={onUpdateUser} onBack={() => setActiveView(null)} />;
        break;
      case 'devices':
        viewContent = (
          <DevicesView
            user={user}
            isMobile={isMobile}
            setActiveView={setActiveView}
            onClose={onClose}
            isQuarantined={isQuarantined}
            quarantineTime={quarantineTime}
            onOpenQrScanner={() => setShowQrScanner(true)}
          />
        );
        break;
      case 'privacy':
        viewContent = (
          <PrivacyView
            isMobile={isMobile}
            setActiveView={setActiveView}
            onClose={onClose}
            isQuarantined={isQuarantined}
            quarantineTime={quarantineTime}
            isLastSeenVisible={isLastSeenVisible}
            onToggleLastSeen={toggleLastSeen}
          />
        );
        break;
      case 'alerts':
        viewContent = (
          <AlertsView
            settings={notifSettings}
            updateSetting={updateNotifSetting}
            isMobile={isMobile}
            setActiveView={setActiveView}
            onClose={onClose}
          />
        );
        break;
      case 'interface':
        viewContent = (
          <div className="p-4 md:p-10 space-y-2">
            <InterfaceSettings user={user} onBack={() => setActiveView(null)} onClose={onClose} />
          </div>
        );
        break;
      default:
        // Сюда попадает только 'language': Storage/Network не имеют action и не
        // могут стать activeView (их заглушки были недостижимы — удалены).
        viewContent = (
          <LanguageView
            currentLang={currentLang}
            setCurrentLang={setCurrentLang}
            isMobile={isMobile}
            setActiveView={setActiveView}
            onClose={onClose}
          />
        );
    }

    return (
      <div className="fixed inset-0 z-[200] bg-background flex flex-col safe-top safe-bottom" onClick={onClose}>
        <div className="flex-1 overflow-y-auto" onClick={e => e.stopPropagation()}>
          {viewContent}
        </div>
        {showQrScanner && <QrLoginScanner onClose={() => setShowQrScanner(false)} />}
      </div>
    );
  }

  // Mobile: Main menu (full screen, categories list)
  if (isMobile) {
    return (
      <>
        <SettingsMenuMobile
          user={user}
          currentLang={currentLang}
          setActiveView={setActiveView}
          onClose={onClose}
          onLogout={handleLogout}
        />
        {showQrScanner && <QrLoginScanner onClose={() => setShowQrScanner(false)} />}
      </>
    );
  }

  // --- Desktop: Modal with sidebar + content ---
  // Непрозрачный отдельный слой: bg-black/70 + сплошное окно БЕЗ прозрачного
  // bg-background/95 через которое просвечивал чат («чат как часть настроек»).
  // Окно — solid bg-background; клик по затемнению закрывает, внутри — нет.
  return (
    <div className={cn("fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm", isMobile ? "p-0 safe-y" : "p-4")} onClick={onClose}>
      <div className={cn("w-full bg-background border border-white/10 shadow-2xl overflow-hidden", isMobile ? "h-full rounded-none" : "max-w-3xl rounded-[48px]")} onClick={e => e.stopPropagation()}>
        <div className="flex h-full md:h-[640px]">
          <SettingsSidebar
            activeView={activeView}
            setActiveView={setActiveView}
            onClose={onClose}
            currentLang={currentLang}
            onLogout={handleLogout}
          />

          {/* Content — свой скролл, min-h-0 чтобы не распирать flex */}
          <div className="flex-1 min-h-0 overflow-y-auto settings-scroll">
            {activeView === 'profile' ? <ProfileView user={user} onUpdateUser={onUpdateUser} onBack={() => setActiveView(null)} /> :
             activeView === 'devices' ? (
               <DevicesView
                 user={user}
                 isMobile={isMobile}
                 setActiveView={setActiveView}
                 onClose={onClose}
                 isQuarantined={isQuarantined}
                 quarantineTime={quarantineTime}
                 onOpenQrScanner={() => setShowQrScanner(true)}
               />
             ) :
             activeView === 'privacy' ? (
               <PrivacyView
                 isMobile={isMobile}
                 setActiveView={setActiveView}
                 onClose={onClose}
                 isQuarantined={isQuarantined}
                 quarantineTime={quarantineTime}
                 isLastSeenVisible={isLastSeenVisible}
                 onToggleLastSeen={toggleLastSeen}
               />
             ) :
             activeView === 'language' ? (
               <LanguageView
                 currentLang={currentLang}
                 setCurrentLang={setCurrentLang}
                 isMobile={isMobile}
                 setActiveView={setActiveView}
                 onClose={onClose}
               />
             ) :
             activeView === 'alerts' ? (
               <AlertsView
                 settings={notifSettings}
                 updateSetting={updateNotifSetting}
                 isMobile={isMobile}
                 setActiveView={setActiveView}
                 onClose={onClose}
               />
             ) :
             activeView === 'interface' ? (
               <div className="p-4 md:p-10 space-y-2">
                 <InterfaceSettings user={user} onBack={() => setActiveView('profile')} onClose={onClose} />
               </div>
             ) : (
               /* Бывший desktop overview (Node Integrity / Multi-Account /
                  Purge) удалён как недостижимый. Оставлен защитный fallback
                  в Identity. */
               <ProfileView user={user} onUpdateUser={onUpdateUser} onBack={() => setActiveView(null)} />
             )}
          </div>
        </div>
      </div>
      {showQrScanner && <QrLoginScanner onClose={() => setShowQrScanner(false)} />}
    </div>
  );
};

export default SettingsModal;
