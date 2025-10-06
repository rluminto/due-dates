// background.js
// Background service worker for the Deadline Scraper extension

// Storage key constant
const STORAGE_KEY = "deadlineScraperData";

// Default settings
const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  notificationHours: 24
};

// Default storage object
const DEFAULT_STORAGE = {
  items: [],
  settings: DEFAULT_SETTINGS
};

// Tabs that should be closed after they send a SCRAPE_RESULT
const tabsToCloseAfterScrape = new Set();

// Initialize extension
browser.runtime.onInstalled.addListener(async () => {
  // Extension installed
  
  // Initialize storage if it doesn't exist
  const data = await browser.storage.local.get(STORAGE_KEY);
  if (!data[STORAGE_KEY]) {
    await browser.storage.local.set({
      [STORAGE_KEY]: DEFAULT_STORAGE
    });
  // Initialized default storage
  }
  
  // Set up notification alarm
  browser.alarms.create('notificationCheck', { periodInMinutes: 30 });
  // Notification alarm created
  
  // Update badge
  await updateBadge();
});

// Handle messages from content scripts
browser.runtime.onMessage.addListener(async (message, sender) => {
  // Received message
  
  if (message.type === "SCRAPE_RESULT") {
    await handleScrapeResult(message.items || []);
    // Only close the tab if the content script indicated the scrape completed
    try {
      if (message.scrapeComplete && sender && sender.tab && tabsToCloseAfterScrape.has(sender.tab.id)) {
        tabsToCloseAfterScrape.delete(sender.tab.id);
        await browser.tabs.remove(sender.tab.id);
  // Closed scraped tab after confirmed completion
      } else if (sender && sender.tab && tabsToCloseAfterScrape.has(sender.tab.id)) {
        // If the scrape wasn't marked complete, keep the tab in the tracker so we can wait longer or retry
  // Received partial/no-complete scrape; keeping tab for retries
      }
    } catch (e) {
      console.warn('Failed to close scraped tab:', e);
    }
    return true;
  }
  
  if (message.type === "GET_DATA") {
    const data = await getStorageData();
    return data;
  }

  if (message.type === 'TOGGLE_ITEM_DONE') {
    try {
      const data = await getStorageData();
      const items = data.items.map(it => it.id === message.id ? { ...it, done: !!message.done } : it);
      const updated = { ...data, items };
      await browser.storage.local.set({ [STORAGE_KEY]: updated });
      // Notify UI
  try { browser.runtime.sendMessage({ type: 'DATA_UPDATED' }); } catch (e) { /* ignore */ }
      return true;
    } catch (e) {
      console.error('Error toggling item done:', e);
      return false;
    }
  }
  
  if (message.type === "UPDATE_SETTINGS") {
    await updateSettings(message.settings);
    return true;
  }
  
  if (message.type === "CLEAR_DATA") {
    await clearAllData();
    return true;
  }

  // Open recent semester courses on Gradescope and inject scraper
  if (message.type === 'OPEN_RECENT_SEMESTER_COURSES') {
    try {
      const coursesUrl = 'https://www.gradescope.com/';
      // Open the Gradescope courses page in a new tab
      const tab = await browser.tabs.create({ url: coursesUrl });
  // Opened Gradescope courses page

      // Wait for the tab to complete loading
      await waitForTabComplete(tab.id, 15000);

      // Verify the tab still exists before attempting to run extraction script
      try {
        await browser.tabs.get(tab.id);
      } catch (e) {
        console.warn('Courses listing tab was closed before extraction:', tab.id);
  try { await browser.tabs.remove(tab.id); } catch (ignore) { /* ignore close errors */ }
        return false;
      }

      // Execute a small script in the page context to extract recent term course links
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const termEls = document.querySelectorAll('.courseList--term');
            let links = [];
            if (termEls.length > 0) {
              const firstTerm = termEls[0];
              const sibling = firstTerm.nextElementSibling;
              if (sibling) {
                const anchors = sibling.querySelectorAll('a.courseBox');
                anchors.forEach(a => links.push(a.href));
              }
            }
            if (links.length === 0) {
              const anchors = document.querySelectorAll('a.courseBox');
              anchors.forEach(a => links.push(a.href));
            }
            return links.slice(0, 10);
          } catch (e) { return []; }
        }
      });

      const links = (results && results[0] && results[0].result) || [];
  // Extracted recent term course links

      // Open each course and inject scraper in limited concurrent batches for speed and stability
      const concurrency = 3;
      const batchDelayMs = 250; // small pause between batches to avoid thrashing
      const perTabTimeout = 6000; // shorter timeout (ms)
      const scriptUrl = browser.runtime.getURL('content-scripts/scrape-gradescope.js');

      for (let i = 0; i < links.length; i += concurrency) {
        const batch = links.slice(i, i + concurrency);
        // Launch batch in parallel
        const promises = batch.map(async (link) => {
          try {
            const courseTab = await browser.tabs.create({ url: link, active: false });
            tabsToCloseAfterScrape.add(courseTab.id);

            // Wait for completion (shorter timeout), but don't block other batches
            try {
              await waitForTabComplete(courseTab.id, perTabTimeout);
            } catch (e) {
              console.warn('Wait for tab complete failed or timed out for', courseTab.id, e);
            }

            // Use safeExecuteScript which checks tab existence and retries
            try {
              await safeExecuteScript(courseTab.id, [scriptUrl], 1);
              // Injected scraper into course link
            } catch (injectErr) {
              console.error('Injection failed for', link, injectErr);
            }
          } catch (err) {
            console.error('Error opening/injecting course link', link, err);
          }
        });

        // Wait for the current batch to settle before launching next batch
        await Promise.all(promises);
        // Small delay to avoid opening too many tabs instantaneously
        if (i + concurrency < links.length) await new Promise(r => setTimeout(r, batchDelayMs));
      }

      // Optionally close the courses listing tab after launching the course tabs
      try { await browser.tabs.remove(tab.id); } catch (e) { /* ignore */ }

      return true;
    } catch (err) {
      console.error('Error handling OPEN_RECENT_SEMESTER_COURSES:', err);
      return false;
    }
  }

  // Open PrairieLearn courses page and inject PrairieLearn scraper for each course (batched)
  if (message.type === 'OPEN_PRAIRIELEARN_COURSES') {
    try {
      const plUrl = 'https://us.prairielearn.com/pl';
      const tab = await browser.tabs.create({ url: plUrl });
  // Opened PrairieLearn home tab

      await waitForTabComplete(tab.id, 10000);

      // Ensure tab still exists
      try { await browser.tabs.get(tab.id); } catch (e) {
        console.warn('PrairieLearn home tab closed before extraction:', tab.id);
        return false;
      }

      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            const anchors = Array.from(document.querySelectorAll('a'));
            const links = anchors
              .map(a => a.href)
              .filter(h => h && h.includes('/course_instance/'));
            // unique
            return Array.from(new Set(links)).slice(0, 20);
          } catch (e) { return []; }
        }
      });

      let links = (results && results[0] && results[0].result) || [];
      // Normalize links to assessments pages where possible
      links = links.map(h => {
        try {
          const u = new URL(h);
          // If path ends with /course_instance/<id> or contains that segment, ensure /assessments is appended
          if (/\/course_instance\/\d+(?:\/)?$/.test(u.pathname)) {
            if (!u.pathname.endsWith('/assessments')) u.pathname = u.pathname.replace(/\/?$/, '/assessments');
            return u.toString();
          }
        } catch (e) { /* ignore URL parse issues */ }
        return h;
      });
      // Deduplicate and limit
      links = Array.from(new Set(links)).slice(0, 20);
  // Normalized PrairieLearn course links
      // Close the PrairieLearn listing tab now that we've extracted links; no need to keep it open
      try {
        await browser.tabs.remove(tab.id);
  // Closed PrairieLearn listing tab after extracting links
      } catch (e) {
        console.warn('Failed to close PrairieLearn listing tab immediately:', e);
      }

      // Batch open and inject similar to Gradescope flow
      const concurrency = 3;
      const batchDelayMs = 250;
      const perTabTimeout = 6000;
      const scriptUrl = browser.runtime.getURL('content-scripts/scrape-prairielearn.js');

      for (let i = 0; i < links.length; i += concurrency) {
        const batch = links.slice(i, i + concurrency);
        const promises = batch.map(async (link) => {
          try {
            const courseTab = await browser.tabs.create({ url: link, active: false });
            tabsToCloseAfterScrape.add(courseTab.id);

            try { await waitForTabComplete(courseTab.id, perTabTimeout); } catch (e) {
              console.warn('PrairieLearn tab wait failed for', courseTab.id, e);
            }

            // Try injection and wait for the content script's SCRAPE_RESULT for this tab.
            const maxAttempts = 2;
            let attempt = 0;
            let lastResult = null;

            while (attempt < maxAttempts) {
              attempt++;
              try {
                await safeExecuteScript(courseTab.id, [scriptUrl], 1);
                // Attempted injection for PrairieLearn (attempt)

                // Wait for the content script to reply for this tab
                try {
                  const res = await waitForScrapeResultFromTab(courseTab.id, 6000);
                  lastResult = res;
                  if (res && res.scrapedCount && res.scrapedCount > 0) {
                    // We got items: close the tab and mark done
                    tabsToCloseAfterScrape.delete(courseTab.id);
                    try { await browser.tabs.remove(courseTab.id); } catch (e) { /* ignore */ }
                    // PrairieLearn tab scraped and closed
                    break;
                  } else {
                    // PrairieLearn scrape returned zero items on attempt
                    // If not last attempt, wait a bit and retry
                    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 800 * attempt));
                  }
                } catch (waitErr) {
                  console.warn('Did not receive scrape result in time for', courseTab.id, waitErr);
                  if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 800 * attempt));
                }
              } catch (injectErr) {
                console.error('Injection failed for PrairieLearn', link, injectErr);
                if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500));
              }
            }

            // After attempts, if we didn't get items, close the tab to avoid clutter but log.
            if ((!lastResult || !lastResult.scrapedCount || lastResult.scrapedCount === 0) && tabsToCloseAfterScrape.has(courseTab.id)) {
              tabsToCloseAfterScrape.delete(courseTab.id);
              try { await browser.tabs.remove(courseTab.id); /* closed after retries */ } catch (e) { /* ignore */ }
            }
          } catch (err) {
            console.error('Error opening/injecting PrairieLearn link', link, err);
          }
        });

        await Promise.all(promises);
        if (i + concurrency < links.length) await new Promise(r => setTimeout(r, batchDelayMs));
      }

      try { await browser.tabs.remove(tab.id); } catch (e) { /* ignore */ }
      return true;
    } catch (err) {
      console.error('Error handling OPEN_PRAIRIELEARN_COURSES:', err);
      return false;
    }
  }
});

