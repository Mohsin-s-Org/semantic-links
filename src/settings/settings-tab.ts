import {
  PluginSettingTab,
  Setting,
  type App,
  type Plugin
} from "obsidian";
import {
  MAX_DEBOUNCE_MS,
  MAX_SUGGESTIONS,
  MIN_DEBOUNCE_MS,
  MIN_SUGGESTIONS
} from "../constants.ts";
import { normalizeDelimitedList } from "../utils/validation.ts";
import type { SemanticLinksSettings } from "./types.ts";

type SettingsHost = Plugin & {
  settings: SemanticLinksSettings;
  saveSettings(): Promise<void>;
};

export class SemanticLinksSettingTab extends PluginSettingTab {
  private readonly owner: SettingsHost;

  constructor(app: App, plugin: SettingsHost) {
    super(app, plugin);
    this.owner = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Suggestions").setHeading();
    new Setting(containerEl)
      .setName("Automatic suggestions")
      .setDesc("Evaluate the active writing context after a short pause. Nothing is inserted without confirmation.")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.automaticSuggestions)
        .onChange((value) => {
          this.owner.settings.automaticSuggestions = value;
          void this.owner.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Debounce delay")
      .setDesc("Milliseconds to wait after editing before a request may begin.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_DEBOUNCE_MS);
        text.inputEl.max = String(MAX_DEBOUNCE_MS);
        text
          .setValue(String(this.owner.settings.debounceMs))
          .onChange((value) => {
            const parsed = Number(value);
            if (Number.isInteger(parsed)
              && parsed >= MIN_DEBOUNCE_MS
              && parsed <= MAX_DEBOUNCE_MS) {
              this.owner.settings.debounceMs = parsed;
              void this.owner.saveSettings();
            }
          });
      });
    new Setting(containerEl)
      .setName("Maximum suggestions")
      .setDesc("Maximum number of candidates shown for one anchor.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(MIN_SUGGESTIONS);
        text.inputEl.max = String(MAX_SUGGESTIONS);
        text
          .setValue(String(this.owner.settings.maxSuggestions))
          .onChange((value) => {
            const parsed = Number(value);
            if (Number.isInteger(parsed)
              && parsed >= MIN_SUGGESTIONS
              && parsed <= MAX_SUGGESTIONS) {
              this.owner.settings.maxSuggestions = parsed;
              void this.owner.saveSettings();
            }
          });
      });

