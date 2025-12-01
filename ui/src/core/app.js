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
    let styleTag = document.getElementById('obsidian-theme-vars');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'obsidian-theme-vars';
        document.head.appendChild(styleTag);
    }
    styleTag.textContent = css;
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
}

/**
 * Prepare and render note list
 */
function prepareNoteList(files) {
    currentList = prepareList(files);
    renderedCount = 0;
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
        card.className = 'note-card';
        card.dataset.path = file.path;
        
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
 * Load file into editor
 */
async function loadFile(path) {
    currentPath = path;
    document.getElementById('filename').innerText = path.split('/').pop().replace('.md', '');
    
    // DEFAULT TO PREVIEW MODE
    isReadingMode = true;
    const btn = document.getElementById('view-btn');
    const preview = document.getElementById('custom-preview');
    const loading = document.getElementById('preview-loading');
    const editorEl = document.querySelector('.EasyMDEContainer');
    const saveBtn = document.getElementById('save-btn');
    
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        btn.title = 'Switch to Edit Mode';
    }
    if (saveBtn) saveBtn.classList.add('hidden');
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
    
    links.forEach(link => {
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
        color: id === centerPath ? accent : (id.startsWith('#') ? tagColor : textMuted)
    }));

    console.log('📊 Graph data:', graphNodes.length, 'nodes,', links.length, 'links');

    if (graphInstance && container.childElementCount > 0) {
        graphInstance.graphData({ nodes: graphNodes, links: links });
        graphInstance.width(container.clientWidth).height(container.clientHeight);
        graphInstance.backgroundColor(bg);
    } else {
        container.innerHTML = '';
        graphInstance = ForceGraph()(container)
            .width(container.clientWidth).height(container.clientHeight)
            .graphData({ nodes: graphNodes, links: links })
            .backgroundColor(bg)
            .nodeColor('color')
            .linkColor(() => textMuted)
            .nodeCanvasObject((node, ctx, globalScale) => {
                const label = node.name;
                const fontSize = 12 / globalScale;
                ctx.font = `${fontSize}px Sans-Serif`;
                ctx.fillStyle = node.color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI, false);
                ctx.fill();
                ctx.fillStyle = text;
                ctx.fillText(label, node.x + 8, node.y + 3);
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
    const graphCanvas = document.getElementById('graph-canvas');
    const blList = document.getElementById('backlinks-list');
    
    if (graphCanvas) graphCanvas.style.display = panelState.graph ? 'block' : 'none';
    if (blList) blList.style.display = panelState.backlinks ? 'block' : 'none';
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
        if (saveBtn) saveBtn.classList.add('hidden');
        
        editorEl.style.display = 'none';
        loading.style.display = 'flex';
        preview.style.display = 'none';
        
        await conn.send('GET_RENDERED_FILE', { path: currentPath });
    } else {
        btn.innerHTML = '<i class="fa-regular fa-eye"></i>';
        btn.title = 'Switch to Preview Mode';
        if (saveBtn) saveBtn.classList.remove('hidden');
        
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
function openDailyNote() {
    alert('Daily Notes coming in V2.');
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
