document.addEventListener('DOMContentLoaded', () => {
    // Generate 45 uptime visual segments
    const barsContainer = document.getElementById('uptime-bars');
    if (barsContainer && barsContainer.children.length === 0) {
        for (let i = 0; i < 45; i++) {
            const bar = document.createElement('div');
            bar.className = 'flex-1 h-full bg-emerald-500 rounded-sm hover:opacity-80 transition-opacity cursor-pointer';
            bar.title = 'Uptime 100% • All systems operational';
            barsContainer.appendChild(bar);
        }
    }

    // Fetch Live Public Stats Summary
    fetch('/api/status-summary')
        .then(res => res.json())
        .then(data => {
            if (data && data.metrics) {
                const imgEl = document.getElementById('stat-images');
                const viewEl = document.getElementById('stat-views');
                const latEl = document.getElementById('stat-latency');
                if (imgEl) imgEl.textContent = Number(data.metrics.total_images || 0).toLocaleString();
                if (viewEl) viewEl.textContent = Number(data.metrics.total_views || 0).toLocaleString();
                if (latEl && data.avg_response_time_ms) {
                    latEl.textContent = '~' + data.avg_response_time_ms + ' ms';
                }
            }
        })
        .catch((err) => {
            console.error('Telemetry fetch error:', err);
        });
});
