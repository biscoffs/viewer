// ==UserScript==
// @name         4chan OTK Thread Viewer
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Viewer for OTK tracked threads messages with recursive quoted messages and toggle support
// @match        https://boards.4chan.org/b/
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let originalBodyOverflow = '';
    let otherBodyNodes = [];

    // Storage keys (must match tracker script)
    const THREADS_KEY = 'otkActiveThreads';
    const MESSAGES_KEY = 'otkMessagesByThreadId';
    const COLORS_KEY = 'otkThreadColors';
    const SELECTED_MESSAGE_KEY = 'otkSelectedMessageId';

    // Decode HTML entities utility
    function decodeEntities(encodedString) {
        const txt = document.createElement('textarea');
        txt.innerHTML = encodedString;
        return txt.value;
    }

    // Helper function to create YouTube embed HTML
    function createYouTubeEmbed(videoId, startTimeSeconds) {
        let finalSrc = `https://www.youtube.com/embed/${videoId}`;
        if (startTimeSeconds && startTimeSeconds > 0) {
            finalSrc += `?start=${startTimeSeconds}`;
        }
        const iframeHtml = `<iframe width="560" height="315" src="${finalSrc}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="aspect-ratio: 16 / 9; width: 100%; max-width: 560px;"></iframe>`;
        return `<div style="display: block; margin-top: 5px; margin-bottom: 5px;">${iframeHtml}</div>`;
    }

