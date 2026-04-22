// ---------------------------------------------------------------------------
// Reusable Agent Avatar Component
// Shows profile photo from URL or falls back to emoji/initial
// ---------------------------------------------------------------------------

interface AgentAvatarProps {
  avatar: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZES = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-base',
  xl: 'w-14 h-14 text-lg',
};

function isImageUrl(avatar: string): boolean {
  return avatar.startsWith('http://') || avatar.startsWith('https://');
}

export default function AgentAvatar({ avatar, name, size = 'md', className = '' }: AgentAvatarProps) {
  const sizeClass = SIZES[size];

  if (isImageUrl(avatar)) {
    return (
      <img
        src={avatar}
        alt={name}
        className={`${sizeClass} rounded-full object-cover ring-1 ring-[#262626] ${className}`}
      />
    );
  }

  // Fallback: emoji or initial
  const display = avatar || name.charAt(0).toUpperCase();
  return (
    <span
      className={`${sizeClass} rounded-full bg-[#1f1f1f] flex items-center justify-center shrink-0 ${className}`}
    >
      {display}
    </span>
  );
}
