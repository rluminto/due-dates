// content-scripts/scrape-gradescope.js
// Content script for scraping assignment deadlines from Gradescope

(function() {
  'use strict';

  // Import the date parser utility
  // Since we can't use ES6 imports in content scripts, we'll inline a simplified version
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

    // Extract time information
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

    // Try different date formats
    const monthNames = {
      'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
      'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
      'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
      'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
    };

    // Try "Dec 25" format
    let match = cleanStr.match(/(\w+)\s+(\d{1,2})/i);
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

  function scrapeGradescope() {
    // Starting Gradescope scrape

    const items = [];
    try {
        // Get course name from the top-left; avoid using generic site-brand like "Gradescope" or "Go home"
        const courseSelectors = ['.navbar-text', '.nav-item.navbar-text', '.course-title', '.course-name', 'h1', '[data-test="course-title"]', '.navbar-brand', '.navbar-brand-label'];
        let courseName = 'Unknown Course';
        for (const cs of courseSelectors) {
          const el = document.querySelector(cs);
          if (el && el.textContent && el.textContent.trim()) {
            const text = el.textContent.trim();
            const siteBrandPattern = /gradescope|go home|prairielearn|home/i;
            if (siteBrandPattern.test(text)) {
              const nav = el.closest('nav') || document;
              const sibling = nav.querySelector('.navbar-text, .nav-item.navbar-text, .course-title, .course-name, [data-test="course-title"], h1');
              if (sibling && sibling.textContent && sibling.textContent.trim()) {
                courseName = sibling.textContent.trim();
                break;
              }
              continue;
            }

            courseName = text;
            break;
          }
        }

      // First, try the common Gradescope table layout (assignments-student-table)
      const seen = new Map();
      const table = document.getElementById('assignments-student-table') || document.querySelector('table#assignments-student-table');
      const courseId = (function(){
        const courseLink = document.querySelector('.sidebar--title-course a[href*="/courses/"]');
        if (courseLink) {
          const m = (courseLink.getAttribute('href')||'').match(/\/courses\/(\d+)/);
          if (m) return m[1];
        }
        // try header h1 courseHeader--title
        const h = document.querySelector('.courseHeader--title, h1.courseHeader--title, .courseHeader--title a');
        if (h && h.textContent) {
          // no numeric id here, just return null
        }
        return null;
      })();

      if (table) {
        const rows = Array.from(table.querySelectorAll('tbody tr'));
  // Found assignment rows in assignments-student-table

        rows.forEach((row, idx) => {
          try {
            // Title usually in a button inside the first th
            const titleBtn = row.querySelector('.js-submitAssignment, th.table--primaryLink button, th.table--primaryLink');
            let title = titleBtn && titleBtn.textContent ? titleBtn.textContent.trim() : '';

            if (!title) {
              const th = row.querySelector('th');
              if (th) title = th.textContent.trim();
            }
            if (!title) title = `Assignment ${idx + 1}`;

            // Assignment id (data-assignment-id on button)
            const assignmentId = titleBtn ? (titleBtn.getAttribute('data-assignment-id') || titleBtn.dataset && titleBtn.dataset.assignmentId) : null;

            // Due date: look for time.submissionTimeChart--dueDate
            const dueEl = row.querySelector('.submissionTimeChart--dueDate[datetime], .submissionTimeChart--dueDate, time.submissionTimeChart--dueDate');
            let dueDateText = dueEl ? (dueEl.getAttribute('datetime') || dueEl.textContent.trim()) : null;

            if (!dueDateText) {
              // fallback: any <time> in row
              const timeAny = row.querySelector('time[datetime], time');
              if (timeAny) dueDateText = timeAny.getAttribute('datetime') || timeAny.textContent.trim();
            }

            if (!dueDateText) {
              console.warn(`Skipping row ${idx+1} (${title}): no due date found`);
              return;
            }

            const dueDate = parseDateString(dueDateText);
            if (!dueDate) {
              console.warn(`Skipping ${title}: Could not parse due date "${dueDateText}"`);
              return;
            }

            // Build href from courseId and assignmentId if possible
            let href = null;
            if (assignmentId && courseId) {
              href = new URL(`/courses/${courseId}/assignments/${assignmentId}`, window.location.origin).href;
            }

            if (!href) {
              // fallback: try to find any anchor in the row
              const a = row.querySelector('a[href*="/assignments/"]');
              if (a) href = a.getAttribute('href').startsWith('http') ? a.getAttribute('href') : new URL(a.getAttribute('href'), window.location.origin).href;
            }

            if (!href) {
              // still no href: create an id-based link stub
              const idStub = assignmentId ? `gradescope-assignment-${assignmentId}` : `gradescope-row-${idx+1}`;
              href = window.location.href + `#${idStub}`;
            }

            if (seen.has(href)) return;
            seen.set(href, true);

            const id = `gradescope-${href}`.replace(/[^a-zA-Z0-9-]/g, '-');
            const item = { id, title, dueDate, course: courseName, link: href, source: 'Gradescope' };
            items.push(item);
            // Scraped table row
          } catch (err) {
            console.error('Error processing gradescope table row:', err);
          }
        });
      }

      // If no items from table, fall back to anchor scanning (older layouts)
      if (items.length === 0) {
        // Find all anchors that look like assignment links (contain '/assignments/')
        const anchors = Array.from(document.querySelectorAll('a[href*="/assignments/"], a[href*="assignments"]'));
        // Found potential assignment links

        for (let i = 0; i < anchors.length; i++) {
          try {
            const a = anchors[i];
            let href = a.getAttribute('href');
            if (!href) continue;
            href = href.startsWith('http') ? href : new URL(href, window.location.origin).href;

            if (seen.has(href)) continue;
            seen.set(href, true);

            // Title: prefer anchor text, fallback to nearby heading/text
            let title = (a.textContent || '').trim();
            if (!title) {
              const parentHeading = a.closest('h1, h2, h3, h4, h5, .assignment-title, .title');
              if (parentHeading) title = parentHeading.textContent.trim();
            }
            if (!title) {
              const container = a.closest('tr, li, .card, .assignment-row') || a.parentElement;
              if (container) {
                const candidate = container.querySelector('h3, h4, h5, .assignment-name, .name, .title');
                if (candidate) title = candidate.textContent.trim();
              }
            }
            if (!title) title = `Assignment ${i + 1}`;

            // Find due date: prefer <time datetime="...">, then selectors, then nearby text
            let dueDateText = null;
            const container = a.closest('tr, li, .card, .assignment-row, tbody, .table') || a.parentElement;

            // 1) <time> element
            if (container) {
              const timeEl = container.querySelector('time[datetime], time');
              if (timeEl) {
                dueDateText = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
              }
            }

            // 2) common selectors
            if (!dueDateText && container) {
              const selectors = ['.due-date', '.deadline', '.date', '[data-due]', '[data-deadline]', '.due'];
              for (const sel of selectors) {
                const el = container.querySelector(sel);
                if (el && el.textContent && el.textContent.trim()) {
                  dueDateText = el.textContent.trim();
                  break;
                }
              }
            }

            // 3) fallback: search the nearby text for date patterns
            if (!dueDateText && container) {
              const text = container.textContent;
              const datePatterns = [/\b(?:due|until|deadline)[:\s]*([^\n,]+)/i, /\b(\w{3,9}\s+\d{1,2}(?:,\s*\d{4})?(?:\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm))?)/i, /(\d{1,2}\/\d{1,2}\/\d{2,4})/, /(today|tomorrow)/i];
              for (const p of datePatterns) {
                const m = text.match(p);
                if (m) {
                  dueDateText = m[1] || m[0];
                  break;
                }
              }
            }

            if (!dueDateText) {
              console.warn(`Skipping ${title}: No due date found near link ${href}`);
              continue;
            }

            const dueDate = parseDateString(dueDateText);
            if (!dueDate) {
              console.warn(`Skipping ${title}: Could not parse due date "${dueDateText}" for link ${href}`);
              continue;
            }

            const id = `gradescope-${href}`.replace(/[^a-zA-Z0-9-]/g, '-');
            const item = {
              id: id,
              title: title,
              dueDate: dueDate,
              course: courseName,
              link: href,
              source: "Gradescope"
            };

            items.push(item);
            // Scraped anchor

          } catch (err) {
            console.error('Error processing anchor:', err);
          }
        }
      }

    } catch (error) {
      console.error("Error during Gradescope scraping:", error);
    }

  // Gradescope scrape completed

    // Always send results back to background and indicate completion so the background
    // can close tabs that were opened for scraping only after a confirmed scrape.
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
    document.addEventListener('DOMContentLoaded', scrapeGradescope);
  } else {
    scrapeGradescope();
  }

  // Also make the function available for manual refresh
  window.scrapeGradescope = scrapeGradescope;

})();