// Renamed and refactored to initiate embed process
function initiateTwitterEmbed(tweetId, originalUrl) {
    const divID = \`tweet-embed-\${tweetId}-\${Math.random().toString(36).substring(2, 7)}\`;
    
    // This will cause a console error for now, which is expected as fetchAndEmbedTweet is not yet defined.
    fetchAndEmbedTweet(divID, originalUrl); 

    // Return placeholder HTML.
    return \`<div id="\${divID}" class="twitter-embed-placeholder" style="padding: 10px; border: 1px solid #ccc; border-radius: 10px; background-color: #f0f0f0; min-height: 50px;">Loading Tweet: \${originalUrl}</div>\`;
}

    // Helper function to create Rumble embed HTML
    function createRumbleEmbed(rumbleIdWithV) {
        // Extract the actual ID part by removing the leading 'v'.
        const idPart = rumbleIdWithV.startsWith('v') ? rumbleIdWithV.substring(1) : rumbleIdWithV;
        const iframeHtml = `<iframe src="https://rumble.com/embed/${idPart}/?pub=4" style="width: 100%; min-height: 360px; aspect-ratio: 16 / 9; max-width: 640px; border: none;" allowfullscreen></iframe>`;
        return `<div style="display: block; margin-top: 5px; margin-bottom: 5px;">${iframeHtml}</div>`;
    }

    // Helper function to format seconds to Twitch's hms time format
    function formatSecondsToTwitchTime(totalSeconds) {
        if (totalSeconds === null || totalSeconds === undefined || totalSeconds <= 0) {
            return null;
        }
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60); // Ensure seconds is integer
        return `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
    }

    // Helper function to create Twitch embed HTML
    function createTwitchEmbed(type, id, startTimeSeconds) { // Added startTimeSeconds
        const parentHostname = 'boards.4chan.org';
        let src = '';
        if (type === 'clip') {
            src = `https://clips.twitch.tv/embed?clip=${id}&parent=${parentHostname}&autoplay=false`;
        } else if (type === 'video') {
            src = `https://player.twitch.tv/?video=${id}&parent=${parentHostname}&autoplay=false`;
            const formattedTime = formatSecondsToTwitchTime(startTimeSeconds);
            if (formattedTime) {
                src += `&t=${formattedTime}`;
            }
        }
        const iframeHtml = `<iframe src="${src}" style="width: 100%; min-height: 360px; aspect-ratio: 16 / 9; max-width: 640px; border: none;" allowfullscreen scrolling="no"></iframe>`;
        return `<div style="display: block; margin-top: 5px; margin-bottom: 5px;">${iframeHtml}</div>`;
    }

    // Helper function to create Streamable embed HTML
    function createStreamableEmbed(videoId) {
        const iframeHtml = `<iframe src="https://streamable.com/o/${videoId}?loop=false" style="width: 100%; min-height: 360px; aspect-ratio: 16 / 9; max-width: 640px; border: none;" allowfullscreen></iframe>`;
        return `<div style="display: block; margin-top: 5px; margin-bottom: 5px;">${iframeHtml}</div>`;
    }

    // Helper functions for YouTube time parsing
    function parseTimeParam(timeString) {
        if (!timeString) return null;
        let totalSeconds = 0;
        if (/^\d+$/.test(timeString)) {
            totalSeconds = parseInt(timeString, 10);
        } else {
            const hoursMatch = timeString.match(/(\d+)h/);
            if (hoursMatch) totalSeconds += parseInt(hoursMatch[1], 10) * 3600;
            const minutesMatch = timeString.match(/(\d+)m/);
            if (minutesMatch) totalSeconds += parseInt(minutesMatch[1], 10) * 60;
            const secondsMatch = timeString.match(/(\d+)s/);
            if (secondsMatch) totalSeconds += parseInt(secondsMatch[1], 10);
        }
        return totalSeconds > 0 ? totalSeconds : null;
    }

    function getTimeFromParams(allParamsString) {
        if (!allParamsString) return null;
        // Matches t=VALUE or start=VALUE from the param string
        const timeMatch = allParamsString.match(/[?&](?:t|start)=([^&]+)/);
        if (timeMatch && timeMatch[1]) {
            return parseTimeParam(timeMatch[1]);
        }
        return null;
    }

    // Convert >>123456 to link text "123456" with class 'quote'
    // We'll link to the message number in viewer and use it for quote expansion
    // Also handles YouTube, X/Twitter, Rumble, Twitch, Streamable, and general links.
    function convertQuotes(text) {
        // Unescape HTML entities first
        text = decodeEntities(text);

        // Define regexes (ensure global flag 'g' is used)
        // YouTube regex now captures video ID (group 1) and all parameters (group 2)
        const youtubeRegexG = /https?:\/\/(?:www\.youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)((?:[?&][a-zA-Z0-9_=&%.:+-]*)*)/g;
        const twitterRegexG = /(https?:\/\/(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/([0-9]+))/g;
        const rumbleRegexG = /https?:\/\/rumble\.com\/(?:embed\/)?(v[a-zA-Z0-9]+)(?:-[^\s"'>?&.]*)?(?:\.html)?(?:\?[^\s"'>]*)?/g;
        const twitchClipRegexG = /https?:\/\/(?:clips\.twitch\.tv\/|(?:www\.)?twitch\.tv\/[a-zA-Z0-9_]+\/clip\/)([a-zA-Z0-9_-]+)(?:\?[^\s"'>]*)?/g;
        // Twitch VOD regex now captures VOD ID (group 1) and all parameters (group 2)
        const twitchVodRegexG = /https?:\/\/(?:www\.)?twitch\.tv\/videos\/([0-9]+)((?:[?&][a-zA-Z0-9_=&%.:+-]*)*)/g;
        const streamableRegexG = /https?:\/\/streamable\.com\/([a-zA-Z0-9]+)(?:\?[^\s"'>]*)?/g;
        const generalLinkRegexG = /(?<!(?:href="|src="))https?:\/\/[^\s<>"']+[^\s<>"'.?!,:;)]/g;
        const quoteLinkRegexG = /&gt;&gt;(\d+)/g;

        // Order of operations:
        // 1. YouTube
        text = text.replace(youtubeRegexG, (match, videoId, allParams) => {
            const startTime = getTimeFromParams(allParams);
            return `__YOUTUBE_EMBED__[${videoId}]__[${startTime || ''}]__`;
        });

        // 2. X/Twitter
        text = text.replace(twitterRegexG, (match, originalUrl, tweetId) => {
    const neuteredUrl = originalUrl.replace(/^http/, 'hxxp');
    return \`__TWITTER_EMBED__[${tweetId}]__${neuteredUrl}__\`;
});

        // 3. Rumble
        text = text.replace(rumbleRegexG, (match, rumbleIdWithV) => `__RUMBLE_EMBED__[${rumbleIdWithV}]__`);

        // 4. Twitch Clips
        text = text.replace(twitchClipRegexG, (match, clipId) => `__TWITCH_CLIP_EMBED__[${clipId}]__`);

        // 5. Twitch VODs
        text = text.replace(twitchVodRegexG, (match, vodId, allParams) => {
            const startTime = getTimeFromParams(allParams); // getTimeFromParams returns total seconds or null
            return `__TWITCH_VOD_EMBED__[${vodId}]__[${startTime || ''}]__`;
        });

        // 6. Streamable
        text = text.replace(streamableRegexG, (match, videoId) => `__STREAMABLE_EMBED__[${videoId}]__`);

        // 7. General links (must come after specific platform placeholders)
        text = text.replace(generalLinkRegexG, (match) => {
            // Avoid re-processing placeholders for YouTube, Twitter, Rumble, Twitch or Streamable
            if (match.includes("__YOUTUBE_EMBED__") || match.includes("__TWITTER_EMBED__") || match.includes("__RUMBLE_EMBED__") || match.includes("__TWITCH_CLIP_EMBED__") || match.includes("__TWITCH_VOD_EMBED__") || match.includes("__STREAMABLE_EMBED__")) {
                return match;
            }
            return `<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>`;
        });

        // 8. >>123 style quotes
        text = text.replace(quoteLinkRegexG, (match, p1) => `<a href="#" class="quote" data-postid="${p1}">${p1}</a>`);

        // Final placeholder replacements:
        // 9. YouTube embeds
        text = text.replace(/__YOUTUBE_EMBED__\[([a-zA-Z0-9_-]+)\]__\[([0-9]*)\]__/g, (match, videoId, startTime) =>
            createYouTubeEmbed(videoId, startTime ? parseInt(startTime, 10) : null)
        );

// 10. X/Twitter embeds/links - now calls initiateTwitterEmbed
text = text.replace(/__TWITTER_EMBED__\[([0-9]+)\]__(.*?)__/g, (match, tweetId, neuteredUrlFromPlaceholder) => {
    const originalUrl = neuteredUrlFromPlaceholder.replace(/^hxxp/, 'http');
    // Any previous console.log for debugging this specific spot should be removed by this replacement.
    return initiateTwitterEmbed(tweetId, originalUrl);
});

        // 11. Rumble embeds
        text = text.replace(/__RUMBLE_EMBED__\[(v[a-zA-Z0-9]+)\]__/g, (match, rumbleIdWithV) => createRumbleEmbed(rumbleIdWithV));

        // 12. Twitch Clip embeds
        text = text.replace(/__TWITCH_CLIP_EMBED__\[([a-zA-Z0-9_-]+)\]__/g, (match, clipId) => createTwitchEmbed('clip', clipId, null)); // Clips don't use startTimeSeconds from URL like VODs

        // 13. Twitch VOD embeds
        text = text.replace(/__TWITCH_VOD_EMBED__\[([0-9]+)\]__\[([0-9]*)\]__/g, (match, vodId, startTime) =>
            createTwitchEmbed('video', vodId, startTime ? parseInt(startTime, 10) : null)
        );

        // 14. Streamable embeds
        text = text.replace(/__STREAMABLE_EMBED__\[([a-zA-Z0-9]+)\]__/g, (match, videoId) => createStreamableEmbed(videoId));

        return text;
    }

    // Load storage data
    let activeThreads = JSON.parse(localStorage.getItem(THREADS_KEY)) || [];
    let messagesByThreadId = JSON.parse(localStorage.getItem(MESSAGES_KEY)) || {};
    let threadColors = JSON.parse(localStorage.getItem(COLORS_KEY)) || {};

    // Create or get viewer container
    let viewer = document.getElementById('otk-thread-viewer');
    if (!viewer) {
        viewer = document.createElement('div');
        viewer.id = 'otk-thread-viewer';
        viewer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0; right: 0; bottom: 0;
            background: #fff4de;
            overflow-y: auto;
            padding: 10px 20px;
            font-family: Verdana, sans-serif;
            font-size: 14px;
            z-index: 9998; /* Keep below tracker bar if tracker bar is to remain visible */
            display: none; /* start hidden */
        `;
        document.body.appendChild(viewer);
    }

    // Inject CSS for selected messages
    if (!document.getElementById('otk-viewer-styles')) {
        const styleSheet = document.createElement("style");
        styleSheet.id = 'otk-viewer-styles';
        styleSheet.type = "text/css";
        styleSheet.innerText = `
            .selected-message {
                background-color: #E0E0E0 !important;
                box-shadow: 0 0 5px rgba(0,0,0,0.3) !important;
            }
        `;
        document.head.appendChild(styleSheet);
    }

    // Helper: Find message by post id across all threads
    function findMessage(postId) {
        for (const threadId of activeThreads) {
            const msgs = messagesByThreadId[threadId] || [];
            for (const msg of msgs) {
                if (msg.id === parseInt(postId)) return { msg, threadId };
            }
        }
        return null;
    }

    // Render single message with recursive quoted messages above
    function renderMessageWithQuotes(msg, threadId, depth = 0, ancestors = []) {
        if (ancestors.includes(msg.id)) {
            // Detected a circular quote, stop rendering this branch.
            // Return a comment node or an empty document fragment.
            const comment = document.createComment(`Skipping circular quote to post ${msg.id}`);
            return comment;
        }
        const color = threadColors[threadId] || '#888';

        // Create container div for quoted messages (recursively)
        const container = document.createElement('div');
        // container.style.marginLeft = `${depth * 20}px`; // Removed to align all messages
        if (depth === 0) {
            container.style.backgroundColor = '#fff';
            container.dataset.messageId = msg.id; // Set data-message-id for top-level messages

            // Add click event listener for selection
            container.addEventListener('click', function(event) {
                const currentSelectedId = localStorage.getItem(SELECTED_MESSAGE_KEY);
                const thisMessageId = String(msg.id); // Ensure string comparison

                // Deselect if clicking the already selected message
                if (currentSelectedId === thisMessageId) {
                    localStorage.removeItem(SELECTED_MESSAGE_KEY);
                    this.classList.remove('selected-message');
                } else {
                    // Remove highlight from previously selected message
                    const previouslySelected = viewer.querySelector('.selected-message');
                    if (previouslySelected) {
                        previouslySelected.classList.remove('selected-message');
                    }

                    // Store new selected message ID and highlight it
                    localStorage.setItem(SELECTED_MESSAGE_KEY, thisMessageId);
                    this.classList.add('selected-message');
                }
                event.stopPropagation(); // Stop event from bubbling
            });

        } else {
            // Alternating backgrounds for quoted messages
            container.style.backgroundColor = (depth % 2 === 1) ? 'rgba(0,0,0,0.05)' : '#fff';
        }
        container.style.borderRadius = '4px';
        container.style.padding = '6px 8px';
        container.style.marginBottom = '8px';

        if (depth === 0) {
            container.style.borderBottom = '1px solid #ccc';
            // Optionally, adjust padding or margin if the border makes spacing awkward
            // For example, increase bottom padding or change margin:
            container.style.paddingBottom = '10px'; // Increase padding to give content space from border
            container.style.marginBottom = '15px'; // Increase margin to space out from next main message
        }

        // Find quotes in this message text
        const quoteIds = [];
        const quoteRegex = /&gt;&gt;(\d+)/g;
        let m;
        while ((m = quoteRegex.exec(msg.text)) !== null) {
            quoteIds.push(m[1]);
        }

        // Render quoted messages recursively (above)
        for (const qid of quoteIds) {
            const found = findMessage(qid);
            if (found) {
                const quotedEl = renderMessageWithQuotes(found.msg, found.threadId, depth + 1, [...ancestors, msg.id]);
                container.appendChild(quotedEl);
            }
        }

        // Create main message div
        const postDiv = document.createElement('div');
        postDiv.style.display = 'flex';
        postDiv.style.alignItems = 'flex-start';

        if (depth === 0) {
            // Color square
            const colorSquare = document.createElement('div');
            colorSquare.style.cssText = `
                width: 15px;
                height: 40px;
                background-color: ${color};
                border-radius: 3px;
                margin-right: 10px;
                flex-shrink: 0;
            `;
            postDiv.appendChild(colorSquare);
        }

        const textWrapperDiv = document.createElement('div');
        textWrapperDiv.style.display = 'flex';
        textWrapperDiv.style.flexDirection = 'column';

        // Post number and timestamp container
        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = 'margin-right: 10px; font-size: 12px; color: #555; flex-shrink: 0; white-space: nowrap;';
        const dt = new Date(msg.time * 1000);
        headerDiv.textContent = `#${msg.id} ${dt.toLocaleString()}`;
        textWrapperDiv.appendChild(headerDiv);

        // Content
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('post-content');
        contentDiv.style.whiteSpace = 'pre-wrap';
        contentDiv.innerHTML = convertQuotes(msg.text);
        textWrapperDiv.appendChild(contentDiv);

        if (msg.attachment && msg.attachment.tim) {
            const attach = msg.attachment;
            const board = 'b'; // Assuming 'b' for now, ideally this could be more dynamic if script were for multiple boards
            const thumbUrl = `https://i.4cdn.org/${board}/${attach.tim}s.jpg`;
            const fullUrl = `https://i.4cdn.org/${board}/${attach.tim}${attach.ext}`;

            const textWrapper = textWrapperDiv; // textWrapperDiv is where the thumb/full media will go

            const createThumbnail = () => {
                const thumb = document.createElement('img');
                thumb.src = thumbUrl;
                thumb.alt = attach.filename;
                thumb.title = `Click to view ${attach.filename} (${attach.w}x${attach.h})`;
                thumb.style.maxWidth = `${attach.tn_w}px`;
                thumb.style.maxHeight = `${attach.tn_h}px`;
                thumb.style.cursor = 'pointer';
                thumb.style.marginTop = '5px';
                thumb.style.borderRadius = '3px';
                thumb.dataset.isThumbnail = "true"; // Mark as thumbnail

                thumb.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const fullMedia = createFullMedia();
                    textWrapper.replaceChild(fullMedia, thumb);
                });
                return thumb;
            };

            const createFullMedia = () => {
                let mediaElement;
                if (['.jpg', '.jpeg', '.png', '.gif'].includes(attach.ext.toLowerCase())) {
                    mediaElement = document.createElement('img');
                    mediaElement.src = fullUrl;
                } else if (['.webm', '.mp4'].includes(attach.ext.toLowerCase())) {
                    mediaElement = document.createElement('video');
                    mediaElement.src = fullUrl;
                    mediaElement.controls = true;
                    mediaElement.autoplay = true;
                    mediaElement.loop = true;
                } else {
                    // Fallback for unsupported types, or just don't create mediaElement
                    const unsupportedText = document.createElement('span');
                    unsupportedText.textContent = `[Unsupported file type: ${attach.ext}]`;
                    return unsupportedText;
                }

                mediaElement.style.maxWidth = '100%'; // Constrain to parent width
                mediaElement.style.maxHeight = '70vh'; // Prevent excessive height
                mediaElement.style.display = 'block';
                mediaElement.style.marginTop = '5px';
                mediaElement.style.borderRadius = '3px';
                mediaElement.style.cursor = 'pointer';
                mediaElement.dataset.isThumbnail = "false"; // Mark as full media

                mediaElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const thumb = createThumbnail();
                    textWrapper.replaceChild(thumb, mediaElement);
                });
                return mediaElement;
            };

            const initialThumb = createThumbnail();
            textWrapperDiv.appendChild(initialThumb);
        }
        postDiv.appendChild(textWrapperDiv);

        container.appendChild(postDiv);
        return container;
    }

    // Render all messages chronologically across all threads
    function renderAllMessages() {
        viewer.innerHTML = '';

        // Gather all messages in one array with threadId info
        let allMessages = [];
        activeThreads.forEach(threadId => {
            const msgs = messagesByThreadId[threadId] || [];
            msgs.forEach(m => allMessages.push({ ...m, threadId }));
        });

        // Sort by time ascending
        allMessages.sort((a, b) => a.time - b.time);

        // Render all messages
        allMessages.forEach(msg => {
            const msgEl = renderMessageWithQuotes(msg, msg.threadId);
            // Selection class is now primarily handled by restoreSelectedMessageState upon loading all messages
            viewer.appendChild(msgEl);
        });

        // Add listener for quote links to scroll to quoted message
        viewer.querySelectorAll('a.quote').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const targetId = parseInt(link.dataset.postid);
                // Scroll to message with this id if found
                const targets = viewer.querySelectorAll('div');
                for (const el of targets) {
                    if (el.textContent.includes(`#${targetId} `)) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Highlight briefly
                        el.style.backgroundColor = '#ffff99';
                        setTimeout(() => {
                            el.style.backgroundColor = '';
                        }, 1500);
                        break;
                    }
                }
            });
        });

        return restoreSelectedMessageState(); // Call and return status
    }

    // Function to restore selected message state and scroll
    function restoreSelectedMessageState() {
        const selectedId = localStorage.getItem(SELECTED_MESSAGE_KEY);
        if (selectedId) {
            // Clear any existing selected message highlight first
            // This is important if a message was selected, then the page was reloaded,
            // and renderAllMessages initially added the class, but a *different* message
            // was clicked before this function runs (e.g. due to an update event).
            // Or, if the user manually removed the class via devtools and then an update happens.
            const previouslySelectedViewerHighlight = viewer.querySelector('.selected-message');
            if (previouslySelectedViewerHighlight) {
                previouslySelectedViewerHighlight.classList.remove('selected-message');
            }

            const selectedElement = viewer.querySelector(`[data-message-id="${selectedId}"]`);
            if (selectedElement) {
                selectedElement.classList.add('selected-message');
                selectedElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                return true; // Message found and scrolled to
            }
        }
        return false; // No selected ID or element not found
    }

    // Toggle viewer display
    function toggleViewer() {
        const bar = document.getElementById('otk-thread-bar'); // Get the black bar

        if (viewer.style.display === 'none' || viewer.style.display === '') {
            // Show viewer
            localStorage.setItem('otkViewerVisible', 'true'); // Store visibility
            renderAllMessages(); // Render content first
            viewer.style.display = 'block';
            const barElement = document.getElementById('otk-thread-bar');
            let calculatedPaddingTop = '60px'; // Fallback
            if (barElement) {
                const barHeight = barElement.offsetHeight;
                if (barHeight > 0) { // Ensure barHeight is sensible
                    calculatedPaddingTop = barHeight + 'px';
                }
            }
            // Set all paddings explicitly
            viewer.style.paddingTop = calculatedPaddingTop;
            viewer.style.paddingLeft = '20px';
            viewer.style.paddingRight = '20px';
            viewer.style.paddingBottom = '10px'; // Original bottom padding

            // Hide other body elements and store them
            originalBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            otherBodyNodes = [];
            Array.from(document.body.childNodes).forEach(node => {
                if (node !== viewer && node !== bar && node.nodeType === Node.ELEMENT_NODE) {
                    // Check if it's an element node and not the bar or viewer itself
                    if (node.style && node.style.display !== 'none') {
                        otherBodyNodes.push({ node: node, originalDisplay: node.style.display });
                        node.style.display = 'none';
                    } else if (!node.style && node.tagName !== 'SCRIPT' && node.tagName !== 'LINK') {
                        // For nodes without a style property or display none, like text nodes if not filtered by ELEMENT_NODE
                        // but mainly to catch elements that might not have .style.display set initially.
                        // SCRIPT and LINK tags are excluded as they don't render.
                        otherBodyNodes.push({ node: node, originalDisplay: '' }); // Assume it was visible
                        node.style.display = 'none';
                    }
                }
            });

            // Ensure the black bar is visible above the viewer
            if (bar) {
                bar.style.zIndex = '10000'; // Higher than viewer's z-index
            }

        } else {
            // Hide viewer
            // Reset to original general padding (10px top/bottom, 20px left/right)
            viewer.style.paddingTop = '10px';
            viewer.style.paddingLeft = '20px';
            viewer.style.paddingRight = '20px';
            viewer.style.paddingBottom = '10px';
            viewer.style.display = 'none';
            document.body.style.overflow = originalBodyOverflow;

            // Restore other body elements
            otherBodyNodes.forEach(item => {
                item.node.style.display = item.originalDisplay;
            });
            otherBodyNodes = [];

            // Reset black bar z-index if it was changed
            if (bar) {
                bar.style.zIndex = '9999'; // Original z-index
            }
            localStorage.setItem('otkViewerVisible', 'false'); // Store visibility
        }
    }

    // Listen for toggle event from thread tracker script
    window.addEventListener('otkToggleViewer', toggleViewer);

    // Auto-open viewer if it was visible before refresh
    const viewerWasVisible = localStorage.getItem('otkViewerVisible');
    if (viewerWasVisible === 'true') {
        toggleViewer();
    }

    // Handle page visibility changes
    function handleVisibilityChange() {
        if (document.visibilityState === 'visible') {
            // Check if the viewer element exists and is currently displayed
            // The 'viewer' variable is the main viewer DOM element, accessible in this scope.
            if (viewer && viewer.style.display === 'block') {
                // Attempt to restore the selected message state and scroll to it.
                restoreSelectedMessageState();
            }
        }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    window.addEventListener('otkMessagesUpdated', () => {
        if (viewer.style.display === 'block') {
            // Store current scroll position
            const lastScrollTop = viewer.scrollTop;

            // Reload data from localStorage
            activeThreads = JSON.parse(localStorage.getItem(THREADS_KEY)) || [];
            messagesByThreadId = JSON.parse(localStorage.getItem(MESSAGES_KEY)) || {};
            threadColors = JSON.parse(localStorage.getItem(COLORS_KEY)) || {};

            const scrolledToSelected = renderAllMessages(); // renderAllMessages now returns status

            // If restoreSelectedMessageState (called within renderAllMessages)
            // did NOT find and scroll to a selected message, then restore the previous scroll position.
            if (!scrolledToSelected) {
                viewer.scrollTop = lastScrollTop;
            }
        }
    });

})();
