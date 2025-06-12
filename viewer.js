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

    // Decode HTML entities utility
    function decodeEntities(encodedString) {
        const txt = document.createElement('textarea');
        txt.innerHTML = encodedString;
        return txt.value;
    }

    // Convert >>123456 to link text "123456" with class 'quote'
    // We'll link to the message number in viewer and use it for quote expansion
    function convertQuotes(text) {
        // Unescape HTML entities first
        text = decodeEntities(text);

        // Regex for >>123456 patterns
        return text.replace(/&gt;&gt;(\d+)/g, (match, p1) => {
            return `<a href="#" class="quote" data-postid="${p1}">${p1}</a>`;
        });
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
    }

    // Toggle viewer display
    function toggleViewer() {
        const bar = document.getElementById('otk-thread-bar'); // Get the black bar

        if (viewer.style.display === 'none' || viewer.style.display === '') {
            // Show viewer
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
        }
    }

    // Listen for toggle event from thread tracker script
    window.addEventListener('otkToggleViewer', toggleViewer);

    window.addEventListener('otkMessagesUpdated', () => {
        if (viewer.style.display === 'block') {
            // Store current scroll position
            const lastScrollTop = viewer.scrollTop;

            // Reload data from localStorage
            activeThreads = JSON.parse(localStorage.getItem(THREADS_KEY)) || [];
            messagesByThreadId = JSON.parse(localStorage.getItem(MESSAGES_KEY)) || {};
            threadColors = JSON.parse(localStorage.getItem(COLORS_KEY)) || {};

            renderAllMessages();

            // Restore scroll position
            viewer.scrollTop = lastScrollTop;
        }
    });

})();