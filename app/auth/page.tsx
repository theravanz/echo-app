"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/hooks/use-translation';
import { CountrySelector } from '@/components/auth/country-selector';
import { auth } from '@/lib/firebase';
import { supabase } from '@/lib/supabase';
import { persistSession, savePrivateKey, loadPrivateKey } from '@/lib/db';
import { saveAuthProgress, loadAuthProgress, clearAuthProgress } from '@/lib/auth-storage';
import nacl from 'tweetnacl';
// @ts-ignore
import { encodeBase64 } from 'tweetnacl-util';
import { QRCodeSVG } from 'qrcode.react';
// @ts-ignore
import { invoke } from '@tauri-apps/api/core';
import {
  signInWithPhoneNumber,
  RecaptchaVerifier,
} from 'firebase/auth';
import { AnimatedSphere } from '@/components/echo/animated-sphere';
import {
  TbShield as Shield,
  TbDeviceMobile as Smartphone,
  TbMail as Mail,
  TbLock as Lock,
  TbCheck as Check,
  TbCopy as Copy,
  TbArrowRight as ArrowRight,
  TbRefresh as RefreshCw,
  TbAlertTriangle as AlertTriangle,
  TbFingerprint as Fingerprint,
  TbGlobe as Globe,
  TbKey as Key,
  TbShieldCheck as ShieldCheck
} from 'react-icons/tb';
import { cn } from '@/lib/utils';

type Step = 1 | 2 | 3 | 4 | 5;

