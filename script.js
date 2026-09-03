// Program horizontal scroll + drag + wheel
const program = document.querySelector('.program-shell');
const track = document.querySelector('.lesson-track');
const sticky = document.getElementById('programSticky');
const programIntro = document.querySelector('.program-intro');
const mobileProgramQuery = window.matchMedia('(max-width: 768px)');

function updateWideDesktopScale() {
    const viewportWidth = document.documentElement.clientWidth;
    const scale = viewportWidth > 1920 ? viewportWidth / 1920 : 1;
    document.documentElement.style.setProperty('--wide-desktop-scale', scale.toFixed(6));
}

updateWideDesktopScale();

let currentTravel = 0;
let startOffset = 0;
let currentProgress = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartScroll = 0;
let touchAxis = null;
let lastDragX = 0;
let lastDragTime = 0;
let swipeVelocity = 0;
let inertiaFrame = null;

function renderProgramTrack() {
    track.style.transform = `translate3d(${-currentProgress}px, 0, 0)`;
}

function stopProgramInertia() {
    if (inertiaFrame !== null) cancelAnimationFrame(inertiaFrame);
    inertiaFrame = null;
    swipeVelocity = 0;
}

function startProgramInertia() {
    if (!mobileProgramQuery.matches || Math.abs(swipeVelocity) < 0.03) return;

    function continueInertia() {
        const nextProgress = Math.min(Math.max(currentProgress + swipeVelocity * 16, 0), currentTravel);
        const reachedEdge = nextProgress === currentProgress;
        currentProgress = nextProgress;
        renderProgramTrack();
        swipeVelocity *= 0.94;

        if (!reachedEdge && Math.abs(swipeVelocity) >= 0.015) {
            inertiaFrame = requestAnimationFrame(continueInertia);
        } else {
            stopProgramInertia();
        }
    }

    inertiaFrame = requestAnimationFrame(continueInertia);
}

function updateTravel() {
    if (!program || !track) return;
    const viewport = document.querySelector('.program-viewport');
    const pad = viewport ? parseFloat(getComputedStyle(viewport).paddingLeft) || 94 : 94;
    // Hero/About use their own wide-screen scale. Program stays fluid, so its
    // travel must be calculated from the actual program viewport width.
    const viewportWidth = viewport ? viewport.clientWidth : window.innerWidth;
    currentTravel = Math.max(0, track.scrollWidth - viewportWidth + pad);
    program.style.setProperty('--program-travel', `${currentTravel}px`);
    currentProgress = Math.min(currentProgress, currentTravel);
    const introHeight = mobileProgramQuery.matches && programIntro ? programIntro.offsetHeight : 0;
    startOffset = program.offsetTop + introHeight;
    if (mobileProgramQuery.matches) renderProgramTrack();
}

function updateProgram() {
    if (!program || !track) return;
    if (mobileProgramQuery.matches) {
        renderProgramTrack();
        return;
    }
    const progress = Math.min(Math.max(window.scrollY - startOffset, 0), currentTravel);
    currentProgress = progress;
    renderProgramTrack();
}

window.addEventListener('resize', () => {
    updateWideDesktopScale();
    updateTravel();
    updateProgram();
}, { passive: true });

window.addEventListener('scroll', updateProgram, { passive: true });

function onDragStart(e) {
    const ev = e.touches ? e.touches[0] : e;
    if (!sticky.contains(ev.target)) return;
    if (e.type === 'mousedown' && e.button !== 0) return;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    dragStartScroll = currentProgress;
    touchAxis = null;
    stopProgramInertia();
    lastDragX = ev.clientX;
    lastDragTime = performance.now();

    // On a phone, wait for movement direction before preventing native scrolling.
    if (mobileProgramQuery.matches && e.type === 'touchstart') return;

    isDragging = true;
    sticky.style.cursor = 'grabbing';
    e.preventDefault();
}

