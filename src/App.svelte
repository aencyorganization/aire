<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import { markedHighlight } from 'marked-highlight';
  import hljs from 'highlight.js';
  import katex from 'katex';
  import 'katex/dist/katex.min.css';
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

  type PaletteCommand = {
    id: string;
    label: string;
    desc: string;
    run: () => void;
  };
  
  // ============================================
  // MARKED CONFIGURATION
  // ============================================

  // Extension: definitional lists (Term + ": definition")
  const definitionListExtension = {
    name: 'definitionList',
    level: 'block',
    start(src: string) {
      return src.match(/^\S[^\n]*\n: /m)?.index ?? -1;
    },
    tokenizer(src: string) {
      const rule = /^(?<body>(?:\S[^\n]*\n: .+(?:\n|$))+)/;
      const match = rule.exec(src);
      if (!match?.groups?.body) return;

      const items: { term: string; description: string }[] = [];
      const lines = match.groups.body.trimEnd().split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        const term = lines[i];
        const descLine = lines[i + 1];
        if (!descLine?.startsWith(': ')) continue;
        items.push({ term: term.trim(), description: descLine.replace(/^: /, '').trim() });
        i++; // skip description line
      }

      return {
        type: 'definitionList',
        raw: match.groups.body,
        items,
      } as const;
    },
    renderer(token) {
      const { items } = token as { items: { term: string; description: string }[] };
      const rendered = items
        .map((item) => `<dt>${item.term}</dt><dd>${item.description}</dd>`)
        .join('');
      return `<dl>${rendered}</dl>`;
    },
  } as const;

  // Extension: callouts :::type Optional title\ncontent\n:::
  const calloutTypes = ['info', 'warn', 'warning', 'error', 'success', 'tip'];
  const calloutExtension = {
    name: 'callout',
    level: 'block',
    start(src: string) {
      return src.match(/^:::/m)?.index ?? -1;
    },
    tokenizer(src: string) {
      const rule = /^:::(?<type>\w+)(?:\s+(?<title>[^\n]+))?\n(?<body>[\s\S]+?)\n:::\s*(?:\n|$)/;
      const match = rule.exec(src);
      if (!match?.groups?.type || !match.groups.body) return;
      const type = match.groups.type.toLowerCase();
      if (!calloutTypes.includes(type)) return;

      return {
        type: 'callout',
        raw: match[0],
        calloutType: type,
        title: match.groups.title?.trim() || type.toUpperCase(),
        text: this.lexer.inlineTokens(match.groups.body.trim()),
      } as const;
    },
    renderer(token) {
      const { calloutType, title, text } = token as {
        calloutType: string;
        title: string;
        text: marked.TokensList;
      };
      const inner = this.parser.parseInline(text);
      return `<div class="callout ${calloutType}"><div class="callout-title">${title}</div><div class="callout-body">${inner}</div></div>`;
    },
  } as const;

  // Extension: math (inline $...$ and block $$...$$) rendered with KaTeX
  const inlineMathExtension = {
    name: 'inlineMath',
    level: 'inline',
    start(src: string) {
      return src.indexOf('$');
    },
    tokenizer(src: string) {
      const rule = /^\$(.+?)\$/;
      const match = rule.exec(src);
      if (!match) return;
      if (!match[1].trim()) return;

      return {
        type: 'inlineMath',
        raw: match[0],
        text: match[1].trim(),
      } as const;
    },
    renderer(token) {
      const { text } = token as { text: string };
      return katex.renderToString(text, { throwOnError: false, displayMode: false });
    },
  } as const;

  const blockMathExtension = {
    name: 'blockMath',
    level: 'block',
    start(src: string) {
      return src.match(/^\$\$/m)?.index ?? -1;
    },
    tokenizer(src: string) {
      const rule = /^\$\$\s*\n?([\s\S]+?)\n?\$\$\s*(?:\n|$)/;
      const match = rule.exec(src);
      if (!match?.[1]) return;

      return {
        type: 'blockMath',
        raw: match[0],
        text: match[1].trim(),
      } as const;
    },
    renderer(token) {
      const { text } = token as { text: string };
      const html = katex.renderToString(text, { throwOnError: false, displayMode: true });
      return `<div class="math-block">${html}</div>`;
    },
  } as const;

  marked.use({ extensions: [definitionListExtension, calloutExtension, blockMathExtension, inlineMathExtension] });

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
    pedantic: false,
  });
  
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
  let liveMessage = '';
  let showPalette = false;
  let paletteFilter = '';
  let filteredCommands: PaletteCommand[] = [];
  let paletteInputEl: HTMLInputElement | null = null;
  let flashFormat = false;
  let flashDownload = false;
  let selectionLength = 0;
  let caretLine = 1;
  let caretCol = 1;
  let flashCopyStats = false;

  const editorStateByDoc = new Map<string, { selectionStart: number; selectionEnd: number; scrollTop: number }>();
  const previewScrollByDoc = new Map<string, number>();
  
  $: currentDoc = $activeDocument;
  $: renderedMarkdown = currentDoc ? marked.parse(currentDoc.content) : '';
  $: lineCount = currentDoc ? currentDoc.content.split('\n').length : 1;
  $: 
    if ($appStore) {
      sidebarWidth = $appStore.sidebarWidth;
    }

  $: filteredCommands = paletteCommands.filter((cmd) =>
    `${cmd.label} ${cmd.desc}`.toLowerCase().includes(paletteFilter.toLowerCase())
  );

  $: wordCount = currentDoc ? (currentDoc.content.trim() ? currentDoc.content.trim().split(/\s+/).length : 0) : 0;

  $: if (previewContainer && renderedMarkdown) {
    tick().then(() => {
      enhancePreviewBlocks();
    });
  }

  async function copyStatusDetails() {
    if (!currentDoc) return;
    const details = [
      `${wordCount} words`,
      `${currentDoc.content.length} chars`,
      `${lineCount} lines`,
      `Line ${caretLine}, Col ${caretCol}`,
      selectionLength > 0 ? `${selectionLength} selected` : null,
    ]
      .filter(Boolean)
      .join(' • ');
    try {
      await navigator.clipboard.writeText(details);
      flashCopyStats = true;
      setTimeout(() => (flashCopyStats = false), 420);
      announce('Status copied');
    } catch (e) {
      console.error('Copy failed', e);
    }
  }

  $: if (currentDoc) {
    // Restore editor/preview positions when switching docs
    tick().then(() => {
      restoreEditorState(currentDoc);
    });
  }

  const paletteCommands: PaletteCommand[] = [
    { id: 'new', label: 'New document', desc: 'Create empty doc', run: handleNewDocument },
    { id: 'download', label: 'Download markdown', desc: 'Save current doc', run: handleDownload },
    { id: 'format-tables', label: 'Format tables', desc: 'Align table columns', run: handleFormatTables },
    { id: 'toggle-theme', label: 'Toggle theme', desc: 'Light/Dark', run: () => appStore.toggleTheme() },
    { id: 'toggle-wrap', label: 'Toggle word wrap', desc: 'Wrap editor lines', run: () => appStore.toggleWordWrap() },
    { id: 'focus-editor', label: 'Focus editor', desc: 'Move caret to editor', run: () => editorTextarea?.focus() },
  ];

  // Palette helpers
  function openPalette() {
    showPalette = true;
    paletteFilter = '';
    tick().then(() => paletteInputEl?.focus());
  }

  function closePalette() {
    showPalette = false;
    paletteFilter = '';
  }

  function runPaletteCommand(cmd: PaletteCommand) {
    closePalette();
    cmd.run();
  }

  function handlePaletteKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = filteredCommands[0];
      if (first) runPaletteCommand(first);
    }
  }

  function handlePaletteInput(e: Event) {
    const target = e.target as HTMLInputElement | null;
    paletteFilter = target?.value ?? '';
  }

  // Paste handler: insert pasted images as markdown references
  function handlePaste(e: ClipboardEvent) {
    if (!currentDoc || !editorTextarea) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const url = URL.createObjectURL(file);
        const label = `pasted-image-${Date.now()}`;

        const { selectionStart, selectionEnd, value } = editorTextarea;
        const before = value.slice(0, selectionStart ?? 0);
        const after = value.slice(selectionEnd ?? selectionStart ?? 0);
        const insertion = `![${label}](${url})`;

        const updated = `${before}${insertion}${after}`;
        appStore.updateDocumentContent(currentDoc.id, updated);

        tick().then(() => {
          const caret = (selectionStart ?? 0) + insertion.length;
          editorTextarea.selectionStart = caret;
          editorTextarea.selectionEnd = caret;
        });
        break;
      }
    }
  }

  // Format markdown tables in current document
  function handleFormatTables() {
    if (!currentDoc) return;
    const formatted = formatTables(currentDoc.content);
    appStore.updateDocumentContent(currentDoc.id, formatted);
    announce('Tables formatted');
    flashFormat = true;
    setTimeout(() => (flashFormat = false), 420);
  }

  function formatTables(markdown: string): string {
    const lines = markdown.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const isTableRow = line.includes('|');
      if (!isTableRow) {
        result.push(line);
        i += 1;
        continue;
      }

      // Collect consecutive lines that look like table rows
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }

      if (tableLines.length < 2 || !tableLines[1].match(/^-{3,}|\|\s*-{3,}/)) {
        result.push(...tableLines);
        continue;
      }

      // Split into cells and compute column widths
      const rows = tableLines.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const colCount = Math.max(...rows.map((r) => r.length));
      const widths = new Array(colCount).fill(0);
      rows.forEach((r) => {
        for (let c = 0; c < colCount; c++) {
          const cell = r[c] ?? '';
          widths[c] = Math.max(widths[c], cell.length);
        }
      });

      // Rebuild rows
      const formattedRows = rows.map((r, idx) => {
        const padded = widths.map((w, c) => {
          const cell = r[c] ?? '';
          return cell.padEnd(w, ' ');
        });
        return `| ${padded.join(' | ')} |`;
      });

      // Ensure separator row has dashes sized to column width
      if (formattedRows.length >= 2) {
        const sepCells = widths.map((w) => '-'.repeat(Math.max(3, w)));
        formattedRows[1] = `| ${sepCells.join(' | ')} |`;
      }

      result.push(...formattedRows);
    }

    return result.join('\n');
  }

  function saveEditorState(doc: Document | null) {
    if (!doc || !editorTextarea) return;
    editorStateByDoc.set(doc.id, {
      selectionStart: editorTextarea.selectionStart ?? 0,
      selectionEnd: editorTextarea.selectionEnd ?? 0,
      scrollTop: editorTextarea.scrollTop,
    });
    if (previewContainer) {
      previewScrollByDoc.set(doc.id, previewContainer.scrollTop);
    }
  }

  function restoreEditorState(doc: Document | null) {
    if (!doc || !editorTextarea) return;
    const state = editorStateByDoc.get(doc.id);
    const previewScroll = previewScrollByDoc.get(doc.id);
    if (!state && previewScroll === undefined) return;

    editorTextarea.selectionStart = state?.selectionStart ?? 0;
    editorTextarea.selectionEnd = state?.selectionEnd ?? 0;
    editorTextarea.scrollTop = state?.scrollTop ?? 0;
    if (previewContainer && previewScroll !== undefined) {
      previewContainer.scrollTop = previewScroll;
    }
    handleSelectionChange();
  }

  function announce(message: string) {
    liveMessage = '';
    tick().then(() => {
      liveMessage = message;
    });
  }

  function enhancePreviewBlocks() {
    if (!previewContainer) return;
    const codes = previewContainer.querySelectorAll('pre > code');

    codes.forEach((code) => {
      const pre = code.parentElement as HTMLElement | null;
      if (!pre || pre.dataset.enhanced === 'true') return;

      pre.dataset.enhanced = 'true';
      pre.classList.add('code-block');
      const lines = (code.textContent || '').split('\n').length;

      // Toolbar
      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'code-action copy';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code.textContent || '');
          const prev = copyBtn.textContent;
          copyBtn.textContent = 'Copied';
          setTimeout(() => (copyBtn.textContent = prev), 1400);
        } catch (err) {
          console.error('Copy failed', err);
        }
      });
      toolbar.appendChild(copyBtn);

      // Collapse toggle for long blocks
      if (lines > 12) {
        pre.classList.add('collapsible', 'collapsed');
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'code-action toggle';
        toggleBtn.textContent = 'Expand';
        toggleBtn.addEventListener('click', () => {
          const isCollapsed = pre.classList.toggle('collapsed');
          toggleBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
        });
        toolbar.appendChild(toggleBtn);
      }

      pre.insertBefore(toolbar, code);
    });

    // Make task-list checkboxes interactive (sync back to markdown)
    const checkboxes = previewContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-task-list-item]');
    checkboxes.forEach((checkbox) => {
      if (checkbox.dataset.bound === 'true') return;
      checkbox.dataset.bound = 'true';
      checkbox.addEventListener('change', () => {
        if (!currentDoc) return;
        const { selectionStart, selectionEnd, scrollTop } = editorTextarea ?? { selectionStart: 0, selectionEnd: 0, scrollTop: 0 };
        const lines = currentDoc.content.split('\n');
        const lineIndex = Array.from(previewContainer.querySelectorAll('input[type="checkbox"][data-task-list-item]')).indexOf(checkbox);
        if (lineIndex < 0) return;

        let taskCounter = -1;
        const updatedLines = lines.map((line) => {
          if (!line.match(/^\s*[-*]\s+\[( |x|X)\]/)) return line;
          taskCounter += 1;
          if (taskCounter !== lineIndex) return line;
          return line.replace(/^(\s*[-*]\s+\[)( |x|X)(\])/, `$1${checkbox.checked ? 'x' : ' '}$3`);
        });

        appStore.updateDocumentContent(currentDoc.id, updatedLines.join('\n'));
        tick().then(() => {
          if (!editorTextarea) return;
          editorTextarea.selectionStart = selectionStart ?? 0;
          editorTextarea.selectionEnd = selectionEnd ?? 0;
          editorTextarea.scrollTop = scrollTop ?? 0;
        });
      });
    });
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
    handleSelectionChange();
  }
  
  function handleNewDocument() {
    const docCount = $appStore.documents.length;
    const newName = docCount === 0 ? 'Untitled' : `Untitled ${docCount + 1}`;
    appStore.createDocument(newName, '');
    announce(`Document ${newName} created`);
    
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
    saveEditorState(currentDoc);
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
    announce(`Document ${currentDoc.name} downloaded`);
    flashDownload = true;
    setTimeout(() => (flashDownload = false), 420);
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

  function handleSelectionChange() {
    if (!editorTextarea) return;
    const { selectionStart = 0, selectionEnd = 0 } = editorTextarea;
    selectionLength = Math.abs(selectionEnd - selectionStart);
    const pos = selectionStart;
    const text = currentDoc?.content ?? '';
    const before = text.slice(0, pos);
    const lines = before.split('\n');
    caretLine = lines.length;
    caretCol = lines[lines.length - 1]?.length + 1 || 1;
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

    // Ctrl/Cmd + K: Command palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (showPalette) {
        closePalette();
      } else {
        openPalette();
      }
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
  <div class="sr-only" aria-live="polite">{liveMessage}</div>
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
                class="tab animate-fade-in"
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
        
        <button class="add-tab-btn animate-fade-in" on:click={handleNewDocument} title="New document (Ctrl+N)">
          <Plus size={16} />
        </button>
      </div>
    </div>
    
    <div class="header-actions">
      <button class="btn btn-icon animate-fade-in" class:active-accent={$appStore.wordWrap} on:click={() => appStore.toggleWordWrap()} title="Toggle word wrap (Ctrl+W)">
        <WrapText size={18} />
      </button>
      
      <button class="btn btn-icon animate-fade-in" class:flash-accent={flashFormat} on:click={handleFormatTables} title="Format tables in this document">
        <Edit3 size={18} />
      </button>
      
      <button class="btn btn-icon animate-fade-in" class:flash-accent={flashDownload} on:click={handleDownload} title="Download markdown (Ctrl+S)">
        <Download size={18} />
      </button>
      
      <button class="btn btn-icon animate-fade-in" on:click={() => appStore.toggleTheme()} title="Toggle theme (Ctrl+D)">
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
          aria-label="Markdown editor"
          value={currentDoc?.content || ''}
          on:input={handleContentChange}
          on:paste={handlePaste}
          on:scroll={handleEditorScroll}
          on:click={handleSelectionChange}
          on:keyup={handleSelectionChange}
          on:select={handleSelectionChange}
          placeholder="# Start writing your masterpiece...&#10;&#10;This editor supports full GitHub Flavored Markdown:&#10;- **Bold** and *italic* text&#10;- [Links](https://example.com)&#10;- `inline code` and code blocks&#10;- Tables, task lists, footnotes, callouts, and math ($...$, $$...$$)!"
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
      <span class="status-pill subtle">
        {$appStore.documents.length} {$appStore.documents.length === 1 ? 'document' : 'documents'}
      </span>
      {#if currentDoc}
        <span class="status-pill">
          {wordCount.toLocaleString()} words
        </span>
        <span class="status-pill">
          {currentDoc.content.length.toLocaleString()} chars
        </span>
        <span class="status-pill">
          {lineCount.toLocaleString()} lines
        </span>
        <span class="status-pill">
          Line {caretLine}, Col {caretCol}
        </span>
        {#if selectionLength > 0}
          <span class="status-pill accent">{selectionLength} selected</span>
        {/if}
      {/if}
    </div>
    <div class="status-right">
      {#if $appStore.wordWrap}
        <span class="status-pill accent">Wrap</span>
      {/if}
      <span class="status-pill success">Auto-saved</span>
      {#if currentDoc}
        <button class="status-pill ghost" class:flash-accent={flashCopyStats} on:click={copyStatusDetails}>
          Copy status
        </button>
      {/if}
    </div>
  </footer>
</main>

{#if showPalette}
  <div class="palette-backdrop" role="presentation" on:click={closePalette}></div>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="palette-input-wrap">
      <input
        bind:this={paletteInputEl}
        class="palette-input"
        type="text"
        placeholder="Type a command..."
        value={paletteFilter}
        on:input={handlePaletteInput}
        on:keydown={handlePaletteKeydown}
      />
    </div>
    <div class="palette-list">
      {#if filteredCommands.length === 0}
        <div class="palette-empty">No matches</div>
      {:else}
        {#each filteredCommands as cmd}
          <button class="palette-item" on:click={() => runPaletteCommand(cmd)}>
            <div class="palette-title">{cmd.label}</div>
            <div class="palette-desc">{cmd.desc}</div>
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

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

  /* Code toolbar and collapsible blocks */
  :global(.markdown-preview pre.code-block) {
    position: relative;
    padding-top: 3rem;
  }
  :global(.markdown-preview .code-toolbar) {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    gap: 0.5rem;
    opacity: 0;
    transform: translateY(-6px);
    transition: opacity var(--transition-base), transform var(--transition-base);
  }
  :global(.markdown-preview pre.code-block:hover .code-toolbar) {
    opacity: 1;
    transform: translateY(0);
  }
  :global(.markdown-preview .code-action) {
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    color: var(--text-secondary);
    border-radius: 6px;
    padding: 0.25em 0.6em;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  :global(.markdown-preview .code-action:hover) {
    color: var(--text-primary);
    background: var(--bg-hover);
    transform: translateY(-1px);
  }
  :global(.markdown-preview pre.collapsible) {
    max-height: none;
    overflow: visible;
  }
  :global(.markdown-preview pre.collapsible.collapsed) {
    max-height: 260px;
    overflow: hidden;
    mask-image: linear-gradient(180deg, rgba(0,0,0,1) 70%, rgba(0,0,0,0));
    -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,1) 70%, rgba(0,0,0,0));
  }
  :global(.markdown-preview .code-action.toggle) {
    min-width: 80px;
  }

  /* Gentle hover float for tabs and header buttons */
  :global(.tab),
  :global(.btn.btn-icon) {
    transition: transform var(--transition-base), box-shadow var(--transition-base);
  }
  :global(.tab:hover),
  :global(.btn.btn-icon:hover) {
    transform: translateY(-1px);
  }

  /* Resizer subtle highlight */
  :global(.resizer) {
    transition: background var(--transition-fast), box-shadow var(--transition-fast);
  }
  :global(.resizer:hover),
  :global(.resizer.active) {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-primary) 18%, transparent);
  }

  /* Screen reader only */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Command palette */
  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(2px);
    z-index: 20;
  }
  .palette {
    position: fixed;
    top: 12%;
    left: 50%;
    transform: translateX(-50%);
    width: min(720px, 92vw);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    z-index: 21;
    overflow: hidden;
    animation: fadeIn 180ms ease;
  }
  .palette-input-wrap {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .palette-input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: 0.95rem;
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  .palette-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 18%, transparent);
  }
  .palette-list {
    max-height: 360px;
    overflow-y: auto;
    padding: 8px 0;
  }
  .palette-item {
    width: 100%;
    text-align: left;
    padding: 10px 16px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background var(--transition-fast), transform var(--transition-fast);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .palette-item:hover {
    background: var(--bg-hover);
    transform: translateY(-1px);
  }
  .palette-title {
    font-weight: 600;
  }
  .palette-desc {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .palette-empty {
    padding: 16px;
    color: var(--text-secondary);
  }

  /* Tables */
  :global(.markdown-preview table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
  }
  :global(.markdown-preview th),
  :global(.markdown-preview td) {
    border: 1px solid var(--border-subtle);
    padding: 0.5em 0.75em;
    text-align: left;
  }
  :global(.markdown-preview th) {
    background: var(--bg-sidebar);
    font-weight: 600;
  }
  :global(.markdown-preview tbody tr:nth-child(odd)) {
    background: var(--bg-hover);
  }

  /* Definition lists */
  :global(.markdown-preview dl) {
    margin: 1em 0;
    padding: 0;
  }
  :global(.markdown-preview dt) {
    font-weight: 600;
    margin-top: 0.6em;
  }
  :global(.markdown-preview dd) {
    margin-left: 1em;
    color: var(--text-secondary);
  }

  /* Callouts */
  :global(.markdown-preview .callout) {
    border: 1px solid var(--border-subtle);
    border-left-width: 4px;
    border-radius: 8px;
    padding: 0.75em 1em;
    margin: 1em 0;
    background: var(--bg-hover);
  }
  :global(.markdown-preview .callout-title) {
    font-weight: 600;
    margin-bottom: 0.35em;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  :global(.markdown-preview .callout-body p:last-child) {
    margin-bottom: 0;
  }
  :global(.markdown-preview .callout.info) { border-left-color: #2f81f7; }
  :global(.markdown-preview .callout.warn),
  :global(.markdown-preview .callout.warning) { border-left-color: #f59e0b; }
  :global(.markdown-preview .callout.error) { border-left-color: #ef4444; }
  :global(.markdown-preview .callout.success) { border-left-color: #22c55e; }
  :global(.markdown-preview .callout.tip) { border-left-color: #a855f7; }

  /* Footnotes */
  :global(.markdown-preview sup a[href^="#fn"],
    .markdown-preview a[href^="#fnref"]) {
    text-decoration: none;
  }
  :global(.markdown-preview .footnotes) {
    border-top: 1px solid var(--border-subtle);
    padding-top: 0.5em;
    margin-top: 1.5em;
    color: var(--text-secondary);
  }
  :global(.markdown-preview .footnotes ol) {
    padding-left: 1.2em;
  }
  :global(.markdown-preview .footnotes li) {
    margin: 0.35em 0;
  }

  /* Math (KaTeX) */
  :global(.markdown-preview .katex-display) {
    margin: 1em 0;
    overflow-x: auto;
  }
  :global(.markdown-preview .katex-display > .katex) {
    padding: 0.75em 0.5em;
    display: inline-block;
  }
  :global(.markdown-preview .math-block) {
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 0.5em 0.75em;
    margin: 1em 0;
    overflow-x: auto;
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
    gap: 6px;
  }
  
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0.25em 0.6em;
    border-radius: 999px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    line-height: 1.2;
  }
  .status-pill.subtle {
    background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
  }
  .status-pill.accent {
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }
  .status-pill.success {
    background: color-mix(in srgb, #22c55e 14%, transparent);
    color: #15803d;
    border-color: color-mix(in srgb, #22c55e 30%, transparent);
  }
  .status-pill.ghost {
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .status-pill.ghost:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .status-pill.flash-accent {
    animation: flashAccent 420ms ease;
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent-primary) 20%, transparent);
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

  :global(.btn.btn-icon.flash-accent) {
    animation: flashAccent 420ms ease;
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }

  :global(.btn.btn-icon.active-accent) {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  }

  @keyframes flashAccent {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 30%, transparent); }
    60% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent-primary) 0%, transparent); }
    100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 0%, transparent); }
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