function AuthPageContent() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  // Multi-account context
  const addingAccount = searchParams.get('addingAccount') === 'true';

  // Return target for post-login redirect (validated to internal paths only)
  const rawReturnTo = searchParams.get('returnTo') || '/app';
  const returnTo = rawReturnTo.startsWith('/') ? rawReturnTo : '/app';

  // Auth mode: 'sms' (normal) or 'email' (fallback when SMS failed)
  const [authMode, setAuthMode] = useState<'sms' | 'email'>('sms');
  const [phoneVerificationFailed, setPhoneVerificationFailed] = useState(false);

  // Recovery Mnemonic (BIP-39)
  const [mnemonic, setMnemonic] = useState<string>('');
  const [isExistingUser, setIsExistingUser] = useState(false);
  const [mnemonicInput, setMnemonicInput] = useState<string>('');
  const [restoreError, setRestoreError] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [qrValue, setQrValue] = useState('');

  // Step 1: Phone
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+7');
  const [phoneError, setPhoneError] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);

  // Step 2: Email (fallback only - when SMS fails)
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [sendCodeLoading, setSendCodeLoading] = useState(false);

  // Step 3: OTP
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '', '', '']);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);

  // Step 4: Recovery Key
  const [checkWritten, setCheckWritten] = useState(false);
  const [checkSafe, setCheckSafe] = useState(false);
  const [checkPrivacy, setCheckPrivacy] = useState(false);
  const [confirmRecoveryLoading, setConfirmRecoveryLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Step 5: Success
  const [showSuccess, setShowSuccess] = useState(false);
  const [isTauri] = useState(() => typeof window !== 'undefined' && !!(window as any).__TAURI__);

  // Firebase
  const confirmationResultRef = useRef<any>(null);
  const recaptchaVerifierRef = useRef<any>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-switch country code when language changes
  const languageToCountry: Record<string, string> = {
    ru: '+7',
    en: '+1',
  };

  useEffect(() => {
    const country = languageToCountry[language];
    if (country) setCountryCode(country);
  }, [language]);

  // Cleanup recaptcha on unmount
  useEffect(() => {
    return () => {
      if (recaptchaVerifierRef.current) {
        try {
          recaptchaVerifierRef.current.clear();
        } catch (e) {
          // Ignore reCAPTCHA cleanup errors
        }
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  // Resend timer
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds(resendSeconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  // ═══════════════════════════════════════════════════════════════════
  // Persistence: восстановить прогресс авторизации после обновления
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    loadAuthProgress().then((saved) => {
      if (!saved) return;
      console.log('[Auth] Restored progress: step', saved.step, 'mode', saved.authMode);
      setCurrentStep(saved.step as Step);
      setAuthMode(saved.authMode);
      if (saved.countryCode) setCountryCode(saved.countryCode);
      if (saved.phone) setPhone(saved.phone);
      if (saved.email) setEmail(saved.email);
      if (saved.otp && saved.otp.length === 8) setOtp(saved.otp);
      if (saved.resendSeconds) setResendSeconds(saved.resendSeconds);
      if (saved.phoneVerificationFailed) setPhoneVerificationFailed(true);
    }).catch(() => {});
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // Persistence: сохранять прогресс при каждом изменении ключевых полей
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (currentStep === 1 && !phone) return; // Не сохраняем пустой начальный шаг
    saveAuthProgress({
      step: currentStep,
      authMode,
      phone,
      countryCode,
      email,
      otp,
      resendSeconds,
      phoneVerificationFailed,
    }).catch(() => {});
  }, [currentStep, authMode, phone, countryCode, email, otp, resendSeconds, phoneVerificationFailed]);

  const goToStep = useCallback((step: Step) => {
    setDirection(step > currentStep ? 'forward' : 'backward');
    setCurrentStep(step);
    if (step === 3) {
      setResendSeconds(60);
      setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 450);
    }
  }, [currentStep]);

  const isValidPhone = (p: string) => p.replace(/\D/g, '').length >= 7;
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // Step 1: Phone submit — try SMS, fallback to email on failure
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(phone)) {
      setPhoneError(t('auth.error.phone'));
      return;
    }
    setPhoneError('');
    setPhoneLoading(true);

    try {
      const fullPhone = countryCode + phone.replace(/\D/g, '');

      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(
          auth,
          'recaptcha-container',
          {
            size: 'invisible',
            callback: () => {},
            'expired-callback': () => {
              setPhoneError(t('auth.error.recaptchaExpired'));
              recaptchaVerifierRef.current = null;
            },
          }
        );
        await recaptchaVerifierRef.current.render();
      }

      const confirmationResult = await signInWithPhoneNumber(
        auth,
        fullPhone,
        recaptchaVerifierRef.current
      );

      confirmationResultRef.current = confirmationResult;
      setAuthMode('sms');
      setPhoneVerificationFailed(false);
      setPhoneLoading(false);
      goToStep(3);
    } catch (_error) {
      console.error('Phone auth error:', _error);
      setAuthMode('email');
      setPhoneVerificationFailed(true);
      setPhoneLoading(false);
      goToStep(2);
    }
  };

  // Step 2: Email fallback
  const handleSendCode = async (e?: React.MouseEvent | React.FormEvent) => {
    if (e && 'preventDefault' in e) e.preventDefault();

    if (sendCodeLoading) return;

    if (!isValidEmail(email)) {
      setEmailError(t('auth.error.email'));
      return;
    }

    setEmailError('');
    setSendCodeLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true }
      });

      if (error) throw error;

      setSendCodeLoading(false);
      setTimeout(() => goToStep(3), 100);
    } catch (error: any) {
      console.error('Email OTP Error:', error);
      setEmailError(error.message || t('auth.error.unknown'));
      setSendCodeLoading(false);
    }
  };

  // Step 3: OTP handlers
  const handleOtpInput = (index: number, value: string) => {
    if (value && !/^\d$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 7) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
      const newOtp = [...otp];
      newOtp[index - 1] = '';
      setOtp(newOtp);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text').replace(/\D/g, '');
    const newOtp = [...otp];
    paste.split('').forEach((char, i) => {
      if (i < 8) newOtp[i] = char;
    });
    setOtp(newOtp);
    const nextEmpty = newOtp.findIndex((d) => !d);
    if (nextEmpty >= 0) {
      otpRefs.current[nextEmpty]?.focus();
    } else {
      otpRefs.current[7]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < 8) return;

    setVerifyLoading(true);
    setPhoneError('');

    try {
      let userIsExisting = false;

      if (authMode === 'sms') {
        if (!confirmationResultRef.current) {
          setPhoneError(t('auth.error.sessionExpired'));
          setVerifyLoading(false);
          return;
        }
        const result = await confirmationResultRef.current.confirm(code);

        // Сохраняем сессию в нативную SQLite (и параллельно в Supabase)
        if (result?.user) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) await persistSession(session).catch(() => {});
        }

        const { data: { user: sbUser } } = await supabase.auth.getUser();
        userIsExisting = !!(sbUser?.user_metadata?.e2ee_initialized);
        setIsExistingUser(userIsExisting);
      } else {
        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'email'
        });

        if (error) throw error;

        // Сохраняем сессию в нативную SQLite
        const { data: { session: emailSession } } = await supabase.auth.getSession();
        if (emailSession) await persistSession(emailSession).catch(() => {});

        userIsExisting = !!(data.user?.user_metadata?.e2ee_initialized);
        setIsExistingUser(userIsExisting);

        if (userIsExisting && await loadPrivateKey()) {
          setVerifyLoading(false);
          goToStep(5);
          setTimeout(() => {
            setShowSuccess(true);
            clearAuthProgress().catch(() => {});
            setTimeout(() => router.push(returnTo), 5000);
          }, 800);
          return;
        }
      }

      if (userIsExisting) {
        setVerifyLoading(false);
        goToStep(4);
      } else {
        // Генерация мнемоники в Rust (фоновый поток, не блокирует UI)
        try {
          const newMnemonic = await invoke('generate_mnemonic');
          setMnemonic(newMnemonic as string);
        } catch (err) {
          console.error('Mnemonic generation error:', err);
          setMnemonic('error generating mnemonic');
        }
        setVerifyLoading(false);
        goToStep(4);
      }
    } catch (error: any) {
      setVerifyLoading(false);
      console.error('Verification error:', error);
      setPhoneError(error.message || t('auth.error.unknown'));
    }
  };

  const handleResend = async () => {
    setResendSeconds(60);
    setOtp(['', '', '', '', '', '', '', '']);

    if (otpRefs.current && otpRefs.current[0]) {
      otpRefs.current[0].focus();
    }

    if (authMode === 'sms') {
      try {
        const fullPhone = countryCode + phone.replace(/\D/g, '');
        if (recaptchaVerifierRef.current) recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
        const result = await signInWithPhoneNumber(auth, fullPhone, recaptchaVerifierRef.current);
        confirmationResultRef.current = result;
      } catch {}
    } else {
      handleSendCode();
    }
  };

  const handleConfirmRecovery = async () => {
    if (!checkWritten || !checkSafe || !checkPrivacy) return;
    setConfirmRecoveryLoading(true);

    try {
      // Генерация ключей в Rust (BIP-39 seed через PBKDF2 в фоновом потоке)
      const keys = await invoke('generate_keys_from_mnemonic', { mnemonicPhrase: mnemonic }) as any;

      // Публичный ключ вычисляем через tweetnacl (как в старой версии)
      // Это гарантирует 100% совместимость со старыми чатами
      const seedBytes = keys.seed_base64 ? (await import('tweetnacl-util')).decodeBase64(keys.seed_base64) : null;
      const privateKeyBytes = (await import('tweetnacl-util')).decodeBase64(keys.private_key);

      let publicKeyBase64 = keys.public_key;
      if (seedBytes && seedBytes.length >= 32) {
        const seed32 = seedBytes.slice(0, 32);
        const publicKey = nacl.scalarMult.base(seed32);
        publicKeyBase64 = encodeBase64(publicKey);
      } else {
        // Fallback: используем приватный ключ как seed (32 байта)
        const publicKey = nacl.scalarMult.base(privateKeyBytes);
        publicKeyBase64 = encodeBase64(publicKey);
      }

      const { data: { session: recoverySession } } = await supabase.auth.getSession();
      if (recoverySession) {
  try {
    console.log('[Auth] Saving recovery session to local DB...');
    await persistSession(recoverySession);
    console.log('[Auth] Recovery session saved successfully!');
  } catch (e) {
    console.error('[Auth] Failed to save recovery session:', e);
  }
}

      await savePrivateKey(keys.private_key);
      localStorage.setItem('echo_public_key', publicKeyBase64);
      localStorage.setItem('echo_mnemonic_backup', mnemonic);

      const { error: authError } = await supabase.auth.updateUser({
        data: {
          public_key: publicKeyBase64,
          e2ee_initialized: true
        }
      });
      if (authError) throw authError;

      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        await supabase.from('profiles').upsert({
          id: userData.user.id,
          public_key: publicKeyBase64,
          e2ee_initialized: true,
          phone_number: authMode === 'sms' ? countryCode + phone.replace(/\D/g, '') : null,
          updated_at: new Date().toISOString()
        });
      }

      setConfirmRecoveryLoading(false);
      goToStep(5);
      setTimeout(() => {
        setShowSuccess(true);
        setTimeout(() => router.push(returnTo), 5000);
      }, 800);
    } catch (error: any) {
      setConfirmRecoveryLoading(false);
      setRestoreError(error.message || t('auth.error.unknown'));
    }
  };

  const handleRestore = async () => {
    setRestoreError('');
    const cleanMnemonic = mnemonicInput.trim().toLowerCase();

    // Валидация мнемоники через Rust (не блокирует поток)
    try {
      const isValid = await invoke('validate_mnemonic', { mnemonicPhrase: cleanMnemonic }) as boolean;
      if (!isValid) {
        setRestoreError(language === 'ru' ? 'Некорректная фраза.' : 'Invalid mnemonic phrase.');
        return;
      }
    } catch {
      setRestoreError(language === 'ru' ? 'Некорректная фраза.' : 'Invalid mnemonic phrase.');
      return;
    }

    setConfirmRecoveryLoading(true);
    try {
      // Генерация seed через Rust (PBKDF2), публичный ключ — через tweetnacl
      const keys = await invoke('generate_keys_from_mnemonic', { mnemonicPhrase: cleanMnemonic }) as any;

      // Вычисляем публичный ключ из seed через tweetnacl.scalarMult.base
      const privateKeyBytes = (await import('tweetnacl-util')).decodeBase64(keys.private_key);
      let publicKeyBase64 = keys.public_key;
      if (keys.seed_base64) {
        const seedBytes = (await import('tweetnacl-util')).decodeBase64(keys.seed_base64);
        if (seedBytes && seedBytes.length >= 32) {
          publicKeyBase64 = encodeBase64(nacl.scalarMult.base(seedBytes.slice(0, 32)));
        }
      } else {
        publicKeyBase64 = encodeBase64(nacl.scalarMult.base(privateKeyBytes));
      }

      const { data: { user } } = await supabase.auth.getUser();
      const storedPublicKey = user?.user_metadata?.public_key;

      if (storedPublicKey && storedPublicKey !== publicKeyBase64) {
        setRestoreError(language === 'ru' ? 'Фраза не подходит к этому аккаунту.' : 'Mnemonic does not match this account.');
        setConfirmRecoveryLoading(false);
        return;
      }

      await savePrivateKey(keys.private_key);
      localStorage.setItem('echo_public_key', publicKeyBase64);
      localStorage.setItem('echo_mnemonic_backup', cleanMnemonic);

      setConfirmRecoveryLoading(false);
      goToStep(5);
      setTimeout(() => {
        setShowSuccess(true);
        setTimeout(() => router.push(returnTo), 5000);
      }, 800);
    } catch (error) {
      setRestoreError(t('auth.error.unknown'));
      setConfirmRecoveryLoading(false);
    }
  };

  const handleBackToPhone = () => {
    setResendSeconds(0);
    setOtp(['', '', '', '', '', '', '', '']);
    setAuthMode('sms');
    goToStep(1);
  };

  const handleBackToEmail = () => {
    setResendSeconds(0);
    setOtp(['', '', '', '', '', '', '', '']);
    setAuthMode('email');
    goToStep(2);
  };

  const countries = [
    { code: '+7', flag: '🇷🇺', name: 'Russia' },
    { code: '+1', flag: '🇺🇸', name: 'United States' },
    { code: '+44', flag: '🇬🇧', name: 'United Kingdom' },
    { code: '+49', flag: '🇩🇪', name: 'Germany' },
    { code: '+33', flag: '🇫🇷', name: 'France' },
    { code: '+380', flag: '🇺🇦', name: 'Ukraine' },
    { code: '+77', flag: '🇰🇿', name: 'Kazakhstan' },
  ];

  const progressDots = (activeStep: number) => (
    <div className="flex gap-2 sm:gap-3 mb-8 sm:mb-12 justify-center">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="relative group">
          <div
            className={cn(
              "h-1 rounded-full transition-all duration-700 ease-out",
              i + 1 < activeStep ? "bg-primary w-6 sm:w-12" : i + 1 === activeStep ? "bg-primary w-10 sm:w-16" : "bg-white/10 w-4 sm:w-8 group-hover:bg-white/20"
            )}
          />
          {i + 1 === activeStep && (
            <div className="absolute inset-0 bg-primary blur-md opacity-40 animate-pulse" />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background text-foreground flex items-center justify-center p-4 sm:p-6 md:p-10 font-sans noise-overlay">
      {/* Immersive Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 opacity-30 sm:opacity-40 mix-blend-screen">
          <AnimatedSphere />
        </div>

        {/* Dynamic Orbs - hidden on small screens for performance */}
        <div className="hidden sm:block absolute top-[10%] left-[-5%] w-[40vw] h-[40vw] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
        <div className="hidden sm:block absolute bottom-[-10%] right-[-5%] w-[45vw] h-[45vw] bg-blue-500/10 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="hidden sm:block absolute top-[40%] right-[10%] w-[30vw] h-[30vw] bg-purple-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '4s' }} />

        {/* Scanline Effect */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_4px] pointer-events-none opacity-10 sm:opacity-20" />
      </div>

      {/* Hidden reCAPTCHA */}
      <div id="recaptcha-container" className="hidden" />

      <div className="relative z-10 w-full max-w-md md:max-w-3xl max-h-[90vh] overflow-y-auto px-1 sm:px-0">
        {/* Logo & Header */}
        <div className="mb-4 sm:mb-6 text-center">
          <div className="relative inline-flex items-center justify-center mb-4 sm:mb-6 group">
            <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150 group-hover:scale-175 transition-transform duration-700" />
            <div className="relative h-10 sm:h-12 flex items-center justify-center">
               <img src="/logo-full.svg" alt="Echo" className="h-full w-auto relative z-10" />
            </div>
          </div>
          {!isTauri && (
            <p className="text-muted-foreground text-[10px] sm:text-sm font-mono tracking-widest uppercase opacity-60">
              {t('auth.subtitle')}
            </p>
          )}
        </div>

        {/* Auth Container with Architectural details */}
        <div className={cn(
          "relative transition-all duration-1000 ease-in-out",
          showSuccess ? "scale-90 opacity-0 blur-xl" : "scale-100 opacity-100 blur-0"
        )}>
          {/* Decorative Corner Brackets - hidden on mobile */}
          <div className="hidden sm:block absolute -top-4 -left-4 w-12 h-12 border-t-2 border-l-2 border-primary/30 rounded-tl-2xl" />
          <div className="hidden sm:block absolute -top-4 -right-4 w-12 h-12 border-t-2 border-r-2 border-primary/30 rounded-tr-2xl" />
          <div className="hidden sm:block absolute -bottom-4 -left-4 w-12 h-12 border-b-2 border-l-2 border-primary/30 rounded-bl-2xl" />
          <div className="hidden sm:block absolute -bottom-4 -right-4 w-12 h-12 border-b-2 border-r-2 border-primary/30 rounded-br-2xl" />

          <div className="bg-card/40 backdrop-blur-3xl border border-white/5 rounded-3xl sm:rounded-[40px] p-5 sm:p-8 md:p-10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] relative overflow-hidden group">
            {/* Glossy Overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />

            {progressDots(currentStep)}

            <div className="relative">
              {/* STEP 1: Phone */}
              {currentStep === 1 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  {/* Mobile: icon + title + description */}
                  <div className="md:hidden text-center">
                    <div className="flex justify-center mb-4">
                      <div className="w-14 h-14 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center relative">
                        <div className="absolute inset-0 rounded-full animate-ping bg-primary/10 opacity-40" />
                        <Smartphone className="w-6 h-6 text-primary relative z-10" />
                      </div>
                    </div>
                    <h2 className="text-xl font-display mb-1">{t('auth.step1.title')}</h2>
                    <p className="text-muted-foreground text-[11px] mb-5 leading-relaxed px-2">{t('auth.step1.description')}</p>
                  </div>

                  <div className="flex flex-col md:flex-row md:gap-6 md:items-stretch">
                    {/* Desktop: QR Code panel */}
                    <div className="hidden md:flex flex-col items-center justify-center w-[200px] shrink-0">
                      <div className="bg-white p-4 rounded-2xl mb-4 shadow-lg">
                        <QRCodeSVG value={qrValue || 'https://echo.app/login'} size={140} bgColor="#ffffff" fgColor="#000000" level="M" />
                      </div>
                      <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest text-center">{language === 'ru' ? 'Сканируйте для входа' : 'Scan to sign in'}</p>
                    </div>

                    {/* Divider — desktop */}
                    <div className="hidden md:block w-px bg-white/5" />

                    {/* Phone form panel */}
                    <div className="flex-1 min-w-0">
                      {/* Desktop: title + description */}
                      <div className="hidden md:block text-center mb-6">
                        <h2 className="text-2xl font-display mb-2">{t('auth.step1.title')}</h2>
                        <p className="text-muted-foreground text-xs leading-relaxed px-4">{t('auth.step1.description')}</p>
                      </div>

                      <form onSubmit={handlePhoneSubmit} className="space-y-3 sm:space-y-4">
                        <div className="flex gap-2 sm:gap-4">
                          <CountrySelector value={countryCode} onChange={setCountryCode} countries={countries} />
                          <div className="flex-1 relative group/input">
                            <div className="absolute -inset-0.5 bg-primary/20 rounded-2xl blur opacity-0 group-focus-within/input:opacity-100 transition duration-500" />
                            <input
                              type="tel"
                              value={phone}
                              onChange={(e) => { setPhone(e.target.value.replace(/[^\d ]/g, '')); setPhoneError(''); }}
                              className={cn(
                                "relative w-full h-12 sm:h-14 bg-background/50 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 text-base sm:text-lg font-medium text-white outline-none focus:border-primary/50 focus:bg-background/80 transition-all placeholder:text-white/20",
                                phoneError && "border-destructive/50"
                              )}
                              placeholder="999 123 45 67"
                            />
                          </div>
                        </div>
                        {phoneError && <p className="text-destructive text-[10px] sm:text-xs text-center font-mono uppercase tracking-tighter">{phoneError}</p>}

                        <button
                          disabled={phoneLoading}
                          className="w-full h-12 sm:h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl sm:rounded-2xl shadow-lg sm:shadow-xl shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3 group/btn overflow-hidden relative text-sm sm:text-base"
                        >
                          <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
                          {phoneLoading ? <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" /> : (
                            <>
                              <span>{t('auth.phone.continue')}</span>
                              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover/btn:translate-x-1 transition-transform" />
                            </>
                          )}
                        </button>
                      </form>

                      {/* Protected by Google — full banner on mobile */}
                      <div className="md:hidden mt-6 p-3 sm:p-4 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex items-center gap-3 sm:gap-4 transition-colors hover:bg-white/[0.05]">
                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                          <ShieldCheck className="w-5 h-5 text-primary" />
                        </div>
                        <div className="text-[9px] sm:text-[10px] leading-relaxed text-white/40 uppercase tracking-widest font-semibold">
                          Protected by Google <br/>
                          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors">Privacy</a> & <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors">Terms</a>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Email Fallback */}
              {currentStep === 2 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-center mb-6 sm:mb-10">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Mail className="w-7 h-7 sm:w-9 sm:h-9 text-blue-400" />
                    </div>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-display text-center mb-2 sm:mb-3">{t('auth.step2.fallback.title')}</h2>

                  <div className="bg-destructive/10 border border-destructive/20 rounded-2xl sm:rounded-3xl p-4 sm:p-6 mb-6 sm:mb-10 flex gap-3 sm:gap-4 items-start relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-destructive" />
                    <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-destructive shrink-0" />
                    <p className="text-[10px] sm:text-xs text-destructive-foreground/80 leading-relaxed font-medium uppercase tracking-wider">{t('auth.sms_unavailable')}</p>
                  </div>

                  <form onSubmit={handleSendCode} className="space-y-5 sm:space-y-8">
                    <div className="space-y-2 sm:space-y-3">
                      <label className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.3em] text-white/30 ml-2">Secure Link Relay</label>
                      <div className="relative group/input">
                        <div className="absolute -inset-0.5 bg-blue-500/20 rounded-2xl blur opacity-0 group-focus-within/input:opacity-100 transition duration-500" />
                        <Mail className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-white/20" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                          className={cn(
                            "relative w-full h-12 sm:h-14 bg-background/50 border border-white/10 rounded-xl sm:rounded-2xl pl-11 sm:pl-14 pr-4 sm:pr-5 text-base sm:text-lg font-medium text-white outline-none focus:border-blue-500/50 focus:bg-background/80 transition-all",
                            emailError && "border-destructive/50"
                          )}
                          placeholder="node@encrypted.net"
                        />
                      </div>
                    </div>
                    {emailError && <p className="text-destructive text-[10px] sm:text-xs mt-1 sm:mt-2 text-center font-mono uppercase">{emailError}</p>}

                    <button
                      disabled={sendCodeLoading}
                      className="w-full h-12 sm:h-14 bg-white text-black font-bold rounded-xl sm:rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-lg sm:shadow-xl hover:bg-white/90 text-sm sm:text-base"
                    >
                      {sendCodeLoading ? <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" /> : (
                        <>
                          <span>{t('auth.send.code')}</span>
                          <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                        </>
                      )}
                    </button>

                    <button type="button" onClick={handleBackToPhone} className="w-full flex items-center justify-center gap-2 text-[10px] sm:text-xs font-bold text-white/30 hover:text-white transition-colors uppercase tracking-[0.2em]">
                      <RefreshCw className="w-3 h-3 sm:w-4 sm:h-4" />
                      {t('auth.back.phone')}
                    </button>
                  </form>
                </div>
              )}

              {/* STEP 3: OTP */}
              {currentStep === 3 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-center mb-6 sm:mb-10">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center relative overflow-hidden">
                      <Lock className="w-7 h-7 sm:w-9 sm:h-9 text-primary relative z-10" />
                      <div className="absolute inset-0 bg-primary/5 animate-pulse" />
                    </div>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-display text-center mb-2 sm:mb-3">{t('auth.step3.title')}</h2>
                  <p className="text-muted-foreground text-center text-xs sm:text-sm mb-6 sm:mb-12 leading-relaxed px-2 sm:px-6">
                    {authMode === 'sms' ? t('auth.step3.sms.description') : t('auth.step3.email.description')}<br/>
                    <span className="text-primary font-mono mt-2 sm:mt-3 block text-sm sm:text-lg font-bold tracking-tight">{authMode === 'sms' ? `${countryCode} ${phone}` : email}</span>
                  </p>

                  <div className="flex justify-center gap-1.5 sm:gap-3 mb-6 sm:mb-12 px-1" onPaste={handlePaste}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => { otpRefs.current[i] = el; }}
                        type="text"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpInput(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        className="w-8 h-10 sm:w-11 sm:h-14 bg-background/50 border border-white/10 rounded-lg sm:rounded-2xl text-center text-base sm:text-2xl font-bold text-primary focus:border-primary focus:bg-background/80 outline-none transition-all shadow-inner"
                      />
                    ))}
                  </div>

                  <button
                    onClick={handleVerify}
                    disabled={verifyLoading || otp.some(d => !d)}
                    className="w-full h-12 sm:h-14 bg-primary text-primary-foreground font-bold rounded-xl sm:rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-30 shadow-lg sm:shadow-2xl shadow-primary/20 text-sm sm:text-base"
                  >
                    {verifyLoading ? <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" /> : (
                      <>
                        <span className="uppercase tracking-widest">{t('auth.verify')}</span>
                      </>
                    )}
                  </button>

                  <div className="mt-6 sm:mt-8 text-center">
                    {resendSeconds > 0 ? (
                      <div className="inline-flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-1.5 sm:py-2 rounded-full bg-white/[0.03] border border-white/5">
                        <RefreshCw className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white/20 animate-spin" />
                        <p className="text-[9px] sm:text-[11px] font-bold text-white/30 uppercase tracking-[0.2em]">{t('auth.resend.timer')} <span className="text-white font-mono">{resendSeconds}</span> {t('auth.resend.sec')}</p>
                      </div>
                    ) : (
                      <button onClick={handleResend} className="text-[10px] sm:text-[11px] text-primary hover:text-primary/80 font-bold uppercase tracking-[0.3em] border-b border-primary/20 pb-1 transition-all">{t('auth.resend.btn')}</button>
                    )}
                  </div>

                  <button onClick={authMode === 'sms' ? handleBackToPhone : handleBackToEmail} className="w-full mt-6 sm:mt-10 text-center text-[9px] sm:text-[10px] font-bold text-white/20 hover:text-white transition-colors uppercase tracking-[0.3em]">
                    {authMode === 'sms' ? t('auth.back.phone') : t('auth.back.email')}
                  </button>
                </div>
              )}

              {/* STEP 4: Recovery Key */}
              {currentStep === 4 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-center mb-6 sm:mb-10">
                    <div className={cn(
                      "w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-[32px] flex items-center justify-center shadow-2xl transition-colors duration-1000",
                      isExistingUser ? "bg-blue-500/10 border border-blue-500/20" : "bg-destructive/10 border border-destructive/20"
                    )}>
                      <Key className={cn("w-8 h-8 sm:w-10 sm:h-10", isExistingUser ? "text-blue-400" : "text-destructive")} />
                    </div>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-display text-center mb-2 sm:mb-3">{isExistingUser ? (language === 'ru' ? 'Синхронизация' : 'Sync Key') : t('auth.step4.title')}</h2>
                  <p className="text-muted-foreground text-center text-xs sm:text-sm mb-6 sm:mb-12 leading-relaxed px-2 sm:px-6" dangerouslySetInnerHTML={{ __html: isExistingUser ? (language === 'ru' ? 'Введите вашу 12-словную фразу для дешифрования данных.' : 'Input your 12-word recovery mnemonic to decrypt vault.') : t('auth.step4.description') }} />

                  {isExistingUser ? (
                    <div className="space-y-5 sm:space-y-8">
                      <div className="relative group/input">
                        <div className="absolute -inset-1 bg-blue-500/10 rounded-2xl sm:rounded-3xl blur opacity-100 group-focus-within/input:bg-blue-500/20 transition duration-1000" />
                        <textarea
                          value={mnemonicInput}
                          onChange={(e) => { setMnemonicInput(e.target.value); setRestoreError(''); }}
                          className="relative w-full h-32 sm:h-40 bg-background/60 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 text-white text-xs sm:text-sm font-mono leading-relaxed outline-none focus:border-blue-500/50 transition-all resize-none shadow-inner scrollbar-hide"
                          placeholder={language === 'ru' ? 'Введите 12 слов...' : 'Enter your 12 words here...'}
                        />
                      </div>
                      {restoreError && <p className="text-destructive text-[10px] sm:text-xs text-center font-mono uppercase tracking-widest">{restoreError}</p>}
                      <button
                        onClick={handleRestore}
                        disabled={confirmRecoveryLoading || !mnemonicInput.trim()}
                        className="w-full h-12 sm:h-14 bg-blue-600 text-white font-bold rounded-xl sm:rounded-2xl flex items-center justify-center gap-3 shadow-lg sm:shadow-xl shadow-blue-500/10 hover:bg-blue-500 transition-all active:scale-[0.98] text-sm sm:text-base"
                      >
                        {confirmRecoveryLoading ? <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" /> : (
                          <>
                            <span className="uppercase tracking-widest">{language === 'ru' ? 'Восстановить' : 'Restore'}</span>
                            <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-5 sm:space-y-8">
                      <div className="bg-destructive/5 border border-destructive/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex gap-3 sm:gap-4 items-start relative overflow-hidden group/warning">
                        <div className="absolute top-0 left-0 w-1 h-full bg-destructive transition-transform duration-700 origin-top group-hover/warning:scale-y-110" />
                        <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-destructive shrink-0 mt-0.5" />
                        <p className="text-[10px] sm:text-xs text-destructive-foreground/80 leading-relaxed font-medium uppercase tracking-[0.05em]">{t('auth.recovery.warning')}</p>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                        {mnemonic.split(' ').map((word, i) => (
                          <div key={i} className="bg-white/[0.03] border border-white/5 p-2 sm:p-3 rounded-xl sm:rounded-2xl text-center relative group/word hover:bg-white/[0.08] transition-all hover:scale-105">
                            <span className="absolute top-0.5 left-1.5 sm:top-1 sm:left-2 text-[7px] sm:text-[8px] text-white/20 font-bold font-mono">{i + 1}</span>
                            <span className="text-[10px] sm:text-xs font-mono font-bold tracking-tight text-white/80">{word}</span>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => { navigator.clipboard.writeText(mnemonic); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}
                        className="w-full h-10 sm:h-12 bg-white/[0.02] border border-white/10 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.4em] flex items-center justify-center gap-2 sm:gap-3 hover:bg-white/[0.05] transition-all hover:text-primary hover:border-primary/30"
                      >
                        {copiedKey ? <Check className="w-3 h-3 sm:w-4 sm:h-4 text-green-400" /> : <Copy className="w-3 h-3 sm:w-4 sm:h-4" />}
                        {copiedKey ? t('auth.recovery.copied') : t('auth.recovery.copy')}
                      </button>

                      <div className="space-y-3 sm:space-y-4 pt-2 sm:pt-4">
                        {[
                          { checked: checkWritten, set: setCheckWritten, text: t('auth.recovery.check1') },
                          { checked: checkSafe, set: setCheckSafe, text: t('auth.recovery.check2') },
                          { checked: checkPrivacy, set: setCheckPrivacy, text: t('auth.recovery.check3') }
                        ].map((check, i) => (
                          <label key={i} className="flex items-start gap-3 sm:gap-4 cursor-pointer group/check">
                            <div className={cn(
                              "w-5 h-5 sm:w-6 sm:h-6 rounded-lg border border-white/20 flex items-center justify-center transition-all shrink-0 mt-0.5",
                              check.checked ? "bg-primary border-primary scale-110 shadow-[0_0_15px_rgba(var(--primary),0.3)]" : "bg-white/5 group-hover:check:border-primary/50"
                            )}>
                              {check.checked && <Check className="w-3 h-3 sm:w-4 sm:h-4 text-primary-foreground" />}
                              <input type="checkbox" className="hidden" checked={check.checked} onChange={e => check.set(e.target.checked)} />
                            </div>
                            <span className="text-[10px] sm:text-xs text-white/40 group-hover:check:text-white/80 transition-colors leading-tight pt-1 font-medium uppercase tracking-wider">{check.text}</span>
                          </label>
                        ))}
                      </div>

                      <button
                        onClick={handleConfirmRecovery}
                        disabled={confirmRecoveryLoading || !checkWritten || !checkSafe || !checkPrivacy}
                        className="w-full h-12 sm:h-14 bg-primary text-primary-foreground font-bold rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 sm:gap-3 disabled:opacity-30 shadow-lg sm:shadow-2xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95 text-sm sm:text-base"
                      >
                        <span className="uppercase tracking-[0.2em]">{t('auth.recovery.confirm')}</span>
                        <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 5: Redirecting */}
              {currentStep === 5 && (
                <div className="py-12 sm:py-20 flex flex-col items-center justify-center text-center animate-in zoom-in duration-1000">
                  <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-3xl sm:rounded-[40px] bg-primary/10 border border-primary/20 flex items-center justify-center mb-8 sm:mb-12 relative group">
                     <div className="absolute inset-0 rounded-3xl sm:rounded-[40px] border-4 border-primary animate-ping opacity-10" />
                     <div className="absolute inset-0 rounded-3xl sm:rounded-[40px] bg-primary/5 blur-xl group-hover:bg-primary/20 transition-all duration-1000" />
                     <ShieldCheck className="w-10 h-10 sm:w-14 sm:h-14 text-primary relative z-10" />
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-display mb-4 sm:mb-6 tracking-tight">{t('auth.step5.title')}</h2>
                  <p className="text-muted-foreground mb-8 sm:mb-12 max-w-xs mx-auto leading-relaxed text-xs sm:text-base">{t('auth.step5.description')}</p>

                  <div className="w-full max-w-[180px] sm:max-w-[240px] h-1 sm:h-1.5 bg-white/[0.03] rounded-full overflow-hidden relative border border-white/5">
                     <div className="h-full bg-primary animate-progress origin-left shadow-[0_0_15px_rgba(var(--primary),0.8)]" />
                  </div>
                  <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.5em] text-primary mt-6 sm:mt-8 font-bold animate-pulse">Establishing Node</p>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* Protected by Google — desktop round button */}
      {currentStep === 1 && (
        <div className="hidden md:flex justify-center mt-4 group/google relative">
          <button className="w-8 h-8 rounded-full bg-white/[0.03] border border-white/5 flex items-center justify-center hover:bg-white/[0.08] transition-all">
            <ShieldCheck className="w-3.5 h-3.5 text-white/20" />
          </button>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-4 py-3 bg-card/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl opacity-0 group-hover/google:opacity-100 pointer-events-none group-hover/google:pointer-events-auto transition-all duration-300 translate-y-1 group-hover/google:translate-y-0 w-52 z-20">
            <p className="text-[10px] text-white/60 leading-relaxed mb-2">{language === 'ru' ? 'reCAPTCHA защищает от автоматических атак.' : 'reCAPTCHA protects from automated attacks.'}</p>
            <div className="flex gap-3">
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:text-primary/80 font-medium">Privacy</a>
              <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:text-primary/80 font-medium">Terms</a>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* Success Overlay with Deep Immersion */}
      {showSuccess && (
        <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center animate-in fade-in duration-1000 overflow-hidden">
          <div className="absolute inset-0 noise-overlay pointer-events-none" />
          <div className="hidden sm:block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-primary/20 rounded-full blur-[180px] animate-pulse" />

          <div className="relative text-center space-y-8 sm:space-y-12 max-w-sm px-6 sm:px-8 z-10">
            <div className="relative inline-flex items-center justify-center group">
               <div className="absolute inset-0 bg-primary/20 blur-[60px] rounded-full animate-pulse" />
               <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-[32px] sm:rounded-[48px] bg-card border border-primary/20 flex items-center justify-center shadow-[0_0_100px_rgba(var(--primary),0.2)] transform rotate-12 group-hover:rotate-0 transition-transform duration-1000">
                  <Fingerprint className="w-12 h-12 sm:w-16 sm:h-16 text-primary" />
               </div>
            </div>

            <div className="space-y-3 sm:space-y-4">
              <h2 className="text-3xl sm:text-5xl font-display tracking-tight leading-none">{t('auth.success.title')}</h2>
              <p className="text-muted-foreground leading-relaxed uppercase tracking-[0.1em] text-[10px] sm:text-xs font-bold">{t('auth.success.text')}</p>
            </div>

            <div className="pt-6 sm:pt-12">
              <div className="inline-flex items-center gap-2 sm:gap-3 text-[9px] sm:text-[11px] font-mono text-primary uppercase tracking-[0.4em] border border-primary/20 px-5 sm:px-8 py-3 sm:py-4 rounded-full bg-primary/5 backdrop-blur-md">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-primary animate-ping" />
                Auth_Token_Verified
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS for advanced animations */}
      <style jsx global>{`
        @keyframes progress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        .animate-progress {
          animation: progress 5s linear forwards;
        }
        .line-reveal {
          clip-path: inset(0 100% 0 0);
          animation: line-reveal 1.2s cubic-bezier(0.77, 0, 0.175, 1) forwards;
        }
        @keyframes line-reveal {
          to { clip-path: inset(0 0 0 0); }
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center noise-overlay">
        <div className="relative w-24 h-24">
           <div className="absolute inset-0 border-4 border-primary/10 rounded-full" />
           <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(var(--primary),0.3)]" />
           <Shield className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 text-primary/40" />
        </div>
      </div>
    }>
      <AuthPageContent />
    </Suspense>
  );
}
