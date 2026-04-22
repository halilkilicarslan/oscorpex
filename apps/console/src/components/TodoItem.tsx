import { useState } from 'react';
import { Trash2, CheckCircle2, Circle } from 'lucide-react';

interface TodoItemProps {
  id: string;
  text: string;
  completed: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function TodoItem({
  id,
  text,
  completed,
  onToggle,
  onDelete,
}: TodoItemProps) {
  const [isHovering, setIsHovering] = useState(false);

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 bg-[#111111] border border-[#262626] rounded-lg hover:bg-[#141414] transition-all duration-200 ease-out"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex items-center justify-center shrink-0 text-[#525252] hover:text-[#22c55e] transition-colors duration-200"
        aria-label={completed ? 'Mark as incomplete' : 'Mark as complete'}
      >
        {completed ? (
          <CheckCircle2 size={20} className="text-[#22c55e]" />
        ) : (
          <Circle size={20} />
        )}
      </button>

      {/* Todo text */}
      <span
        className={`flex-1 text-sm transition-all duration-200 ease-out ${
          completed
            ? 'text-[#525252] line-through'
            : 'text-[#e5e5e5]'
        }`}
      >
        {text}
      </span>

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDelete(id)}
        className={`flex items-center justify-center shrink-0 p-1.5 rounded-md transition-all duration-200 ease-out ${
          isHovering
            ? 'bg-[#ef4444] text-[#fafafa] opacity-100'
            : 'text-[#525252] opacity-0 group-hover:opacity-50'
        } hover:opacity-100 hover:bg-[#dc2626]`}
        aria-label="Delete todo"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
