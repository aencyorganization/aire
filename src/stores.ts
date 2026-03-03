import { writable, derived } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';

// ============================================
// TYPES
// ============================================

export interface Document {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppState {
  documents: Document[];
  activeDocumentId: string | null;
  theme: 'light' | 'dark';
  sidebarWidth: number;
  wordWrap: boolean;
}

// ============================================
// STORAGE UTILS
// ============================================

const STORAGE_KEY = 'aire-v1';

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

const createDefaultDocument = (): Document => ({
  id: crypto.randomUUID(),
  name: 'Untitled',
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
  const defaultDoc = createDefaultDocument();
  
  const initialState: AppState = {
    documents: stored?.documents?.length ? stored.documents : [defaultDoc],
    activeDocumentId: stored?.activeDocumentId || defaultDoc.id,
    theme: stored?.theme || 'light',
    sidebarWidth: stored?.sidebarWidth || 50,
    wordWrap: stored?.wordWrap ?? true,
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      update((state) => ({
        ...state,
        documents: [...state.documents, newDoc],
        activeDocumentId: newDoc.id,
      }));
      
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
      update((state) => ({
        ...state,
        documents: state.documents.map((doc) =>
          doc.id === id
            ? { ...doc, content, updatedAt: Date.now() }
            : doc
        ),
      }));
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
          const newDoc = createDefaultDocument();
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
        };
      });
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
      const newDoc = createDefaultDocument();
      set({
        documents: [newDoc],
        activeDocumentId: newDoc.id,
        theme: 'light',
        sidebarWidth: 50,
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
