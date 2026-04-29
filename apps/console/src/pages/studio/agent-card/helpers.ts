export function relativeTime(iso?: string): string {
	if (!iso) return '—';
	const diff = Date.now() - new Date(iso).getTime();
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return `${sec}sn önce`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}dk önce`;
	const hr = Math.floor(min / 60);
	return `${hr}sa önce`;
}