// Handle scrape results from content scripts
async function handleScrapeResult(newItems) {
  // Processing new scrape items
  
  try {
    // Get existing data
    const data = await getStorageData();
    
    // Create a Map for efficient lookups and deduplication
    const itemMap = new Map();
    
    // Add existing items to map
    data.items.forEach(item => {
      itemMap.set(item.id, item);
    });
    
    // Add/update new items
    newItems.forEach(newItem => {
      // Preserve notification status and done flag if item already exists
      const existingItem = itemMap.get(newItem.id);
      if (existingItem && existingItem.notificationSent) {
        newItem.notificationSent = existingItem.notificationSent;
      }
      if (existingItem && existingItem.done) {
        newItem.done = existingItem.done;
      }
      
      itemMap.set(newItem.id, newItem);
    });
    
    // Convert map back to array and sort by due date
    const mergedItems = Array.from(itemMap.values());
    mergedItems.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    
    // Save updated data
    const updatedData = {
      ...data,
      items: mergedItems
    };
    
    await browser.storage.local.set({
      [STORAGE_KEY]: updatedData
    });
    
  // Saved merged items
    
    // Update badge
    await updateBadge();
    // Notify any open UI (popup) that data changed so it can refresh
    try {
      browser.runtime.sendMessage({ type: 'DATA_UPDATED' });
    } catch (e) {
      console.warn('Failed to send DATA_UPDATED message to UI:', e);
    }
    
  } catch (error) {
    console.error("Error handling scrape result:", error);
  }
}