    new Setting(containerEl).setName("Matching").setHeading();
    new Setting(containerEl)
      .setName("Lexical matching")
      .setDesc("Use titles, aliases and normalized terms. This remains available without a model.")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.lexicalMatchingEnabled)
        .onChange((value) => {
          this.owner.settings.lexicalMatchingEnabled = value;
          void this.owner.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Semantic indexing")
      .setDesc("Reserve semantic matching for the later local-model phase. Phase 1 stores the preference but performs no model work.")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.semanticIndexingEnabled)
        .onChange((value) => {
          this.owner.settings.semanticIndexingEnabled = value;
          void this.owner.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Minimum confidence")
      .setDesc("Hide candidates below this normalized score.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.max = "1";
        text.inputEl.step = "0.05";
        text
          .setValue(String(this.owner.settings.minimumConfidence))
          .onChange((value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
              this.owner.settings.minimumConfidence = parsed;
              void this.owner.saveSettings();
            }
          });
      });

    new Setting(containerEl).setName("Scope").setHeading();
    this.renderExcludedFolders(new Setting(containerEl));
    this.renderExcludedTags(new Setting(containerEl));

    new Setting(containerEl).setName("Link insertion").setHeading();
    new Setting(containerEl)
      .setName("Link path style")
      .setDesc("Use Obsidian's shortest unambiguous link text or the target's full vault path.")
      .addDropdown((dropdown) => dropdown
        .addOption("shortest", "Shortest unambiguous path")
        .addOption("full", "Full vault path")
        .setValue(this.owner.settings.linkPathMode)
        .onChange((value) => {
          if (value === "shortest" || value === "full") {
            this.owner.settings.linkPathMode = value;
            void this.owner.saveSettings();
          }
        }));
  }

  getSettingDefinitions() {
    return [
      this.createHeading("Suggestions"),
      {
        name: "Automatic suggestions",
        desc: "Evaluate the active writing context after a short pause. Nothing is inserted without confirmation.",
        aliases: ["suggest while typing", "automatic links"],
        control: {
          type: "toggle",
          key: "automaticSuggestions",
          defaultValue: true
        }
      },
      {
        name: "Debounce delay",
        desc: "Milliseconds to wait after editing before a request may begin.",
        aliases: ["typing delay", "suggestion delay"],
        control: {
          type: "number",
          key: "debounceMs",
          defaultValue: 350,
          validate: (value: number) => value >= MIN_DEBOUNCE_MS && value <= MAX_DEBOUNCE_MS
            ? undefined
            : `Choose a value from ${MIN_DEBOUNCE_MS} to ${MAX_DEBOUNCE_MS}.`
        }
      },
      {
        name: "Maximum suggestions",
        desc: "Maximum number of candidates shown for one anchor.",
        aliases: ["result limit", "candidate count"],
        control: {
          type: "number",
          key: "maxSuggestions",
          defaultValue: 6,
          validate: (value: number) => Number.isInteger(value)
            && value >= MIN_SUGGESTIONS
            && value <= MAX_SUGGESTIONS
            ? undefined
            : `Choose a whole number from ${MIN_SUGGESTIONS} to ${MAX_SUGGESTIONS}.`
        }
      },
      this.createHeading("Matching"),
      {
        name: "Lexical matching",
        desc: "Use titles, aliases and normalized terms. This remains available without a model.",
        aliases: ["title matching", "alias matching"],
        control: {
          type: "toggle",
          key: "lexicalMatchingEnabled",
          defaultValue: true
        }
      },
      {
        name: "Semantic indexing",
        desc: "Reserve semantic matching for the later local-model phase. Phase 1 stores the preference but performs no model work.",
        aliases: ["embeddings", "model matching"],
        control: {
          type: "toggle",
          key: "semanticIndexingEnabled",
          defaultValue: false
        }
      },
      {
        name: "Minimum confidence",
        desc: "Hide candidates below this normalized score.",
        aliases: ["confidence threshold", "minimum score"],
        control: {
          type: "number",
          key: "minimumConfidence",
          defaultValue: 0.55,
          validate: (value: number) => value >= 0 && value <= 1
            ? undefined
            : "Choose a value from 0 to 1."
        }
      },
      this.createHeading("Scope"),
      {
        name: "Excluded folders",
        desc: "One vault-relative folder per line or a comma-separated list.",
        aliases: ["ignore folders", "folder exclusions"],
        render: (setting: Setting) => {
          this.renderExcludedFolders(setting);
        }
      },
      {
        name: "Excluded tags",
        desc: "One tag per line or a comma-separated list. A leading # is optional.",
        aliases: ["ignore tags", "tag exclusions"],
        render: (setting: Setting) => {
          this.renderExcludedTags(setting);
        }
      },
      this.createHeading("Link insertion"),
      {
        name: "Link path style",
        desc: "Use Obsidian's shortest unambiguous link text or the target's full vault path.",
        aliases: ["wikilink path", "shortest path"],
        control: {
          type: "dropdown",
          key: "linkPathMode",
          defaultValue: "shortest",
          options: {
            shortest: "Shortest unambiguous path",
            full: "Full vault path"
          }
        }
      }
    ];
  }

  private renderExcludedFolders(setting: Setting): void {
    setting
      .setName("Excluded folders")
      .setDesc("One vault-relative folder per line or a comma-separated list.")
      .addTextArea((text) => {
        text
          .setValue(this.owner.settings.excludedFolders.join("\n"))
          .setPlaceholder("Archive\nPrivate")
          .onChange((value) => {
            this.owner.settings.excludedFolders = normalizeDelimitedList(value);
            void this.owner.saveSettings();
          });
        text.inputEl.addClass("semantic-links-settings-list");
      });
  }

  private renderExcludedTags(setting: Setting): void {
    setting
      .setName("Excluded tags")
      .setDesc("One tag per line or a comma-separated list. A leading # is optional.")
      .addTextArea((text) => {
        text
          .setValue(this.owner.settings.excludedTags.join("\n"))
          .setPlaceholder("private\ndraft")
          .onChange((value) => {
            this.owner.settings.excludedTags = normalizeDelimitedList(value)
              .map((tag) => tag.replace(/^#/u, ""));
            void this.owner.saveSettings();
          });
        text.inputEl.addClass("semantic-links-settings-list");
      });
  }

  private createHeading(name: string) {
    return {
      name,
      searchable: false,
      render: (setting: Setting) => {
        setting.setName(name).setHeading();
      }
    };
  }
}
