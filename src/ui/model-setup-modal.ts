import { Modal, Setting, type App } from "obsidian";
import { LOCAL_MODEL_APPROXIMATE_BYTES } from "../embeddings/model-config.ts";
import type { ModelStatus } from "../embeddings/model-manager.ts";

export class ModelSetupModal extends Modal {
  private statusEl: HTMLParagraphElement | null = null;
  private progressEl: HTMLProgressElement | null = null;
  private running = false;

  constructor(
    app: App,
    private readonly onDownload: () => Promise<void>,
    private readonly onLexicalOnly: () => Promise<void>,
    private readonly onClosed: () => void
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Enable local semantic matching?");
    this.contentEl.createEl("p", {
      text: `Semantic matching downloads approximately ${formatMegabytes(LOCAL_MODEL_APPROXIMATE_BYTES)} MB of model and runtime files. Inference stays on this device, and note text is not uploaded.`
    });
    this.contentEl.createEl("p", {
      text: "Title and keyword matching continues to work without this download. The first setup takes longer; later searches reuse the cached, warmed model."
    });
    this.statusEl = this.contentEl.createEl("p", {
      cls: "semantic-links-model-status",
      text: "Nothing will download until you confirm."
    });
    this.progressEl = this.contentEl.createEl("progress", {
      cls: "semantic-links-model-progress"
    });
    this.progressEl.hidden = true;

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Use keyword matching only").onClick(() => {
          void this.run(this.onLexicalOnly);
        });
      })
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.close());
      })
      .addButton((button) => {
        button.setCta().setButtonText("Download and enable").onClick(() => {
          void this.run(this.onDownload);
        });
      });
  }

  updateStatus(status: ModelStatus): void {
    this.statusEl?.setText(status.message);
    if (this.progressEl === null) {
      return;
    }
    this.progressEl.hidden = status.state !== "loading";
    if (status.percent === null) {
      this.progressEl.removeAttribute("value");
    } else {
      this.progressEl.max = 100;
      this.progressEl.value = status.percent;
    }
  }

  override onClose(): void {
    this.onClosed();
    this.contentEl.empty();
    this.statusEl = null;
    this.progressEl = null;
    this.running = false;
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await action();
      this.close();
    } catch {
      this.running = false;
      // The model manager supplies the actionable status in the modal.
    }
  }
}

function formatMegabytes(bytes: number): string {
  return Math.round(bytes / 1_000_000).toLocaleString();
}
