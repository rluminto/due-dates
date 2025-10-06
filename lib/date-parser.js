// lib/date-parser.js
// Robust date parsing utility for handling various date formats from educational platforms

function parseDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    console.warn("Invalid date string:", dateStr);
    return null;
  }

  // 1. Normalize the string: remove "due", "until", extra whitespace
  let cleanStr = dateStr.toLowerCase()
    .replace(/due\s*/g, '')
    .replace(/until\s*/g, '')
    .replace(/@/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Handle relative terms first
  const now = new Date();
  
  if (cleanStr.includes('today')) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return today.toISOString();
  }
  
  if (cleanStr.includes('tomorrow')) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
    return tomorrow.toISOString();
  }

  // 3. Try to extract time information first
  let timeMatch = cleanStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  let hours = 23, minutes = 59; // Default to end of day
  
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = parseInt(timeMatch[2]);
    const isPM = timeMatch[3].toLowerCase() === 'pm';
    
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    
    // Remove time from string for date parsing
    cleanStr = cleanStr.replace(/\d{1,2}:\d{2}\s*(am|pm)/i, '').trim();
  }

  // 4. Try parsing common date formats
  const dateFormats = [
    // Handle "Sunday, Dec 25" format (PrairieLearn style)
    /(\w+),\s*(\w+)\s+(\d{1,2})/i,
    // Handle "Dec 25" format
    /(\w+)\s+(\d{1,2})/i,
    // Handle "12/25" or "12/25/2025" format
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/,
    // Handle "2025-12-25" format
    /(\d{4})-(\d{1,2})-(\d{1,2})/
  ];

  for (const format of dateFormats) {
    const match = cleanStr.match(format);
    if (match) {
      try {
        let date;
        
        if (format.source.includes('\\w+')) {
          // Month name format
          const monthNames = {
            'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
            'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
            'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
            'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
          };
          
          if (match[2] && match[3]) {
            // "Sunday, Dec 25" format
            const monthName = match[2].toLowerCase();
            const day = parseInt(match[3]);
            const month = monthNames[monthName];
            
            if (month !== undefined) {
              const year = now.getFullYear();
              date = new Date(year, month, day, hours, minutes, 0);
              
              // If the date is in the past, assume it's for next year
              if (date < now) {
                date.setFullYear(year + 1);
              }
            }
          } else if (match[1] && match[2]) {
            // "Dec 25" format
            const monthName = match[1].toLowerCase();
            const day = parseInt(match[2]);
            const month = monthNames[monthName];
            
            if (month !== undefined) {
              const year = now.getFullYear();
              date = new Date(year, month, day, hours, minutes, 0);
              
              // If the date is in the past, assume it's for next year
              if (date < now) {
                date.setFullYear(year + 1);
              }
            }
          }
        } else if (format.source.includes('(\\d{4})')) {
          // ISO format "2025-12-25"
          const year = parseInt(match[1]);
          const month = parseInt(match[2]) - 1; // Month is 0-indexed
          const day = parseInt(match[3]);
          date = new Date(year, month, day, hours, minutes, 0);
        } else {
          // MM/DD or MM/DD/YYYY format
          const month = parseInt(match[1]) - 1; // Month is 0-indexed
          const day = parseInt(match[2]);
          let year = match[3] ? parseInt(match[3]) : now.getFullYear();
          
          // Handle 2-digit years
          if (year < 100) {
            year += year < 50 ? 2000 : 1900;
          }
          
          date = new Date(year, month, day, hours, minutes, 0);
          
          // If the date is in the past and no year was specified, assume next year
          if (!match[3] && date < now) {
            date.setFullYear(year + 1);
          }
        }
        
        if (date && !isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch (e) {
        console.warn("Error parsing date with format:", format.source, e);
      }
    }
  }

  // 5. Last resort: try native Date parsing
  try {
    const date = new Date(cleanStr);
    if (!isNaN(date.getTime())) {
      // Set to end of day if no time was specified
      if (!timeMatch) {
        date.setHours(23, 59, 59, 999);
      }
      return date.toISOString();
    }
  } catch (e) {
    console.warn("Native Date parsing failed:", e);
  }

  // 6. Return null if no format matches
  console.warn("Could not parse date:", dateStr);
  return null;
}

// Export for use in content scripts (browser compatibility)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDateString };
} else if (typeof window !== 'undefined') {
  window.DateParser = { parseDateString };
}