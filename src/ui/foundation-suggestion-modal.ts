import {
  SuggestModal,
  type App,
  type TFile
} from "obsidian";

export class FoundationSuggestionModal extends SuggestModal<TFile> {
  constructor(
    app: App,
    private readonly candidates: readonly TFile[],
    private readonly onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder("Choose a note to link");
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "insert link" },
      { command: "esc", purpose: "close" }
    ]);
  }

  getSuggestions(query: string): TFile[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) {
      return [...this.candidates];
    }

    return this.candidates.filter((file) => file.path
      .toLocaleLowerCase()
      .includes(normalizedQuery));
  }

  renderSuggestion(file: TFile, element: HTMLElement): void {
    element.addClass("semantic-links-suggestion");
    const body = element.createDiv();
    body.createDiv({
      cls: "semantic-links-suggestion__title",
      text: file.basename
    });
    body.createDiv({
      cls: "semantic-links-suggestion__reason",
      text: `Foundation candidate · ${file.path}`
    });
  }

  onChooseSuggestion(file: TFile): void {
    this.onChoose(file);
  }
}
