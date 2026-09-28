// Program horizontal scroll follows one smoothly controlled page position.
const program = document.querySelector('.program-shell');
const track = document.querySelector('.lesson-track');
const sticky = document.getElementById('programSticky');
const mobileProgramQuery = window.matchMedia('(max-width: 768px)');

function updateWideDesktopScale() {
    const viewportWidth = document.documentElement.clientWidth;
    const scale = viewportWidth > 1920 ? viewportWidth / 1920 : 1;
    document.documentElement.style.setProperty('--wide-desktop-scale', scale.toFixed(6));
    requestAnimationFrame(() => {
        const backgroundHeight = Math.ceil(document.documentElement.scrollHeight * scale);
        document.documentElement.style.setProperty('--wide-desktop-background-height', `${backgroundHeight}px`);
    });
}

updateWideDesktopScale();
window.addEventListener('load', updateWideDesktopScale, { once: true });

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
let programScrollFrame = null;
let programMeasureFrame = null;
let programMotionFrame = null;
let programMotionTargetY = null;
let programMotionOwner = null;
let programMotionLastTime = 0;
let programMotionExpectedY = null;

const PROGRAM_WHEEL_EASE_RATE = 15;
const PROGRAM_DRAG_EASE_RATE = 22;
const PROGRAM_WHEEL_MAX_LEAD = 300;

function renderProgramTrack() {
    track.style.transform = `translate3d(${-currentProgress}px, 0, 0)`;
}

function stopProgramInertia() {
    if (inertiaFrame !== null) cancelAnimationFrame(inertiaFrame);
    inertiaFrame = null;
    swipeVelocity = 0;
}

function stopProgramMotion() {
    if (programMotionFrame !== null) cancelAnimationFrame(programMotionFrame);
    programMotionFrame = null;
    programMotionTargetY = null;
    programMotionOwner = null;
    programMotionLastTime = 0;
    programMotionExpectedY = null;
}

function animateProgramMotion(timestamp) {
    programMotionFrame = null;
    if (programMotionTargetY === null) return;

    const currentY = window.scrollY;
    const distance = programMotionTargetY - currentY;
    if (Math.abs(distance) <= 0.5) {
        window.scrollTo({ top: programMotionTargetY, behavior: 'instant' });
        updateProgram();
        stopProgramMotion();
        return;
    }

    const elapsed = programMotionLastTime
        ? Math.min((timestamp - programMotionLastTime) / 1000, 0.05)
        : 1 / 60;
    programMotionLastTime = timestamp;
    const rate = programMotionOwner === 'drag' ? PROGRAM_DRAG_EASE_RATE : PROGRAM_WHEEL_EASE_RATE;
    const nextY = currentY + distance * (1 - Math.exp(-rate * elapsed));
    programMotionExpectedY = nextY;
    window.scrollTo({ top: nextY, behavior: 'instant' });
    updateProgram();
    programMotionFrame = requestAnimationFrame(animateProgramMotion);
}

function moveProgramTo(targetY, owner) {
    programMotionTargetY = targetY;
    programMotionOwner = owner;
    if (programMotionFrame === null) {
        programMotionLastTime = 0;
        programMotionFrame = requestAnimationFrame(animateProgramMotion);
    }
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
    const nextTravel = Math.max(0, track.scrollWidth - viewportWidth + pad);
    if (Math.abs(nextTravel - currentTravel) > 1) stopProgramMotion();
    currentTravel = nextTravel;
    program.style.setProperty('--program-travel', `${currentTravel}px`);
    currentProgress = Math.min(currentProgress, currentTravel);
    startOffset = program.getBoundingClientRect().top + window.scrollY;
    updateProgram();
}

function updateProgram() {
    if (!program || !track) return;
    if (!mobileProgramQuery.matches) {
        currentProgress = Math.min(Math.max(window.scrollY - startOffset, 0), currentTravel);
    }
    renderProgramTrack();
}

function scheduleProgramUpdate() {
    if (programScrollFrame !== null) return;
    programScrollFrame = requestAnimationFrame(() => {
        programScrollFrame = null;
        updateProgram();
    });
}

function scheduleTravelUpdate() {
    if (programMeasureFrame !== null) return;
    programMeasureFrame = requestAnimationFrame(() => {
        programMeasureFrame = null;
        updateTravel();
    });
}

