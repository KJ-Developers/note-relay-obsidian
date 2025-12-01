/**
 * Main Application Controller
 * Central state management and module coordination
 */

import VaultConnection from './connection.js';
import { processFileData, renderNode, prepareList } from '../utils/fileTree.js';
import { b64toBlob, getMimeType } from '../utils/helpers.js';
import { initEditor, loadEditorContent, getEditorContent, getEditor } from '../ui/editor.js';
import * as icons from '../ui/icons.js';
import ForceGraph from 'force-graph';
import jsyaml from 'js-yaml';

// Global state
let conn = null;
let masterFileList = [];
let folderTree = {};
let tagTree = {};
let currentView = 'folders';
let currentPath = null;
let selectedFolderPath = '';
let isReadingMode = false;
let isCheckboxSaving = false;
let panelState = { graph: true, backlinks: true };
let currentList = [];
let renderedCount = 0;
let imageCache = {};
let graphInstance = null;
let easyMDE = null;
let ctxTarget = '';
let ctxTargetType = null;
let currentYamlData = null;
let contentWithoutYaml = '';
let navigationHistory = [];

/**
 * Show welcome screen on initial load
 */
function showWelcomeScreen() {
    const preview = document.getElementById('custom-preview');
    if (!preview) return;
    
    const welcomeHTML = `
        <div style="padding: 40px; max-width: 700px; margin: 0 auto;">
            <h1 style="color: var(--interactive-accent); margin-bottom: 10px;">
                <i class="fa-solid fa-satellite-dish"></i> Welcome to Note Relay
            </h1>
            <p style="color: var(--text-muted); font-size: 0.95em; margin-bottom: 30px;">
                Remote access to your Obsidian vault from anywhere
            </p>
            
            <h2 style="color: var(--text-normal); margin-top: 30px;">🚀 Getting Started</h2>
            <ul style="line-height: 1.8;">
                <li><strong>Select a note</strong> from the file tree on the left to start reading</li>
                <li><strong>Create new notes</strong> using the <i class="fa-regular fa-file-lines"></i> button</li>
                <li><strong>Toggle edit mode</strong> with the <i class="fa-regular fa-eye"></i> button in the toolbar</li>
                <li><strong>Search notes</strong> using the filter box above the note list</li>
            </ul>
            
            <h2 style="color: var(--text-normal); margin-top: 30px;">⌨️ Keyboard Shortcuts</h2>
            <ul style="line-height: 1.8;">
                <li><kbd>Cmd/Ctrl + S</kbd> - Save current note</li>
                <li><kbd>Cmd/Ctrl + K</kbd> - Create link in editor</li>
                <li><kbd>Escape</kbd> - Close menus</li>
            </ul>
            
            <h2 style="color: var(--text-normal); margin-top: 30px;">✨ Features</h2>
            <ul style="line-height: 1.8;">
                <li><strong>Live Preview</strong> - High-fidelity markdown rendering</li>
                <li><strong>Local Graph</strong> - Visualize note connections</li>
                <li><strong>Backlinks</strong> - See which notes link to the current note</li>
                <li><strong>Full Editing</strong> - Create, rename, delete files and folders</li>
                <li><strong>Theme Support</strong> - Uses your Obsidian theme CSS</li>
            </ul>
            
            <p style="margin-top: 40px; padding: 20px; background: var(--background-secondary); border-radius: 8px; border-left: 4px solid var(--interactive-accent);">
                <strong>💡 Tip:</strong> Right-click on files and folders for additional options
            </p>
        </div>
    `;
    
    preview.innerHTML = welcomeHTML;
    preview.style.display = 'block';
    
    // Hide editor components and view toggle button
    const editorEl = document.querySelector('.EasyMDEContainer');
    const loading = document.getElementById('preview-loading');
    const viewBtn = document.getElementById('view-btn');
    const saveBtn = document.getElementById('save-btn');
    if (editorEl) editorEl.style.display = 'none';
    if (loading) loading.style.display = 'none';
    if (viewBtn) viewBtn.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';
}

/**
 * Initialize the application
 */
export function initApp() {
    console.log('🚀 Note Relay V2 Bundle Loaded - Build: Production');
    console.log('✅ Initializing Note Relay UI');
    
    // Initialize connection
    conn = new VaultConnection();
    
    // Load saved panel state
    const savedPanels = localStorage.getItem('panelState');
    if (savedPanels) {
        panelState = JSON.parse(savedPanels);
        applyPanelState();
    }
    
    // Set up event listeners
    setupEventListeners();
    
    // Initialize editor after a brief delay to ensure DOM is ready
    setTimeout(() => {
        easyMDE = initEditor('editor');
        if (!easyMDE) {
            console.error('❌ Failed to initialize EasyMDE editor');
        } else {
            console.log('✅ EasyMDE editor initialized');
        }
        
        // Show welcome screen after editor is initialized
        showWelcomeScreen();
    }, 100);
    
    // Set up connection message handler
    conn.onMessage = handleMessage;
    
    // Initialize sidebar resize
    initSidebarResize();
    
    // Update icons
    updateIcons();
    
    console.log('✅ App initialization complete');
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Connect button
    const btn = document.getElementById('connect-btn');
    const passwordInput = document.getElementById('password-input');
    if (btn) btn.addEventListener('click', connectToVault);
    if (passwordInput) {
        passwordInput.focus();
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') connectToVault();
        });
    }
    
    // Global click to close context menu
    window.addEventListener('mousedown', (e) => {
        const menu = document.getElementById('context-menu');
        if (menu && menu.style.display === 'block' && !e.target.closest('.context-menu')) {
            menu.style.display = 'none';
        }
    }, true);
    
    // Close menu on blur/escape
    window.addEventListener('blur', () => {
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
    });
    
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const menu = document.getElementById('context-menu');
            if (menu) menu.style.display = 'none';
        }
    });
    
    // Context menu handler
    document.addEventListener('contextmenu', handleContextMenuDisplay);
    
    // Link/tag/checkbox interceptors
    document.addEventListener('click', handleDocumentClick);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveFile();
        }
    });
}

/**
 * Handle document clicks (links, tags, checkboxes)
 */
async function handleDocumentClick(e) {
    // Checkbox handling
    if (e.target.type === 'checkbox' && e.target.closest('#custom-preview')) {
        e.preventDefault();
        e.stopPropagation();
        await handleCheckboxClick(e.target);
        return;
    }
    
    // Internal link handling
    if (e.target.classList.contains('internal-link')) {
        e.preventDefault();
        let target = e.target.getAttribute('href');
        if (!target.endsWith('.md')) target = target + '.md';
        loadFile(target);
        return;
    }
    
    // Tag handling
    if (e.target.classList.contains('tag')) {
        e.preventDefault();
        const tagName = e.target.getAttribute('href')?.replace('#', '') || e.target.textContent.replace('#', '');
        if (tagName) {
            currentView = 'tags';
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-tags').classList.add('active');
            renderSidebar();
            
            const tagNode = tagTree._sub?.[tagName];
            if (tagNode && tagNode._files) {
                prepareNoteList(tagNode._files);
                setTimeout(() => {
                    document.querySelectorAll('.tree-label').forEach(label => {
                        if (label.textContent.includes(tagName)) {
                            label.classList.add('selected');
                        }
                    });
                }, 100);
            }
        }
        return;
    }
}

/**
 * Handle checkbox clicks in preview mode
 */
async function handleCheckboxClick(checkbox) {
    const newCheckedState = checkbox.checked;
    const listItem = checkbox.closest('li');
    
    if (listItem && currentPath) {
        const file = masterFileList.find(f => f.path === currentPath);
        if (file) {
            try {
                const result = await conn.send('GET_FILE', { path: currentPath });
                let content = result.data?.data || result.data?.content || result.data;
                
                if (typeof content !== 'string') {
                    console.error('Content is not a string');
                    checkbox.checked = !checkbox.checked;
                    return;
                }
                
                const taskRegex = /^(\s*[-*+]\s+\[)([xX\s])(\])/gm;
                let checkboxIndex = 0;
                const targetIndex = Array.from(document.querySelectorAll('#custom-preview input[type=\"checkbox\"]')).indexOf(checkbox);
                
                let found = false;
                content = content.replace(taskRegex, (match, prefix, status, suffix) => {
                    if (checkboxIndex === targetIndex) {
                        found = true;
                        const newStatus = newCheckedState ? 'x' : ' ';
                        checkboxIndex++;
                        return prefix + newStatus + suffix;
                    }
                    checkboxIndex++;
                    return match;
                });
                
                if (!found) {
                    checkbox.checked = !checkbox.checked;
                    return;
                }
                
                isCheckboxSaving = true;
                await conn.send('WRITE', { path: currentPath, data: content });
                
                setTimeout(() => {
                    isCheckboxSaving = false;
                }, 100);
            } catch (err) {
                console.error('Failed to save checkbox state:', err);
                checkbox.checked = !checkbox.checked;
                isCheckboxSaving = false;
            }
        }
    }
}

/**
 * Connect to vault (local or remote)
 */
async function connectToVault() {
    const btn = document.getElementById('connect-btn');
    const pass = document.getElementById('password-input').value;
    
    if (!pass) {
        alert('Password required');
        return;
    }
    
    btn.disabled = true;
    btn.innerText = 'Connecting...';
    
    try {
        const onStatusUpdate = (msg) => {
            document.getElementById('status-text').innerText = msg;
        };
        
        await conn.connect(pass, onStatusUpdate);
        
    } catch (error) {
        if (error.message === 'Authentication required') {
            log('Session expired. Please log in to the dashboard first.');
            btn.innerText = 'Login Required';
        } else {
            log('Connection Error: ' + error.message);
            btn.innerText = 'Retry';
        }
        btn.disabled = false;
        console.error('Connection error:', error);
    }
}

/**
 * Handle incoming messages from connection
 */
function handleMessage(msg) {
    console.log('🎯 Message received:', msg.type);
    
    if (msg.type === 'CONNECTED') {
        document.getElementById('connect-overlay').style.display = 'none';
        document.getElementById('app-container').classList.add('active');
        initSidebarResize();
        setTimeout(async () => {
            await conn.send('GET_TREE');
        }, 200);
        return;
    }
    
    if (msg.type === 'TREE') {
        console.log('📊 TREE data received:', {
            hasData: !!msg.data,
            fileCount: msg.data?.files?.length,
            folderCount: msg.data?.folders?.length,
            hasCss: !!msg.data?.css
        });
        
        if (masterFileList.length === 0) {
            document.getElementById('connect-overlay').style.display = 'none';
            document.getElementById('app-container').classList.add('active');
            initSidebarResize();
        }
        
        if (msg.data.css) {
            applyTheme(msg.data.css);
        }
        
        const result = processFileData(msg.data);
        console.log('📊 Processed data:', {
            masterFileListCount: result.masterFileList.length,
            folderTreeFiles: result.folderTree._files?.length,
            tagTreeCount: Object.keys(result.tagTree).length
        });
        
        const wasEmpty = masterFileList.length === 0;
        
        masterFileList = result.masterFileList;
        folderTree = result.folderTree;
        tagTree = result.tagTree;
        
        // Always render on first load, silent refresh on subsequent loads
        if (wasEmpty || !msg.data.files) {
            console.log('🎨 Rendering sidebar and note list');
            renderSidebar();
            prepareNoteList(folderTree._files.length > 0 ? folderTree._files : masterFileList.slice(0, 100));
        } else {
            console.log('🔄 Silent refresh - not re-rendering');
        }
        return;
    }
    
    if (msg.type === 'FILE') {
        const filePath = msg.meta?.path || msg.path;
        const content = msg.data.data || msg.data;
        console.log('📄 Loading file:', filePath, 'Current mode:', isReadingMode ? 'READ' : 'EDIT');
        
        // Load into editor
        easyMDE.value(content);
        easyMDE.codemirror.clearHistory();
        
        // If this is during YAML save, just load content and return
        if (window._yamlSaveInProgress) {
            console.log('⏸️ YAML save in progress, content loaded for processing');
            return;
        }
        
        // Only manipulate loading/preview if in reading mode
        // (when toggling to edit mode, toggleViewMode already handled the UI)
        if (isReadingMode) {
            const loading = document.getElementById('preview-loading');
            const preview = document.getElementById('custom-preview');
            if (loading) loading.style.display = 'flex';
            if (preview) preview.style.display = 'none';
            
            // Double-toggle to get rendered version
            toggleViewMode(); // Toggle off (to edit)
            setTimeout(() => toggleViewMode(), 50); // Toggle on (to preview - triggers fetch)
        } else {
            // In edit mode - just refresh the editor
            if (easyMDE) easyMDE.codemirror.refresh();
        }
        
        renderBacklinks(msg.data.backlinks);
        if (panelState.graph) renderLocalGraph(filePath);
        return;
    }
    
    if (msg.type === 'RENDERED_FILE') {
        if (isCheckboxSaving) {
            console.log('⏭️ Skipping RENDERED_FILE during checkbox save');
            return;
        }
        
        if (msg.data.files) {
            const result = processFileData({ files: msg.data.files }, true);
            masterFileList = result.masterFileList;
            folderTree = result.folderTree;
            tagTree = result.tagTree;
        }
        
        if (msg.data.css) {
            applyTheme(msg.data.css);
        }
        
        // Store YAML data for editing (and get original content if available)
        currentYamlData = msg.data.yaml;
        
        // If we have YAML, we need to get the original content to reconstruct later
        if (currentYamlData && !contentWithoutYaml && easyMDE) {
            const editorContent = easyMDE.value();
            const yamlMatch = editorContent.match(/^---\n[\s\S]*?\n---\n?/);
            if (yamlMatch) {
                contentWithoutYaml = editorContent.slice(yamlMatch[0].length);
            } else {
                contentWithoutYaml = editorContent;
            }
        }
        
        renderYamlProperties(msg.data.yaml, msg.meta?.path || msg.path);
        renderPreview(msg.data.html);
        renderBacklinks(msg.data.backlinks || []);
        const renderedPath = msg.meta?.path || msg.path;
        if (panelState.graph && renderedPath) renderLocalGraph(renderedPath);
        return;
    }
}

