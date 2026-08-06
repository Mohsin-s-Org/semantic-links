import {
  Modal,
  Setting,
  type App
} from "obsidian";

export class DeleteIndexModal extends Modal {
  constructor(
    app: App,
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Delete local semantic index?");
    this.contentEl.createEl("p", {
      text: "This removes locally stored passages and vectors. Your notes are not changed, and the index can be rebuilt later."
    });
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setButtonText("Delete index")
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