function onProgramWheel(e) {
    if (mobileProgramQuery.matches || currentTravel <= 0) return;
    if (e.ctrlKey) {
        stopProgramMotion();
        return;
    }
    if (!e.cancelable) {
        stopProgramMotion();
        return;
    }
    if (isDragging) {
        e.preventDefault();
        return;
    }

    // Own wheel input from just before the program through its exit. The
    // target is allowed past either edge, so the next section starts moving
    // without a separate handoff or a stored overflow burst.
    const currentY = window.scrollY;
    const zoneStart = startOffset - window.innerHeight;
    const zoneEnd = startOffset + currentTravel + window.innerHeight;
    if (currentY < zoneStart || currentY > zoneEnd) {
        stopProgramMotion();
        return;
    }

    const rawDelta = e.deltaY || e.deltaX;
    if (!rawDelta) return;
    const delta = rawDelta * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
    const remaining = programMotionTargetY === null ? 0 : programMotionTargetY - currentY;
    const continuesWheelDirection = programMotionOwner === 'wheel'
        && Math.sign(remaining) === Math.sign(delta);
    const baseY = continuesWheelDirection ? programMotionTargetY : currentY;
    const maxScrollY = Math.max(0, document.scrollingElement.scrollHeight - window.innerHeight);
    const desiredY = Math.min(Math.max(baseY + delta, 0), maxScrollY);
    const limitedY = currentY + Math.min(
        Math.max(desiredY - currentY, -PROGRAM_WHEEL_MAX_LEAD),
        PROGRAM_WHEEL_MAX_LEAD
    );

    e.preventDefault();
    moveProgramTo(limitedY, 'wheel');
}

window.addEventListener('resize', () => {
    stopProgramMotion();
    updateWideDesktopScale();
    scheduleTravelUpdate();
}, { passive: true });
window.addEventListener('scroll', () => {
    if (programMotionOwner !== null && programMotionExpectedY !== null
        && Math.abs(window.scrollY - programMotionExpectedY) > 2) {
        stopProgramMotion();
    }
    if (programMotionOwner === null) scheduleProgramUpdate();
}, { passive: true });
window.addEventListener('wheel', onProgramWheel, { passive: false });
document.addEventListener('pointerdown', stopProgramMotion, { capture: true, passive: true });
window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        stopProgramMotion();
    }
});

// The SVG or viewport can change size after the first render. Keep the sticky
// section's vertical travel equal to the track's actual horizontal travel.
if (window.ResizeObserver && track && program) {
    const programResizeObserver = new ResizeObserver(scheduleTravelUpdate);
    programResizeObserver.observe(track);
    programResizeObserver.observe(document.querySelector('.program-viewport'));
}

