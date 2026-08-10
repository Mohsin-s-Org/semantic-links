import { Modal, Setting, type App } from "obsidian";

export class ModelRemovalModal extends Modal {
  constructor(app: App, private readonly onConfirm: () => void) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Remove the local semantic model?");
    this.contentEl.createEl("p", {
      text: "This deletes the cached model and semantic vectors. Your notes and lexical suggestions are not changed."
    });
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.close());
      })
      .addButton((button) => {
        button.setWarning().setButtonText("Remove model").onClick(() => {
          this.close();
          this.onConfirm();
        });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
