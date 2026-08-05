import "obsidian";

// Obsidian 1.13.1 declares these classes as HistoryHandler implementations
// without declaring the required method. Remove this merge after the official
// package includes the missing instance members.
declare module "obsidian" {
  interface Menu {
    onHistoryBack(): void;
  }

  interface Modal {
    onHistoryBack(): void;
  }

  interface PopoverSuggest<T> {
    onHistoryBack(): void;
  }
}