function onDragStart(e) {
    const ev = e.touches ? e.touches[0] : e;
    if (!sticky.contains(ev.target)) return;
    if (e.type === 'mousedown' && e.button !== 0) return;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    dragStartScroll = mobileProgramQuery.matches ? currentProgress : window.scrollY;
    touchAxis = null;
    stopProgramInertia();
    if (!mobileProgramQuery.matches) stopProgramMotion();
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
    if (mobileProgramQuery.matches) {
        const newProgress = Math.min(Math.max(dragStartScroll - deltaX, 0), currentTravel);
        const previousProgress = currentProgress;
        currentProgress = newProgress;
        const now = performance.now();
        const elapsed = Math.max(now - lastDragTime, 1);
        const instantVelocity = (currentProgress - previousProgress) / elapsed;
        swipeVelocity = swipeVelocity * 0.35 + instantVelocity * 0.65;
        lastDragX = ev.clientX;
        lastDragTime = now;
        renderProgramTrack();
    } else {
        const nextScrollY = Math.min(
            Math.max(dragStartScroll - deltaX, startOffset),
            startOffset + currentTravel
        );
        moveProgramTo(nextScrollY, 'drag');
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
    if (mobileProgramQuery.matches) startProgramInertia();
    touchAxis = null;
}

sticky.addEventListener('mousedown', onDragStart);
document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup', onDragEnd);

sticky.addEventListener('touchstart', onDragStart, { passive: false });
document.addEventListener('touchmove', onDragMove, { passive: false });
document.addEventListener('touchend', onDragEnd, { passive: false });
document.addEventListener('touchcancel', onDragEnd, { passive: false });

window.addEventListener('load', scheduleTravelUpdate);

updateTravel();

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
var playerSection = mainVideo ? mainVideo.closest('.player-section') : null;

// The deployed page intentionally has no course video files.  Safari still
// paints the empty <video> element as a solid dark rectangle, so on mobile we
// remove only that unavailable player while keeping the section intact when a
// real video source is supplied later.
function markPlayerUnavailable() {
    if (!playerSection) return;
    playerSection.classList.add('media-unavailable');
    updateTravel();
}

function markPlayerAvailable() {
    if (playerSection) playerSection.classList.remove('media-unavailable');
}

if (mainVideo) {
    mainVideo.addEventListener('error', markPlayerUnavailable);
    mainVideo.addEventListener('loadedmetadata', markPlayerAvailable);
    var playerSource = mainVideo.getAttribute('src') || '';
    // Windows-only paths cannot resolve on the hosted page.  Mark them
    // immediately, avoiding a flash of the Safari fallback rectangle.
    if (/^[A-Za-z]:[\\/]/.test(playerSource) || /^file:/i.test(playerSource)) {
        markPlayerUnavailable();
    }
}

function showPauseButton() {
    if (!btnPause || !btnPlay) return;
    btnPause.style.display = 'flex';
    btnPlay.style.display = 'none';
    btnPlay.classList.remove('fade-out');
    clearTimeout(fadeTimeout);
}

function showPlayButton() {
    if (!btnPause || !btnPlay) return;
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

    function animateFaqAnswer(item) {
        var answer = item.querySelector('p');
        var summary = item.querySelector('summary');
        if (!answer) return;

        answer.classList.add('faq-answer');
        answer.style.maxHeight = '0px';
        answer.style.opacity = '0';
        answer.style.transform = 'translateY(-6px)';
        answer.style.marginBottom = '0px';

        var isClosing = false;
        var suppressNextToggle = false;
        var closeFallback = null;

        answer.addEventListener('transitionend', function(event) {
            // The same transitionend event also fires while an answer is
            // collapsing. Do not restore `max-height: none` during that
            // phase: doing so briefly expands the answer for one frame
            // before <details> closes and makes everything below jump.
            if (event.propertyName === 'max-height' && item.open && !isClosing) {
                answer.style.maxHeight = 'none';
            }
        });

        function openAnswer() {
            answer.style.maxHeight = '0px';
            answer.style.opacity = '0';
            answer.style.transform = 'translateY(-6px)';
            answer.style.marginBottom = '0px';
            requestAnimationFrame(function() {
                if (!item.open) return;
                answer.style.maxHeight = answer.scrollHeight + 'px';
                answer.style.opacity = '1';
                answer.style.transform = 'translateY(0)';
                answer.style.marginBottom = '13px';
            });
        }

        function finishClose() {
            if (!isClosing) return;
            isClosing = false;
            if (closeFallback !== null) window.clearTimeout(closeFallback);
            closeFallback = null;
            // Close details only after the answer has finished animating.
            suppressNextToggle = true;
            item.open = false;
        }

        function closeAnswer() {
            if (isClosing) return;
            isClosing = true;
            answer.style.maxHeight = answer.scrollHeight + 'px';
            answer.style.opacity = '1';
            answer.style.transform = 'translateY(0)';
            answer.style.marginBottom = '13px';
            requestAnimationFrame(function() {
                answer.style.maxHeight = '0px';
                answer.style.opacity = '0';
                answer.style.transform = 'translateY(-6px)';
                answer.style.marginBottom = '0px';
            });
            answer.addEventListener('transitionend', function(event) {
                if (event.propertyName === 'max-height') finishClose();
            }, { once: true });
            // Fallback for reduced-motion settings where transitionend is not fired.
            closeFallback = window.setTimeout(finishClose, 420);
        }

        // Native details closes its content immediately. Keep it open while
        // the answer animates out, then let finishClose close the element.
        if (summary) {
            summary.addEventListener('click', function(event) {
                if (item.open && !isClosing) {
                    event.preventDefault();
                    closeAnswer();
                }
            });
        }

        item.addEventListener('toggle', function() {
            if (suppressNextToggle) {
                suppressNextToggle = false;
                return;
            }
            if (item.open) openAnswer();
        });
    }

    function updateFaqPreview() {
        var hasOpenItem = Array.from(faqItems).some(function(item) { return item.open; });
        faqSection.classList.toggle('faq--expanded', hasOpenItem);
    }

    faqItems.forEach(function(item) {
        animateFaqAnswer(item);
        item.addEventListener('toggle', updateFaqPreview);
    });

    updateFaqPreview();
}

// About: mouse interaction on desktop and tap-to-reveal interaction on mobile.
var aboutSection = document.querySelector('.about');
var aboutRingElement = document.querySelector('.about-orbit-ring');
if (aboutRingElement && window.VinqyRing) window.VinqyRing.mount(aboutRingElement);
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
