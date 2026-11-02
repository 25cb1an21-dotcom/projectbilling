(() => {
    // Change the mascot's name and palette here.
    const MASCOT_NAME = 'Anuj';
    const COLORS = {
        coat: '#fffaf0',
        hat: '#ffffff',
        scarf: '#f39838',
        apron: '#088395',
        skin: '#d99468'
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const welcomePage = document.body.classList.contains('welcome-page');
    let widget;
    let bubble;
    let character;
    let typingTimer = 0;
    let idleTimer = 0;
    let moodTimer = 0;
    let messageId = 0;
    let soundEnabled = false;
    let mascotDismissed = false;
    let bubbleOpen = true;
    let activityEvents = ['pointerdown', 'keydown', 'mousemove', 'touchstart'];

    function initialize() {
        if (document.querySelector('.mascot-widget')) return;
        // Change the welcome and idle messages in this setup block.
        const welcomeMessage = 'Welcome! Hungry? Tap Order Food to begin 🍽️';
        const defaultMessage = welcomePage ? welcomeMessage : `Hi! I’m ${MASCOT_NAME}. Ready to order?`;

        widget = document.createElement('section');
        widget.className = 'mascot-widget';
        widget.dataset.mood = 'wave';
        widget.setAttribute('aria-label', `${MASCOT_NAME}, your digital waiter`);
        widget.innerHTML = `
            <div class="mascot-bubble" id="mascot-bubble" aria-live="polite">
                <span class="mascot-message"></span>
                <div class="mascot-controls">
                    <button class="mascot-control mascot-sound" type="button" aria-label="Turn waiter sounds on">🔇 Sound</button>
                    <button class="mascot-control mascot-hide" type="button" aria-label="Hide the waiter">Hide</button>
                </div>
            </div>
            <button class="mascot-character" type="button" aria-label="Open or close ${MASCOT_NAME}'s speech bubble" aria-expanded="true" aria-controls="mascot-bubble">
                <svg class="mascot-svg" viewBox="0 0 120 140" role="img" aria-label="Cute chef waiter">
                    <ellipse cx="60" cy="132" rx="31" ry="5" fill="#062c37" opacity=".16"/>
                    <g class="mascot-body">
                        <path d="M37 67Q60 57 83 67L96 121Q61 133 25 121Z" fill="${COLORS.coat}" stroke="#0a4d68" stroke-width="2"/>
                        <path d="M45 77Q60 86 75 77L84 124H36Z" fill="${COLORS.apron}" stroke="#0a4d68" stroke-width="2"/>
                        <path d="M45 67Q60 77 75 67L69 83H51Z" fill="${COLORS.scarf}"/>
                        <path d="M35 78 22 107M85 78 98 105" fill="none" stroke="${COLORS.coat}" stroke-width="12" stroke-linecap="round"/>
                        <g class="mascot-arm mascot-arm-point">
                            <path d="M84 79 99 100" fill="none" stroke="${COLORS.coat}" stroke-width="12" stroke-linecap="round"/>
                            <circle cx="101" cy="103" r="7" fill="${COLORS.skin}"/>
                        </g>
                        <g class="mascot-arm mascot-arm-wave">
                            <path d="M34 79 21 97" fill="none" stroke="${COLORS.coat}" stroke-width="12" stroke-linecap="round"/>
                            <circle cx="19" cy="99" r="7" fill="${COLORS.skin}"/>
                        </g>
                        <path d="M38 116 34 127M81 116 86 127" fill="none" stroke="#0a4d68" stroke-width="9" stroke-linecap="round"/>
                    </g>
                    <g class="mascot-head">
                        <path d="M29 43Q29 19 60 19T91 43V65Q91 86 60 88 29 86 29 65Z" fill="${COLORS.skin}" stroke="#0a4d68" stroke-width="2"/>
                        <path d="M26 41Q26 26 39 28 42 13 54 22 66 8 74 22 91 15 94 34 104 42 94 48H27Z" fill="${COLORS.hat}" stroke="#0a4d68" stroke-width="2"/>
                        <path d="M37 47Q42 41 48 47M72 47Q78 41 83 47" fill="none" stroke="#173a43" stroke-width="3" stroke-linecap="round"/>
                        <g class="mascot-eyes">
                            <ellipse cx="45" cy="53" rx="3.3" ry="4.3" fill="#173a43"/>
                            <ellipse cx="76" cy="53" rx="3.3" ry="4.3" fill="#173a43"/>
                        </g>
                        <path d="M55 58Q60 62 64 58" fill="none" stroke="#a95443" stroke-width="2" stroke-linecap="round"/>
                        <g class="mascot-face-smile">
                            <path d="M48 66Q60 78 73 66" fill="none" stroke="#8c3f37" stroke-width="3" stroke-linecap="round"/>
                        </g>
                        <g class="mascot-face-sad">
                            <path d="M49 73Q60 62 72 73" fill="none" stroke="#8c3f37" stroke-width="3" stroke-linecap="round"/>
                            <path d="M81 57q-3 5 0 8 4-3 0-8" fill="#79d9eb"/>
                        </g>
                        <g class="mascot-face-thinking">
                            <circle cx="83" cy="32" r="4" fill="${COLORS.scarf}"/>
                            <path d="M49 70Q60 65 71 70" fill="none" stroke="#8c3f37" stroke-width="3" stroke-linecap="round"/>
                        </g>
                        <circle cx="36" cy="62" r="4" fill="#ed8b7b" opacity=".75"/>
                        <circle cx="84" cy="62" r="4" fill="#ed8b7b" opacity=".75"/>
                    </g>
                    <path d="M49 96h22" stroke="#bceff2" stroke-width="3" stroke-linecap="round"/>
                    <circle cx="60" cy="105" r="3" fill="${COLORS.scarf}"/>
                </svg>
            </button>`;
        document.body.append(widget);
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'mascot-restore';
        restore.textContent = `Show ${MASCOT_NAME}`;
        restore.hidden = true;
        restore.setAttribute('aria-label', `Show ${MASCOT_NAME}, your digital waiter`);
        document.body.append(restore);

        bubble = widget.querySelector('.mascot-bubble');
        character = widget.querySelector('.mascot-character');
        soundEnabled = localStorage.getItem('rb_mascot_sound') === 'true';
        updateSoundButton();

        character.addEventListener('click', () => setBubbleOpen(!bubbleOpen));
        widget.querySelector('.mascot-hide').addEventListener('click', hideMascot);
        widget.querySelector('.mascot-sound').addEventListener('click', toggleSound);
        restore.addEventListener('click', () => {
            mascotDismissed = false;
            widget.hidden = false;
            restore.hidden = true;
            scheduleIdle();
        });

        if (welcomePage) {
            say(welcomeMessage, 'wave');
            document.querySelectorAll('.welcome-actions a').forEach(button => {
                button.addEventListener('mouseenter', () => {
                    widget.classList.add('is-pointing');
                    say(button.classList.contains('order-button')
                        ? 'Great choice! Let’s find something delicious.'
                        : 'Owner? Login here to manage the restaurant.', 'happy');
                });
                button.addEventListener('mouseleave', () => {
                    widget.classList.remove('is-pointing');
                });
            });
        } else {
            say(defaultMessage, 'happy');
        }

        activityEvents.forEach(eventName => {
            document.addEventListener(eventName, scheduleIdle, { passive: true });
        });
        scheduleIdle();
    }

    function setBubbleOpen(open) {
        bubbleOpen = open;
        bubble.hidden = !open;
        character.setAttribute('aria-expanded', String(open));
    }

    function updateSoundButton() {
        const button = widget.querySelector('.mascot-sound');
        button.textContent = soundEnabled ? '🔊 Sound' : '🔇 Sound';
        button.setAttribute('aria-label', soundEnabled ? 'Mute waiter sounds' : 'Turn waiter sounds on');
    }

    function toggleSound() {
        soundEnabled = !soundEnabled;
        localStorage.setItem('rb_mascot_sound', String(soundEnabled));
        updateSoundButton();
        if (soundEnabled) playChime();
    }

    function playChime() {
        if (!soundEnabled) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        try {
            const audio = new AudioContextClass();
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.frequency.value = 660;
            gain.gain.setValueAtTime(.035, audio.currentTime);
            gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .12);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.start();
            oscillator.stop(audio.currentTime + .13);
            oscillator.onended = () => audio.close();
        } catch (error) {
            console.warn('Waiter sound could not be played.', error);
        }
    }

    function say(message, mood = 'happy') {
        if (mascotDismissed) return;
        const validMoods = ['happy', 'wave', 'sad', 'thinking', 'celebrate'];
        const nextMood = validMoods.includes(mood) ? mood : 'happy';
        const text = String(message);
        const textNode = widget.querySelector('.mascot-message');
        const currentMessage = ++messageId;
        window.clearInterval(typingTimer);
        window.clearTimeout(moodTimer);
        widget.dataset.mood = nextMood;
        document.querySelector('.mascot-restore').hidden = true;
        setBubbleOpen(true);
        widget.classList.remove('is-jumping');
        if (nextMood === 'happy' || nextMood === 'celebrate') {
            void widget.offsetWidth;
            widget.classList.add('is-jumping');
            window.setTimeout(() => widget.classList.remove('is-jumping'), 650);
        }
        textNode.textContent = '';

        if (nextMood === 'celebrate') celebrate();
        if (nextMood !== 'sad') playChime();

        const characters = Array.from(text);
        let index = 0;
        typingTimer = window.setInterval(() => {
            if (currentMessage !== messageId) {
                window.clearInterval(typingTimer);
                return;
            }
            textNode.textContent += characters[index++];
            if (index >= characters.length) window.clearInterval(typingTimer);
        }, 24);

        if (nextMood === 'sad') {
            moodTimer = window.setTimeout(() => {
                if (currentMessage === messageId) widget.dataset.mood = 'happy';
            }, 2000);
        }
        scheduleIdle();
    }

    function celebrate() {
        if (reducedMotion.matches) return;
        const colors = [COLORS.scarf, '#05bfdb', '#f7d45c', '#ffffff', '#72c78f'];
        for (let index = 0; index < 36; index++) {
            const piece = document.createElement('span');
            piece.className = 'mascot-confetti';
            piece.style.setProperty('--confetti-x', `${Math.random() * 100}vw`);
            piece.style.setProperty('--confetti-drift', `${Math.random() * 160 - 80}px`);
            piece.style.setProperty('--confetti-color', colors[index % colors.length]);
            piece.style.animationDelay = `${Math.random() * .35}s`;
            document.body.append(piece);
            window.setTimeout(() => piece.remove(), 2200);
        }
    }

    function scheduleIdle() {
        window.clearTimeout(idleTimer);
        if (document.hidden || widget?.hidden) return;
        idleTimer = window.setTimeout(() => {
            const items = typeof menu !== 'undefined' && Array.isArray(menu) ? menu : [];
            const suggestion = items.length
                ? `Try our bestseller! How about ${items[Math.floor(Math.random() * items.length)].n}?`
                : 'Try our bestseller! Something delicious is waiting.';
            say(suggestion, 'thinking');
        }, 20000);
    }

    function hideMascot() {
        mascotDismissed = true;
        widget.hidden = true;
        document.querySelector('.mascot-restore').hidden = false;
        window.clearTimeout(idleTimer);
    }

    window.mascot = { say };
    window.addEventListener('load', initialize, { once: true });
    if (document.readyState === 'complete') initialize();
})();
