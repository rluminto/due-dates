// popup.js
// JavaScript for the extension popup interface

document.addEventListener('DOMContentLoaded', async () => {
    // Popup loaded
    
    // Get DOM elements
    const loadingMessage = document.getElementById('loadingMessage');
    const emptyMessage = document.getElementById('emptyMessage');
    const deadlineList = document.getElementById('deadlineList');
    const itemCount = document.getElementById('itemCount');
    const refreshBtn = document.getElementById('refreshBtn');
    const optionsBtn = document.getElementById('optionsBtn');
    
    // Filter tabs: Upcoming / Done
    const filterUpcoming = document.getElementById('filterUpcoming');
    const filterDone = document.getElementById('filterDone');
    let currentFilter = 'upcoming';
    // showOverdueOnly flag removed
    
    // Quick site links removed from UI; refresh will orchestrate PL then GS when needed
    let allItems = [];
    
    // Initialize popup
    await loadDeadlines();
    
    // Event listeners
    refreshBtn.addEventListener('click', handleRefresh);
    optionsBtn.addEventListener('click', openOptions);
    // Listen for background updates (e.g., after scrapes complete)
    browser.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'DATA_UPDATED') {
            // Data updated, reload deadlines
            loadDeadlines();
        }
    });
    
    filterUpcoming.addEventListener('click', () => setFilter('upcoming'));
    filterDone.addEventListener('click', () => setFilter('done'));
    // Overdue-only toggle removed; overdue items will be shown at top of Upcoming by default

    // Keyboard support for tabs
    [filterUpcoming, filterDone].forEach(btn => {
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const other = btn === filterUpcoming ? filterDone : filterUpcoming;
                other.focus();
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                btn.click();
            }
        });
    });

    // PL All / Open Recent buttons removed from the UI; refresh will trigger these when appropriate
    
    // Load deadlines from storage
    async function loadDeadlines() {
        try {
            const data = await browser.runtime.sendMessage({ type: 'GET_DATA' });
            allItems = data.items || [];
            renderList();
        } catch (error) {
            console.error('Error loading deadlines:', error);
            showError('Failed to load deadlines');
        }
    }
    
    // Set active filter (upcoming or past)
    function setFilter(filter) {
        currentFilter = filter;

        // Update button states (reuse .filter-btn class)
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.filter-btn').forEach(btn => btn.setAttribute('aria-selected', 'false'));

        if (filter === 'upcoming') {
            filterUpcoming.classList.add('active');
            filterUpcoming.setAttribute('aria-selected', 'true');
        } else if (filter === 'done') {
            filterDone.classList.add('active');
            filterDone.setAttribute('aria-selected', 'true');
        }

        renderList();
    }
    
    // Render the deadline list
    function renderList() {
    // Rendering list
        
        // Filter items based on upcoming/past
        const now = new Date();
        // Partition items into overdue, upcoming, and done
        const overdueItems = [];
        const upcomingItems = [];
        const doneItems = [];

        allItems.forEach(item => {
            const due = new Date(item.dueDate);
            if (item.done) {
                doneItems.push(item);
            } else if (due < now) {
                overdueItems.push(item);
            } else {
                upcomingItems.push(item);
            }
        });

        // If viewing Done
        let filteredItems = [];
        if (currentFilter === 'done') {
            filteredItems = doneItems;
        } else {
            // Upcoming view: show overdue first, then upcoming
            filteredItems = overdueItems.concat(upcomingItems);
        }
        
        // Sort by due date
        filteredItems.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        
        // Update item count
        const totalCount = allItems.length;
        const filteredCount = filteredItems.length;
        
        if (currentFilter === 'done') {
            itemCount.textContent = `${filteredCount} done of ${totalCount} item${totalCount !== 1 ? 's' : ''}`;
        } else {
            itemCount.textContent = `${filteredCount} upcoming of ${totalCount} item${totalCount !== 1 ? 's' : ''}`;
        }
        
        // Hide loading message
        loadingMessage.style.display = 'none';
        
        // Show/hide appropriate content
        if (filteredItems.length === 0) {
            deadlineList.style.display = 'none';
            emptyMessage.style.display = 'block';
        } else {
            emptyMessage.style.display = 'none';
            deadlineList.style.display = 'block';
            
            // Clear existing list
            deadlineList.innerHTML = '';
            
            // Create list items
            filteredItems.forEach(item => {
                const listItem = createListItem(item);
                deadlineList.appendChild(listItem);
            });
        }
    }
    
    // Create a list item for a deadline
    function createListItem(item) {
        const li = document.createElement('li');
        li.className = 'deadline-item';
        
    // Use a wrapper div instead of anchor to allow separate click targets for the link vs done-checkbox
    const link = document.createElement('div');
    link.className = 'deadline-link';
        
        // Calculate time until due
        const now = new Date();
        const dueDate = new Date(item.dueDate);
        const timeUntilDue = dueDate - now;
        const daysUntilDue = Math.ceil(timeUntilDue / (1000 * 60 * 60 * 24));
    // const hoursUntilDue = Math.ceil(timeUntilDue / (1000 * 60 * 60));
        
        let timeClass = 'normal';

        if (timeUntilDue < 0) {
            timeClass = 'urgent';
        } else if (daysUntilDue === 0) {
            timeClass = 'urgent';
        } else if (daysUntilDue === 1) {
            timeClass = 'warning';
        } else if (daysUntilDue <= 3) {
            timeClass = 'warning';
        } else {
            timeClass = 'normal';
        }
        
        // Format due date for display
        const dueDateFormatted = dueDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });

        // Build DOM safely instead of using innerHTML
        const headerDiv = document.createElement('div');
        headerDiv.className = 'deadline-header';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'deadline-title';
        titleDiv.textContent = item.title;

    // Normalize source to a css-friendly class name (e.g., 'prairielearn' or 'gradescope')
    const sourceClass = (item.source || '').toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const sourceDiv = document.createElement('div');
    sourceDiv.className = `deadline-source ${sourceClass}`;
    sourceDiv.textContent = item.source;

        headerDiv.appendChild(titleDiv);
        // append source chip only (course is shown in the meta row below)
        headerDiv.appendChild(sourceDiv);

        // Done checkbox (with label wrapper for larger hit target)
        const checkboxWrap = document.createElement('label');
        checkboxWrap.className = 'done-checkbox-wrap';
        checkboxWrap.setAttribute('title', 'Mark as done');
        checkboxWrap.style.marginLeft = '8px';

        const doneCheckbox = document.createElement('input');
        doneCheckbox.type = 'checkbox';
        doneCheckbox.className = 'done-checkbox';
        doneCheckbox.checked = !!item.done;
        doneCheckbox.setAttribute('aria-label', `Mark ${item.title} as done`);

        const fakeBox = document.createElement('span');
        fakeBox.className = 'done-fakebox';

        checkboxWrap.appendChild(doneCheckbox);
        checkboxWrap.appendChild(fakeBox);
        headerDiv.appendChild(checkboxWrap);

        // Handle checkbox changes with optimistic UI + snackbar undo
        doneCheckbox.addEventListener('change', async (e) => {
            const newDone = e.target.checked;
            // Optimistically update UI
            setItemDoneUi(li, titleDiv, newDone);

            // Send message to background and show snackbar to allow undo
            try {
                await browser.runtime.sendMessage({ type: 'TOGGLE_ITEM_DONE', id: item.id, done: newDone });
                showSnackbar(`${newDone ? 'Marked done' : 'Marked undone'}: ${item.title}`, 'Undo', async () => {
                    // Undo callback
                    doneCheckbox.checked = !newDone;
                    setItemDoneUi(li, titleDiv, !newDone);
                    try {
                        await browser.runtime.sendMessage({ type: 'TOGGLE_ITEM_DONE', id: item.id, done: !newDone });
                    } catch (err) {
                        console.error('Failed to undo toggle:', err);
                    }
                });
            } catch (err) {
                console.error('Failed to toggle done state:', err);
                // revert UI
                doneCheckbox.checked = !newDone;
                setItemDoneUi(li, titleDiv, !newDone);
                showSnackbar('Failed to update; try again', null, null, 3000);
            }
        });

        const metaDiv = document.createElement('div');
        metaDiv.className = 'deadline-meta';

        const courseDiv = document.createElement('div');
        courseDiv.className = 'deadline-course';
        courseDiv.textContent = item.course || '';

                const timeDiv = document.createElement('div');
                timeDiv.className = `deadline-time ${timeClass}`;
                timeDiv.title = dueDateFormatted;
                    // For items that are already marked done, show the original absolute due date.
                    // For non-done items that are past due, show the 'Overdue' label with the absolute date in the title.
                    if (item.done) {
                        timeDiv.textContent = dueDateFormatted;
                        timeDiv.title = dueDateFormatted;
                    } else if (timeUntilDue < 0) {
                        timeDiv.textContent = 'Overdue';
                        timeDiv.classList.add('overdue-badge');
                        timeDiv.title = dueDateFormatted;
                    } else {
                        timeDiv.textContent = dueDateFormatted;
                        timeDiv.title = dueDateFormatted;
                    }

                // Compute gradient color from green (>=7 days) to red (<=24 hours)
                try {
                    const hoursRemaining = timeUntilDue / (1000 * 60 * 60);

                    let bgColor = '';
                    let textColor = '#fff';

                    if (timeUntilDue < 0) {
                        // overdue: gray
                        bgColor = 'hsl(0,0%,40%)';
                        textColor = '#fff';
                    } else {
                        const minHours = 24; // red at 24h
                        const maxHours = 24 * 7; // green at 7 days
                        const clamped = Math.max(0, hoursRemaining);
                        // Non-linear easing so mid-range values move further toward green (sqrt makes early changes more pronounced)
                        const rawFrac = Math.min(1, Math.max(0, (clamped - minHours) / (maxHours - minHours)));
                        const eased = Math.sqrt(rawFrac);
                        // Hue: 0 (red) -> 90 (lime). Use eased fraction for stronger contrast at shorter ranges.
                        const hue = Math.round(eased * 90);
                        // Darker lime: increase saturation a bit and lower lightness for a richer, darker green
                        bgColor = `hsl(${hue}, 70%, 38%)`;
                        textColor = '#fff';
                    }

                    // Apply badge styles
                    timeDiv.style.background = bgColor;
                    timeDiv.style.color = textColor;
                    timeDiv.style.padding = '4px 8px';
                    timeDiv.style.borderRadius = '6px';
                    timeDiv.style.minWidth = 'fit-content';
                } catch (e) {
                    // ignore color errors and leave default styling
                    console.error('Error computing gradient color for deadline-time:', e);
                }

        metaDiv.appendChild(courseDiv);
        metaDiv.appendChild(timeDiv);

        // If item is marked done, dim and strike
        if (item.done) setItemDoneUi(li, titleDiv, true);

        // Append built sections to link
        link.appendChild(headerDiv);
        link.appendChild(metaDiv);
        
        // Make title/metadata clickable to open link; checkbox is separate
        link.addEventListener('click', (e) => {
            // Ignore clicks that originated on the checkbox
            if (e.target.closest('.done-checkbox-wrap')) return;
            if (item.link) browser.tabs.create({ url: item.link });
            window.close();
        });
        
        li.appendChild(link);
        return li;
    }

    function setItemDoneUi(li, titleDiv, done) {
        if (done) {
            li.style.opacity = '0.5';
            titleDiv.style.textDecoration = 'line-through';
        } else {
            li.style.opacity = '1';
            titleDiv.style.textDecoration = 'none';
        }
    }

    // Snackbar helper (simple single-message queue)
    const snackbarEl = document.getElementById('snackbar');
    let snackbarTimer = null;
    function showSnackbar(text, actionText, actionCallback, timeout = 6000) {
        if (!snackbarEl) return;
        clearTimeout(snackbarTimer);
        snackbarEl.innerHTML = '';
        const span = document.createElement('span');
        span.textContent = text;
        snackbarEl.appendChild(span);

        if (actionText && actionCallback) {
            const btn = document.createElement('button');
            btn.className = 'snackbar-btn';
            btn.textContent = actionText;
            btn.addEventListener('click', () => {
                actionCallback();
                hideSnackbar();
            });
            snackbarEl.appendChild(btn);
        }

        snackbarEl.style.display = 'flex';
        snackbarEl.classList.add('show');
        snackbarEl.focus();
        snackbarTimer = setTimeout(() => hideSnackbar(), timeout);
    }

    function hideSnackbar() {
        if (!snackbarEl) return;
        snackbarEl.classList.remove('show');
        snackbarEl.style.display = 'none';
        clearTimeout(snackbarTimer);
    }
    
    // Handle refresh button click
    async function handleRefresh() {
    // Refresh button clicked
        
        try {
            // Get current active tab
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                console.error('No active tab found');
                return;
            }
            
            const url = tab.url;
            let scriptFile = null;
            
            // Determine which script to inject based on URL
            if (url.includes('gradescope.com')) {
                // popup.html lives in ui/, content scripts are in ../content-scripts/
                scriptFile = '../content-scripts/scrape-gradescope.js';
            } else if (url.includes('prairielearn.com')) {
                scriptFile = '../content-scripts/scrape-prairielearn.js';
            } else {
                // Not on a supported page -> orchestrate full-site scraping: PL then GS
                try {
                    refreshBtn.disabled = true;
                    refreshBtn.style.opacity = '0.6';
                    await browser.runtime.sendMessage({ type: 'OPEN_PRAIRIELEARN_COURSES' });
                } catch (e) {
                    console.error('Failed to start PrairieLearn scraping from refresh:', e);
                }
                try {
                    await browser.runtime.sendMessage({ type: 'OPEN_RECENT_SEMESTER_COURSES' });
                } catch (e) {
                    console.error('Failed to start Gradescope scraping from refresh:', e);
                }
                // leave popup open and return
                return;
            }
            
            // Show loading state
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = '0.6';
            
            // Inject the appropriate content script (verify tab still exists first)
            try {
                await browser.tabs.get(tab.id);
            } catch (e) {
                console.error('Active tab disappeared before injection', e);
                alert('The active tab closed or changed. Please try again.');
                return;
            }

            // Inject the content script (do not close popup)
            await browser.scripting.executeScript({ target: { tabId: tab.id }, files: [scriptFile] });
            
        } catch (error) {
            console.error('Error during refresh:', error);
            alert('Failed to refresh deadlines. Please try again.');
        } finally {
            // Reset button state
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
        }
    }
    
    // Open options page
    function openOptions() {
        browser.runtime.openOptionsPage();
        window.close();
    }
    
    // Show error message
    function showError(message) {
        loadingMessage.style.display = 'none';
        deadlineList.style.display = 'none';
        emptyMessage.style.display = 'block';
        emptyMessage.innerHTML = `
            <p>Error: ${message}</p>
            <p class="empty-hint">Please try refreshing or check the extension settings.</p>
        `;
    }
    
    // escapeHtml removed (not used)
});