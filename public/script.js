// Update these defaults when the restaurant's contact details or hours change.
const CONTACT = {
    online: { label: 'Online / Delivery', hours: '10:00-22:00', phone: '+91 8349539933' },
    offline: { label: 'Dine-in', hours: '11:00-20:00', phone: '+91 6264290195' },
    email: 'hello@yourrestaurant.com',
    address: 'Your full address here'
};

(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const status = document.querySelector('#slide-status');
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let activeSlide = 0;
    let rotationTimer = 0;

    function showSlide(index) {
        activeSlide = (index + slides.length) % slides.length;
        slides.forEach((slide, slideIndex) => {
            const isActive = slideIndex === activeSlide;
            slide.classList.toggle('is-active', isActive);
            slide.setAttribute('aria-hidden', String(!isActive));
        });
        if (status) status.textContent = `${activeSlide + 1} / ${slides.length}`;
    }

    function stopRotation() {
        window.clearInterval(rotationTimer);
        rotationTimer = 0;
    }

    function startRotation() {
        stopRotation();
        if (slides.length < 2 || document.hidden || motionPreference.matches) return;
        rotationTimer = window.setInterval(() => showSlide(activeSlide + 1), 5000);
    }

    if (slides.length) {
        showSlide(0);
        document.querySelector('#previous-slide')?.addEventListener('click', () => {
            showSlide(activeSlide - 1);
            startRotation();
        });
        document.querySelector('#next-slide')?.addEventListener('click', () => {
            showSlide(activeSlide + 1);
            startRotation();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopRotation();
            else startRotation();
        });
        if (motionPreference.addEventListener) {
            motionPreference.addEventListener('change', startRotation);
        } else {
            motionPreference.addListener(startRotation);
        }
        startRotation();
    }

    document.querySelectorAll('.action-button[href]').forEach(button => {
        button.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            const bounds = button.getBoundingClientRect();
            const ripple = document.createElement('span');
            ripple.className = 'button-ripple';
            ripple.style.left = `${event.clientX - bounds.left}px`;
            ripple.style.top = `${event.clientY - bounds.top}px`;
            button.append(ripple);
            window.setTimeout(() => { window.location.href = button.href; }, 240);
        });
    });

    const contactDetails = document.querySelector('#footer-contact-details');
    const contactEditor = document.querySelector('#contact-editor');
    const contactForm = document.querySelector('#contact-editor-form');
    const editContactButton = document.querySelector('#edit-contact-button');
    const footer = document.querySelector('#site-footer');

    function readContact() {
        let saved;
        try {
            saved = JSON.parse(localStorage.getItem('rb_contact_details') || 'null');
        } catch (error) {
            console.error('Could not read saved contact details.', error);
        }

        return {
            online: { ...CONTACT.online, ...(saved?.online || {}) },
            offline: { ...CONTACT.offline, ...(saved?.offline || {}) },
            email: typeof saved?.email === 'string' ? saved.email : CONTACT.email,
            address: typeof saved?.address === 'string' ? saved.address : CONTACT.address
        };
    }

    function readRestaurantName() {
        try {
            const settings = JSON.parse(localStorage.getItem('rb_set') || 'null');
            return typeof settings?.name === 'string' && settings.name.trim()
                ? settings.name.trim()
                : 'Neel Tarang';
        } catch (error) {
            console.error('Could not read the restaurant name.', error);
            return 'Neel Tarang';
        }
    }

    function ownerIsLoggedIn() {
        try {
            return sessionStorage.getItem('rb_adm') === '1';
        } catch (error) {
            console.error('Could not read the owner login session.', error);
            return false;
        }
    }

    function isOpenNow(hours, date = new Date()) {
        const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(hours || '');
        if (!match) return false;
        const openAt = Number(match[1]) * 60 + Number(match[2]);
        const closeAt = Number(match[3]) * 60 + Number(match[4]);
        const now = date.getHours() * 60 + date.getMinutes();
        if (openAt === closeAt) return true;
        return closeAt > openAt
            ? now >= openAt && now < closeAt
            : now >= openAt || now < closeAt;
    }

    function cleanPhone(phone) {
        return String(phone || '').replace(/[^\d+]/g, '');
    }

    function whatsappNumber(phone) {
        let digits = String(phone || '').replace(/\D/g, '');
        if (digits.length === 10) digits = `91${digits}`;
        else if (digits.startsWith('0') && digits.length === 11) digits = `91${digits.slice(1)}`;
        return digits;
    }

    function appendContactLine(contact, type) {
        const line = document.createElement('div');
        const open = isOpenNow(contact.hours);
        line.className = `footer-contact-line${open ? ' is-active' : ''}`;

        const heading = document.createElement('span');
        heading.className = 'footer-contact-label';
        heading.textContent = `${contact.label} · ${contact.hours}`;
        line.append(heading);

        const phoneLink = document.createElement('a');
        phoneLink.className = 'footer-phone';
        phoneLink.href = `tel:${cleanPhone(contact.phone)}`;
        phoneLink.textContent = contact.phone;
        line.append(phoneLink);

        const statusBadge = document.createElement('span');
        statusBadge.className = `footer-status ${open ? 'is-open' : 'is-closed'}`;
        statusBadge.textContent = open ? 'Open now' : 'Closed';
        line.append(statusBadge);

        const status = document.createElement('span');
        status.className = 'visually-hidden';
        status.textContent = `${contact.label} is ${open ? 'open' : 'closed'} now`;
        line.append(status);

        if (type === 'online') line.dataset.active = String(open);
        contactDetails.append(line);
    }

    function renderFooter() {
        if (!contactDetails) return;
        const contact = readContact();
        const name = readRestaurantName();
        document.querySelector('#footer-brand-name').textContent = name;
        document.querySelector('#footer-copyright-name').textContent = name;
        document.querySelector('.footer-logo').setAttribute('aria-label', `${name} home`);
        document.querySelector('#footer-year').textContent = String(new Date().getFullYear());

        contactDetails.replaceChildren();
        appendContactLine(contact.online, 'online');
        appendContactLine(contact.offline, 'offline');

        const emailLink = document.createElement('a');
        emailLink.className = 'footer-email';
        emailLink.href = `mailto:${contact.email}`;
        emailLink.textContent = contact.email;
        contactDetails.append(emailLink);

        const address = document.createElement('p');
        address.className = 'footer-address';
        address.textContent = contact.address;
        contactDetails.append(address);

        const mapLink = document.querySelector('.footer-map');
        mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`;
        const supportLink = document.querySelector('.footer-support');
        supportLink.href = `mailto:${contact.email}`;
        document.querySelectorAll('.footer-legal-link').forEach(link => {
            link.href = `mailto:${contact.email}?subject=${encodeURIComponent(link.dataset.subject || '')}`;
        });
        const whatsappLink = document.querySelector('.social-whatsapp');
        whatsappLink.href = `https://wa.me/${whatsappNumber(contact.online.phone)}`;
        whatsappLink.setAttribute('aria-label', `WhatsApp ${contact.online.label}`);
        editContactButton.hidden = !ownerIsLoggedIn();
    }

    function openContactEditor() {
        if (!ownerIsLoggedIn()) return;
        const contact = readContact();
        contactForm.elements.onlinePhone.value = contact.online.phone;
        contactForm.elements.offlinePhone.value = contact.offline.phone;
        contactForm.elements.email.value = contact.email;
        contactForm.elements.address.value = contact.address;
        contactEditor.hidden = false;
        contactForm.elements.onlinePhone.focus();
    }

    function closeContactEditor() {
        contactEditor.hidden = true;
        editContactButton.focus();
    }

    editContactButton?.addEventListener('click', openContactEditor);
    contactEditor?.querySelector('.contact-editor-close').addEventListener('click', closeContactEditor);
    contactEditor?.querySelector('.contact-editor-cancel').addEventListener('click', closeContactEditor);
    contactEditor?.addEventListener('click', event => {
        if (event.target === contactEditor) closeContactEditor();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && contactEditor && !contactEditor.hidden) closeContactEditor();
    });
    contactForm?.addEventListener('submit', event => {
        event.preventDefault();
        if (!ownerIsLoggedIn()) {
            contactEditor.hidden = true;
            renderFooter();
            return;
        }
        const nextContact = readContact();
        nextContact.online.phone = contactForm.elements.onlinePhone.value.trim();
        nextContact.offline.phone = contactForm.elements.offlinePhone.value.trim();
        nextContact.email = contactForm.elements.email.value.trim();
        nextContact.address = contactForm.elements.address.value.trim();
        try {
            localStorage.setItem('rb_contact_details', JSON.stringify(nextContact));
        } catch (error) {
            console.error('Could not save contact details.', error);
            window.alert('Contact details could not be saved. Check browser storage and try again.');
            return;
        }
        renderFooter();
        closeContactEditor();
    });

    const accordions = Array.from(document.querySelectorAll('.footer-accordion'));
    const mobileFooter = window.matchMedia('(max-width: 700px)');
    function setFooterAccordionMode() {
        accordions.forEach(section => {
            if (mobileFooter.matches) section.removeAttribute('open');
            else section.setAttribute('open', '');
        });
    }
    if (mobileFooter.addEventListener) mobileFooter.addEventListener('change', setFooterAccordionMode);
    else mobileFooter.addListener(setFooterAccordionMode);
    window.addEventListener('resize', setFooterAccordionMode);
    setFooterAccordionMode();

    const footerObserver = 'IntersectionObserver' in window
        ? new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                footer?.classList.add('is-visible');
                footerObserver.disconnect();
            }
        }, { threshold: 0.01 })
        : null;
    function revealFooterIfVisible() {
        if (!footer || footer.classList.contains('is-visible')) return;
        const bounds = footer.getBoundingClientRect();
        if (bounds.top < window.innerHeight && bounds.bottom > 0) {
            footer.classList.add('is-visible');
            footerObserver?.disconnect();
        }
    }
    if (footer && footerObserver) {
        footerObserver.observe(footer);
        revealFooterIfVisible();
        window.addEventListener('load', revealFooterIfVisible, { once: true });
        window.addEventListener('pageshow', revealFooterIfVisible);
        window.setTimeout(revealFooterIfVisible, 0);
        window.setTimeout(revealFooterIfVisible, 500);
    } else {
        footer?.classList.add('is-visible');
    }

    const backToTop = document.querySelector('#back-to-top-floating');
    function updateBackToTop() {
        backToTop.hidden = window.scrollY < 360;
    }
    backToTop?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: motionPreference.matches ? 'auto' : 'smooth' });
    });
    window.addEventListener('scroll', updateBackToTop, { passive: true });
    window.addEventListener('scroll', revealFooterIfVisible, { passive: true });

    renderFooter();
    updateBackToTop();
    window.setInterval(renderFooter, 60000);
    window.addEventListener('focus', renderFooter);
    window.addEventListener('storage', event => {
        if (event.key === 'rb_contact_details' || event.key === 'rb_set') renderFooter();
    });
})();
