import { writable, derived } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';

// ============================================
// TYPES
// ============================================

export interface Document {
  id: string;
  name: string;
  content: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

export interface HistorySnapshot {
  content: string;
  timestamp: number;
}

export interface AppState {
  documents: Document[];
  workspaces: Workspace[];
  activeDocumentId: string | null;
  activeWorkspaceId: string;
  theme: 'light' | 'dark';
  sidebarWidth: number;
  wordWrap: boolean;
  historyByDoc: Record<string, HistorySnapshot[]>;
}

// ============================================
// STORAGE UTILS
// ============================================

const STORAGE_KEY = 'aire-v1';
const MAX_HISTORY_ENTRIES = 20;

const createDefaultWorkspace = (): Workspace => ({
  id: crypto.randomUUID(),
  name: 'Main',
  createdAt: Date.now(),
});

function loadFromStorage(): Partial<AppState> | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load from localStorage:', e);
  }
  return null;
}

function saveToStorage(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

// ============================================
// DEFAULTS
// ============================================

const createDefaultDocument = (workspaceId: string): Document => ({
  id: crypto.randomUUID(),
  name: 'Untitled',
  workspaceId,
  content: `# Welcome to Aire

This is a **modern**, _fluid_ markdown editor with full GitHub Flavored Markdown support.

## Features

- ✅ Full GFM support (tables, task lists, strikethrough)
- ✅ Syntax highlighting for code blocks
- ✅ Multiple tabs
- ✅ Light & Dark themes
- ✅ Everything auto-saved to localStorage

## Try It Out

### Code Block

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));
\`\`\`

### Table

| Feature | Status | Notes |
|---------|--------|-------|
| GFM Support | ✅ | Complete |
| Syntax Highlight | ✅ | 100+ languages |
| Themes | ✅ | Light & Dark |

### Task List

- [x] Create awesome editor
- [x] Add smooth animations
- [ ] Write documentation
- [ ] Share with friends

> "Simplicity is the ultimate sophistication." - Leonardo da Vinci

Enjoy writing! 🚀
`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// ============================================
// STORES
// ============================================

function createDocumentStore() {
  const stored = loadFromStorage();
  const defaultWorkspace = createDefaultWorkspace();
  const workspaces = stored?.workspaces?.length ? stored.workspaces : [defaultWorkspace];
  const activeWorkspaceId = stored?.activeWorkspaceId || workspaces[0].id;
  const defaultDoc = createDefaultDocument(activeWorkspaceId);
  const storedDocs = stored?.documents?.length ? stored.documents : [defaultDoc];
  const normalizedDocs = storedDocs.map((doc) => ({
    ...doc,
    workspaceId: doc.workspaceId || activeWorkspaceId,
  }));
  
  const initialState: AppState = {
    documents: normalizedDocs,
    workspaces,
    activeDocumentId: stored?.activeDocumentId || normalizedDocs[0]?.id || null,
    activeWorkspaceId,
    theme: stored?.theme || 'light',
    sidebarWidth: stored?.sidebarWidth || 50,
    wordWrap: stored?.wordWrap ?? true,
    historyByDoc: stored?.historyByDoc || {},
  };

  const { subscribe, set, update } = writable<AppState>(initialState);

  // Auto-save to localStorage
  subscribe((state) => {
    saveToStorage(state);
  });

  return {
    subscribe,
    
    // Document actions
    createDocument: (name?: string, content?: string) => {
      const newDoc: Document = {
        id: crypto.randomUUID(),
        name: name || 'Untitled',
        content: content || '',
        workspaceId: initialState.activeWorkspaceId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      update((state) => {
        const scopedDoc = { ...newDoc, workspaceId: state.activeWorkspaceId };
        return {
          ...state,
          documents: [...state.documents, scopedDoc],
          activeDocumentId: scopedDoc.id,
        };
      });
      
      return newDoc.id;
    },
    
    updateDocument: (id: string, updates: Partial<Document>) => {
      update((state) => ({
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === id
            ? { ...doc, ...updates, updatedAt: Date.now() }
            : doc
        ),
      }));
    },
    
    updateDocumentContent: (id: string, content: string) => {
      update((state) => {
        const now = Date.now();
        const previousDoc = state.documents.find((doc) => doc.id === id);
        const documents = state.documents.map((doc) =>
          doc.id === id
            ? { ...doc, content, updatedAt: now }
            : doc
        );
        const previousHistory = state.historyByDoc[id] || [];
        const shouldAppend = previousDoc && previousDoc.content !== content;
        const historyByDoc = shouldAppend
          ? {
              ...state.historyByDoc,
              [id]: [
                ...previousHistory,
                { content: previousDoc.content, timestamp: now },
              ].slice(-MAX_HISTORY_ENTRIES),
            }
          : state.historyByDoc;

        return {
          ...state,
          documents,
          historyByDoc,
        };
      });
    },

    restoreDocumentVersion: (id: string, historyIndex: number) => {
      update((state) => {
        const snapshots = state.historyByDoc[id] || [];
        const snapshot = snapshots[historyIndex];
        if (!snapshot) return state;
        return {
          ...state,
          documents: state.documents.map((doc) =>
            doc.id === id
              ? { ...doc, content: snapshot.content, updatedAt: Date.now() }
              : doc
          ),
        };
      });
    },
    
    renameDocument: (id: string, name: string) => {
      update((state) => ({
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === id
            ? { ...doc, name, updatedAt: Date.now() }
            : doc
        ),
      }));
    },
    
    deleteDocument: (id: string) => {
      update((state) => {
        const newDocuments = state.documents.filter((doc) => doc.id !== id);
        const newActiveId =
          state.activeDocumentId === id
            ? newDocuments.length > 0
              ? newDocuments[0].id
              : null
            : state.activeDocumentId;
        
        // If no documents left, create a new one
        if (newDocuments.length === 0) {
          const newDoc = createDefaultDocument(state.activeWorkspaceId);
          return {
            ...state,
            documents: [newDoc],
            activeDocumentId: newDoc.id,
          };
        }
        
        return {
          ...state,
          documents: newDocuments,
          activeDocumentId: newActiveId,
          historyByDoc: Object.fromEntries(
            Object.entries(state.historyByDoc).filter(([docId]) => docId !== id)
          ),
        };
      });
    },

    createWorkspace: (name?: string) => {
      const newWorkspace: Workspace = {
        id: crypto.randomUUID(),
        name: name?.trim() || 'New workspace',
        createdAt: Date.now(),
      };
      update((state) => ({
        ...state,
        workspaces: [...state.workspaces, newWorkspace],
        activeWorkspaceId: newWorkspace.id,
        activeDocumentId: null,
      }));
      return newWorkspace.id;
    },

    setActiveWorkspace: (workspaceId: string) => {
      update((state) => {
        const docsInWorkspace = state.documents.filter((doc) => doc.workspaceId === workspaceId);
        const activeDocumentStillVisible = docsInWorkspace.some((doc) => doc.id === state.activeDocumentId);
        return {
          ...state,
          activeWorkspaceId: workspaceId,
          activeDocumentId: activeDocumentStillVisible ? state.activeDocumentId : docsInWorkspace[0]?.id || null,
        };
      });
    },

    renameWorkspace: (workspaceId: string, name: string) => {
      update((state) => ({
        ...state,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, name: name.trim() || workspace.name } : workspace
        ),
      }));
    },

    moveDocumentToWorkspace: (docId: string, workspaceId: string) => {
      update((state) => ({
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === docId ? { ...doc, workspaceId, updatedAt: Date.now() } : doc
        ),
      }));
    },
    
    setActiveDocument: (id: string) => {
      update((state) => ({
        ...state,
        activeDocumentId: id,
      }));
    },
    
    // Tab reordering
    reorderDocuments: (newOrder: Document[]) => {
      update((state) => ({
        ...state,
        documents: newOrder,
      }));
    },
    
    // Theme
    toggleTheme: () => {
      update((state) => ({
        ...state,
        theme: state.theme === 'light' ? 'dark' : 'light',
      }));
    },
    
    setTheme: (theme: 'light' | 'dark') => {
      update((state) => ({
        ...state,
        theme,
      }));
    },
    
    // Sidebar width
    setSidebarWidth: (width: number) => {
      update((state) => ({
        ...state,
        sidebarWidth: Math.max(20, Math.min(80, width)),
      }));
    },

    // Word wrap
    toggleWordWrap: () => {
      update((state) => ({
        ...state,
        wordWrap: !state.wordWrap,
      }));
    },

    setWordWrap: (enabled: boolean) => {
      update((state) => ({
        ...state,
        wordWrap: enabled,
      }));
    },

    // Reset
    reset: () => {
      const newWorkspace = createDefaultWorkspace();
      const newDoc = createDefaultDocument(newWorkspace.id);
      set({
        documents: [newDoc],
        workspaces: [newWorkspace],
        activeDocumentId: newDoc.id,
        activeWorkspaceId: newWorkspace.id,
        theme: 'light',
        sidebarWidth: 50,
        wordWrap: true,
        historyByDoc: {},
      });
    },
  };
}

export const appStore = createDocumentStore();

// Derived stores
export const activeDocument: Readable<Document | null> = derived(
  appStore,
  ($appStore) =>
    $appStore.documents.find((doc) => doc.id === $appStore.activeDocumentId) || null
);

export const documentCount: Readable<number> = derived(
  appStore,
  ($appStore) => $appStore.documents.length
);

export const hasUnsavedChanges: Readable<boolean> = derived(
  appStore,
  () => false // Always auto-saved
);