function onDragMove(e) {
    const ev = e.touches ? e.touches[0] : e;
    if (mobileProgramQuery.matches && e.type === 'touchmove') {
        if (touchAxis === null) {
            const deltaX = ev.clientX - dragStartX;
            const deltaY = ev.clientY - dragStartY;
            if (Math.abs(deltaX) + Math.abs(deltaY) < 8) return;
            touchAxis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
            if (touchAxis === 'horizontal') {
                isDragging = true;
                sticky.style.cursor = 'grabbing';
            }
        }
        if (touchAxis === 'vertical') return;
    }

    if (!isDragging) return;
    const deltaX = ev.clientX - dragStartX;
    const newProgress = Math.min(Math.max(dragStartScroll - deltaX, 0), currentTravel);
    const previousProgress = currentProgress;
    currentProgress = newProgress;
    if (mobileProgramQuery.matches) {
        const now = performance.now();
        const elapsed = Math.max(now - lastDragTime, 1);
        const instantVelocity = (currentProgress - previousProgress) / elapsed;
        swipeVelocity = swipeVelocity * 0.35 + instantVelocity * 0.65;
        lastDragX = ev.clientX;
        lastDragTime = now;
        renderProgramTrack();
    } else {
        window.scrollTo({ top: startOffset + newProgress, behavior: 'instant' });
    }
    e.preventDefault();
}

function onDragEnd(e) {
    if (mobileProgramQuery.matches && touchAxis === 'vertical') {
        touchAxis = null;
        return;
    }
    if (!isDragging) {
        touchAxis = null;
        return;
    }
    isDragging = false;
    sticky.style.cursor = 'grab';
    if (!mobileProgramQuery.matches) {
        window.scrollTo({ top: startOffset + currentProgress, behavior: 'instant' });
    } else {
        startProgramInertia();
    }
    touchAxis = null;
}

function onWheel(e) {
    if (mobileProgramQuery.matches) return;
    if (isDragging) return;
    const rect = sticky.getBoundingClientRect();
    const isOver = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!isOver) return;

    const currentScrollY = window.scrollY;
    const endOffset = startOffset + currentTravel;
    if (currentScrollY < startOffset - 1 || currentScrollY > endOffset + 1) return;

    const delta = e.deltaY;
    const newProgress = Math.min(Math.max(currentProgress + delta * 0.8, 0), currentTravel);
    if (newProgress !== currentProgress) {
        currentProgress = newProgress;
        window.scrollTo({ top: startOffset + newProgress, behavior: 'instant' });
        e.preventDefault();
    }
}

sticky.addEventListener('mousedown', onDragStart);
document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup', onDragEnd);

sticky.addEventListener('touchstart', onDragStart, { passive: false });
document.addEventListener('touchmove', onDragMove, { passive: false });
document.addEventListener('touchend', onDragEnd, { passive: false });
document.addEventListener('touchcancel', onDragEnd, { passive: false });

sticky.addEventListener('wheel', onWheel, { passive: false });

window.addEventListener('load', () => {
    updateTravel();
    updateProgram();
});

updateTravel();
updateProgram();

// Video triangles hover
document.querySelectorAll('.tri-video').forEach(function(triangle) {
    var video = triangle.querySelector('video');
    triangle.addEventListener('mouseenter', function() {
        if (video) video.play().catch(function() {});
    });
    triangle.addEventListener('mouseleave', function() {
        if (video) video.pause();
    });
});

// Main player controls
var mainVideo = document.getElementById('course-video');
var btnPause = document.getElementById('btn-pause');
var btnPlay = document.getElementById('btn-play');
var fadeTimeout = null;

function showPauseButton() {
    btnPause.style.display = 'flex';
    btnPlay.style.display = 'none';
    btnPlay.classList.remove('fade-out');
    clearTimeout(fadeTimeout);
}

function showPlayButton() {
    btnPause.style.display = 'none';
    btnPlay.style.display = 'flex';
    btnPlay.classList.remove('fade-out');
    clearTimeout(fadeTimeout);
    fadeTimeout = setTimeout(function() {
        btnPlay.classList.add('fade-out');
    }, 3000);
}

showPauseButton();

btnPause.addEventListener('click', function() {
    if (mainVideo.paused) mainVideo.play();
});
btnPlay.addEventListener('click', function() {
    if (!mainVideo.paused) mainVideo.pause();
});