// Get storage data with defaults
async function getStorageData() {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || DEFAULT_STORAGE;
  } catch (error) {
    console.error("Error getting storage data:", error);
    return DEFAULT_STORAGE;
  }
}

// Update settings
async function updateSettings(newSettings) {
  try {
    const data = await getStorageData();
    const updatedData = {
      ...data,
      settings: {
        ...data.settings,
        ...newSettings
      }
    };
    
    await browser.storage.local.set({
      [STORAGE_KEY]: updatedData
    });
    
  // Settings updated
  } catch (error) {
    console.error("Error updating settings:", error);
  }
}

// Clear all data
async function clearAllData() {
  try {
    await browser.storage.local.set({
      [STORAGE_KEY]: DEFAULT_STORAGE
    });
    
    // Clear badge
    await browser.action.setBadgeText({ text: '' });
    
  // All data cleared
  } catch (error) {
    console.error("Error clearing data:", error);
  }
}

// Update extension badge with upcoming deadline count
async function updateBadge() {
  try {
    const data = await getStorageData();
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + (24 * 60 * 60 * 1000));
    
    // Filter items due in the next 24 hours
    const upcomingItems = data.items.filter(item => {
      const dueDate = new Date(item.dueDate);
      return dueDate >= now && dueDate <= twentyFourHoursFromNow;
    });
    
    const count = upcomingItems.length;
    
    // Set badge text
    const badgeText = count > 0 ? count.toString() : '';
    await browser.action.setBadgeText({ text: badgeText });
    
    // Set badge color
    if (count > 0) {
      await browser.action.setBadgeBackgroundColor({ color: '#FF5733' });
    }
    
  // Badge updated
    
  } catch (error) {
    console.error("Error updating badge:", error);
  }
}

