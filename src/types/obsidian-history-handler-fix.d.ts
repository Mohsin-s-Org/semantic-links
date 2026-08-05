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

  // The generic parameter must match the official class for declaration merging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PopoverSuggest<T> {
    onHistoryBack(): void;
  }
}
