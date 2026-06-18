import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase/config';
import './SettingsModal.css';

interface SettingsModalProps {
  user: any;
  onClose: () => void;
  isQuarantined?: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ user, onClose, isQuarantined }) => {
  const [activeView, setActiveMode] = useState<'main' | 'devices' | 'privacy'>('main');
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentHwid, setCurrentHwid] = useState('');
  const [isLastSeenVisible, setIsLastSeenVisible] = useState(user?.user_metadata?.privacy_last_seen !== false);

  const toggleLastSeen = async () => {
    const newValue = !isLastSeenVisible;
    setIsLastSeenVisible(newValue);
    
    await supabase.from('profiles').update({
      user_metadata: {
        ...user.user_metadata,
        privacy_last_seen: newValue
      }
    }).eq('id', user.id);
  };

  useEffect(() => {
    const hwid = generateLocalHWID();
    setCurrentHwid(hwid);
    if (activeView === 'devices') {
      fetchDevices();
    }
  }, [activeView]);

  const generateLocalHWID = () => {
    const gl = document.createElement('canvas').getContext('webgl');
    const renderer = gl ? (gl.getParameter(gl.RENDERER) + gl.getParameter(gl.VENDOR)) : '';
    const screenInfo = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
    const cpuInfo = navigator.hardwareConcurrency || 'unknown';
    const rawId = `${renderer}-${screenInfo}-${cpuInfo}-${navigator.language}`;
    let hash = 0;
    for (let i = 0; i < rawId.length; i++) {
      const char = rawId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  };

  const fetchDevices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .order('last_active', { ascending: false });
    
    if (!error) setDevices(data || []);
    setLoading(false);
  };

  const handleTerminateDevice = async (deviceId: string) => {
    if (isQuarantined) {
      alert('⚠️ Действие ограничено. Новое устройство должно пройти 32-часовой карантин для управления сессиями.');
      return;
    }
    if (!window.confirm('Вы уверены, что хотите завершить этот сеанс?')) return;
    
    // Use RPC to enforce quarantine check on backend
    const { error } = await supabase.rpc('terminate_device_session', {
      target_device_id: deviceId,
      requester_hwid: currentHwid
    });
    
    if (error) {
      alert(`Ошибка: ${error.message}`);
      return;
    }
    
    setDevices(prev => prev.filter(d => d.id !== deviceId));
  };

  const handleTerminateOthers = async () => {
    if (isQuarantined) {
      alert('⚠️ Действие ограничено. Новое устройство должно пройти 32-часовой карантин для управления сессиями.');
      return;
    }
    if (!window.confirm('Завершить все остальные сеансы?')) return;
    
    setLoading(true);
    let hasError = false;
    
    for (const device of devices) {
      if (device.hwid !== currentHwid) {
        const { error } = await supabase.rpc('terminate_device_session', {
          target_device_id: device.id,
          requester_hwid: currentHwid
        });
        if (error) hasError = true;
      }
    }
    
    if (hasError) {
      alert('Некоторые сеансы не удалось завершить (возможно, из-за ограничений безопасности)');
    }
    
    fetchDevices();
  };

  const getOSIcon = (os: string) => {
    if (os.includes('Windows')) return 'fab fa-windows';
    if (os.includes('Mac') || os.includes('iOS')) return 'fab fa-apple';
    if (os.includes('Linux')) return 'fab fa-linux';
    if (os.includes('Android')) return 'fab fa-android';
    return 'fas fa-globe';
  };

  const menuItems = [
    { id: 'notifications', icon: 'fas fa-bell', label: 'Уведомления', color: '#ff9500' },
    { id: 'data', icon: 'fas fa-database', label: 'Данные и память', color: '#34c759' },
    { id: 'privacy', icon: 'fas fa-shield', label: 'Конфиденциальность', color: '#5856d6', action: () => setActiveMode('privacy') },
    { id: 'general', icon: 'fas fa-sliders-h', label: 'Основные настройки', color: '#007aff' },
    { id: 'folders', icon: 'fas fa-folder', label: 'Папки с чатами', color: '#5ac8fa' },
    { id: 'devices', icon: 'fas fa-desktop', label: 'Устройства', color: '#af52de', action: () => setActiveMode('devices') },
    { id: 'language', icon: 'fas fa-globe', label: 'Язык', color: '#ff2d55', sublabel: 'Русский' },
  ];

  const soonItems = [
    { id: 'pro', icon: 'fas fa-crown', label: 'Echo PRO', color: '#ffcc00' },
    { id: 'gift', icon: 'fas fa-gift', label: 'Отправить подарок', color: '#ff3b30' },
  ];

  if (activeView === 'devices') {
    return (
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-card" onClick={e => e.stopPropagation()}>
          <div className="settings-header">
            <button className="back-btn" onClick={() => setActiveMode('main')}>
              <i className="fas fa-arrow-left"></i>
            </button>
            <h2>Устройства</h2>
            <button className="close-btn" onClick={onClose}>
              <i className="fas fa-times"></i>
            </button>
          </div>

          <div className="settings-content-scroll">
            <div className="devices-info-box">
              <i className="fas fa-shield-check"></i>
              <p>Эти устройства имеют доступ к вашему аккаунту. Новые устройства ограничены на 32 часа.</p>
            </div>

            <div className="menu-divider">Текущее устройство</div>
            <div className="devices-list">
              {devices.filter(d => d.hwid === currentHwid).map(device => (
                <div key={device.id} className="device-item current-device">
                  <div className="device-icon">
                    <i className={getOSIcon(device.os_name || '')}></i>
                  </div>
                  <div className="device-details">
                    <div className="device-name">
                      {device.os_name} • {device.browser_name || 'Echo Web (Текущий)'}
                      <span className="online-badge">онлайн</span>
                    </div>
                    <div className="device-meta">{device.location_ip}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="menu-divider">Активные сессии</div>
            <div className="devices-list">
              {loading ? (
                <div className="loading-text">Загрузка устройств...</div>
              ) : devices.filter(d => d.hwid !== currentHwid).length === 0 ? (
                <div className="loading-text">Нет других активных устройств</div>
              ) : devices.filter(d => d.hwid !== currentHwid).map(device => {
                const tzCountry = device.location_tz?.split('/')[1]?.replace('_', ' ') || 'Unknown';
                const isMismatch = device.location_ip && device.location_ip !== tzCountry && device.location_ip !== 'Unknown';

                return (
                  <div key={device.id} className="device-item">
                    <div className="device-icon">
                      <i className={getOSIcon(device.os_name || '')}></i>
                    </div>
                    <div className="device-details">
                      <div className="device-name">
                        {device.os_name} • {device.browser_name || 'Echo Web'}
                        {isMismatch && <span className="vpn-badge">VPN?</span>}
                      </div>
                      <div className="device-meta">
                        Вход из: {device.location_ip}
                      </div>
                      <div className="device-status">
                        Активен с: {new Date(device.created_at).toLocaleDateString()} • {new Date(device.last_active).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </div>
                    </div>
                    <button className="terminate-item-btn" onClick={() => handleTerminateDevice(device.id)} title="Завершить сеанс">
                      <i className="fas fa-sign-out-alt"></i>
                    </button>
                  </div>
                );
              })}
            </div>
            
            <div style={{ padding: '2rem 1.5rem' }}>
              <button className="terminate-sessions-btn" onClick={handleTerminateOthers}>
                <i className="fas fa-power-off"></i> Завершить другие сеансы
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeView === 'privacy') {
    return (
      <div className="settings-overlay" onClick={onClose}>
        <div className="settings-card" onClick={e => e.stopPropagation()}>
          <div className="settings-header">
            <button className="back-btn" onClick={() => setActiveMode('main')}>
              <i className="fas fa-arrow-left"></i>
            </button>
            <h2>Конфиденциальность</h2>
            <button className="close-btn" onClick={onClose}>
              <i className="fas fa-times"></i>
            </button>
          </div>

          <div className="settings-content-scroll">
            <div className="menu-group">
              <div className="menu-item" onClick={toggleLastSeen}>
                <div className="menu-icon-box" style={{ backgroundColor: '#5856d615', color: '#5856d6' }}>
                  <i className="fas fa-eye"></i>
                </div>
                <div className="menu-label-container">
                  <span className="menu-label">Последняя активность</span>
                  <span className="menu-sublabel">Кто может видеть время вашего последнего входа</span>
                </div>
                <div className={`toggle-switch ${isLastSeenVisible ? 'on' : 'off'}`}>
                  <div className="toggle-thumb"></div>
                </div>
              </div>
            </div>
            
            <div className="devices-info-box">
              <i className="fas fa-info-circle"></i>
              <p>Если вы скроете время своего входа, вы также не будете видеть время входа других пользователей.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-card" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <button className="back-btn" onClick={onClose}>
            <i className="fas fa-arrow-left"></i>
          </button>
          <h2>Настройки</h2>
          <button className="close-btn" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="settings-content-scroll">
          {/* Mini Profile Section */}
          <div className="settings-mini-profile">
            <div className="profile-bg-blur" style={{ 
              background: user?.user_metadata?.cover_url ? `url(${user?.user_metadata?.cover_url}) center/cover` : (user?.user_metadata?.cover_color || '#1a1523')
            }}></div>
            <div className="profile-info-main">
              <div className="settings-avatar" style={{ 
                background: user?.user_metadata?.avatar_url ? 'transparent' : (user?.user_metadata?.avatar_color || 'var(--primary)')
              }}>
                {user?.user_metadata?.avatar_url ? (
                  <img src={user?.user_metadata?.avatar_url} alt="" />
                ) : (
                  (user?.user_metadata?.display_name?.[0] || user?.email?.[0] || 'A').toUpperCase()
                )}
              </div>
              <div className="profile-text-info">
                <h3>{user?.user_metadata?.display_name || user?.email?.split('@')[0]}</h3>
                <span>{user?.user_metadata?.username ? `@${user.user_metadata.username}` : user?.phone || user?.email}</span>
              </div>
              <button className="edit-profile-btn" title="Редактировать профиль">
                <i className="fas fa-pen"></i>
              </button>
            </div>
          </div>

          <div className="settings-menu">
            <div className="menu-group">
              {menuItems.map(item => (
                <div key={item.id} className="menu-item" onClick={item.action}>
                  <div className="menu-icon-box" style={{ backgroundColor: item.color + '15', color: item.color }}>
                    <i className={item.icon}></i>
                  </div>
                  <div className="menu-label-container">
                    <span className="menu-label">{item.label}</span>
                    {item.sublabel && <span className="menu-sublabel">{item.sublabel}</span>}
                  </div>
                  <i className="fas fa-chevron-right arrow-icon"></i>
                </div>
              ))}
            </div>

            <div className="menu-divider">Скоро</div>

            <div className="menu-group">
              {soonItems.map(item => (
                <div key={item.id} className="menu-item disabled">
                  <div className="menu-icon-box" style={{ backgroundColor: item.color + '15', color: item.color }}>
                    <i className={item.icon}></i>
                  </div>
                  <span className="menu-label">{item.label}</span>
                  <span className="soon-badge">Soon</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <div className="echo-version">Echo for Web v1.0.56 (Alpha)</div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