// Handle alarm for notifications
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'notificationCheck') {
    await checkAndSendNotifications();
  }
});

// Check for deadlines and send notifications
async function checkAndSendNotifications() {
  try {
    const data = await getStorageData();
    
    if (!data.settings.notificationsEnabled) {
    // Notifications disabled, skipping check
      return;
    }
    
    const now = new Date();
    const notificationWindow = data.settings.notificationHours * 60 * 60 * 1000; // Convert hours to milliseconds
    const cutoffTime = new Date(now.getTime() + notificationWindow);
    
    // Find items due within the notification window that haven't been notified
    const itemsToNotify = data.items.filter(item => {
      const dueDate = new Date(item.dueDate);
      return dueDate >= now && 
             dueDate <= cutoffTime && 
             !item.notificationSent;
    });
    
  // Found items to notify
    
    // Send notifications and update items
    const updatedItems = [...data.items];
    
    for (const item of itemsToNotify) {
      try {
        // Calculate time until due
        const dueDate = new Date(item.dueDate);
        const timeUntilDue = dueDate - now;
        const hoursUntilDue = Math.round(timeUntilDue / (1000 * 60 * 60));
        const daysUntilDue = Math.round(timeUntilDue / (1000 * 60 * 60 * 24));
        
        let timeMessage;
        if (daysUntilDue >= 1) {
          timeMessage = `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`;
        } else if (hoursUntilDue >= 1) {
          timeMessage = `Due in ${hoursUntilDue} hour${hoursUntilDue !== 1 ? 's' : ''}`;
        } else {
          timeMessage = "Due soon!";
        }
        
        // Create notification
        await browser.notifications.create(item.id, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Deadline Approaching',
          message: `${item.title}\n${item.course}\n${timeMessage}`
        });
        
        // Mark as notified
        const itemIndex = updatedItems.findIndex(i => i.id === item.id);
        if (itemIndex !== -1) {
          updatedItems[itemIndex] = {
            ...updatedItems[itemIndex],
            notificationSent: true
          };
        }
        
  // Notification sent
        
      } catch (notificationError) {
        console.error(`Error sending notification for ${item.title}:`, notificationError);
      }
    }
    
    // Save updated data if any notifications were sent
    if (itemsToNotify.length > 0) {
      const updatedData = {
        ...data,
        items: updatedItems
      };
      
      await browser.storage.local.set({
        [STORAGE_KEY]: updatedData
      });
    }
    
  } catch (error) {
    console.error("Error checking notifications:", error);
  }
}

// Handle notification clicks
browser.notifications.onClicked.addListener(async (notificationId) => {
  try {
    const data = await getStorageData();
    const item = data.items.find(i => i.id === notificationId);
    
    if (item && item.link) {
      // Open the assignment link in a new tab
      await browser.tabs.create({ url: item.link });
    }
    
    // Clear the notification
    await browser.notifications.clear(notificationId);
    
  } catch (error) {
    console.error("Error handling notification click:", error);
  }
});

