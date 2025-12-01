/**
 * File Tree Management
 * Handles folder/tag tree building and rendering
 */

/**
 * Process file data and build folder/tag trees
 */
export function processFileData(data) {
    const files = data.files || data;
    const folders = data.folders || [];
    
    const masterFileList = files;
    const folderTree = { _files: [], _sub: {} };
    const tagTree = { _files: [], _sub: {} };
    
    // Build folder structure
    const allFolders = new Set(folders);
    
    // Add folders from file paths
    files.forEach(f => {
        const parts = f.path.split('/');
        parts.pop();
        
        let folderPath = '';
        parts.forEach(part => {
            folderPath = folderPath ? `${folderPath}/${part}` : part;
            allFolders.add(folderPath);
        });
    });
    
    // Create folder structure
    allFolders.forEach(folderPath => {
        const parts = folderPath.split('/');
        let current = folderTree;
        parts.forEach(part => {
            if (!current._sub[part]) {
                current._sub[part] = { _files: [], _sub: {} };
            }
            current = current._sub[part];
        });
    });
    
    // Populate files into folders
    files.forEach(f => {
        const parts = f.path.split('/');
        const filename = parts.pop();
        
        if (parts.length === 0) {
            folderTree._files.push(f);
        } else {
            let current = folderTree;
            parts.forEach(part => {
                current = current._sub[part];
            });
            current._files.push(f);
        }
        
        // Process tags
        if (f.tags) {
            f.tags.forEach(rawTag => {
                const parts = rawTag.replace('#', '').split('/');
                let tCurrent = tagTree;
                parts.forEach(part => {
                    if (!tCurrent._sub[part]) {
                        tCurrent._sub[part] = { _files: [], _sub: {} };
                    }
                    tCurrent = tCurrent._sub[part];
                    tCurrent._files.push(f);
                });
            });
        }
    });
    
    return { masterFileList, folderTree, tagTree };
}

/**
 * Render tree node recursively
 */
export function renderNode(node, container, level, parentPath, currentView, icons, onNodeClick) {
    // Add root node for unfiled notes (only at root level for folders view)
    if (level === 0 && currentView === 'folders' && node._files && node._files.length > 0) {
        const rootDiv = document.createElement('div');
        rootDiv.className = 'tree-item-wrapper';
        
        const rootLabel = document.createElement('div');
        rootLabel.className = 'tree-label file-tree-item';
        rootLabel.setAttribute('data-path', '/');
        rootLabel.setAttribute('data-type', 'root');
        rootLabel.style.paddingLeft = '0px';
        
        const rootIcon = document.createElement('span');
        rootIcon.className = 'tree-icon';
        rootIcon.innerHTML = '<i class="fa-solid fa-home"></i>';
        
        const rootText = document.createElement('span');
        rootText.className = 'tree-text';
        rootText.textContent = `Root Notes (${node._files.length})`;
        
        rootLabel.appendChild(rootIcon);
        rootLabel.appendChild(rootText);
        
        rootLabel.onclick = () => {
            document.querySelectorAll('.tree-label').forEach(d => d.classList.remove('selected'));
            rootLabel.classList.add('selected');
            
            if (onNodeClick) {
                onNodeClick('/', node._files);
            }
        };
        
        rootDiv.appendChild(rootLabel);
        container.appendChild(rootDiv);
    }
    
    Object.keys(node._sub || {}).sort().forEach(key => {
        const child = node._sub[key];
        const hasSub = Object.keys(child._sub || {}).length > 0;
        const fileCount = child._files ? child._files.length : 0;
        const fullPath = parentPath + key + '/';
        const isFolder = currentView === 'folders';
        
        const div = document.createElement('div');
        div.className = 'tree-item-wrapper';
        
        const label = document.createElement('div');
        label.className = 'tree-label file-tree-item';
        label.setAttribute('data-path', fullPath);
        label.setAttribute('data-type', isFolder ? 'folder' : 'tag');
        label.style.paddingLeft = `${level * 12}px`;
        
        const caret = document.createElement('span');
        caret.className = hasSub ? 'caret' : 'caret empty';
        caret.innerHTML = hasSub ? '▶' : '';
        
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.innerHTML = isFolder ? (icons.folder || '<i class="fa-solid fa-folder"></i>') : (icons.tag || '<i class="fa-solid fa-hashtag"></i>');
        
        const text = document.createElement('span');
        text.className = 'tree-text';
        text.textContent = key + (fileCount > 0 ? ` (${fileCount})` : '');
        
        label.appendChild(caret);
        label.appendChild(icon);
        label.appendChild(text);
        
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'tree-children';
        
        div.appendChild(label);
        div.appendChild(childrenDiv);
        
        // Left click handler
        label.onclick = (e) => {
            if (e.target.closest('.caret') && hasSub) return;
            
            document.querySelectorAll('.tree-label').forEach(d => d.classList.remove('selected'));
            label.classList.add('selected');
            
            if (onNodeClick) {
                onNodeClick(fullPath, child._files);
            }
        };
        
        // Caret click handler
        if (hasSub) {
            caret.onclick = (e) => {
                e.stopPropagation();
                childrenDiv.classList.toggle('open');
                caret.innerHTML = childrenDiv.classList.contains('open') ? '▼' : '▶';
            };
        }
        
        container.appendChild(div);
        
        if (hasSub) {
            renderNode(child, childrenDiv, level + 1, fullPath, currentView, icons, onNodeClick);
        }
    });
}

/**
 * Prepare list of files for virtualized rendering
 */
export function prepareList(files) {
    return files.sort((a, b) => {
        const aName = a.path.split('/').pop().toLowerCase();
        const bName = b.path.split('/').pop().toLowerCase();
        return aName.localeCompare(bName);
    });
}
