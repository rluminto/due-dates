// content-scripts/scrape-prairielearn.js
// Content script for scraping assignment deadlines from PrairieLearn

(function() {
  'use strict';

  // Import the date parser utility (inline version for content scripts)
  function parseDateString(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
      console.warn("Invalid date string:", dateStr);
      return null;
    }

    // Normalize the string
    let cleanStr = dateStr.toLowerCase()
      .replace(/due\s*/g, '')
      .replace(/until\s*/g, '')
      .replace(/@/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Handle relative terms
    const now = new Date();
    
    if (cleanStr.includes('today')) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      return today.toISOString();
    }
    
    if (cleanStr.includes('tomorrow')) {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
      return tomorrow.toISOString();
    }

    // Extract time information (PrairieLearn often shows "11:59 PM CST")
    let timeMatch = cleanStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    let hours = 23, minutes = 59;
    
    if (timeMatch) {
      hours = parseInt(timeMatch[1]);
      minutes = parseInt(timeMatch[2]);
      const isPM = timeMatch[3].toLowerCase() === 'pm';
      
      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
      
      cleanStr = cleanStr.replace(/\d{1,2}:\d{2}\s*(am|pm)/i, '').trim();
    }

    // Remove timezone information
    cleanStr = cleanStr.replace(/\b(cst|est|pst|mst|cdt|edt|pdt|mdt)\b/gi, '').trim();

    // Try different date formats common in PrairieLearn
    const monthNames = {
      'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
      'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
      'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
      'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
    };

    // Try "Sunday, Dec 25" format (common in PrairieLearn)
    let match = cleanStr.match(/(\w+),\s*(\w+)\s+(\d{1,2})/i);
    if (match) {
      const monthName = match[2].toLowerCase();
      const day = parseInt(match[3]);
      const month = monthNames[monthName];
      
      if (month !== undefined) {
        const year = now.getFullYear();
        const date = new Date(year, month, day, hours, minutes, 0);
        
        if (date < now) {
          date.setFullYear(year + 1);
        }
        
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    // Try "Dec 25" format
    match = cleanStr.match(/(\w+)\s+(\d{1,2})/i);
    if (match) {
      const monthName = match[1].toLowerCase();
      const day = parseInt(match[2]);
      const month = monthNames[monthName];
      
      if (month !== undefined) {
        const year = now.getFullYear();
        const date = new Date(year, month, day, hours, minutes, 0);
        
        if (date < now) {
          date.setFullYear(year + 1);
        }
        
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    // Try MM/DD/YYYY format
    match = cleanStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (match) {
      const month = parseInt(match[1]) - 1;
      const day = parseInt(match[2]);
      let year = parseInt(match[3]);
      
      if (year < 100) {
        year += year < 50 ? 2000 : 1900;
      }
      
      const date = new Date(year, month, day, hours, minutes, 0);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    // Last resort: native Date parsing
    try {
      const date = new Date(cleanStr);
      if (!isNaN(date.getTime())) {
        if (!timeMatch) {
          date.setHours(23, 59, 59, 999);
        }
        return date.toISOString();
      }
    } catch (e) {
      console.warn("Native Date parsing failed:", e);
    }

    console.warn("Could not parse date:", dateStr);
    return null;
  }

  function scrapePrairieLearn() {
    // Starting PrairieLearn scrape
    
    const items = [];
    
    try {
      // Get course name from the page (prefer navbar-text or course-title over generic site brand)
      const courseSelectors = ['.navbar-text', '.nav-item.navbar-text', '.course-title', '.course-name', 'h1', '[data-testid="course-title"]', '.navbar-brand', '.navbar-brand-label'];
      let courseName = 'Unknown Course';
      for (const cs of courseSelectors) {
        const el = document.querySelector(cs);
        if (el && el.textContent && el.textContent.trim()) {
          const text = el.textContent.trim();
          // If this looks like a site-brand (e.g., "PrairieLearn", "Go home"), try to find a better sibling
          const siteBrandPattern = /prairielearn|go home|gradescope|home/i;
          if (siteBrandPattern.test(text)) {
            // try to find a sibling or nav-specific element with the course text
            const nav = el.closest('nav') || document;
            const sibling = nav.querySelector('.navbar-text, .nav-item.navbar-text, .course-title, .course-name, [data-testid="course-title"], h1');
            if (sibling && sibling.textContent && sibling.textContent.trim()) {
              courseName = sibling.textContent.trim();
              break;
            }
            // else continue to next selector
            continue;
          }

          courseName = text;
          break;
        }
      }
      
      // Look for assessment/assignment rows - PrairieLearn typically uses cards or table rows
      const assessmentSelectors = [
        '.assessment-row',
        '.card',
        '.assessment-card',
        'tr[data-assessment-id]',
        '[data-testid*="assessment"]',
        'tbody tr',
        '.list-group-item',
        '[class*="assessment"]'
      ];

      // Collect elements from all selectors (dedupe) instead of stopping at first match
      const foundSet = new Set();
      for (const selector of assessmentSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => foundSet.add(el));
          if (elements.length > 0) {
            // selector returned elements
          }
        } catch (e) {
          console.warn(`Selector failed: ${selector}`, e);
        }
      }

      // Fallback approach: search for smaller candidate elements that mention 'due' or 'deadline'
      if (foundSet.size === 0) {
  console.warn("No assessment elements found via selectors. Trying fallback approach...");
        const fallbackElements = document.querySelectorAll('div, tr, .card, [class*="assessment"], [class*="homework"]');
        Array.from(fallbackElements).forEach(el => {
          const text = (el.textContent || '').toLowerCase();
          if ((text.includes('due') || text.includes('deadline') || text.includes('homework') || text.includes('quiz') || text.includes('exam')) && text.length < 1200) {
            foundSet.add(el);
          }
        });
  // Fallback found candidate assessment elements
      }

      // Convert to array and filter out the very large containers (page-level)
      let assessmentElements = Array.from(foundSet).filter(el => {
        const text = (el.textContent || '');
        // Exclude near-whole-page containers by text length
        return text.length > 10 && text.length < 1200;
      });
  // Total assessment candidate elements after filtering

      // Process each assessment element
      for (let i = 0; i < assessmentElements.length; i++) {
        const element = assessmentElements[i];
        
        try {
          // Extract assessment title
          const titleSelectors = [
            '.assessment-title',
            '.assessment-name',
            '.card-title',
            'h3, h4, h5',
            'a[href*="assessment"]',
            '.title',
            '[data-testid*="title"]',
            'strong'
          ];
          
          let titleElement = null;
          let title = null;
          
          for (const selector of titleSelectors) {
            titleElement = element.querySelector(selector);
            if (titleElement) {
              title = titleElement.textContent.trim();
              if (title && title.length > 0) {
                break;
              }
            }
          }
          
          // If no title found using selectors, try to extract from element text
          if (!title) {
            const elementText = element.textContent.trim();
            const lines = elementText.split('\n').map(line => line.trim()).filter(line => line);
            
            // Look for lines that might be titles (shorter lines, often first)
            for (const line of lines) {
              if (line.length > 5 && line.length < 100 && !line.toLowerCase().includes('due')) {
                title = line;
                break;
              }
            }
            
            if (!title) {
              title = lines[0] || `Assessment ${i + 1}`;
            }
          }
          
          if (!title || title.length === 0) {
            console.warn(`Skipping element ${i}: No title found`);
            continue;
          }

          // Extract due date
          const dueDateSelectors = [
            '.due-date',
            '.deadline',
            '[data-testid*="due"]',
            '.date',
            '.due-time',
            '.assessment-due'
          ];
          
          let dueDateElement = null;
          let dueDateText = null;
          
          for (const selector of dueDateSelectors) {
            dueDateElement = element.querySelector(selector);
            if (dueDateElement) {
              dueDateText = dueDateElement.textContent.trim();
              if (dueDateText && dueDateText.length > 0) {
                break;
              }
            }
          }
          
          // If no due date found using selectors, look for date patterns in element text
          if (!dueDateText) {
            let elementText = (element.textContent || '').trim();

            // Quick check: only run broad regex fallback if the element text contains explicit date-related hints
            const hintKeywords = /\b(due|deadline|until|end|ends|until:?)\b/i;
            if (hintKeywords.test(elementText)) {
              // sanitize common HTML-encoded sequences (popovers content sometimes included)
              elementText = elementText.replace(/&lt;|&gt;|&amp;/g, ' ');

              const datePatterns = [
                /due[:\s]+([^,\n]+)/i,
                /deadline[:\s]+([^,\n]+)/i,
                /(\w+,\s*\w+\s+\d{1,2}(?:\s+at\s+\d{1,2}:\d{2}\s*[ap]m)?)/i, // "Sunday, Dec 25 at 11:59 PM"
                /(\w+\s+\d{1,2}(?:,\s*\d{4})?(?:\s+at\s+\d{1,2}:\d{2}\s*[ap]m)?)/i, // "Dec 25 at 11:59 PM"
                /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
                /(today|tomorrow)/i
              ];

              for (const pattern of datePatterns) {
                const match = elementText.match(pattern);
                if (match) {
                  dueDateText = match[1] || match[0];
                  break;
                }
              }
            } else {
              // No explicit hint keywords -> skip this element as it's unlikely to have a deadline
              // This prevents items like "part0: course beginning" from being scraped.
            }
          }
          
          if (!dueDateText) {
            console.warn(`Skipping ${title}: No due date found`);
            continue;
          }

          // Parse the due date
          const dueDate = parseDateString(dueDateText);
          if (!dueDate) {
            console.warn(`Skipping ${title}: Could not parse due date "${dueDateText}"`);
            continue;
          }

          // Extract assessment link
          let link = window.location.href; // Default to current page
          const linkElement = element.querySelector('a[href*="assessment"], a[href*="homework"], a[href*="quiz"]');
          if (linkElement) {
            const href = linkElement.getAttribute('href');
            if (href) {
              link = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
            }
          }

          // Generate unique ID
          const id = `prairielearn-${link}`.replace(/[^a-zA-Z0-9-]/g, '-');

          // Determine if due date has passed
          const now = new Date();
          const dueDateObj = new Date(dueDate);

          // Create DeadlineItem object
          const item = {
            id: id,
            title: title,
            dueDate: dueDate,
            course: courseName,
            link: link,
            source: "PrairieLearn",
            pastDue: dueDateObj.getTime() < now.getTime()
          };

          items.push(item);
          // Scraped assessment

        } catch (error) {
          console.error(`Error processing assessment element ${i}:`, error);
        }
      }

    } catch (error) {
      console.error("Error during PrairieLearn scraping:", error);
    }

  // PrairieLearn scrape completed

    // Send results (always) to background script and indicate completion so background
    // can reliably close tabs that were opened for scraping.
    try {
      browser.runtime.sendMessage({
        type: "SCRAPE_RESULT",
        items: items,
        scrapeComplete: true,
        scrapedCount: items.length
      });
    } catch (error) {
      console.error("Error sending scrape results:", error);
    }

    return items;
  }

  // Auto-run when content script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scrapePrairieLearn);
  } else {
    scrapePrairieLearn();
  }

  // Also make the function available for manual refresh
  window.scrapePrairieLearn = scrapePrairieLearn;

})();