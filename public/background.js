(() => {
    const canvas = document.getElementById('ambient-background');
    if (!(canvas instanceof HTMLCanvasElement)) {
        console.error('Ambient background canvas was not found.');
        return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
        console.error('Could not initialize the ambient background canvas.');
        return;
    }

    const CONFIG = {
        colors: ['5,191,219', '8,131,149', '243,152,56', '10,77,104'],
        speed: 0.18,
        desktopElements: 7,
        mobileElements: 3
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let blobs = [];
    let frameId = 0;
    let previousFrame = 0;

    function createBlobs(count) {
        blobs = Array.from({ length: count }, (_, index) => ({
            x: Math.random(),
            y: Math.random(),
            radius: 0.2 + Math.random() * 0.2,
            vx: (Math.random() - 0.5) * 24,
            vy: (Math.random() - 0.5) * 18,
            color: CONFIG.colors[index % CONFIG.colors.length]
        }));
    }

    function draw() {
        context.clearRect(0, 0, width, height);
        const radiusScale = Math.min(width, height);

        blobs.forEach(blob => {
            const x = blob.x * width;
            const y = blob.y * height;
            const radius = blob.radius * radiusScale;
            const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(${blob.color},0.14)`);
            gradient.addColorStop(0.5, `rgba(${blob.color},0.07)`);
            gradient.addColorStop(1, `rgba(${blob.color},0)`);
            context.fillStyle = gradient;
            context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        });
    }

    function animate(timestamp) {
        frameId = 0;
        if (document.hidden || reducedMotion.matches) return;

        const elapsed = previousFrame ? Math.min((timestamp - previousFrame) / 1000, 0.05) : 0;
        previousFrame = timestamp;
        blobs.forEach(blob => {
            blob.x += blob.vx * CONFIG.speed * elapsed / Math.max(width, 1);
            blob.y += blob.vy * CONFIG.speed * elapsed / Math.max(height, 1);
            if (blob.x < -0.3) blob.x = 1.3;
            if (blob.x > 1.3) blob.x = -0.3;
            if (blob.y < -0.3) blob.y = 1.3;
            if (blob.y > 1.3) blob.y = -0.3;
        });

        draw();
        frameId = window.requestAnimationFrame(animate);
    }

    function start() {
        if (reducedMotion.matches || document.hidden) {
            draw();
            return;
        }
        if (!frameId) {
            previousFrame = 0;
            frameId = window.requestAnimationFrame(animate);
        }
    }

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        const count = width < 600 ? CONFIG.mobileElements : CONFIG.desktopElements;
        if (blobs.length !== count) createBlobs(count);
        draw();
    }

    function updateMotionPreference() {
        if (reducedMotion.matches) {
            if (frameId) window.cancelAnimationFrame(frameId);
            frameId = 0;
            previousFrame = 0;
            draw();
        } else {
            start();
        }
    }

    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (frameId) window.cancelAnimationFrame(frameId);
            frameId = 0;
            previousFrame = 0;
        } else {
            start();
        }
    });

    if (reducedMotion.addEventListener) {
        reducedMotion.addEventListener('change', updateMotionPreference);
    } else {
        reducedMotion.addListener(updateMotionPreference);
    }

    resize();
    start();
})();
