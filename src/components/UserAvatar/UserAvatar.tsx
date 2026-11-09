import Avatar from '@mui/material/Avatar';

export interface UserAvatarProps {
  userId: string;
  name: string;
  size?: number;
}

const PALETTE = ['#4F46E5', '#0EA5E9', '#15803D', '#B45309', '#B91C1C', '#7C3AED', '#0D9488'];

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Avatar with initials on a deterministic background colour derived from userId. */
export function UserAvatar({ userId, name, size = 32 }: UserAvatarProps) {
  return (
    <Avatar sx={{ bgcolor: colorForId(userId), width: size, height: size, fontSize: size * 0.4 }}>
      {initialsFor(name)}
    </Avatar>
  );
}
