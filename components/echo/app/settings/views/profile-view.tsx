"use client";

import { ProfileEditPanel } from "@/components/echo/app/profile-edit-panel";
import type { UserProfile } from "@/hooks/echo/types";

interface ProfileViewProps {
  user: UserProfile | null;
  onUpdateUser?: (patch: Record<string, any>) => void;
  onBack: () => void;
}

const ProfileView: React.FC<ProfileViewProps> = ({ user, onUpdateUser, onBack }) => {
  if (!user) return null;

  return (
    <ProfileEditPanel
    profile={{
      id: user.id,
      display_name: user.user_metadata?.display_name || "",
      username: user.user_metadata?.username || "",
      avatar_url: user.user_metadata?.avatar_url ?? null,
      avatar_color: user.user_metadata?.avatar_color ?? null,
      avatar_storage_path: user.user_metadata?.avatar_storage_path ?? null,
      avatar_nonce: user.user_metadata?.avatar_nonce ?? null,
      avatar_mime: user.user_metadata?.avatar_mime ?? null,
      bio: user.user_metadata?.bio ?? null,
      background: user.user_metadata?.background ?? null,
      status_emoji: user.user_metadata?.status_emoji ?? null,
      birth_date: user.user_metadata?.birth_date ?? null,
      birth_date_hide_year: user.user_metadata?.birth_date_hide_year ?? false,
      activity_type: user.user_metadata?.activity_type ?? null,
      activity_title: user.user_metadata?.activity_title ?? null,
      activity_subtitle: user.user_metadata?.activity_subtitle ?? null,
      activity_cover_url: user.user_metadata?.activity_cover_url ?? null,
      activity_cover_path: user.user_metadata?.activity_cover_path ?? null,
      activity_cover_nonce: user.user_metadata?.activity_cover_nonce ?? null,
      activity_file_url: user.user_metadata?.activity_file_url ?? null,
      activity_gradient: user.user_metadata?.activity_gradient ?? null,
      share_listening_activity: user.user_metadata?.share_listening_activity ?? false,
      channel_id: user.user_metadata?.channel_id ?? null,
      channel_name: user.user_metadata?.channel_name ?? null,
      channel_username: user.user_metadata?.channel_username ?? null,
    }}
    onClose={onBack}
    onSaved={(patch) => {
      onUpdateUser?.({ user_metadata: { ...user.user_metadata, ...patch } });
    }}
  />
);
};

export default ProfileView;