mainVideo.addEventListener('play', showPlayButton);
mainVideo.addEventListener('pause', showPauseButton);

mainVideo.addEventListener('click', function() {
    if (this.paused) { this.play(); } else { this.pause(); }
});

// Mobile FAQ preview: opening any answer reveals the whole list.
var faqSection = document.querySelector('.faq-new');
if (faqSection) {
    var faqItems = faqSection.querySelectorAll('details');

    function updateFaqPreview() {
        var hasOpenItem = Array.from(faqItems).some(function(item) { return item.open; });
        faqSection.classList.toggle('faq--expanded', hasOpenItem);
    }

    faqItems.forEach(function(item) {
        item.addEventListener('toggle', updateFaqPreview);
    });

    updateFaqPreview();
}

// About: mouse interaction on desktop and tap-to-reveal interaction on mobile.
var aboutSection = document.querySelector('.about');
var aboutToggle = document.querySelector('.about-mobile-toggle');
var desktopAboutQuery = window.matchMedia('(min-width: 769px) and (hover: hover)');

if (aboutSection) {
    var icons = aboutSection.querySelectorAll('.benefit');
    var mouseX = 0;
    var mouseY = 0;
    var pointerInside = false;
    var time = 0;
    var animationFrame = null;

    var iconData = [];
    icons.forEach(function(icon) {
        iconData.push({
            driftPhase: Math.random() * 100,
            driftAmplitude: 2 + Math.random() * 4,
            speed: 0.5 + Math.random() * 0.5,
            maxMove: 10 + Math.random() * 15
        });
    });

    function updateDesktopIcons() {
        if (!desktopAboutQuery.matches) {
            animationFrame = null;
            return;
        }

        var rect = aboutSection.getBoundingClientRect();
        time += 0.01;

        icons.forEach(function(icon, index) {
            var data = iconData[index];
            var iconRect = icon.getBoundingClientRect();
            var iconCX = iconRect.left + iconRect.width / 2;
            var iconCY = iconRect.top + iconRect.height / 2;
            var moveX = 0;
            var moveY = 0;

            if (pointerInside) {
                var dx = mouseX - iconCX;
                var dy = mouseY - iconCY;
                var distance = Math.sqrt(dx * dx + dy * dy);
                var maxDist = rect.width * 0.6;
                var influence = Math.max(0, 1 - distance / maxDist);
                influence = influence * influence;
                moveX = dx * influence * 0.3;
                moveY = dy * influence * 0.3;
            }

            var driftX = Math.sin(time * data.speed + data.driftPhase) * data.driftAmplitude;
            var driftY = Math.cos(time * data.speed * 0.8 + data.driftPhase * 0.7) * data.driftAmplitude;
            var finalX = moveX + driftX;
            var finalY = moveY + driftY;
            var length = Math.sqrt(finalX * finalX + finalY * finalY);

            if (length > data.maxMove) {
                finalX = (finalX / length) * data.maxMove;
                finalY = (finalY / length) * data.maxMove;
            }

            icon.style.transform = 'translate(' + finalX + 'px, ' + finalY + 'px)';
        });

        animationFrame = requestAnimationFrame(updateDesktopIcons);
    }

    function updateAboutMode() {
        if (desktopAboutQuery.matches) {
            if (!animationFrame) updateDesktopIcons();
        } else {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            animationFrame = null;
            icons.forEach(function(icon) { icon.style.transform = ''; });
        }
    }

    aboutSection.addEventListener('mousemove', function(e) {
        pointerInside = true;
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    aboutSection.addEventListener('mouseleave', function() {
        pointerInside = false;
    });

    desktopAboutQuery.addEventListener('change', updateAboutMode);
    updateAboutMode();
}

if (aboutToggle && aboutSection) {
    aboutToggle.addEventListener('click', function() {
        if (!window.matchMedia('(max-width: 768px)').matches) return;
        var isVisible = aboutSection.classList.toggle('about--icons-visible');
        aboutToggle.setAttribute('aria-pressed', String(isVisible));
    });
}
