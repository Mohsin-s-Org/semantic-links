import {
  App,
  Plugin,
  PluginSettingTab,
  Setting
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
          setting.addTextArea((text) => {
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
      },
      {
        name: "Excluded tags",
        desc: "One tag per line or a comma-separated list. A leading # is optional.",
        aliases: ["ignore tags", "tag exclusions"],
        render: (setting: Setting) => {
          setting.addTextArea((text) => {
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
