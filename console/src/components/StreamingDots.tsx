export default function StreamingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5" aria-label="Assistant is typing">
      <span className="streaming-dot block w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
      <span className="streaming-dot block w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
      <span className="streaming-dot block w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
    </div>
  );
}