// Clean up old items periodically (remove items older than 30 days)
browser.alarms.create('cleanup', { periodInMinutes: 24 * 60 }); // Daily cleanup

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanup') {
    await cleanupOldItems();
  }
});

async function cleanupOldItems() {
  try {
    const data = await getStorageData();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    // Filter out items older than 30 days
    const filteredItems = data.items.filter(item => {
      const dueDate = new Date(item.dueDate);
      return dueDate >= thirtyDaysAgo;
    });
    
    if (filteredItems.length !== data.items.length) {
      const removedCount = data.items.length - filteredItems.length;
    // Cleaned up old items
      
      const updatedData = {
        ...data,
        items: filteredItems
      };
      
      await browser.storage.local.set({
        [STORAGE_KEY]: updatedData
      });
      
      // Update badge after cleanup
      await updateBadge();
    }
    
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

// Background script loaded

// Auto-inject Gradescope scraper when a Gradescope course page loads
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    if (changeInfo.status === 'complete' && tab && tab.url && tab.url.includes('gradescope.com/courses/')) {
  // Detected Gradescope course page load
      const scriptUrl = browser.runtime.getURL('content-scripts/scrape-gradescope.js');
      try {
        // Ensure tab still exists (avoid invalid tab id)
        await browser.tabs.get(tabId);
        await browser.scripting.executeScript({ target: { tabId: tabId }, files: [scriptUrl] });
  // Injected Gradescope scraper
      } catch (injectErr) {
        console.error('Failed to inject Gradescope scraper:', injectErr);
      }
    }
  } catch (err) {
    console.error('Error in tabs.onUpdated handler:', err);
  }
});

// Helper: wait for a tab to reach 'complete' status up to a timeout (event-driven, no polling)
function waitForTabComplete(tabId, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function onUpdated(upId, changeInfo) {
      if (upId !== tabId) return;
      if (changeInfo && changeInfo.status === 'complete') {
        settled = true;
        browser.tabs.onUpdated.removeListener(onUpdated);
        browser.tabs.onRemoved.removeListener(onRemoved);
        clearTimeout(timer);
        resolve();
      }
    }

    function onRemoved(removedTabId) {
      if (removedTabId === tabId && !settled) {
        settled = true;
        browser.tabs.onUpdated.removeListener(onUpdated);
        browser.tabs.onRemoved.removeListener(onRemoved);
        clearTimeout(timer);
        reject(new Error('Tab removed'));
      }
    }

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        browser.tabs.onUpdated.removeListener(onUpdated);
        browser.tabs.onRemoved.removeListener(onRemoved);
        resolve(); // timeout: resolve to avoid blocking, caller should verify page contents
      }
    }, timeout);
  });
}

// Helper: execute script safely with existence check and one retry on transient errors
async function safeExecuteScript(tabId, scriptFiles, maxRetries = 1) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      // Ensure the tab still exists
      await browser.tabs.get(tabId);
      await browser.scripting.executeScript({ target: { tabId }, files: scriptFiles });
      return true;
    } catch (e) {
      // If tab no longer exists, abort
      if (e && e.message && e.message.includes('No tab with id')) {
        throw e;
      }
      // Otherwise try once more after a short backoff
      attempt++;
      if (attempt > maxRetries) throw e;
      await new Promise(r => setTimeout(r, 300 * attempt));
    }
  }
  return false;
}

// Helper: wait for the next SCRAPE_RESULT message coming from a specific tabId
function waitForScrapeResultFromTab(tabId, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function onMessage(message, sender) {
      if (!sender || !sender.tab) return;
      if (sender.tab.id !== tabId) return;
      if (message && message.type === 'SCRAPE_RESULT') {
        settled = true;
        browser.runtime.onMessage.removeListener(onMessage);
        clearTimeout(timer);
        resolve(message);
      }
    }

    browser.runtime.onMessage.addListener(onMessage);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        browser.runtime.onMessage.removeListener(onMessage);
        reject(new Error('Timed out waiting for SCRAPE_RESULT from tab ' + tabId));
      }
    }, timeout);
  });
}