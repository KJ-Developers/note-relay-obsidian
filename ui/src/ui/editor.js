/**
 * Editor Component
 * Manages EasyMDE markdown editor
 */

import EasyMDE from 'easymde';

let easyMDE = null;

/**
 * Initialize EasyMDE editor
 */
export function initEditor(elementId = 'editor') {
    const textarea = document.getElementById(elementId);
    if (!textarea) {
        console.error('Editor textarea not found');
        return null;
    }
    
    easyMDE = new EasyMDE({
        element: textarea,
        spellChecker: false,
        status: false,
        toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "table"],
        autofocus: false,
        placeholder: 'Start typing...',
        renderingConfig: {
            singleLineBreaks: false,
            codeSyntaxHighlighting: true
        }
    });
    
    return easyMDE;
}

/**
 * Load content into editor
 */
export async function loadEditorContent(path, content, callbacks = {}) {
    if (!easyMDE) {
        console.error('Editor not initialized');
        return;
    }
    
    // Update filename display
    const filenameEl = document.getElementById('filename');
    if (filenameEl) {
        const displayName = path.split('/').pop().replace('.md', '');
        filenameEl.innerText = displayName;
    }
    
    // Set content
    easyMDE.value(content);
    
    // Show save button
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.classList.remove('hidden');
    
    // Add change listener
    if (callbacks.onChange) {
        easyMDE.codemirror.on('change', callbacks.onChange);
    }
    
    // Refresh CodeMirror
    setTimeout(() => {
        easyMDE.codemirror.refresh();
    }, 100);
}

/**
 * Get current editor content
 */
export function getEditorContent() {
    return easyMDE ? easyMDE.value() : '';
}

/**
 * Set editor content
 */
export function setEditorContent(content) {
    if (easyMDE) {
        easyMDE.value(content);
    }
}

/**
 * Get editor instance
 */
export function getEditor() {
    return easyMDE;
}