/**
 * Apply Obsidian theme CSS
 */
function applyTheme(css) {
    console.log('🎨 APPLY THEME - START');
    let styleTag = document.getElementById('obsidian-theme-vars');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'obsidian-theme-vars';
        document.head.appendChild(styleTag);
    }
    
    styleTag.textContent = css;
    console.log('📝 CSS injected, length:', css.length);
    
    // Force reflow
    document.body.offsetHeight;
    
    // Set backgrounds and colors directly via inline styles for all major areas
    setTimeout(() => {
        applyThemeToElements();
        console.log('✅ APPLY THEME - COMPLETE');
    }, 50);
}

/**
 * Apply theme colors to all elements (called by applyTheme and mutation observer)
 */
function applyThemeToElements() {
    const root = document.documentElement;
    
    // Extract all theme colors
    const primaryBg = getComputedStyle(root).getPropertyValue('--background-primary').trim();
    const secondaryBg = getComputedStyle(root).getPropertyValue('--background-secondary').trim();
    const secondaryAltBg = getComputedStyle(root).getPropertyValue('--background-secondary-alt').trim();
    const textNormal = getComputedStyle(root).getPropertyValue('--text-normal').trim();
    const textMuted = getComputedStyle(root).getPropertyValue('--text-muted').trim();
    const textFaint = getComputedStyle(root).getPropertyValue('--text-faint').trim();
    const textAccent = getComputedStyle(root).getPropertyValue('--text-accent').trim();
    const textAccentHover = getComputedStyle(root).getPropertyValue('--text-accent-hover').trim();
    const borderColor = getComputedStyle(root).getPropertyValue('--background-modifier-border').trim();
    const hoverBg = getComputedStyle(root).getPropertyValue('--background-modifier-hover').trim();
    const interactiveAccent = getComputedStyle(root).getPropertyValue('--interactive-accent').trim();
    
    console.log('🎨 Applying comprehensive theme...');
    console.log('Border color extracted:', borderColor);
    console.log('Hover background extracted:', hoverBg);
    
    // === FIX: Force border visibility ===
    // Apply borders with inline styles since CSS background shorthand was resetting them
    if (borderColor) {
        document.querySelectorAll('#sidebar, #pane-notes, #local-graph-container, #app-ribbon').forEach(el => {
            el.style.setProperty('border-right', `1px solid ${borderColor}`, 'important');
        });
        document.querySelectorAll('.brand-header, .explorer-toolbar, .context-header, #editor-header, .pane-header, .search-box-container').forEach(el => {
            el.style.setProperty('border-bottom', `1px solid ${borderColor}`, 'important');
        });
        document.querySelectorAll('#context-panel').forEach(el => {
            el.style.setProperty('border-top', `1px solid ${borderColor}`, 'important');
        });
    }
    
    // === BACKGROUNDS ===
    
    // Main content areas
    if (primaryBg) {
        document.querySelectorAll('body, #content-area, #main-content, #custom-preview, #graph-canvas, #local-graph-container').forEach(el => {
            el.style.setProperty('background', primaryBg, 'important');
        });
    }
    
    // Sidebar areas
    if (secondaryBg) {
        document.querySelectorAll('#sidebar, #sidebar-tree-area, #note-list-container, .pane-header, .explorer-toolbar').forEach(el => {
            el.style.setProperty('background', secondaryBg, 'important');
        });
    }
    
    // === TEXT COLORS ===
    
    // Sidebar text (folders, notes) and filename
    if (textNormal) {
        document.querySelectorAll('.tree-text, .note-card, .note-title, #sidebar-tree-area, #note-list-container, .brand-header, #filename').forEach(el => {
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    // Buttons and icons - muted by default with hover effects
    if (textMuted && textNormal && hoverBg) {
        document.querySelectorAll('.nav-btn, .header-btn, .ribbon-btn').forEach(btn => {
            btn.style.setProperty('color', textMuted, 'important');
            
            btn.addEventListener('mouseenter', () => {
                btn.style.setProperty('color', textNormal, 'important');
                btn.style.setProperty('background-color', hoverBg, 'important');
            });
            
            btn.addEventListener('mouseleave', () => {
                if (!btn.classList.contains('active')) {
                    btn.style.setProperty('color', textMuted, 'important');
                    btn.style.setProperty('background-color', 'transparent', 'important');
                }
            });
        });
        
        // Icon colors inherit from button
        document.querySelectorAll('.header-btn i, .nav-btn i, .ribbon-btn i, .tree-icon, .tree-icon i, .brand-header i').forEach(el => {
            el.style.setProperty('color', 'inherit', 'important');
        });
    }
    
    // Tree items (folders and files) - hover effects
    if (textMuted && textNormal && hoverBg) {
        document.querySelectorAll('.file-tree-item').forEach(item => {
            item.style.setProperty('color', textMuted, 'important');
            
            item.addEventListener('mouseenter', () => {
                item.style.setProperty('color', textNormal, 'important');
                item.style.setProperty('background-color', hoverBg, 'important');
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.setProperty('color', textMuted, 'important');
                item.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    // Tab highlighting (FOLDERS/TAGS)
    if (textMuted && textAccent) {
        document.querySelectorAll('.tab').forEach(tab => {
            if (tab.classList.contains('active')) {
                tab.style.setProperty('color', textAccent, 'important');
                tab.style.setProperty('border-bottom-color', textAccent, 'important');
            } else {
                tab.style.setProperty('color', textMuted, 'important');
            }
        });
    }
    
    // === CONTEXT MENU ===
    if (secondaryBg && borderColor) {
        document.querySelectorAll('.context-menu').forEach(el => {
            el.style.setProperty('background-color', secondaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
        });
    }
    
    if (textNormal && hoverBg) {
        document.querySelectorAll('.menu-item').forEach(item => {
            item.style.setProperty('color', textNormal, 'important');
            item.addEventListener('mouseenter', () => {
                item.style.setProperty('background-color', hoverBg, 'important');
            });
            item.addEventListener('mouseleave', () => {
                item.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    if (borderColor) {
        document.querySelectorAll('.menu-separator').forEach(el => {
            el.style.setProperty('background-color', borderColor, 'important');
        });
    }
    
    // Active buttons
    if (textAccent) {
        document.querySelectorAll('.header-btn.active, .nav-btn.active').forEach(el => {
            el.style.setProperty('color', textAccent, 'important');
        });
    }
    
    // Active note highlight
    if (interactiveAccent || textAccent) {
        document.querySelectorAll('.note-card.active').forEach(el => {
            el.style.setProperty('background-color', interactiveAccent || textAccent, 'important');
            el.style.setProperty('color', primaryBg || '#ffffff', 'important');
        });
    }
    
    // Save button
    if (interactiveAccent) {
        document.querySelectorAll('.save-btn, #save-btn').forEach(el => {
            el.style.setProperty('background-color', interactiveAccent, 'important');
            el.style.setProperty('color', '#ffffff', 'important');
        });
    }
    
    // === CONTENT TEXT ===
    
    // Paragraphs, lists, general content
    if (textNormal) {
        document.querySelectorAll('#custom-preview, #custom-preview p, #custom-preview li, #custom-preview td, .property-value, .yaml-content').forEach(el => {
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    // Headings
    if (textNormal) {
        document.querySelectorAll('#custom-preview h1, #custom-preview h2, #custom-preview h3, #custom-preview h4, #custom-preview h5, #custom-preview h6').forEach(el => {
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    // Links
    if (textAccent) {
        document.querySelectorAll('#custom-preview a, .internal-link').forEach(el => {
            el.style.setProperty('color', textAccent, 'important');
        });
    }
    
    // === CODE BLOCKS ===
    
    if (secondaryAltBg && textNormal) {
        document.querySelectorAll('#custom-preview pre, #custom-preview code').forEach(el => {
            el.style.setProperty('background-color', secondaryAltBg, 'important');
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    // === TABLES ===
    
    if (borderColor) {
        document.querySelectorAll('#custom-preview table, #custom-preview th, #custom-preview td').forEach(el => {
            el.style.setProperty('border-color', borderColor, 'important');
        });
    }
    if (secondaryAltBg) {
        document.querySelectorAll('#custom-preview th').forEach(el => {
            el.style.setProperty('background-color', secondaryAltBg, 'important');
        });
    }
    
    // === BLOCKQUOTES ===
    
    if (textMuted && borderColor) {
        document.querySelectorAll('#custom-preview blockquote').forEach(el => {
            el.style.setProperty('color', textMuted, 'important');
            el.style.setProperty('border-left-color', borderColor, 'important');
        });
    }
    
    // === BORDERS ===
    
    if (borderColor) {
        // Only set border-color which applies to whichever borders are already defined in CSS
        document.querySelectorAll('.pane-header, .brand-header, .explorer-toolbar, #editor-header, .note-card, #sidebar, #local-graph-container, #backlinks-container, .context-header, #app-ribbon, .resize-handle').forEach(el => {
            el.style.setProperty('border-color', borderColor, 'important');
        });
    }
    
    // === PROPERTIES PANEL ===
    
    // Properties container
    if (secondaryBg && borderColor) {
        document.querySelectorAll('.yaml-properties-container').forEach(el => {
            el.style.setProperty('background-color', secondaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
        });
    }
    
    // Properties header
    if (secondaryBg && textNormal && borderColor) {
        document.querySelectorAll('.yaml-header').forEach(el => {
            el.style.setProperty('background-color', secondaryBg, 'important');
            el.style.setProperty('color', textNormal, 'important');
            el.style.setProperty('border-bottom', `1px solid ${borderColor}`, 'important');
        });
    }
    
    // Property keys (labels)
    if (textMuted) {
        document.querySelectorAll('.yaml-key').forEach(el => {
            el.style.setProperty('color', textMuted, 'important');
        });
    }
    
    // Property input fields
    if (primaryBg && borderColor && textNormal) {
        document.querySelectorAll('.yaml-value input[type="text"], .yaml-value input[type="date"], .yaml-value input[type="number"], .yaml-value textarea').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    // Property rows hover
    if (hoverBg) {
        document.querySelectorAll('.yaml-property').forEach(row => {
            row.addEventListener('mouseenter', () => {
                row.style.setProperty('background-color', hoverBg, 'important');
            });
            row.addEventListener('mouseleave', () => {
                row.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    // Add property button
    if (primaryBg && borderColor && textNormal) {
        document.querySelectorAll('.yaml-add-property button').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    // Plugin view badge
    if (textNormal && borderColor) {
        document.querySelectorAll('.plugin-view-badge').forEach(el => {
            el.style.setProperty('border-bottom', `1px solid ${borderColor}`, 'important');
        });
        document.querySelectorAll('.plugin-label').forEach(el => {
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    // === DROPDOWNS (Tag & Property Selectors) ===
    
    // Tag dropdown
    if (primaryBg && borderColor) {
        document.querySelectorAll('.yaml-tag-dropdown').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
        });
    }
    
    if (textNormal && hoverBg) {
        document.querySelectorAll('.yaml-tag-suggestion').forEach(item => {
            item.style.setProperty('color', textNormal, 'important');
            item.addEventListener('mouseenter', () => {
                item.style.setProperty('background-color', hoverBg, 'important');
            });
            item.addEventListener('mouseleave', () => {
                item.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    // Property type dropdown
    if (primaryBg && borderColor) {
        document.querySelectorAll('.yaml-property-dropdown').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
        });
    }
    
    if (primaryBg && borderColor && textNormal) {
        document.querySelectorAll('.yaml-property-search').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border-bottom', `1px solid ${borderColor}`, 'important');
            el.style.setProperty('color', textNormal, 'important');
        });
    }
    
    if (textNormal && hoverBg) {
        document.querySelectorAll('.yaml-property-suggestion').forEach(item => {
            item.style.setProperty('color', textNormal, 'important');
            item.addEventListener('mouseenter', () => {
                item.style.setProperty('background-color', hoverBg, 'important');
            });
            item.addEventListener('mouseleave', () => {
                item.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    // Type selector dropdown
    if (primaryBg && borderColor) {
        document.querySelectorAll('.yaml-type-selector').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
        });
    }
    
    // Link autocomplete dropdown
    if (primaryBg && borderColor) {
        document.querySelectorAll('.yaml-link-dropdown').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
        });
    }
    
    if (textNormal && hoverBg) {
        document.querySelectorAll('.yaml-link-suggestion').forEach(item => {
            item.style.setProperty('color', textNormal, 'important');
            item.addEventListener('mouseenter', () => {
                item.style.setProperty('background-color', hoverBg, 'important');
            });
            item.addEventListener('mouseleave', () => {
                item.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    // Link value containers and internal links
    if (primaryBg && borderColor) {
        document.querySelectorAll('.yaml-link-value').forEach(el => {
            el.style.setProperty('background-color', primaryBg, 'important');
            el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
        });
    }
    
    if (textAccent) {
        document.querySelectorAll('.yaml-internal-link').forEach(el => {
            el.style.setProperty('color', textAccent, 'important');
            el.style.setProperty('background-color', hoverBg || 'rgba(76, 79, 105, 0.075)', 'important');
        });
    }
    
    // Edit link button
    if (textMuted && textNormal && hoverBg) {
        document.querySelectorAll('.yaml-edit-link').forEach(btn => {
            btn.style.setProperty('color', textMuted, 'important');
            btn.addEventListener('mouseenter', () => {
                btn.style.setProperty('color', textNormal, 'important');
                btn.style.setProperty('background-color', hoverBg, 'important');
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.setProperty('color', textMuted, 'important');
                btn.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    if (textNormal && borderColor) {
        document.querySelectorAll('.yaml-type-selector-header').forEach(el => {
            el.style.setProperty('background-color', secondaryBg, 'important');
            el.style.setProperty('color', textNormal, 'important');
            el.style.setProperty('border-bottom', `1px solid ${borderColor}`, 'important');
        });
    }
    
    if (textNormal && hoverBg) {
        document.querySelectorAll('.yaml-type-option').forEach(item => {
            item.style.setProperty('color', textNormal, 'important');
            item.addEventListener('mouseenter', () => {
                item.style.setProperty('background-color', hoverBg, 'important');
            });
            item.addEventListener('mouseleave', () => {
                item.style.setProperty('background-color', 'transparent', 'important');
            });
        });
    }
    
    // === TAG CHIPS ===
    
    const tagBg = getComputedStyle(root).getPropertyValue('--tag-background').trim() || secondaryAltBg;
    const tagColor = getComputedStyle(root).getPropertyValue('--tag-color').trim() || textAccent;
    if (tagBg || tagColor) {
        document.querySelectorAll('.yaml-tag-chip').forEach(el => {
            if (tagBg) el.style.setProperty('background-color', tagBg, 'important');
            if (tagColor) el.style.setProperty('color', tagColor, 'important');
        });
    }
    
    // === GRAPH CANVAS ===
    
    const graphCanvas = document.querySelector('#graph-canvas canvas');
    if (graphCanvas && primaryBg) {
        graphCanvas.style.setProperty('background', primaryBg, 'important');
        if (graphInstance) {
            graphInstance.backgroundColor(primaryBg);
        }
    }
    
    console.log('✅ Comprehensive theme applied');
}

/**
 * Render preview HTML
 */
function renderPreview(html) {
    const preview = document.getElementById('custom-preview');
    const loading = document.getElementById('preview-loading');
    
    if (html) {
        preview.innerHTML = html;
        
        // Apply Prism syntax highlighting
        if (window.Prism) {
            preview.querySelectorAll('pre code').forEach(block => {
                window.Prism.highlightElement(block);
            });
        }
        
        // Inject Unicode for MathJax
        preview.querySelectorAll('mjx-c[class*=\"mjx-c\"]').forEach(el => {
            const match = el.className.match(/mjx-c([0-9A-F]+)/i);
            if (match && !el.textContent) {
                const codePoint = parseInt(match[1], 16);
                el.textContent = String.fromCodePoint(codePoint);
            }
        });
        
        // Add copy buttons to code blocks
        addCopyButtons(preview);
    }
    
    // Hide loading spinner and show preview
    if (loading) {
        loading.style.display = 'none';
    }
    if (preview) {
        preview.style.display = 'block';
        // Reset scroll position to top when loading new content
        preview.scrollTop = 0;
    }
    
    console.log('✅ Preview rendered and visible');
}

/**
 * Add copy buttons to code blocks
 */
function addCopyButtons(container) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.parentNode.classList?.contains('code-block-wrapper')) return;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        wrapper.style.cssText = 'position: relative; margin: 1em 0;';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.innerHTML = icons.copy;
        copyBtn.style.cssText = 'position: absolute !important; top: 8px !important; right: 8px !important; background: rgba(32,32,32,0.9) !important; color: white !important; padding: 6px 10px !important; border: 1px solid #444 !important; border-radius: 4px !important; cursor: pointer !important; z-index: 999 !important; display: block !important; opacity: 1 !important; visibility: visible !important;';
        copyBtn.onclick = () => {
            const code = pre.querySelector('code')?.textContent || pre.textContent;
            navigator.clipboard.writeText(code).then(() => {
                copyBtn.innerHTML = icons.check;
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.innerHTML = icons.copy;
                    copyBtn.classList.remove('copied');
                }, 2000);
            });
        };
        wrapper.appendChild(copyBtn);
    });
}

/**
 * Render YAML frontmatter properties panel
 */
function renderYamlProperties(yamlData, path) {
    const container = document.getElementById('yaml-properties-container');
    if (!container) return;
    
    // Always show properties panel, even if empty
    const hasYaml = yamlData && Object.keys(yamlData).length > 0;
    
    // Detect plugin views
    const PLUGIN_VIEWS = {
        'kanban-plugin': { icon: '📋', label: 'Kanban Board', author: 'mgmeyers' },
        'dataview': { icon: '📊', label: 'Dataview Query', author: 'blacksmithgu' },
        'excalidraw-plugin': { icon: '✏️', label: 'Excalidraw Drawing', author: 'zsolt' }
    };
    
    let detectedPlugin = null;
    if (hasYaml) {
        Object.keys(yamlData).forEach(key => {
            if (PLUGIN_VIEWS[key]) {
                detectedPlugin = { key, ...PLUGIN_VIEWS[key] };
            }
        });
    }
    
    const isCollapsed = localStorage.getItem('yamlCollapsed') === 'true';
    
    const propertiesHtml = hasYaml ? Object.entries(yamlData).map(([key, value]) => 
        renderYamlProperty(key, value, path)
    ).join('') : '<div style="padding: 8px; color: var(--text-muted); font-size: 12px; text-align: center;">No properties yet</div>';
    
    const pluginBadgeHtml = detectedPlugin ? `
        <div class="plugin-view-badge">
            <span class="plugin-icon">${detectedPlugin.icon}</span>
            <span class="plugin-label">${detectedPlugin.label}</span>
            <button class="plugin-toggle-btn" onclick="window.togglePluginView()">
                <i class="fa-solid fa-eye"></i> Toggle View
            </button>
            <span class="plugin-attribution">by ${detectedPlugin.author}</span>
        </div>
    ` : '';
    
    container.innerHTML = `
        <div class="yaml-header" onclick="window.toggleYamlCollapse()">
            <span>
                <i class="fa-solid fa-chevron-${isCollapsed ? 'right' : 'down'}"></i>
                Properties
            </span>
        </div>
        ${pluginBadgeHtml}
        <div class="yaml-content ${isCollapsed ? 'collapsed' : ''}">
            ${propertiesHtml}
            <div class="yaml-add-property">
                <button onclick="window.addYamlProperty(event)">
                    <i class="fa-solid fa-plus"></i> Add property
                </button>
            </div>
        </div>
    `;
    
    container.style.display = 'block';
    
    // Reapply theme to newly rendered elements (especially tags)
    setTimeout(() => applyThemeToElements(), 10);
}

/**
 * Render individual YAML property
 */
function renderYamlProperty(key, value, path) {
    // Handle arrays (tags, aliases, etc.)
    if (Array.isArray(value)) {
        const chips = value.map(item => `
            <span class="yaml-tag-chip">
                ${item}
                <i class="fa-solid fa-xmark" onclick="window.removeYamlArrayItem('${key}', '${item}')"></i>
            </span>
        `).join('');
        
        return `
            <div class="yaml-property" data-key="${key}">
                <div class="yaml-key">${key}</div>
                <div class="yaml-value yaml-tags">
                    ${chips}
                    <input type="text" 
                           class="yaml-tag-input" 
                           placeholder="Add ${key}..."
                           onfocus="window.showTagDropdown(this, '${key}')"
                           oninput="window.filterTagDropdown(this, '${key}')"
                           onblur="window.hideTagDropdown()"
                           onkeydown="window.handleYamlArrayInput(event, '${key}')">
                </div>
                <i class="fa-solid fa-trash yaml-delete-property" 
                   onclick="window.deleteYamlProperty('${key}')"
                   title="Delete property"></i>
            </div>
        `;
    }
    
    // Handle booleans (check before numbers to avoid false positives)
    if (typeof value === 'boolean') {
        return `
            <div class="yaml-property" data-key="${key}">
                <div class="yaml-key">${key}</div>
                <div class="yaml-value">
                    <input type="checkbox" 
                           ${value ? 'checked' : ''}
                           onchange="window.updateYamlProperty('${key}', this.checked)">
                </div>
                <i class="fa-solid fa-trash yaml-delete-property" 
                   onclick="window.deleteYamlProperty('${key}')"
                   title="Delete property"></i>
            </div>
        `;
    }
    
    // Handle dates - check for date format YYYY-MM-DD or known date property names
    const valueString = String(value || '');
    const isDateFormat = /^\d{4}-\d{2}-\d{2}$/.test(valueString);
    const isDateProperty = ['date', 'created', 'modified', 'due'].includes(key);
    
    if (isDateFormat || isDateProperty) {
        return `
            <div class="yaml-property" data-key="${key}">
                <div class="yaml-key">${key}</div>
                <div class="yaml-value">
                    <input type="date" 
                           value="${value}" 
                           onchange="window.updateYamlProperty('${key}', this.value)">
                </div>
                <i class="fa-solid fa-trash yaml-delete-property" 
                   onclick="window.deleteYamlProperty('${key}')"
                   title="Delete property"></i>
            </div>
        `;
    }
    
    // Handle numbers
    if (typeof value === 'number' || (!isNaN(value) && value !== '' && !isNaN(parseFloat(value)))) {
        return `
            <div class="yaml-property" data-key="${key}">
                <div class="yaml-key">${key}</div>
                <div class="yaml-value">
                    <input type="number" 
                           value="${value}" 
                           step="any"
                           onchange="window.updateYamlProperty('${key}', parseFloat(this.value) || 0)"
                           onkeydown="if(event.key==='Enter') this.blur()">
                </div>
                <i class="fa-solid fa-trash yaml-delete-property" 
                   onclick="window.deleteYamlProperty('${key}')"
                   title="Delete property"></i>
            </div>
        `;
    }
    
    // Handle internal links (wikilinks)
    const stringValue = String(value || '');
    const hasWikilink = stringValue.includes('[[') && stringValue.includes(']]');
    if (hasWikilink) {
        // Parse all links and text between them
        let html = stringValue;
        const linkRegex = /\[\[([^\]]+)\]\]/g;
        
        // Replace all [[links]] with clickable elements
        html = html.replace(linkRegex, (match, linkText) => {
            return `<a href="${linkText}.md" class="internal-link yaml-internal-link"><i class="fa-solid fa-link"></i> ${linkText}</a>`;
        });
        
        return `
            <div class="yaml-property" data-key="${key}">
                <div class="yaml-key">${key}</div>
                <div class="yaml-value yaml-link-value">
                    <span class="yaml-link-content">${html}</span>
                    <button class="yaml-edit-link" onclick="window.editYamlLink('${key}', this)" title="Edit link">
                        <i class="fa-solid fa-pencil"></i>
                    </button>
                </div>
                <i class="fa-solid fa-trash yaml-delete-property" 
                   onclick="window.deleteYamlProperty('${key}')"
                   title="Delete property"></i>
            </div>
        `;
    }
    
    // Handle multiline text
    if (stringValue.includes('\n') || stringValue.length > 100) {
        const escapedValue = stringValue.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        return `
            <div class="yaml-property" data-key="${key}">
                <div class="yaml-key">${key}</div>
                <div class="yaml-value">
                    <textarea rows="3"
                              onblur="window.updateYamlProperty('${key}', this.value)"
                              onkeydown="if(event.key==='Enter' && event.ctrlKey) this.blur()">${escapedValue}</textarea>
                </div>
                <i class="fa-solid fa-trash yaml-delete-property" 
                   onclick="window.deleteYamlProperty('${key}')"
                   title="Delete property"></i>
            </div>
        `;
    }
    
    // Handle regular strings (default)
    const escapedValue = stringValue.replace(/"/g, '&quot;');
    return `
        <div class="yaml-property" data-key="${key}">
            <div class="yaml-key">${key}</div>
            <div class="yaml-value">
                <input type="text" 
                       value="${escapedValue}" 
                       onfocus="window.checkForLinkAutocomplete(this, '${key}')"
                       oninput="window.filterLinkAutocomplete(this, '${key}')"
                       onblur="window.hideLinkAutocomplete(); window.updateYamlProperty('${key}', this.value)"
                       onkeydown="if(event.key==='Enter') this.blur()">
            </div>
            <i class="fa-solid fa-trash yaml-delete-property" 
               onclick="window.deleteYamlProperty('${key}')"
               title="Delete property"></i>
        </div>
    `;
}

/**
 * Toggle YAML properties collapsed state
 */
window.toggleYamlCollapse = function() {
    const content = document.querySelector('.yaml-content');
    const icon = document.querySelector('.yaml-header i:first-child');
    
    if (content && icon) {
        const isCollapsed = content.classList.toggle('collapsed');
        icon.className = `fa-solid fa-chevron-${isCollapsed ? 'right' : 'down'}`;
        localStorage.setItem('yamlCollapsed', isCollapsed);
    }
};

/**
 * Toggle between plugin rendered view and markdown source
 */
window.togglePluginView = async function() {
    if (!currentPath || !conn) return;
    
    try {
        const response = await conn.send('OPEN_FILE', { path: currentPath });
        
        // Extract the data
        const data = response.data || response;
        
        // Check for plugin-rendered HTML first
        if (data.renderedHTML && data.renderedHTML.length > 0) {
            console.log('🎨 ========== WEB UI RECEIVED DATA ==========');
            console.log('📏 renderedHTML length:', data.renderedHTML.length);
            console.log('📝 renderedHTML preview (first 1000 chars):', data.renderedHTML.substring(0, 1000));
            console.log('🎨 pluginCSS exists:', !!data.pluginCSS);
            console.log('🎨 pluginCSS length:', data.pluginCSS?.length || 0);
            if (data.pluginCSS) {
                console.log('🎨 pluginCSS preview (first 2000 chars):', data.pluginCSS.substring(0, 2000));
                console.log('🎨 CSS rule count:', (data.pluginCSS.match(/\{/g) || []).length);
            }
            console.log('🎨 ========== END RECEIVED DATA ==========');
            
            const preview = document.getElementById('custom-preview');
            if (preview) {
                // Get plugin name for attribution
                let pluginName = 'Obsidian Plugin';
                if (data.viewType === 'kanban') {
                    pluginName = 'Kanban Plugin by mgmeyers';
                }
                
                preview.innerHTML = `
                    <div style="padding: 0px;">
                        <div style="background: var(--background-secondary); padding: 8px 12px; border-radius: 6px; margin-bottom: 8px;">
                            <strong>${pluginName}</strong>
                            <span style="float: right; color: var(--text-muted);">Read-only view</span>
                        </div>
                        ${data.renderedHTML}
                    </div>
                `;
                
                // Inject plugin CSS if provided
                if (data.pluginCSS) {
                    console.log('💉 Injecting plugin CSS into DOM...');
                    let pluginStyleTag = document.getElementById('plugin-styles');
                    if (!pluginStyleTag) {
                        pluginStyleTag = document.createElement('style');
                        pluginStyleTag.id = 'plugin-styles';
                        document.head.appendChild(pluginStyleTag);
                        console.log('✅ Created new <style id="plugin-styles"> tag');
                    } else {
                        console.log('♻️ Reusing existing <style id="plugin-styles"> tag');
                    }
                    
                    // Add fallback CSS for Kanban horizontal board styling
                    const kanbanFallbackCSS = `
/* Kanban Horizontal Board Fallback Styles */
.kanban-plugin__item-wrapper {
    padding: 4px !important;
}

.kanban-plugin__item {
    background-color: var(--background-primary, #ffffff) !important;
    border: 1px solid var(--background-modifier-border, #e0e0e0) !important;
    border-radius: var(--radius-m, 5px) !important;
    padding: 8px !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
    margin-bottom: 4px !important;
}

.kanban-plugin__item:hover {
    border-color: var(--background-modifier-border-hover, #d0d0d0) !important;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15) !important;
}

.kanban-plugin__lane {
    background-color: var(--background-secondary, #f5f5f5) !important;
    border-radius: var(--radius-m, 5px) !important;
    padding: 8px !important;
}

.kanban-plugin__lane-header-wrapper {
    padding: 8px !important;
    border-bottom: 1px solid var(--background-modifier-border, #e0e0e0) !important;
    margin-bottom: 8px !important;
}

.kanban-plugin__lane-items {
    padding: 8px !important;
    gap: 8px !important;
}

/* Hide interactive elements (read-only view) */
.kanban-plugin__lane-grip,
.kanban-plugin__lane-action-wrapper,
.kanban-plugin__item-prefix-button,
.kanban-plugin__item-postfix-button,
.kanban-plugin__item-metadata-wrapper .clickable-icon,
.kanban-plugin__grow-wrap button,
.kanban-plugin__item-button-wrapper,
.kanban-plugin__lane-setting-wrapper,
.kanban-plugin__item-grip,
.kanban-plugin__lane-collapse,
.kanban-plugin__lane-settings,
.kanban-plugin__lane-settings-button-wrapper,
.kanban-plugin__lane-settings-button {
    display: none !important;
}

/* Disable drag and drop interactions */
.kanban-plugin__item,
.kanban-plugin__lane {
    cursor: default !important;
}
`;
                    
                    pluginStyleTag.textContent = data.pluginCSS + '\n' + kanbanFallbackCSS;
                    console.log('✅ CSS injected with fallback styles');
                    console.log('📏 Total CSS length:', pluginStyleTag.textContent.length);
                }
                
                // Switch to preview mode if in edit mode
                const editorContainer = document.querySelector('.EasyMDEContainer');
                if (editorContainer && editorContainer.style.display !== 'none') {
                    await toggleViewMode();
                }
                
                // Apply theme to the new content
                setTimeout(() => applyThemeToElements(), 100);
            }
            return;
        }
        
        // Fallback: Check for markdown HTML
        if (data.html && data.html.length > 0) {
            
            const preview = document.getElementById('custom-preview');
            if (preview) {
                let pluginType = 'Unknown';
                if (data.yaml) {
                    if (data.yaml['kanban-plugin']) pluginType = 'Kanban Board (Markdown Structure)';
                    else if (data.yaml['dataview']) pluginType = 'Dataview';
                    else if (data.yaml['excalidraw-plugin']) pluginType = 'Excalidraw';
                }
                
                preview.innerHTML = `
                    <div style="padding: 20px;">
                        <div style="background: var(--background-secondary); padding: 10px; border-radius: 6px; margin-bottom: 16px;">
                            <strong>${pluginType}</strong>
                            <span style="float: right; color: var(--text-muted);">Read-only structure</span>
                        </div>
                        ${data.html}
                    </div>
                `;
                
                // Switch to preview mode if in edit mode
                const editorContainer = document.querySelector('.EasyMDEContainer');
                if (editorContainer && editorContainer.style.display !== 'none') {
                    await toggleViewMode();
                }
                
                // Apply theme to the new content
                setTimeout(() => applyThemeToElements(), 100);
            }
            return;
        }
        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--background-secondary);
            color: var(--text-normal);
            padding: 12px 16px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 10000;
            border: 1px solid var(--background-modifier-border);
        `;
        message.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Could not render view';
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 3000);
        
    } catch (error) {
        console.error('Failed to get plugin view:', error);
        alert('Could not capture plugin view from Obsidian: ' + error.message);
    }
};

/**
 * Update YAML property value
 */
window.updateYamlProperty = async function(key, value) {
    if (!currentYamlData || !currentPath) return;
    
    currentYamlData[key] = value;
    await saveYamlToFile();
};

/**
 * Handle array input (tags, aliases, etc.)
 */
window.handleYamlArrayInput = function(event, key) {
    if (event.key === 'Enter' && event.target.value.trim()) {
        event.preventDefault();
        const value = event.target.value.trim();
        addYamlArrayItem(key, value);
        event.target.value = '';
        window.hideTagDropdown();
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const dropdown = document.querySelector('.yaml-tag-dropdown');
        if (dropdown) {
            const firstItem = dropdown.querySelector('.yaml-tag-suggestion');
            if (firstItem) firstItem.focus();
        }
    } else if (event.key === 'Escape') {
        window.hideTagDropdown();
    }
};

/**
 * Show tag dropdown with suggestions
 */
window.showTagDropdown = function(input, key) {
    // Get all existing tags from tagTree
    const allTags = [];
    
    // tagTree structure: { _sub: { 'tagname': { ... } } } or { 'tagname': { ... } }
    if (tagTree && typeof tagTree === 'object') {
        // Try _sub first (nested structure for tags)
        if (tagTree._sub && typeof tagTree._sub === 'object') {
            Object.keys(tagTree._sub).forEach(tag => {
                const cleanTag = tag.replace(/^#/, '');
                if (cleanTag) allTags.push(cleanTag);
            });
        } else if (tagTree._children && typeof tagTree._children === 'object') {
            Object.keys(tagTree._children).forEach(tag => {
                const cleanTag = tag.replace(/^#/, '');
                if (cleanTag) allTags.push(cleanTag);
            });
        } else {
            // Fallback: iterate top-level keys (flat structure)
            Object.keys(tagTree).forEach(tag => {
                if (!tag.startsWith('_')) { // Skip internal properties
                    const cleanTag = tag.replace(/^#/, '');
                    if (cleanTag) allTags.push(cleanTag);
                }
            });
        }
    }
    
    if (allTags.length === 0) return;
    
    // Get already used tags in this note
    const usedTags = currentYamlData && currentYamlData[key] ? currentYamlData[key] : [];
    
    // Filter out already used tags
    const availableTags = allTags.filter(tag => !usedTags.includes(tag));
    
    if (availableTags.length === 0) return;
    
    displayTagDropdown(input, availableTags, key);
};

/**
 * Filter tag dropdown based on input
 */
window.filterTagDropdown = function(input, key) {
    const searchTerm = input.value.toLowerCase();
    
    // Get all existing tags from tagTree
    const allTags = [];
    
    if (tagTree && typeof tagTree === 'object') {
        if (tagTree._sub && typeof tagTree._sub === 'object') {
            Object.keys(tagTree._sub).forEach(tag => {
                const cleanTag = tag.replace(/^#/, '');
                if (cleanTag) allTags.push(cleanTag);
            });
        } else if (tagTree._children && typeof tagTree._children === 'object') {
            Object.keys(tagTree._children).forEach(tag => {
                const cleanTag = tag.replace(/^#/, '');
                if (cleanTag) allTags.push(cleanTag);
            });
        } else {
            Object.keys(tagTree).forEach(tag => {
                if (!tag.startsWith('_')) {
                    const cleanTag = tag.replace(/^#/, '');
                    if (cleanTag) allTags.push(cleanTag);
                }
            });
        }
    }
    
    if (allTags.length === 0) return;
    
    // Get already used tags in this note
    const usedTags = currentYamlData && currentYamlData[key] ? currentYamlData[key] : [];
    
    // Filter available tags based on search and exclude used ones
    const filteredTags = allTags.filter(tag => 
        !usedTags.includes(tag) && 
        tag.toLowerCase().includes(searchTerm)
    );
    
    if (filteredTags.length === 0) {
        window.hideTagDropdown();
        return;
    }
    
    displayTagDropdown(input, filteredTags, key);
};

/**
 * Display tag dropdown
 */
function displayTagDropdown(input, tags, key) {
    // Remove existing dropdown
    const existing = document.querySelector('.yaml-tag-dropdown');
    if (existing) existing.remove();
    
    const rect = input.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'yaml-tag-dropdown';
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 2) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.minWidth = rect.width + 'px';
    
    // Limit to 8 suggestions
    const displayTags = tags.slice(0, 8);
    
    dropdown.innerHTML = displayTags.map(tag => `
        <div class="yaml-tag-suggestion" 
             tabindex="0"
             onmousedown="window.selectTag('${tag}', '${key}')"
             onkeydown="if(event.key==='Enter') window.selectTag('${tag}', '${key}')">
            <i class="fa-solid fa-tag"></i> ${tag}
        </div>
    `).join('');
    
    document.body.appendChild(dropdown);
    
    // Apply theme to the newly created dropdown
    setTimeout(() => applyThemeToElements(), 10);
}

/**
 * Select tag from dropdown
 */
window.selectTag = async function(tag, key) {
    await addYamlArrayItem(key, tag);
    
    // Clear input and refocus
    const input = document.querySelector('.yaml-tag-input');
    if (input) {
        input.value = '';
        setTimeout(() => {
            input.focus();
            window.showTagDropdown(input, key);
        }, 100);
    }
};

/**
 * Hide tag dropdown
 */
window.hideTagDropdown = function() {
    setTimeout(() => {
        const dropdown = document.querySelector('.yaml-tag-dropdown');
        if (dropdown) dropdown.remove();
    }, 200); // Delay to allow click events to fire
};

/**
 * Add item to YAML array
 */
async function addYamlArrayItem(key, item) {
    if (!currentYamlData) currentYamlData = {};
    if (!currentYamlData[key]) currentYamlData[key] = [];
    
    // Filter out duplicates (case-sensitive comparison)
    const itemTrimmed = item.trim();
    if (currentYamlData[key].includes(itemTrimmed)) {
        console.log(`Tag "${itemTrimmed}" already exists, skipping`);
        return;
    }
    
    currentYamlData[key].push(itemTrimmed);
    await saveYamlToFile();
    renderYamlProperties(currentYamlData, currentPath);
}

/**
 * Remove item from YAML array
 */
window.removeYamlArrayItem = async function(key, item) {
    if (!currentYamlData || !currentYamlData[key]) return;
    
    currentYamlData[key] = currentYamlData[key].filter(v => v !== item);
    if (currentYamlData[key].length === 0) {
        delete currentYamlData[key];
    }
    
    await saveYamlToFile();
    renderYamlProperties(currentYamlData, currentPath);
};

/**
 * Add new YAML property
 */
window.addYamlProperty = function(event) {
    const button = event.target.closest('button');
    if (!button) return;
    
    // Common Obsidian properties
    const commonProperties = [
        'tags', 'aliases', 'cssclass', 'cssclasses',
        'date', 'created', 'modified', 'due',
        'author', 'title', 'description', 'summary',
        'category', 'type', 'status', 'priority',
        'publish', 'draft', 'featured',
        'image', 'banner', 'cover',
        'link', 'url', 'source'
    ];
    
    // Filter out properties that already exist
    const existingProps = currentYamlData ? Object.keys(currentYamlData) : [];
    const availableProps = commonProperties.filter(prop => !existingProps.includes(prop));
    
    if (availableProps.length === 0 && existingProps.length > 0) {
        // If no common properties left, still show dropdown for custom entry
        availableProps.push('+ Custom property...');
    }
    
    // Show dropdown
    showPropertyDropdown(button, availableProps);
};

/**
 * Show property dropdown for selection
 */
function showPropertyDropdown(button, properties) {
    // Remove existing dropdown
    const existing = document.querySelector('.yaml-property-dropdown');
    if (existing) existing.remove();
    
    const rect = button.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'yaml-property-dropdown';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    
    // Add search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'yaml-property-search';
    searchInput.placeholder = 'Type to filter or add custom...';
    dropdown.appendChild(searchInput);
    
    // Add suggestions container
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'yaml-property-suggestions';
    dropdown.appendChild(suggestionsDiv);
    
    // Display initial properties
    displayPropertySuggestions(suggestionsDiv, properties);
    
    // Handle search input
    searchInput.addEventListener('input', (e) => {
        const value = e.target.value.toLowerCase();
        if (value) {
            const filtered = properties.filter(prop => 
                prop.toLowerCase().includes(value) && prop !== '+ Custom property...'
            );
            // Always show custom option when typing
            if (!filtered.includes(value)) {
                filtered.push(`+ Add "${e.target.value}"`);
            }
            displayPropertySuggestions(suggestionsDiv, filtered, e.target.value);
        } else {
            displayPropertySuggestions(suggestionsDiv, properties);
        }
    });
    
    // Handle keyboard
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdown.remove();
        } else if (e.key === 'Enter') {
            const firstSuggestion = suggestionsDiv.querySelector('.yaml-property-suggestion');
            if (firstSuggestion) {
                firstSuggestion.click();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const firstSuggestion = suggestionsDiv.querySelector('.yaml-property-suggestion');
            if (firstSuggestion) firstSuggestion.focus();
        }
    });
    
    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!dropdown.contains(e.target) && e.target !== button) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 100);
    
    document.body.appendChild(dropdown);
    searchInput.focus();
    
    // Apply theme to the newly created dropdown
    setTimeout(() => applyThemeToElements(), 10);
}

/**
 * Display property suggestions in dropdown
 */
function displayPropertySuggestions(container, properties, customValue = null) {
    container.innerHTML = properties.map(prop => {
        // Handle custom property addition
        if (prop.startsWith('+ Add "')) {
            const propName = customValue;
            return `
                <div class="yaml-property-suggestion" 
                     tabindex="0"
                     onmousedown="window.selectProperty('${propName}')"
                     onkeydown="if(event.key==='Enter') window.selectProperty('${propName}')">
                    <i class="fa-solid fa-plus"></i> Add "${propName}"
                </div>
            `;
        } else if (prop === '+ Custom property...') {
            return `
                <div class="yaml-property-suggestion yaml-custom" 
                     tabindex="0">
                    <i class="fa-solid fa-keyboard"></i> <em>Type to add custom property</em>
                </div>
            `;
        } else {
            // Regular property
            const icon = getPropertyIcon(prop);
            return `
                <div class="yaml-property-suggestion" 
                     tabindex="0"
                     onmousedown="window.selectProperty('${prop}')"
                     onkeydown="if(event.key==='Enter') window.selectProperty('${prop}')">
                    <i class="fa-solid fa-${icon}"></i> ${prop}
                </div>
            `;
        }
    }).join('');
}

/**
 * Get icon for property type
 */
function getPropertyIcon(prop) {
    if (prop === 'tags') return 'tag';
    if (prop === 'aliases') return 'clone';
    if (['date', 'created', 'modified', 'due'].includes(prop)) return 'calendar';
    if (['author', 'title', 'description', 'summary'].includes(prop)) return 'file-lines';
    if (['category', 'type', 'status'].includes(prop)) return 'folder';
    if (['image', 'banner', 'cover'].includes(prop)) return 'image';
    if (['link', 'url', 'source'].includes(prop)) return 'link';
    if (['publish', 'draft', 'featured'].includes(prop)) return 'eye';
    if (prop === 'priority') return 'star';
    if (['cssclass', 'cssclasses'].includes(prop)) return 'paintbrush';
    return 'circle';
}

/**
 * Select property from dropdown
 */
window.selectProperty = async function(propName) {
    // Remove dropdown
    const dropdown = document.querySelector('.yaml-property-dropdown');
    if (dropdown) dropdown.remove();
    
    // Sanitize property name
    const sanitizedKey = propName.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitizedKey) {
        alert('Invalid property name. Use only letters, numbers, hyphens, and underscores.');
        return;
    }
    
    if (!currentYamlData) currentYamlData = {};
    if (currentYamlData[sanitizedKey] !== undefined) {
        alert('Property already exists.');
        return;
    }
    
    // Set default value based on property type (known properties)
    if (sanitizedKey === 'tags' || sanitizedKey === 'aliases' || sanitizedKey === 'cssclasses') {
        currentYamlData[sanitizedKey] = [];
        await saveYamlToFile();
        renderYamlProperties(currentYamlData, currentPath);
    } else if (['date', 'created', 'modified', 'due'].includes(sanitizedKey)) {
        currentYamlData[sanitizedKey] = new Date().toISOString().split('T')[0];
        await saveYamlToFile();
        renderYamlProperties(currentYamlData, currentPath);
    } else if (['publish', 'draft', 'featured'].includes(sanitizedKey)) {
        currentYamlData[sanitizedKey] = false;
        await saveYamlToFile();
        renderYamlProperties(currentYamlData, currentPath);
    } else {
        // For unknown properties, show type selector
        showPropertyTypeSelector(sanitizedKey);
    }
};

/**
 * Show property type selector for new custom properties
 */
function showPropertyTypeSelector(propName) {
    const container = document.getElementById('yaml-properties-container');
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'yaml-type-selector';
    dropdown.style.top = `${rect.top + 100}px`;
    dropdown.style.left = `${rect.left + rect.width / 2 - 150}px`;
    
    dropdown.innerHTML = `
        <div class="yaml-type-header">
            Choose type for "${propName}"
        </div>
        <div class="yaml-type-option" onclick="window.createPropertyWithType('${propName}', 'text')">
            <i class="fa-solid fa-font"></i>
            <div>
                <strong>Text</strong>
                <span>Single line text</span>
            </div>
        </div>
        <div class="yaml-type-option" onclick="window.createPropertyWithType('${propName}', 'number')">
            <i class="fa-solid fa-hashtag"></i>
            <div>
                <strong>Number</strong>
                <span>Numeric value</span>
            </div>
        </div>
        <div class="yaml-type-option" onclick="window.createPropertyWithType('${propName}', 'checkbox')">
            <i class="fa-solid fa-check-square"></i>
            <div>
                <strong>Checkbox</strong>
                <span>True/false toggle</span>
            </div>
        </div>
        <div class="yaml-type-option" onclick="window.createPropertyWithType('${propName}', 'date')">
            <i class="fa-solid fa-calendar"></i>
            <div>
                <strong>Date</strong>
                <span>Date picker</span>
            </div>
        </div>
        <div class="yaml-type-option" onclick="window.createPropertyWithType('${propName}', 'list')">
            <i class="fa-solid fa-list"></i>
            <div>
                <strong>List</strong>
                <span>Array of items</span>
            </div>
        </div>
        <div class="yaml-type-option" onclick="window.createPropertyWithType('${propName}', 'multiline')">
            <i class="fa-solid fa-align-left"></i>
            <div>
                <strong>Multiline Text</strong>
                <span>Long text area</span>
            </div>
        </div>
        <div class="yaml-type-option" onclick="window.createPropertyWithType('${propName}', 'link')">
            <i class="fa-solid fa-link"></i>
            <div>
                <strong>Link</strong>
                <span>Internal wiki-link</span>
            </div>
        </div>
    `;
    
    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function closeSelector(e) {
            if (!dropdown.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeSelector);
            }
        });
    }, 100);
    
    document.body.appendChild(dropdown);
    
    // Apply theme to the newly created dropdown
    setTimeout(() => applyThemeToElements(), 10);
}

/**
 * Create property with specified type
 */
window.createPropertyWithType = async function(propName, type) {
    // Remove type selector
    const selector = document.querySelector('.yaml-type-selector');
    if (selector) selector.remove();
    
    if (!currentYamlData) currentYamlData = {};
    
    // Set default value based on selected type
    switch (type) {
        case 'text':
            currentYamlData[propName] = '';
            break;
        case 'number':
            currentYamlData[propName] = 0;
            break;
        case 'checkbox':
            currentYamlData[propName] = false;
            break;
        case 'date':
            currentYamlData[propName] = new Date().toISOString().split('T')[0];
            break;
        case 'list':
            currentYamlData[propName] = [];
            break;
        case 'multiline':
            currentYamlData[propName] = '';
            break;
        case 'link':
            currentYamlData[propName] = '';
            break;
        default:
            currentYamlData[propName] = '';
    }
    
    await saveYamlToFile();
    renderYamlProperties(currentYamlData, currentPath);
    
    // Auto-focus the new property input
    setTimeout(() => {
        const newProp = document.querySelector(`.yaml-property[data-key="${propName}"] input, .yaml-property[data-key="${propName}"] textarea`);
        if (newProp) newProp.focus();
    }, 100);
};

/**
 * Delete YAML property
 */
window.deleteYamlProperty = async function(key) {
    if (!currentYamlData || !key) return;
    
    if (!confirm(`Delete property "${key}"?`)) return;
    
    delete currentYamlData[key];
    await saveYamlToFile();
    renderYamlProperties(currentYamlData, currentPath);
};

/**
 * Edit link property - convert to input
 */
window.editYamlLink = function(key, button) {
    const property = button.closest('.yaml-property');
    const valueDiv = property.querySelector('.yaml-value');
    const currentValue = currentYamlData[key] || '';
    
    valueDiv.innerHTML = `
        <input type="text" 
               class="yaml-link-edit"
               value="${currentValue.replace(/"/g, '&quot;')}" 
               onfocus="window.checkForLinkAutocomplete(this, '${key}')"
               oninput="window.filterLinkAutocomplete(this, '${key}')"
               onblur="window.hideLinkAutocomplete(); window.saveLinkEdit('${key}', this.value)"
               onkeydown="if(event.key==='Enter') this.blur()">
    `;
    
    const input = valueDiv.querySelector('input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
};

/**
 * Save link edit
 */
window.saveLinkEdit = async function(key, value) {
    await window.updateYamlProperty(key, value);
    // Re-render to show as link again
    renderYamlProperties(currentYamlData, currentPath);
};

/**
 * Check if input should show link autocomplete
 */
window.checkForLinkAutocomplete = function(input, key) {
    const value = input.value;
    if (value.includes('[[') && !value.endsWith(']]')) {
        window.showLinkAutocomplete(input, key);
    }
};

/**
 * Show link autocomplete dropdown
 */
window.showLinkAutocomplete = function(input, key) {
    // Remove existing dropdown
    const existing = document.querySelector('.yaml-link-dropdown');
    if (existing) existing.remove();
    
    // Get all file paths from masterFileList
    const allFiles = masterFileList.map(file => {
        const path = file.path || file;
        return path.replace('.md', '').split('/').pop(); // Get filename without extension
    }).filter(Boolean).sort();
    
    if (allFiles.length === 0) return;
    
    const rect = input.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'yaml-link-dropdown';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.minWidth = `${rect.width}px`;
    
    // Get current input after [[
    const value = input.value;
    const linkStart = value.lastIndexOf('[[');
    const searchTerm = linkStart >= 0 ? value.substring(linkStart + 2).toLowerCase() : '';
    
    // Filter files based on search
    const filtered = searchTerm 
        ? allFiles.filter(file => file.toLowerCase().includes(searchTerm))
        : allFiles.slice(0, 50); // Show first 50 if no search
    
    displayLinkSuggestions(dropdown, filtered, input, key);
    document.body.appendChild(dropdown);
    
    // Apply theme to the newly created dropdown
    setTimeout(() => applyThemeToElements(), 10);
};

/**
 * Filter link autocomplete as user types
 */
window.filterLinkAutocomplete = function(input, key) {
    const value = input.value;
    
    // Check if we're typing a wikilink
    if (value.includes('[[')) {
        const dropdown = document.querySelector('.yaml-link-dropdown');
        if (!dropdown) {
            window.showLinkAutocomplete(input, key);
        } else {
            // Update dropdown content
            const allFiles = masterFileList.map(file => {
                const path = file.path || file;
                return path.replace('.md', '').split('/').pop();
            }).filter(Boolean).sort();
            
            const linkStart = value.lastIndexOf('[[');
            const searchTerm = linkStart >= 0 ? value.substring(linkStart + 2).toLowerCase() : '';
            const filtered = searchTerm
                ? allFiles.filter(file => file.toLowerCase().includes(searchTerm))
                : allFiles.slice(0, 50);
            
            displayLinkSuggestions(dropdown, filtered, input, key);
        }
    } else {
        window.hideLinkAutocomplete();
    }
};

/**
 * Display link suggestions in dropdown
 */
function displayLinkSuggestions(container, files, input, key) {
    container.innerHTML = files.map(file => `
        <div class="yaml-link-suggestion" 
             tabindex="0"
             onmousedown="window.selectLink('${file}', '${key}')"
             onkeydown="if(event.key==='Enter') window.selectLink('${file}', '${key}')">
            <i class="fa-solid fa-file"></i> ${file}
        </div>
    `).join('');
    
    if (files.length === 0) {
        container.innerHTML = '<div class="yaml-link-suggestion yaml-custom"><em>No matches found</em></div>';
    }
}

/**
 * Select link from autocomplete
 */
window.selectLink = function(fileName, key) {
    const input = document.querySelector('.yaml-property[data-key="' + key + '"] input');
    if (!input) return;
    
    const value = input.value;
    const linkStart = value.lastIndexOf('[[');
    
    if (linkStart >= 0) {
        // Replace from [[ to end with [[filename]]
        const before = value.substring(0, linkStart);
        input.value = before + '[[' + fileName + ']]';
    } else {
        input.value = '[[' + fileName + ']]';
    }
    
    window.hideLinkAutocomplete();
    input.focus();
};

/**
 * Hide link autocomplete dropdown
 */
window.hideLinkAutocomplete = function() {
    setTimeout(() => {
        const dropdown = document.querySelector('.yaml-link-dropdown');
        if (dropdown) dropdown.remove();
    }, 200);
};

/**
 * Save YAML changes to file
 */
async function saveYamlToFile() {
    if (!currentPath) {
        console.error('❌ No currentPath set');
        return;
    }
    
    try {
        console.log('💾 Starting YAML save for:', currentPath);
        console.log('Current YAML data:', JSON.stringify(currentYamlData, null, 2));
        console.log('Current mode:', isReadingMode ? 'PREVIEW' : 'EDIT');
        
        // Set flag to prevent FILE handler from interfering
        window._yamlSaveInProgress = true;
        console.log('🚩 Set _yamlSaveInProgress flag');
        
        // Request the raw markdown
        console.log('📡 Requesting GET_FILE...');
        await conn.send('GET_FILE', { path: currentPath });
        
        // Wait for the file content (will be handled by FILE message handler)
        console.log('⏳ Waiting 200ms for file content...');
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Get the raw content from editor (FILE handler loads it there)
        const rawContent = easyMDE ? easyMDE.value() : '';
        console.log('📝 Raw content length:', rawContent.length);
        console.log('First 200 chars:', rawContent.substring(0, 200));
        
        if (!rawContent) {
            throw new Error('Could not fetch file content');
        }
        
        // Extract body content (without old YAML)
        let bodyContent = rawContent;
        const yamlMatch = rawContent.match(/^---\n[\s\S]*?\n---\n?/);
        if (yamlMatch) {
            console.log('✂️ Found YAML frontmatter, extracting body');
            console.log('YAML block:', yamlMatch[0].substring(0, 100));
            bodyContent = rawContent.slice(yamlMatch[0].length);
        } else {
            console.log('ℹ️ No existing YAML frontmatter found');
        }
        console.log('Body content length:', bodyContent.length);
        
        // Reconstruct file with new YAML
        let newContent = bodyContent;
        if (currentYamlData && Object.keys(currentYamlData).length > 0) {
            console.log('🔨 Reconstructing file with new YAML...');
            const yamlString = jsyaml.dump(currentYamlData, {
                indent: 2,
                lineWidth: -1,
                noRefs: true,
                sortKeys: false
            });
            console.log('Generated YAML:', yamlString);
            newContent = `---\n${yamlString}---\n${bodyContent}`;
        }
        console.log('New content length:', newContent.length);
        console.log('First 200 chars of new content:', newContent.substring(0, 200));
        
        // Update stored content
        contentWithoutYaml = bodyContent;
        
        // Save to file
        console.log('💾 Sending SAVE_FILE command...');
        await conn.send('SAVE_FILE', { path: currentPath, data: newContent });
        
        console.log('✅ YAML saved, refreshing preview...');
        
        // If in preview mode, refresh the rendered view
        if (isReadingMode) {
            console.log('📺 Preview mode: refreshing rendered view');
            // Small delay to ensure file is written
            await new Promise(resolve => setTimeout(resolve, 100));
            console.log('📡 Requesting GET_RENDERED_FILE...');
            await conn.send('GET_RENDERED_FILE', { path: currentPath });
        } else {
            console.log('✏️ Edit mode: updating editor with new content');
            // In edit mode, update the editor
            if (easyMDE) {
                const cursorPos = easyMDE.codemirror.getCursor();
                easyMDE.value(newContent);
                easyMDE.codemirror.setCursor(cursorPos);
            }
        }
        
        console.log('🎉 YAML save complete!');
        
    } catch (err) {
        console.error('❌ Failed to save YAML:', err);
        console.error('Error stack:', err.stack);
        alert('Failed to save properties: ' + err.message);
    } finally {
        // Clear the flag
        console.log('🏁 Clearing _yamlSaveInProgress flag');
        window._yamlSaveInProgress = false;
    }
}

/**
 * Render sidebar (folders or tags)
 */
function renderSidebar() {
    const container = document.getElementById('file-tree');
    container.innerHTML = '';
    
    const tree = currentView === 'folders' ? folderTree : tagTree;
    const iconSet = { folder: icons.folder, tag: icons.tag };
    
    const onNodeClick = (fullPath, files) => {
        if (currentView === 'folders') {
            selectedFolderPath = fullPath;
        }
        prepareNoteList(files);
    };
    
    renderNode(tree, container, 0, '', currentView, iconSet, onNodeClick);
    
    // Reapply theme to newly rendered elements
    setTimeout(() => applyThemeToElements(), 10);
}

/**
 * Prepare and render note list
 */
function prepareNoteList(files) {
    currentList = prepareList(files);
    renderedCount = 0;
    
    // Clear the container before rendering new list
    const container = document.getElementById('note-list');
    if (container) {
        container.innerHTML = '';
    }
    
    renderBatch();
}

/**
 * Render batch of notes (virtualized)
 */
function renderBatch() {
    const container = document.getElementById('note-list');
    const batchSize = 50;
    const end = Math.min(renderedCount + batchSize, currentList.length);
    
    for (let i = renderedCount; i < end; i++) {
        const file = currentList[i];
        const card = document.createElement('div');
        card.className = 'note-card file-tree-item';
        card.dataset.path = file.path;
        card.dataset.type = 'file';
        
        const title = document.createElement('div');
        title.className = 'note-title';
        title.textContent = file.path.split('/').pop().replace('.md', '');
        
        card.appendChild(title);
        card.addEventListener('click', () => loadFile(file.path));
        container.appendChild(card);
    }
    
    renderedCount = end;
}

/**
 * Navigate back to previous file
 */
window.navigateBack = function() {
    if (navigationHistory.length === 0) return;
    
    const previousPath = navigationHistory.pop();
    // Set flag to prevent adding current path back to history
    const tempHistory = [...navigationHistory];
    navigationHistory = [];
    loadFile(previousPath);
    navigationHistory = tempHistory;
};

/**
 * Load file into editor
 */
async function loadFile(path) {
    // Track navigation history
    if (currentPath && currentPath !== path) {
        navigationHistory.push(currentPath);
        // Limit history to 50 items
        if (navigationHistory.length > 50) {
            navigationHistory.shift();
        }
    }
    
    currentPath = path;
    const filenameEl = document.getElementById('filename');
    const filename = path.split('/').pop().replace('.md', '');
    
    // Add back button if history exists
    if (navigationHistory.length > 0) {
        filenameEl.innerHTML = `
            <button id="back-btn" onclick="window.navigateBack()" title="Go back">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            <span>${filename}</span>
        `;
    } else {
        filenameEl.innerHTML = `<span>${filename}</span>`;
    }
    
    // DEFAULT TO PREVIEW MODE
    isReadingMode = true;
    const btn = document.getElementById('view-btn');
    const preview = document.getElementById('custom-preview');
    const loading = document.getElementById('preview-loading');
    const editorEl = document.querySelector('.EasyMDEContainer');
    const saveBtn = document.getElementById('save-btn');
    
    if (btn) {
        btn.style.display = 'block';
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        btn.title = 'Switch to Edit Mode';
    }
    if (saveBtn) {
        saveBtn.style.display = 'none'; // Hidden in preview mode
        saveBtn.classList.add('hidden');
    }
    if (editorEl) editorEl.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    if (preview) preview.style.display = 'none';
    
    await conn.send('GET_RENDERED_FILE', { path });
}

/**
 * Render backlinks
 */
function renderBacklinks(links) {
    const container = document.getElementById('backlinks-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!links || links.length === 0) {
        container.innerHTML = '<div style="padding: 10px; color: var(--text-muted); font-style: italic;">No backlinks</div>';
        return;
    }
    
    // Sort backlinks alphabetically by filename
    const sortedLinks = [...links].sort((a, b) => {
        const nameA = a.split('/').pop().replace('.md', '').toLowerCase();
        const nameB = b.split('/').pop().replace('.md', '').toLowerCase();
        return nameA.localeCompare(nameB);
    });
    
    sortedLinks.forEach(link => {
        const item = document.createElement('a');
        item.className = 'backlink-item';
        item.textContent = link.split('/').pop().replace('.md', '');
        item.onclick = () => loadFile(link);
        container.appendChild(item);
    });
}

/**
 * Render local graph
 */
function renderLocalGraph(centerPath) {
    const container = document.getElementById('graph-canvas');
    if (!container || container.clientHeight === 0) return;

    console.log('🕸️ Rendering graph for:', centerPath);

    // Get current theme colors from Obsidian variables
    const style = getComputedStyle(document.body);
    const bg = style.getPropertyValue('--background-primary').trim() || '#ffffff';
    const text = style.getPropertyValue('--text-normal').trim() || '#333333';
    const textMuted = style.getPropertyValue('--text-muted').trim() || '#888888';
    const accent = style.getPropertyValue('--interactive-accent').trim() || '#7c4dff';
    const tagColor = style.getPropertyValue('--text-accent').trim() || '#e91e63';

    const centerNode = masterFileList.find(f => f.path === centerPath);
    if (!centerNode) { 
        container.innerHTML = '<div style="color:' + textMuted + '; text-align:center; padding-top:40px; font-style:italic;">No connections.</div>'; 
        return; 
    }

    const nodes = new Set();
    const links = [];
    nodes.add(centerPath);

    // Add outgoing links
    if (centerNode.links) {
        centerNode.links.forEach(target => {
            const tFile = masterFileList.find(f => f.path.endsWith(target) || f.path.endsWith(target + '.md'));
            if (tFile) {
                nodes.add(tFile.path);
                links.push({ source: centerPath, target: tFile.path });
            }
        });
    }

    // Add tags
    if (centerNode.tags) {
        centerNode.tags.forEach(tag => {
            nodes.add(tag);
            links.push({ source: centerPath, target: tag });
        });
    }

    // Add incoming links (backlinks)
    masterFileList.forEach(f => {
        if (f.links && f.links.some(l => centerPath.endsWith(l) || centerPath.endsWith(l + '.md'))) {
            nodes.add(f.path);
            links.push({ source: f.path, target: centerPath });
        }
    });

    const graphNodes = Array.from(nodes).map(id => ({ 
        id: id, 
        name: id.startsWith('#') ? id : id.split('/').pop().replace('.md', ''),
        val: id === centerPath ? 20 : 5,
        color: id === centerPath ? accent : (id.startsWith('#') ? tagColor : textMuted),
        isCenter: id === centerPath
    }));

    console.log('📊 Graph data:', graphNodes.length, 'nodes,', links.length, 'links');

    if (graphInstance && container.childElementCount > 0) {
        graphInstance.graphData({ nodes: graphNodes, links: links });
        graphInstance.width(container.clientWidth).height(container.clientHeight);
        graphInstance.backgroundColor(bg);
    } else {
        container.innerHTML = '';
        graphInstance = ForceGraph()(container)
            .width(container.clientWidth)
            .height(container.clientHeight)
            .graphData({ nodes: graphNodes, links: links })
            .backgroundColor(bg)
            .nodeColor('color')
            .nodeLabel('name')
            .nodeVal('val')
            .linkColor(() => textMuted)
            .linkWidth(1.5)
            .d3AlphaDecay(0.02)
            .d3VelocityDecay(0.3)
            .zoom(3.5)
            .nodeCanvasObject((node, ctx, globalScale) => {
                const label = node.name;
                const fontSize = 10 / globalScale;
                ctx.font = `${fontSize}px Sans-Serif`;
                
                // Draw node circle (4px radius for cleaner look)
                ctx.fillStyle = node.color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI, false);
                ctx.fill();
                
                // Always position label to the right with more spacing
                const labelWidth = ctx.measureText(label).width;
                const labelPadding = 4;
                const labelOffset = 8;
                const labelX = node.x + labelOffset;
                const labelY = node.y;
                
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                
                // Draw semi-transparent background behind label
                const bgX = labelX - labelPadding;
                ctx.fillStyle = bg + 'dd'; // Add alpha for transparency
                ctx.fillRect(
                    bgX, 
                    labelY - fontSize/2 - labelPadding/2, 
                    labelWidth + labelPadding * 2, 
                    fontSize + labelPadding
                );
                
                // Draw label text
                ctx.fillStyle = node.isCenter ? accent : text;
                ctx.fillText(label, labelX, labelY);
            })
            .onNodeClick(node => { 
                if (node.id.startsWith('#')) {
                    filterByTag(node.id);
                } else {
                    loadFile(node.id);
                }
            });
    }
}

/**
 * Initialize sidebar resize
 */
function initSidebarResize() {
    const handle = document.getElementById('sidebar-resize');
    const sidebar = document.getElementById('sidebar');
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        sidebar.style.width = savedWidth + 'px';
    }
    
    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        handle.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const delta = e.clientX - startX;
        const newWidth = Math.max(200, Math.min(500, startWidth + delta));
        sidebar.style.width = newWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('resizing');
            document.body.style.cursor = '';
            localStorage.setItem('sidebarWidth', sidebar.offsetWidth);
        }
    });
}

/**
 * Show context menu
 */
function showContextMenu(x, y, target, actions) {
    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    ctxTarget = target;
}

/**
 * Apply panel state
 */
function applyPanelState() {
    const graphCont = document.getElementById('local-graph-container');
    const blCont = document.getElementById('backlinks-container');
    const mainPanel = document.getElementById('context-panel');
    const graphCanvas = document.getElementById('graph-canvas');
    const blList = document.getElementById('backlinks-list');
    
    if (graphCanvas) graphCanvas.style.display = panelState.graph ? 'block' : 'none';
    if (blList) blList.style.display = panelState.backlinks ? 'block' : 'none';
    
    const iconGraph = document.getElementById('icon-graph');
    const iconBacklinks = document.getElementById('icon-backlinks');
    if (iconGraph) iconGraph.className = panelState.graph ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
    if (iconBacklinks) iconBacklinks.className = panelState.backlinks ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
    
    if (graphCont) graphCont.style.flex = panelState.graph ? '1' : '0 0 auto';
    if (blCont) blCont.style.flex = panelState.backlinks ? '1' : '0 0 auto';
    
    if (mainPanel) {
        if (!panelState.graph && !panelState.backlinks) {
            mainPanel.style.height = '35px';
        } else {
            mainPanel.style.height = '300px';
            if (panelState.graph && graphInstance) {
                setTimeout(() => renderLocalGraph(currentPath), 300);
            }
        }
    }
}

/**
 * Update icons based on theme/mode
 */
function updateIcons() {
    const isLight = document.body.classList.contains('light-mode');
    const isFocus = document.getElementById('app-container')?.classList.contains('focus-mode');
    const themeBtn = document.getElementById('theme-btn');
    const focusBtn = document.getElementById('focus-btn');
    
    if (themeBtn) {
        themeBtn.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
    }
    if (focusBtn) {
        focusBtn.innerHTML = isFocus ? '<i class="fa-solid fa-minimize"></i>' : '<i class="fa-solid fa-maximize"></i>';
        focusBtn.classList.toggle('active', isFocus);
    }
}

/**
 * Toggle view mode (reading/editing)
 */
async function toggleViewMode() {
    isReadingMode = !isReadingMode;
    const btn = document.getElementById('view-btn');
    const preview = document.getElementById('custom-preview');
    const loading = document.getElementById('preview-loading');
    const editorEl = document.querySelector('.EasyMDEContainer');
    const saveBtn = document.getElementById('save-btn');
    
    console.log('🔄 Toggle view mode:', isReadingMode ? 'READ' : 'EDIT');
    
    if (isReadingMode) {
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        btn.title = 'Switch to Edit Mode';
        if (saveBtn) {
            saveBtn.classList.add('hidden');
            saveBtn.style.display = 'none';
        }
        
        editorEl.style.display = 'none';
        loading.style.display = 'flex';
        preview.style.display = 'none';
        
        await conn.send('GET_RENDERED_FILE', { path: currentPath });
    } else {
        btn.innerHTML = '<i class="fa-regular fa-eye"></i>';
        btn.title = 'Switch to Preview Mode';
        if (saveBtn) {
            saveBtn.classList.remove('hidden');
            saveBtn.style.display = 'block';
        }
        
        preview.style.display = 'none';
        loading.style.display = 'none';
        editorEl.style.display = 'flex';
        
        await conn.send('GET_FILE', { path: currentPath });
        if (easyMDE) easyMDE.codemirror.refresh();
    }
}

/**
 * Toggle focus mode
 */
function toggleFocus() {
    document.getElementById('app-container').classList.toggle('focus-mode');
    updateIcons();
    if (graphInstance && panelState.graph) {
        setTimeout(() => renderLocalGraph(currentPath), 300);
    }
}

/**
 * Toggle panel (graph/backlinks)
 */
function togglePanel(panel) {
    panelState[panel] = !panelState[panel];
    localStorage.setItem('panelState', JSON.stringify(panelState));
    applyPanelState();
}

/**
 * Save current file
 */
async function saveFile() {
    if (!currentPath) return;
    const content = getEditorContent();
    await conn.send('SAVE_FILE', { path: currentPath, data: content });
    log('File saved!');
}

/**
 * Switch tab (folders/tags)
 */
function switchTab(tab) {
    currentView = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    renderSidebar();
}

/**
 * Refresh vault tree
 */
async function refreshTree() {
    await conn.send('GET_TREE');
    setTimeout(() => {
        switchTab('folders');
        selectedFolderPath = '';
        const rootFiles = masterFileList.filter(f => !f.path.includes('/'));
        prepareNoteList(rootFiles.length > 0 ? rootFiles : masterFileList);
    }, 200);
}

/**
 * Search/filter notes
 */
function doSearch(e) {
    const val = e.target.value.toLowerCase();
    const header = document.querySelector('#pane-notes .pane-header');
    
    if (!val) {
        prepareNoteList(masterFileList.filter(f => !f.path.includes('/')));
        if (header) header.innerText = 'NOTES';
    } else {
        const results = masterFileList.filter(f => 
            f.path.toLowerCase().includes(val) || 
            (f.tags && f.tags.some(t => t.toLowerCase().includes(val)))
        );
        prepareNoteList(results);
        if (header) header.innerText = `RESULTS: ${results.length}`;
    }
}

/**
 * Create new note
 */
async function createNote() {
    let parentDir = '';
    
    if (selectedFolderPath) {
        parentDir = selectedFolderPath;
    } else if (currentPath && currentPath.includes('/')) {
        parentDir = currentPath.substring(0, currentPath.lastIndexOf('/')) + '/';
    }
    
    const name = prompt(`New Note in ${parentDir || 'Root'}:`, 'Untitled');
    
    if (name) {
        const cleanName = name.replace(/\.md$/, '');
        const fullPath = parentDir + cleanName + '.md';
        
        await conn.send('CREATE_FILE', { path: fullPath });
        await conn.send('GET_TREE');
        await loadFile(fullPath);
        
        if (isReadingMode) await toggleViewMode();
    }
}

/**
 * Create new folder
 */
async function createFolder() {
    let parentDir = '';
    
    if (selectedFolderPath) {
        parentDir = selectedFolderPath;
    } else if (currentPath && currentPath.includes('/')) {
        parentDir = currentPath.substring(0, currentPath.lastIndexOf('/')) + '/';
    }
    
    const name = prompt(`New Folder in ${parentDir || 'Root'}:`, 'New Folder');
    
    if (name) {
        const fullPath = parentDir + name;
        await conn.send('CREATE_FOLDER', { path: fullPath });
        await conn.send('GET_TREE');
    }
}

/**
 * Collapse all tree nodes
 */
function collapseAll() {
    document.querySelectorAll('.tree-children.open').forEach(el => {
        el.classList.remove('open');
    });
    document.querySelectorAll('.caret').forEach(caret => {
        caret.innerHTML = '▶';
    });
}

/**
 * Sort files
 */
function sortFiles() {
    alert('Sort functionality coming in V2 update.');
}

/**
 * Open daily note
 */
async function openDailyNote() {
    if (!conn) {
        alert('Not connected to vault.');
        return;
    }
    
    try {
        console.log('📅 Sending OPEN_DAILY_NOTE command...');
        const response = await conn.send('OPEN_DAILY_NOTE', {});
        console.log('📅 Response received:', response);
        
        // Response structure is {type, data, meta} from HTTP callback
        const data = response.data || response;
        
        if (data.success && data.path) {
            console.log('📅 Loading file:', data.path);
            
            // Clear welcome screen before loading
            const preview = document.getElementById('custom-preview');
            if (preview) preview.innerHTML = '';
            
            await loadFile(data.path);
            console.log('📅 File loaded successfully');
        } else if (data.message) {
            alert(data.message);
        } else {
            console.error('📅 Unexpected response format:', response);
        }
    } catch (error) {
        console.error('Failed to open daily note:', error);
        alert('Failed to open daily note. Make sure the Daily Notes plugin is enabled in Obsidian.');
    }
}

/**
 * Open graph view
 */
function openGraph() {
    if (!panelState.graph) togglePanel('graph');
    alert('Full Graph View coming in V2. Local Graph is available in the right panel.');
}

/**
 * Open settings
 */
function openSettings() {
    alert('Settings coming in V2.');
}

/**
 * Context menu actions
 */
async function ctxOpen() {
    hideContextMenu();
    if (ctxTarget && ctxTarget.length > 0 && ctxTargetType === 'file') {
        await loadFile(ctxTarget);
    }
}

async function ctxNewNote() {
    hideContextMenu();
    
    let parentDir = '';
    if (ctxTarget) {
        if (ctxTarget.endsWith('/')) {
            parentDir = ctxTarget;
        } else if (ctxTarget.endsWith('.md')) {
            parentDir = ctxTarget.substring(0, ctxTarget.lastIndexOf('/')) + '/';
        }
    }
    if (parentDir === '/') parentDir = '';
    
    const name = prompt(`New Note in ${parentDir || 'Root'}:`, 'Untitled');
    if (name) {
        const cleanName = name.replace(/\.md$/, '');
        const fullPath = parentDir + cleanName + '.md';
        
        await conn.send('CREATE_FILE', { path: fullPath });
        await conn.send('GET_TREE');
        await loadFile(fullPath);
    }
}

async function ctxNewFolder() {
    hideContextMenu();
    
    let parentDir = '';
    if (ctxTarget) {
        if (ctxTarget.endsWith('/')) {
            parentDir = ctxTarget;
        } else if (ctxTarget.endsWith('.md')) {
            parentDir = ctxTarget.substring(0, ctxTarget.lastIndexOf('/')) + '/';
        }
    }
    if (parentDir === '/') parentDir = '';
    
    const name = prompt(`New Folder in ${parentDir || 'Root'}:`, 'New Folder');
    if (name) {
        const fullPath = parentDir + name;
        await conn.send('CREATE_FOLDER', { path: fullPath });
        await conn.send('GET_TREE');
    }
}

async function ctxRename() {
    hideContextMenu();
    
    if (!ctxTarget || ctxTarget.length === 0) {
        console.error('ctxRename: No target path');
        return;
    }
    
    const isFolder = ctxTargetType === 'folder';
    const isFile = ctxTargetType === 'file';
    const cleanTarget = ctxTarget.endsWith('/') ? ctxTarget.slice(0, -1) : ctxTarget;
    
    let defaultName = cleanTarget;
    if (isFile && cleanTarget.endsWith('.md')) {
        defaultName = cleanTarget.slice(0, -3);
    } else if (isFolder) {
        defaultName = cleanTarget.split('/').pop();
    }
    
    const promptText = isFolder ? 'Rename Folder:' : 'Rename / Move (Enter new path):';
    const newPathInput = prompt(promptText, defaultName);
    
    if (newPathInput && newPathInput !== defaultName) {
        let newPath = newPathInput;
        
        if (isFile && cleanTarget.endsWith('.md') && !newPath.endsWith('.md')) {
            newPath += '.md';
        }
        
        if (isFolder) {
            const parentPath = cleanTarget.substring(0, cleanTarget.lastIndexOf('/'));
            if (parentPath) {
                newPath = parentPath + '/' + newPath;
            }
        }
        
        await conn.send('RENAME_FILE', { path: cleanTarget, data: { newPath } });
        await conn.send('GET_TREE');
        if (isFile && cleanTarget.endsWith('.md')) {
            await loadFile(newPath);
        }
    }
}

async function ctxDelete() {
    hideContextMenu();
    
    if (!ctxTarget || ctxTarget.length === 0) {
        console.error('ctxDelete: No target path');
        return;
    }
    
    const isFolder = ctxTargetType === 'folder';
    const cleanTarget = ctxTarget.endsWith('/') ? ctxTarget.slice(0, -1) : ctxTarget;
    const itemType = isFolder ? 'folder' : 'file';
    const displayName = isFolder ? cleanTarget.split('/').pop() : cleanTarget.split('/').pop();
    
    if (confirm(`Are you sure you want to delete this ${itemType}: "${displayName}"?`)) {
        await conn.send('DELETE_FILE', { path: cleanTarget });
        await conn.send('GET_TREE');
    }
}

/**
 * Hide context menu
 */
function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.style.display = 'none';
}

/**
 * Render context menu
 */
function renderContextMenu(container, items) {
    items.forEach(item => {
        if (item.show === false) return;
        
        if (item.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'menu-separator';
            container.appendChild(sep);
            return;
        }
        
        const div = document.createElement('div');
        div.className = `menu-item ${item.danger ? 'delete' : ''}`;
        div.innerHTML = `<i class="fa-solid ${item.icon}"></i> ${item.label}`;
        div.onclick = (e) => {
            e.stopPropagation();
            window[item.action]();
            container.style.display = 'none';
        };
        container.appendChild(div);
    });
}

/**
 * Handle context menu display
 */
function handleContextMenuDisplay(e) {
    if (e.target.closest('#context-menu') || e.target.closest('.context-menu')) {
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    
    const target = e.target.closest('.file-tree-item');
    
    menu.innerHTML = '';
    menu.style.display = 'block';
    
    let x = e.clientX;
    let y = e.clientY;
    
    if (x + 200 > window.innerWidth) x = window.innerWidth - 210;
    if (y + 300 > window.innerHeight) y = window.innerHeight - 310;
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    
    if (target) {
        const path = target.getAttribute('data-path');
        const type = target.getAttribute('data-type');
        
        if (!path || path.length === 0) {
            console.error('Context menu target missing data-path:', target);
            return;
        }
        
        // Don't show context menu for tags
        if (type === 'tag' || path.startsWith('#')) {
            menu.style.display = 'none';
            return;
        }
        
        ctxTarget = path;
        ctxTargetType = type;
        
        renderContextMenu(menu, [
            { label: 'Open', icon: 'fa-folder-open', action: 'ctxOpen', show: type === 'file' },
            { label: 'New Note', icon: 'fa-plus', action: 'ctxNewNote' },
            { label: 'New Folder', icon: 'fa-folder', action: 'ctxNewFolder' },
            { type: 'separator' },
            { label: 'Rename', icon: 'fa-pen-to-square', action: 'ctxRename' },
            { label: 'Delete', icon: 'fa-trash', action: 'ctxDelete', danger: true }
        ]);
    } else {
        ctxTarget = selectedFolderPath || '';
        
        renderContextMenu(menu, [
            { label: 'New Note Here', icon: 'fa-plus', action: 'ctxNewNote' },
            { label: 'New Folder Here', icon: 'fa-folder', action: 'ctxNewFolder' }
        ]);
    }
}

/**
 * Log message to status text
 */
function log(msg) {
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.innerText = msg;
}

// Export all window functions
window.initApp = initApp;
window.loadFile = loadFile;
window.saveFile = saveFile;
window.toggleViewMode = toggleViewMode;
window.toggleFocus = toggleFocus;
window.togglePanel = togglePanel;
window.switchTab = switchTab;
window.refreshTree = refreshTree;
window.doSearch = doSearch;
window.createNote = createNote;
window.createFolder = createFolder;
window.collapseAll = collapseAll;
window.sortFiles = sortFiles;
window.openDailyNote = openDailyNote;
window.openGraph = openGraph;
window.openSettings = openSettings;
window.ctxOpen = ctxOpen;
window.ctxNewNote = ctxNewNote;
window.ctxNewFolder = ctxNewFolder;
window.ctxRename = ctxRename;
window.ctxDelete = ctxDelete;
