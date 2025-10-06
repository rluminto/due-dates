// options.js
// JavaScript for the extension options/settings page

document.addEventListener('DOMContentLoaded', async () => {
    // Options page loaded
    
    // Get DOM elements
    const settingsForm = document.getElementById('settingsForm');
    const notificationsEnabled = document.getElementById('notificationsEnabled');
    const notificationHours = document.getElementById('notificationHours');
    const itemCount = document.getElementById('itemCount');
    // const saveBtn = document.getElementById('saveBtn'); // unused UI element
    const resetBtn = document.getElementById('resetBtn');
    const clearDataBtn = document.getElementById('clearDataBtn');
    const exportBtn = document.getElementById('exportBtn');
    const saveStatus = document.getElementById('saveStatus');
    
    // Load current settings
    await loadSettings();
    
    // Event listeners
    settingsForm.addEventListener('submit', handleSave);
    resetBtn.addEventListener('click', handleReset);
    clearDataBtn.addEventListener('click', handleClearData);
    exportBtn.addEventListener('click', handleExport);
    
    // Auto-save on change
    notificationsEnabled.addEventListener('change', handleAutoSave);
    notificationHours.addEventListener('change', handleAutoSave);
    
    // Load settings from storage
    async function loadSettings() {
        try {
            const data = await browser.runtime.sendMessage({ type: 'GET_DATA' });
            
            // Populate form fields
            notificationsEnabled.checked = data.settings.notificationsEnabled;
            notificationHours.value = data.settings.notificationHours.toString();
            
            // Update item count
            itemCount.textContent = data.items.length;
            
            // Settings loaded
        } catch (error) {
            console.error('Error loading settings:', error);
            showStatus('Failed to load settings', 'error');
        }
    }
    
    // Handle form submission
    async function handleSave(event) {
        event.preventDefault();
        await saveSettings();
    }
    
    // Auto-save when settings change
    async function handleAutoSave() {
        await saveSettings(true); // true = silent save
    }
    
    // Save settings to storage
    async function saveSettings(silent = false) {
        try {
            const settings = {
                notificationsEnabled: notificationsEnabled.checked,
                notificationHours: parseInt(notificationHours.value)
            };
            
            await browser.runtime.sendMessage({
                type: 'UPDATE_SETTINGS',
                settings: settings
            });
            
            if (!silent) {
                showStatus('Settings saved successfully', 'success');
            }
            
            // Settings saved
        } catch (error) {
            console.error('Error saving settings:', error);
            showStatus('Failed to save settings', 'error');
        }
    }
    
    // Reset settings to defaults
    async function handleReset() {
        if (!confirm('Reset all settings to default values?')) {
            return;
        }
        
        try {
            const defaultSettings = {
                notificationsEnabled: true,
                notificationHours: 24
            };
            
            // Update form fields
            notificationsEnabled.checked = defaultSettings.notificationsEnabled;
            notificationHours.value = defaultSettings.notificationHours.toString();
            
            // Save to storage
            await browser.runtime.sendMessage({
                type: 'UPDATE_SETTINGS',
                settings: defaultSettings
            });
            
            showStatus('Settings reset to defaults', 'success');
            // Settings reset to defaults
        } catch (error) {
            console.error('Error resetting settings:', error);
            showStatus('Failed to reset settings', 'error');
        }
    }
    
    // Clear all data
    async function handleClearData() {
        const confirmed = confirm(
            'Are you sure you want to delete all saved deadlines and reset settings?\n\n' +
            'This action cannot be undone.'
        );
        
        if (!confirmed) {
            return;
        }
        
        try {
            await browser.runtime.sendMessage({ type: 'CLEAR_DATA' });
            
            // Reset form to defaults
            notificationsEnabled.checked = true;
            notificationHours.value = '24';
            itemCount.textContent = '0';
            
            showStatus('All data cleared successfully', 'success');
            // All data cleared
        } catch (error) {
            console.error('Error clearing data:', error);
            showStatus('Failed to clear data', 'error');
        }
    }
    
    // Export data as JSON
    async function handleExport() {
        try {
            const data = await browser.runtime.sendMessage({ type: 'GET_DATA' });
            
            // Create export object
            const exportData = {
                exportDate: new Date().toISOString(),
                version: '1.0',
                items: data.items,
                settings: data.settings
            };
            
            // Create and download file
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `deadline-scraper-export-${new Date().toISOString().split('T')[0]}.json`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            URL.revokeObjectURL(url);
            
            showStatus('Data exported successfully', 'success');
            // Data exported
        } catch (error) {
            console.error('Error exporting data:', error);
            showStatus('Failed to export data', 'error');
        }
    }
    
    // Show status message
    function showStatus(message, type = 'info') {
        saveStatus.textContent = message;
        saveStatus.className = type;
        
        // Clear status after 5 seconds
        setTimeout(() => {
            saveStatus.textContent = '';
            saveStatus.className = '';
        }, 5000);
    }
    
    // Test notifications function (could be added later)
    // Unused helper: keep for manual testing of notifications
    async function _testNotification() {
        try {
            await browser.notifications.create('test-notification', {
                type: 'basic',
                iconUrl: '../icons/icon128.png',
                title: 'Deadline Scraper Test',
                message: 'Notifications are working correctly!'
            });
            
            showStatus('Test notification sent', 'success');
        } catch (error) {
            console.error('Error sending test notification:', error);
            showStatus('Failed to send test notification', 'error');
        }
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        // Ctrl+S or Cmd+S to save
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            handleSave(event);
        }
    });
});