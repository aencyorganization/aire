# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-03-04

### Added
- Command palette (Ctrl/Cmd+K) with searchable commands for new doc, download, word wrap, etc., plus keyboard navigation and backdrop dismiss.
- Interactive task list checkboxes in the preview that update the markdown source instantly (keeps scroll/caret positions).
- Inline ($...$) and block ($$...$$) LaTeX rendering powered by KaTeX, including CSS import.
- Code blocks gain per-block toolbar: copy button and collapse/expand toggle, both animated.
- ARIA live region announcements for key actions and aria-label on editor for screen readers.
- Per-document persistence of editor selection/caret and scroll, plus preview scroll restore when switching tabs.
- Status bar redesigned into pills showing docs, words, chars, lines, selection length (when present), wrap state, autosave state, and current caret line/column.
- "Copy status" pill to copy all stats at once with accent flash feedback.
- Enlarged/respaced task list checkboxes in preview to improve hit area and alignment.
- Subtle, smoother accent animations applied to buttons, tabs, code toolbars, and resizer interactions.

## [1.0.1] - 2025-03-03

### Added
- Word wrap toggle with keyboard shortcut (Ctrl+W)
- Visual indicator for word wrap state in status bar

### Changed
- Simplified README documentation
- License changed from MIT to GPL v3

### Removed
- Screenshots section from README
- Excessive emojis and visual noise from documentation

## [1.0.0] - 2025-03-03

### Added

- Initial release of Aire - a modern markdown editor built with Svelte + TypeScript + Vite
- Full GitHub Flavored Markdown support
- Live split-pane preview with real-time rendering
- Syntax highlighting powered by highlight.js
- Multiple document tabs for managing multiple files
- Light and dark themes for comfortable editing
- Auto-save to localStorage to prevent data loss
- Draggable editor/preview resizer for customizable workspace
- Keyboard shortcuts (Ctrl+N, Ctrl+S, Ctrl+D) for quick actions
- Tab renaming with double-click for better organization
- Download markdown files functionality
- Line numbers for easier navigation
- Responsive design for various screen sizes
