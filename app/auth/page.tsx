"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/hooks/use-translation';
import { CountrySelector } from '@/components/auth/country-selector';
import { auth } from '@/lib/firebase';
import { supabase } from '@/lib/supabase';
import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
// @ts-ignore
import { encodeBase64 } from 'tweetnacl-util';
import { QRCodeSVG } from 'qrcode.react';
import {
  signInWithPhoneNumber,
  RecaptchaVerifier,
} from 'firebase/auth';
import { AnimatedSphere } from '@/components/echo/animated-sphere';
import { Shield, Smartphone, Mail, Lock, Check, Copy, ArrowRight, RefreshCw, AlertTriangle, Fingerprint, Globe, Key, ShieldCheck } from 'lucide-react';
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
      if (authMode === 'sms') {
        if (!confirmationResultRef.current) {
          setPhoneError(t('auth.error.sessionExpired'));
          setVerifyLoading(false);
          return;
        }
        await confirmationResultRef.current.confirm(code);
        
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        if (sbUser?.user_metadata?.e2ee_initialized) {
          setIsExistingUser(true);
        }
      } else {
        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'email'
        });

        if (error) throw error;
        
        if (data.user?.user_metadata?.e2ee_initialized) {
          setIsExistingUser(true);
          if (localStorage.getItem('echo_private_key')) {
            setVerifyLoading(false);
            goToStep(5);
            setTimeout(() => {
              setShowSuccess(true);
              setTimeout(() => router.push('/app'), 5000);
            }, 800);
            return;
          }
        }
      }

      if (isExistingUser) {
        setVerifyLoading(false);
        goToStep(4);
      } else {
        setMnemonic(bip39.generateMnemonic());
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
      const seed = bip39.mnemonicToSeedSync(mnemonic).slice(0, 32);
      const publicKey = nacl.scalarMult.base(seed);
      const publicKeyBase64 = encodeBase64(publicKey);
      const privateKeyBase64 = encodeBase64(seed);

      localStorage.setItem('echo_private_key', privateKeyBase64);
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
        setTimeout(() => router.push('/app'), 5000);
      }, 800);
    } catch (error: any) {
      setConfirmRecoveryLoading(false);
      setRestoreError(error.message || t('auth.error.unknown'));
    }
  };

  const handleRestore = async () => {
    setRestoreError('');
    const cleanMnemonic = mnemonicInput.trim().toLowerCase();
    
    if (!bip39.validateMnemonic(cleanMnemonic)) {
      setRestoreError(language === 'ru' ? 'Некорректная фраза.' : 'Invalid mnemonic phrase.');
      return;
    }

    setConfirmRecoveryLoading(true);
    try {
      const seed = bip39.mnemonicToSeedSync(cleanMnemonic).slice(0, 32);
      const publicKey = nacl.scalarMult.base(seed);
      const publicKeyBase64 = encodeBase64(publicKey);
      const privateKeyBase64 = encodeBase64(seed);

      const { data: { user } } = await supabase.auth.getUser();
      const storedPublicKey = user?.user_metadata?.public_key;

      if (storedPublicKey && storedPublicKey !== publicKeyBase64) {
        setRestoreError(language === 'ru' ? 'Фраза не подходит к этому аккаунту.' : 'Mnemonic does not match this account.');
        setConfirmRecoveryLoading(false);
        return;
      }

      localStorage.setItem('echo_private_key', privateKeyBase64);
      localStorage.setItem('echo_public_key', publicKeyBase64);
      localStorage.setItem('echo_mnemonic_backup', cleanMnemonic);

      setConfirmRecoveryLoading(false);
      goToStep(5);
      setTimeout(() => {
        setShowSuccess(true);
        setTimeout(() => router.push('/app'), 5000);
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
    <div className="flex gap-3 mb-12 justify-center">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="relative group">
          <div 
            className={cn(
              "h-1 rounded-full transition-all duration-700 ease-out",
              i + 1 < activeStep ? "bg-primary w-12" : i + 1 === activeStep ? "bg-primary w-16" : "bg-white/10 w-8 group-hover:bg-white/20"
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
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden flex items-center justify-center p-6 font-sans noise-overlay">
      {/* Immersive Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 opacity-40 mix-blend-screen">
          <AnimatedSphere />
        </div>
        
        {/* Dynamic Orbs */}
        <div className="absolute top-[10%] left-[-5%] w-[40vw] h-[40vw] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[45vw] h-[45vw] bg-blue-500/10 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-[40%] right-[10%] w-[30vw] h-[30vw] bg-purple-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '4s' }} />
        
        {/* Scanline Effect */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_4px] pointer-events-none opacity-20" />
      </div>

      {/* Hidden reCAPTCHA */}
      <div id="recaptcha-container" className="hidden" />

      <div className="relative z-10 w-full max-w-[480px]">
        {/* Logo & Header */}
        <div className="mb-12 text-center transform transition-transform duration-1000">
          <div className="relative inline-flex items-center justify-center mb-6 group">
            <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150 group-hover:scale-175 transition-transform duration-700" />
            <div className="relative h-12 flex items-center justify-center">
               <img src="/logo-full.svg" alt="Echo" className="h-full w-auto relative z-10" />
            </div>
          </div>
          <p className="text-muted-foreground text-sm font-mono tracking-widest uppercase opacity-60">
             {t('auth.subtitle')}
          </p>
        </div>

        {/* Auth Container with Architectural details */}
        <div className={cn(
          "relative transition-all duration-1000 ease-in-out",
          showSuccess ? "scale-90 opacity-0 blur-xl" : "scale-100 opacity-100 blur-0"
        )}>
          {/* Decorative Corner Brackets */}
          <div className="absolute -top-4 -left-4 w-12 h-12 border-t-2 border-l-2 border-primary/30 rounded-tl-2xl" />
          <div className="absolute -top-4 -right-4 w-12 h-12 border-t-2 border-r-2 border-primary/30 rounded-tr-2xl" />
          <div className="absolute -bottom-4 -left-4 w-12 h-12 border-b-2 border-l-2 border-primary/30 rounded-bl-2xl" />
          <div className="absolute -bottom-4 -right-4 w-12 h-12 border-b-2 border-r-2 border-primary/30 rounded-br-2xl" />

          <div className="bg-card/40 backdrop-blur-3xl border border-white/5 rounded-[40px] p-10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] relative overflow-hidden group">
            {/* Glossy Overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />
            
            {progressDots(currentStep)}

            <div className="relative">
              {/* STEP 1: Phone */}
              {currentStep === 1 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-center mb-10">
                    <div className="w-20 h-20 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center relative">
                      <div className="absolute inset-0 rounded-full animate-ping bg-primary/10 opacity-40" />
                      <Smartphone className="w-9 h-9 text-primary relative z-10" />
                    </div>
                  </div>
                  <h2 className="text-3xl font-display text-center mb-3">{t('auth.step1.title')}</h2>
                  <p className="text-muted-foreground text-center text-sm mb-10 leading-relaxed px-4">{t('auth.step1.description')}</p>

                  <form onSubmit={handlePhoneSubmit} className="space-y-8">
                    <div className="flex gap-4">
                      <CountrySelector value={countryCode} onChange={setCountryCode} countries={countries} />
                      <div className="flex-1 relative group/input">
                        <div className="absolute -inset-0.5 bg-primary/20 rounded-2xl blur opacity-0 group-focus-within/input:opacity-100 transition duration-500" />
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => { setPhone(e.target.value.replace(/[^\d ]/g, '')); setPhoneError(''); }}
                          className={cn(
                            "relative w-full h-14 bg-background/50 border border-white/10 rounded-2xl px-5 text-lg font-medium text-white outline-none focus:border-primary/50 focus:bg-background/80 transition-all placeholder:text-white/20",
                            phoneError && "border-destructive/50"
                          )}
                          placeholder="999 123 45 67"
                        />
                      </div>
                    </div>
                    {phoneError && <p className="text-destructive text-xs mt-2 text-center font-mono uppercase tracking-tighter">{phoneError}</p>}

                    <button 
                      disabled={phoneLoading}
                      className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3 group/btn overflow-hidden relative"
                    >
                      <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
                      {phoneLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : (
                        <>
                          <span className="text-lg">{t('auth.phone.continue')}</span>
                          <ArrowRight className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                        </>
                      )}
                    </button>
                  </form>

                  <div className="mt-10 p-5 rounded-3xl bg-white/[0.03] border border-white/[0.05] flex items-center gap-5 transition-colors hover:bg-white/[0.05]">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-6 h-6 text-primary" />
                    </div>
                    <div className="text-[11px] leading-relaxed text-white/40 uppercase tracking-widest font-semibold">
                      Protected by Google <br/>
                      <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors">Privacy</a> & <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors">Terms</a>
                    </div>
                  </div>

                  <div className="mt-10 flex items-center gap-6 text-white/10">
                    <div className="h-px flex-1 bg-current" />
                    <span className="text-[11px] uppercase tracking-[0.2em] font-bold text-white/30">{t('auth.or')}</span>
                    <div className="h-px flex-1 bg-current" />
                  </div>

                  <div className="mt-10 grid grid-cols-2 gap-4">
                    <button className="h-14 bg-white/[0.03] border border-white/5 rounded-2xl flex items-center justify-center gap-3 hover:bg-white/[0.08] transition-all hover:border-white/10 group/social">
                       <svg className="w-6 h-6 group-hover/social:scale-110 transition-transform" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                       </svg>
                       <span className="text-sm font-semibold tracking-wide">Google</span>
                    </button>
                    <button disabled className="h-14 bg-white/[0.03] border border-white/5 rounded-2xl flex items-center justify-center gap-3 opacity-30 cursor-not-allowed">
                       <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                       </svg>
                       <span className="text-sm font-semibold tracking-wide">Apple</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Email Fallback */}
              {currentStep === 2 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-center mb-10">
                    <div className="w-20 h-20 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Mail className="w-9 h-9 text-blue-400" />
                    </div>
                  </div>
                  <h2 className="text-3xl font-display text-center mb-3">{t('auth.step2.fallback.title')}</h2>
                  
                  <div className="bg-destructive/10 border border-destructive/20 rounded-3xl p-6 mb-10 flex gap-4 items-start relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-destructive" />
                    <AlertTriangle className="w-6 h-6 text-destructive shrink-0" />
                    <p className="text-xs text-destructive-foreground/80 leading-relaxed font-medium uppercase tracking-wider">{t('auth.sms_unavailable')}</p>
                  </div>

                  <form onSubmit={handleSendCode} className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/30 ml-2">Secure Link Relay</label>
                      <div className="relative group/input">
                        <div className="absolute -inset-0.5 bg-blue-500/20 rounded-2xl blur opacity-0 group-focus-within/input:opacity-100 transition duration-500" />
                        <Mail className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
                          className={cn(
                            "relative w-full h-14 bg-background/50 border border-white/10 rounded-2xl pl-14 pr-5 text-lg font-medium text-white outline-none focus:border-blue-500/50 focus:bg-background/80 transition-all",
                            emailError && "border-destructive/50"
                          )}
                          placeholder="node@encrypted.net"
                        />
                      </div>
                    </div>
                    {emailError && <p className="text-destructive text-xs mt-2 text-center font-mono uppercase">{emailError}</p>}

                    <button 
                      disabled={sendCodeLoading}
                      className="w-full h-14 bg-white text-black font-bold rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-xl hover:bg-white/90"
                    >
                      {sendCodeLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : (
                        <>
                          <span className="text-lg">{t('auth.send.code')}</span>
                          <ArrowRight className="w-5 h-5" />
                        </>
                      )}
                    </button>

                    <button type="button" onClick={handleBackToPhone} className="w-full flex items-center justify-center gap-2 text-xs font-bold text-white/30 hover:text-white transition-colors uppercase tracking-[0.2em]">
                      <RefreshCw className="w-4 h-4" />
                      {t('auth.back.phone')}
                    </button>
                  </form>
                </div>
              )}

              {/* STEP 3: OTP */}
              {currentStep === 3 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-center mb-10">
                    <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center relative overflow-hidden">
                      <Lock className="w-9 h-9 text-primary relative z-10" />
                      <div className="absolute inset-0 bg-primary/5 animate-pulse" />
                    </div>
                  </div>
                  <h2 className="text-3xl font-display text-center mb-3">{t('auth.step3.title')}</h2>
                  <p className="text-muted-foreground text-center text-sm mb-12 leading-relaxed px-6">
                    {authMode === 'sms' ? t('auth.step3.sms.description') : t('auth.step3.email.description')}<br/>
                    <span className="text-primary font-mono mt-3 block text-lg font-bold tracking-tight">{authMode === 'sms' ? `${countryCode} ${phone}` : email}</span>
                  </p>

                  <div className="flex justify-between gap-3 mb-12" onPaste={handlePaste}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => { otpRefs.current[i] = el; }}
                        type="text"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpInput(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        className="w-11 h-14 bg-background/50 border border-white/10 rounded-2xl text-center text-2xl font-bold text-primary focus:border-primary focus:bg-background/80 outline-none transition-all shadow-inner"
                      />
                    ))}
                  </div>

                  <button 
                    onClick={handleVerify}
                    disabled={verifyLoading || otp.some(d => !d)}
                    className="w-full h-14 bg-primary text-primary-foreground font-bold rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-30 shadow-2xl shadow-primary/20"
                  >
                    {verifyLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : (
                      <>
                        <span className="text-lg uppercase tracking-widest">{t('auth.verify')}</span>
                      </>
                    )}
                  </button>

                  <div className="mt-8 text-center">
                    {resendSeconds > 0 ? (
                      <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full bg-white/[0.03] border border-white/5">
                        <RefreshCw className="w-3 h-3 text-white/20 animate-spin" />
                        <p className="text-[11px] font-bold text-white/30 uppercase tracking-[0.2em]">{t('auth.resend.timer')} <span className="text-white font-mono">{resendSeconds}</span> {t('auth.resend.sec')}</p>
                      </div>
                    ) : (
                      <button onClick={handleResend} className="text-[11px] text-primary hover:text-primary/80 font-bold uppercase tracking-[0.3em] border-b border-primary/20 pb-1 transition-all">{t('auth.resend.btn')}</button>
                    )}
                  </div>

                  <button onClick={authMode === 'sms' ? handleBackToPhone : handleBackToEmail} className="w-full mt-10 text-center text-[10px] font-bold text-white/20 hover:text-white transition-colors uppercase tracking-[0.3em]">
                    {authMode === 'sms' ? t('auth.back.phone') : t('auth.back.email')}
                  </button>
                </div>
              )}

              {/* STEP 4: Recovery Key */}
              {currentStep === 4 && (
                <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                  <div className="flex justify-center mb-10">
                    <div className={cn(
                      "w-20 h-20 rounded-[32px] flex items-center justify-center shadow-2xl transition-colors duration-1000",
                      isExistingUser ? "bg-blue-500/10 border border-blue-500/20" : "bg-destructive/10 border border-destructive/20"
                    )}>
                      <Key className={cn("w-10 h-10", isExistingUser ? "text-blue-400" : "text-destructive")} />
                    </div>
                  </div>
                  <h2 className="text-3xl font-display text-center mb-3">{isExistingUser ? (language === 'ru' ? 'Синхронизация' : 'Sync Key') : t('auth.step4.title')}</h2>
                  <p className="text-muted-foreground text-center text-sm mb-12 leading-relaxed px-6" dangerouslySetInnerHTML={{ __html: isExistingUser ? (language === 'ru' ? 'Введите вашу 12-словную фразу для дешифрования данных.' : 'Input your 12-word recovery mnemonic to decrypt vault.') : t('auth.step4.description') }} />

                  {isExistingUser ? (
                    <div className="space-y-8">
                      <div className="relative group/input">
                        <div className="absolute -inset-1 bg-blue-500/10 rounded-3xl blur opacity-100 group-focus-within/input:bg-blue-500/20 transition duration-1000" />
                        <textarea
                          value={mnemonicInput}
                          onChange={(e) => { setMnemonicInput(e.target.value); setRestoreError(''); }}
                          className="relative w-full h-40 bg-background/60 border border-white/10 rounded-3xl p-6 text-white text-sm font-mono leading-relaxed outline-none focus:border-blue-500/50 transition-all resize-none shadow-inner scrollbar-hide"
                          placeholder="Enter your 12 words here..."
                        />
                      </div>
                      {restoreError && <p className="text-destructive text-xs text-center font-mono uppercase tracking-widest">{restoreError}</p>}
                      <button 
                        onClick={handleRestore}
                        disabled={confirmRecoveryLoading || !mnemonicInput.trim()}
                        className="w-full h-14 bg-blue-600 text-white font-bold rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-blue-500/10 hover:bg-blue-500 transition-all active:scale-[0.98]"
                      >
                        {confirmRecoveryLoading ? <RefreshCw className="w-6 h-6 animate-spin" /> : (
                          <>
                            <span className="text-lg uppercase tracking-widest">{language === 'ru' ? 'Восстановить' : 'Restore'}</span>
                            <Globe className="w-5 h-5" />
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      <div className="bg-destructive/5 border border-destructive/10 rounded-3xl p-6 flex gap-4 items-start relative overflow-hidden group/warning">
                        <div className="absolute top-0 left-0 w-1 h-full bg-destructive transition-transform duration-700 origin-top group-hover/warning:scale-y-110" />
                        <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-1" />
                        <p className="text-xs text-destructive-foreground/80 leading-relaxed font-medium uppercase tracking-[0.05em]" dangerouslySetInnerHTML={{ __html: t('auth.recovery.warning') }} />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        {mnemonic.split(' ').map((word, i) => (
                          <div key={i} className="bg-white/[0.03] border border-white/5 p-3 rounded-2xl text-center relative group/word hover:bg-white/[0.08] transition-all hover:scale-105">
                            <span className="absolute top-1 left-2 text-[8px] text-white/20 font-bold font-mono">{i + 1}</span>
                            <span className="text-xs font-mono font-bold tracking-tight text-white/80">{word}</span>
                          </div>
                        ))}
                      </div>

                      <button 
                        onClick={() => { navigator.clipboard.writeText(mnemonic); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}
                        className="w-full h-12 bg-white/[0.02] border border-white/10 rounded-2xl text-[10px] font-bold uppercase tracking-[0.4em] flex items-center justify-center gap-3 hover:bg-white/[0.05] transition-all hover:text-primary hover:border-primary/30"
                      >
                        {copiedKey ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        {copiedKey ? t('auth.recovery.copied') : t('auth.recovery.copy')}
                      </button>

                      <div className="space-y-4 pt-4">
                        {[
                          { checked: checkWritten, set: setCheckWritten, text: t('auth.recovery.check1') },
                          { checked: checkSafe, set: setCheckSafe, text: t('auth.recovery.check2') },
                          { checked: checkPrivacy, set: setCheckPrivacy, text: t('auth.recovery.check3') }
                        ].map((check, i) => (
                          <label key={i} className="flex items-start gap-4 cursor-pointer group/check">
                            <div className={cn(
                              "w-6 h-6 rounded-lg border border-white/20 flex items-center justify-center transition-all shrink-0 mt-0.5",
                              check.checked ? "bg-primary border-primary scale-110 shadow-[0_0_15px_rgba(var(--primary),0.3)]" : "bg-white/5 group-hover:check:border-primary/50"
                            )}>
                              {check.checked && <Check className="w-4 h-4 text-primary-foreground" />}
                              <input type="checkbox" className="hidden" checked={check.checked} onChange={e => check.set(e.target.checked)} />
                            </div>
                            <span className="text-xs text-white/40 group-hover:check:text-white/80 transition-colors leading-tight pt-1 font-medium uppercase tracking-wider">{check.text}</span>
                          </label>
                        ))}
                      </div>

                      <button 
                        onClick={handleConfirmRecovery}
                        disabled={confirmRecoveryLoading || !checkWritten || !checkSafe || !checkPrivacy}
                        className="w-full h-14 bg-primary text-primary-foreground font-bold rounded-2xl flex items-center justify-center gap-3 disabled:opacity-30 shadow-2xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95"
                      >
                        <span className="text-lg uppercase tracking-[0.2em]">{t('auth.recovery.confirm')}</span>
                        <ArrowRight className="w-6 h-6" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 5: Redirecting */}
              {currentStep === 5 && (
                <div className="py-20 flex flex-col items-center justify-center text-center animate-in zoom-in duration-1000">
                  <div className="w-28 h-28 rounded-[40px] bg-primary/10 border border-primary/20 flex items-center justify-center mb-12 relative group">
                     <div className="absolute inset-0 rounded-[40px] border-4 border-primary animate-ping opacity-10" />
                     <div className="absolute inset-0 rounded-[40px] bg-primary/5 blur-xl group-hover:bg-primary/20 transition-all duration-1000" />
                     <ShieldCheck className="w-14 h-14 text-primary relative z-10" />
                  </div>
                  <h2 className="text-4xl font-display mb-6 tracking-tight">{t('auth.step5.title')}</h2>
                  <p className="text-muted-foreground mb-12 max-w-xs mx-auto leading-relaxed">{t('auth.step5.description')}</p>
                  
                  <div className="w-full max-w-[240px] h-1.5 bg-white/[0.03] rounded-full overflow-hidden relative border border-white/5">
                     <div className="h-full bg-primary animate-progress origin-left shadow-[0_0_15px_rgba(var(--primary),0.8)]" />
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.5em] text-primary mt-8 font-bold animate-pulse">Establishing Node</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Success Overlay with Deep Immersion */}
      {showSuccess && (
        <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center animate-in fade-in duration-1000 overflow-hidden">
          <div className="absolute inset-0 noise-overlay pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-primary/20 rounded-full blur-[180px] animate-pulse" />
          
          <div className="relative text-center space-y-12 max-w-sm px-8 z-10">
            <div className="relative inline-flex items-center justify-center group">
               <div className="absolute inset-0 bg-primary/20 blur-[60px] rounded-full animate-pulse" />
               <div className="w-32 h-32 rounded-[48px] bg-card border border-primary/20 flex items-center justify-center shadow-[0_0_100px_rgba(var(--primary),0.2)] transform rotate-12 group-hover:rotate-0 transition-transform duration-1000">
                  <Fingerprint className="w-16 h-16 text-primary" />
               </div>
            </div>
            
            <div className="space-y-4">
              <h2 className="text-5xl font-display tracking-tight leading-none">{t('auth.success.title')}</h2>
              <p className="text-muted-foreground leading-relaxed uppercase tracking-[0.1em] text-xs font-bold">{t('auth.success.text')}</p>
            </div>
            
            <div className="pt-12">
              <div className="inline-flex items-center gap-3 text-[11px] font-mono text-primary uppercase tracking-[0.4em] border border-primary/20 px-8 py-4 rounded-full bg-primary/5 backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
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
