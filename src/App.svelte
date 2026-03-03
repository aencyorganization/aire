<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import { markedHighlight } from 'marked-highlight';
  import hljs from 'highlight.js';
  import { 
    Plus, 
    X, 
    Sun, 
    Moon, 
    Download, 
    Trash2, 
    FileText,
    MoreVertical,
    Edit3,
    Github,
    WrapText
  } from 'lucide-svelte';
  import { appStore, activeDocument } from './stores';
  import type { Document } from './stores';
  
  // ============================================
  // MARKED CONFIGURATION
  // ============================================
  
  // ============================================
  // GITHUB ALERTS RENDERER
  // ============================================
  
  const alertTypes: Record<string, { icon: string; label: string; className: string }> = {
    'NOTE': { 
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>', 
      label: 'Note', 
      className: 'markdown-alert-note' 
    },
    'TIP': { 
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>', 
      label: 'Tip', 
      className: 'markdown-alert-tip' 
    },
    'IMPORTANT': { 
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 8-9.04 9.06a2.82 2.82 0 1 0 3.98 3.98L16 12"/><circle cx="17" cy="7" r="5"/></svg>', 
      label: 'Important', 
      className: 'markdown-alert-important' 
    },
    'WARNING': { 
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', 
      label: 'Warning', 
      className: 'markdown-alert-warning' 
    },
    'CAUTION': { 
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', 
      label: 'Caution', 
      className: 'markdown-alert-caution' 
    },
  };

  function renderGitHubAlert(text: string): string | null {
    // The text may come wrapped in <p> tags from marked's paragraph processing
    // Extract the actual text content, handling both plain text and HTML-wrapped text
    let cleanText = text;
    
    // Remove wrapping <p> tags if present
    if (cleanText.startsWith('<p>') && cleanText.endsWith('</p>')) {
      cleanText = cleanText.slice(3, -4);
    }
    
    // Check for GitHub Alert syntax: [!TYPE]
    const alertRegex = /^\[! (NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>\s*|\n\s*)?/i;
    const match = cleanText.match(alertRegex);
    
    if (match) {
      const type = match[1].toUpperCase();
      const alert = alertTypes[type];
      if (alert) {
        let content = cleanText.slice(match[0].length).trim();
        
        // Remove trailing </p> if it was split
        content = content.replace(/<\/p>\s*$/i, '');
        
        return `<div class="markdown-alert ${alert.className}">
          <div class="markdown-alert-header">
            ${alert.icon}
            <span>${alert.label}</span>
          </div>
          <div class="markdown-alert-content">${content}</div>
        </div>`;
      }
    }
    return null;
  }

  // ============================================
  // COLOR PREVIEW RENDERER
  // ============================================
  
  const colorPatterns = [
    // HEX: #RGB, #RRGGBB, #RGBA, #RRGGBBAA
    { regex: /#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g, type: 'hex' },
    // RGB/RGBA: rgb(255, 0, 0), rgba(255, 0, 0, 0.5)
    { regex: /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)/gi, type: 'rgb' },
    // HSL/HSLA: hsl(120, 50%, 50%), hsla(120, 50%, 50%, 0.5)
    { regex: /hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*(?:,\s*([\d.]+)\s*)?\)/gi, type: 'hsl' },
  ];
  
  function renderColorPreview(text: string): string {
    let result = text;
    
    // Process HEX colors
    result = result.replace(/#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g, (match) => {
      return `<span class="color-preview-wrapper">
        <span class="color-preview-circle" style="background-color: ${match};"></span>
        <code class="color-preview-code">${match}</code>
      </span>`;
    });
    
    // Process RGB/RGBA colors
    result = result.replace(/rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)/gi, (match) => {
      return `<span class="color-preview-wrapper">
        <span class="color-preview-circle" style="background-color: ${match};"></span>
        <code class="color-preview-code">${match}</code>
      </span>`;
    });
    
    // Process HSL/HSLA colors
    result = result.replace(/hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*[\d.]+\s*)?\)/gi, (match) => {
      return `<span class="color-preview-wrapper">
        <span class="color-preview-circle" style="background-color: ${match};"></span>
        <code class="color-preview-code">${match}</code>
      </span>`;
    });
    
    return result;
  }
  
  // ============================================
  // MARKED CONFIGURATION
  // ============================================
  
  marked.use(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
    })
  );
  
  // Configure marked for GFM
  marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: true,
    mangle: false,
  });
  
  // Custom renderer for blockquotes (GitHub Alerts)
  const renderer = new marked.Renderer();
  const originalBlockquote = renderer.blockquote.bind(renderer);
  
  renderer.blockquote = (quote: string) => {
    // Check if this is a GitHub Alert
    const alertHtml = renderGitHubAlert(quote);
    if (alertHtml) {
      return alertHtml;
    }
    return originalBlockquote(quote);
  };
  
  // Custom renderer for paragraphs (Color previews in text)
  const originalParagraph = renderer.paragraph.bind(renderer);
  
  renderer.paragraph = (text: string) => {
    // Add color previews to text
    const processedText = renderColorPreview(text);
    return `<p>${processedText}</p>`;
  };
  
  // Custom renderer for list items
  const originalListItem = renderer.listitem.bind(renderer);
  
  renderer.listitem = (text: string, task: boolean, checked: boolean) => {
    // Add color previews to list items
    const processedText = renderColorPreview(text);
    if (task) {
      return `<li class="task-list-item"><input type="checkbox" ${checked ? 'checked' : ''} disabled> ${processedText}</li>`;
    }
    return `<li>${processedText}</li>`;
  };
  
  // Custom renderer for table cells
  const originalTableCell = renderer.tablecell.bind(renderer);
  
  renderer.tablecell = (content: string, flags: { header: boolean; align: 'center' | 'left' | 'right' | null }) => {
    // Add color previews to table cells
    const processedContent = renderColorPreview(content);
    if (flags.header) {
      return `<th${flags.align ? ` align="${flags.align}"` : ''}>${processedContent}</th>`;
    }
    return `<td${flags.align ? ` align="${flags.align}"` : ''}>${processedContent}</td>`;
  };
  
  // Apply custom renderer
  marked.use({ renderer });
  
  // ============================================
  // STATE
  // ============================================
  
  let editorTextarea: HTMLTextAreaElement;
  let lineNumbersEl: HTMLDivElement;
  let previewContainer: HTMLDivElement;
  let editingNameId: string | null = null;
  let editingNameValue = '';
  let showDeleteConfirm: string | null = null;
  let isResizing = false;
  let sidebarWidth = 50;
  
  $: currentDoc = $activeDocument;
  $: renderedMarkdown = currentDoc ? marked.parse(currentDoc.content) : '';
  $: lineCount = currentDoc ? currentDoc.content.split('\n').length : 1;
  $: 
    if ($appStore) {
      sidebarWidth = $appStore.sidebarWidth;
    }
  
  // Apply theme to body
  $: {
    if (typeof document !== 'undefined') {
      if ($appStore.theme === 'dark') {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
    }
  }
  
  // ============================================
  // HANDLERS
  // ============================================
  
  function handleContentChange(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    if (currentDoc) {
      appStore.updateDocumentContent(currentDoc.id, target.value);
    }
  }
  
  function handleNewDocument() {
    const docCount = $appStore.documents.length;
    const newName = docCount === 0 ? 'Untitled' : `Untitled ${docCount + 1}`;
    appStore.createDocument(newName, '');
    
    // Focus editor after creation
    tick().then(() => {
      editorTextarea?.focus();
    });
  }
  
  function handleCloseDocument(e: MouseEvent, id: string) {
    e.stopPropagation();
    
    if ($appStore.documents.length === 1) {
      // Don't delete the last document, just clear it
      appStore.updateDocumentContent(id, '');
      appStore.renameDocument(id, 'Untitled');
    } else {
      appStore.deleteDocument(id);
    }
  }
  
  function handleTabClick(id: string) {
    appStore.setActiveDocument(id);
  }
  
  function startEditingName(doc: Document) {
    editingNameId = doc.id;
    editingNameValue = doc.name;
    
    tick().then(() => {
      const input = document.getElementById(`rename-input-${doc.id}`) as HTMLInputElement;
      input?.focus();
      input?.select();
    });
  }
  
  function finishEditingName() {
    if (editingNameId && editingNameValue.trim()) {
      appStore.renameDocument(editingNameId, editingNameValue.trim());
    }
    editingNameId = null;
    editingNameValue = '';
  }
  
  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      finishEditingName();
    } else if (e.key === 'Escape') {
      editingNameId = null;
      editingNameValue = '';
    }
  }
  
  function handleDownload() {
    if (!currentDoc) return;
    
    const blob = new Blob([currentDoc.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentDoc.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  function handleDeleteDocument(id: string) {
    showDeleteConfirm = null;
    appStore.deleteDocument(id);
  }
  
  // Sync scroll between editor and line numbers
  function handleEditorScroll() {
    if (lineNumbersEl && editorTextarea) {
      lineNumbersEl.scrollTop = editorTextarea.scrollTop;
    }
  }
  
  // Resizer handlers
  function startResizing(e: MouseEvent) {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  
  function stopResizing() {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
  
  function handleResizing(e: MouseEvent) {
    if (!isResizing) return;
    
    const containerWidth = window.innerWidth;
    const newWidth = (e.clientX / containerWidth) * 100;
    
    if (newWidth >= 20 && newWidth <= 80) {
      sidebarWidth = newWidth;
      appStore.setSidebarWidth(newWidth);
    }
  }
  
  // Keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    // Ctrl/Cmd + N: New document
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      handleNewDocument();
    }
    
    // Ctrl/Cmd + S: Download (since it's auto-saved)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleDownload();
    }
    
    // Ctrl/Cmd + D: Toggle theme
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      appStore.toggleTheme();
    }
    
    // Ctrl/Cmd + W: Toggle word wrap
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      appStore.toggleWordWrap();
    }
  }
  
  onMount(() => {
    window.addEventListener('mousemove', handleResizing);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      window.removeEventListener('mousemove', handleResizing);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<main class="app-container">
  <!-- Header / Tab Bar -->
  <header class="header">
    <div class="tabs-container">
      <div class="tabs-scroll no-scrollbar">
        {#each $appStore.documents as doc (doc.id)}
          <div 
            class="tab-wrapper animate-slide-in"
            class:active={doc.id === $appStore.activeDocumentId}
          >
            {#if editingNameId === doc.id}
              <input
                id="rename-input-{doc.id}"
                type="text"
                class="rename-input"
                bind:value={editingNameValue}
                on:blur={finishEditingName}
                on:keydown={handleRenameKeydown}
              />
            {:else}
              <button 
                class="tab"
                class:active={doc.id === $appStore.activeDocumentId}
                on:click={() => handleTabClick(doc.id)}
                on:dblclick={() => startEditingName(doc)}
                title={doc.name}
              >
                <FileText size={14} />
                <span class="tab-name">{doc.name}</span>
                <button 
                  class="tab-close"
                  on:click={(e) => handleCloseDocument(e, doc.id)}
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              </button>
            {/if}
          </div>
        {/each}
        
        <button class="add-tab-btn" on:click={handleNewDocument} title="New document (Ctrl+N)">
          <Plus size={16} />
        </button>
      </div>
    </div>
    
    <div class="header-actions">
      <button class="btn btn-icon" on:click={() => appStore.toggleWordWrap()} title="Toggle word wrap (Ctrl+W)">
        <WrapText size={18} />
      </button>
      
      <button class="btn btn-icon" on:click={handleDownload} title="Download markdown (Ctrl+S)">
        <Download size={18} />
      </button>
      
      <button class="btn btn-icon" on:click={() => appStore.toggleTheme()} title="Toggle theme (Ctrl+D)">
        {#if $appStore.theme === 'dark'}
          <Sun size={18} />
        {:else}
          <Moon size={18} />
        {/if}
      </button>
    </div>
  </header>
  
  <!-- Workspace -->
  <div class="workspace">
    <!-- Editor Pane -->
    <section class="editor-pane" style="width: {sidebarWidth}%">
      <div class="editor-container">
        <!-- Line Numbers -->
        <div class="line-numbers" bind:this={lineNumbersEl}>
          {#each Array(lineCount) as _, i}
            <div class="line-number">{i + 1}</div>
          {/each}
        </div>
        
        <!-- Editor -->
        <textarea
          bind:this={editorTextarea}
          class="editor-textarea"
          class:word-wrap-enabled={$appStore.wordWrap}
          value={currentDoc?.content || ''}
          on:input={handleContentChange}
          on:scroll={handleEditorScroll}
          placeholder="# Start writing your masterpiece...&#10;&#10;This editor supports full GitHub Flavored Markdown:&#10;- **Bold** and *italic* text&#10;- [Links](https://example.com)&#10;- `inline code` and code blocks&#10;- Tables, task lists, and more!"
          spellcheck="false"
        ></textarea>
      </div>
    </section>
    
    <!-- Resizer -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div 
      class="resizer"
      class:active={isResizing}
      on:mousedown={startResizing}
    ></div>
    
    <!-- Preview Pane -->
    <section class="preview-pane" style="width: {100 - sidebarWidth}%">
      <div class="preview-container" bind:this={previewContainer}>
        {#if currentDoc}
          <article class="markdown-preview animate-fade-up">
            {@html renderedMarkdown}
          </article>
        {:else}
          <div class="empty-state">
            <div class="empty-icon">
              <FileText size={48} />
            </div>
            <p>No document selected</p>
            <button class="btn btn-primary" on:click={handleNewDocument}>
              <Plus size={16} />
              Create New Document
            </button>
          </div>
        {/if}
      </div>
    </section>
  </div>
  
  <!-- Status Bar -->
  <footer class="status-bar">
    <div class="status-left">
      <span class="status-item">
        {$appStore.documents.length} {$appStore.documents.length === 1 ? 'document' : 'documents'}
      </span>
      {#if currentDoc}
        <span class="status-separator">|</span>
        <span class="status-item">
          {currentDoc.content.length.toLocaleString()} characters
        </span>
        <span class="status-separator">|</span>
        <span class="status-item">
          {lineCount.toLocaleString()} lines
        </span>
      {/if}
    </div>
    <div class="status-right">
      {#if $appStore.wordWrap}
        <span class="status-item">Wrap</span>
        <span class="status-separator">|</span>
      {/if}
      <span class="status-item">GFM Support</span>
      <span class="status-separator">|</span>
      <span class="status-item" class:unsaved={false}>
        Auto-saved
      </span>
    </div>
  </footer>
</main>

<style>
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background-color: var(--bg-app);
  }
  
  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 8px;
    background-color: var(--bg-app);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  
  .tabs-container {
    flex: 1;
    overflow: hidden;
    display: flex;
    align-items: center;
  }
  
  .tabs-scroll {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    padding: 4px;
    max-width: 100%;
  }
  
  .tab-wrapper {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  
  .tab-wrapper.active {
    z-index: 1;
  }
  
  .rename-input {
    font-family: inherit;
    font-size: 0.8125rem;
    padding: 0.4em 0.8em;
    border: 2px solid var(--accent-primary);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text-primary);
    outline: none;
    width: 140px;
  }
  
  .add-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }
  
  .add-tab-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 8px;
    border-left: 1px solid var(--border-subtle);
  }
  
  /* Workspace */
  .workspace {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  
  .editor-pane {
    display: flex;
    flex-direction: column;
    background-color: var(--bg-surface);
    min-width: 200px;
  }
  
  .editor-container {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  
  .line-numbers {
    overflow: hidden;
    user-select: none;
  }
  
  .line-number {
    height: 1.7em;
    line-height: 1.7;
  }
  
  .editor-textarea {
    flex: 1;
    border: none;
    outline: none;
    resize: none;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 14px;
    line-height: 1.7;
    background-color: var(--bg-surface);
    color: var(--text-primary);
    padding: 1.5em;
    tab-size: 2;
    -moz-tab-size: 2;
    white-space: pre;
    overflow-wrap: normal;
    overflow-x: auto;
  }
  
  .editor-textarea::placeholder {
    color: var(--text-tertiary);
  }

  .editor-textarea.word-wrap-enabled {
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  
  .preview-pane {
    display: flex;
    flex-direction: column;
    background-color: var(--bg-surface);
    min-width: 200px;
    overflow: hidden;
  }
  
  .preview-container {
    flex: 1;
    overflow-y: auto;
    padding: 2em;
  }
  
  .markdown-preview {
    max-width: 800px;
    margin: 0 auto;
  }
  
  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary);
    gap: 1em;
  }
  
  .empty-icon {
    color: var(--border-subtle);
  }
  
  /* Status Bar */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 12px;
    background-color: var(--bg-sidebar);
    border-top: 1px solid var(--border-subtle);
    font-size: 0.75rem;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  
  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .status-separator {
    opacity: 0.3;
  }
  
  .status-item.unsaved {
    color: var(--accent-primary);
  }
  
  /* Button styles */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    padding: 0.5em 1em;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all var(--transition-fast);
    background: transparent;
    color: var(--text-secondary);
  }
  
  .btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  
  .btn-primary {
    background: var(--accent-primary);
    color: white;
  }
  
  .btn-primary:hover {
    background: var(--accent-hover);
    color: white;
  }
  
  .btn-icon {
    padding: 0.5em;
    width: 36px;
    height: 36px;
  }
  
  /* Dark mode specific styles */
  :global(.dark-mode) .editor-textarea {
    background-color: var(--bg-surface);
  }
  
  :global(.dark-mode) .preview-container {
    background-color: var(--bg-surface);
  }
  
  /* Responsive */
  @media (max-width: 768px) {
    .workspace {
      flex-direction: column;
    }
    
    .editor-pane,
    .preview-pane {
      width: 100% !important;
      height: 50%;
    }
    
    .resizer {
      width: 100%;
      height: 4px;
      cursor: row-resize;
    }
    
    .preview-container {
      padding: 1em;
    }
  }
</style>
