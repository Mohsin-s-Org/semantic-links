import {
  PluginSettingTab,
  Setting,
  type App,
  type Plugin,
  type SettingDefinitionItem
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

type SettingKey = keyof SemanticLinksSettings & string;
type ListSettingKey = "excludedFolders" | "excludedTags";

export class SemanticLinksSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly owner: SettingsHost) {
    super(app, owner);
  }

  override getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return [
      this.heading("Suggestions"),
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
          validate: (value) => value >= MIN_DEBOUNCE_MS && value <= MAX_DEBOUNCE_MS
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
          validate: (value) => Number.isInteger(value)
            && value >= MIN_SUGGESTIONS
            && value <= MAX_SUGGESTIONS
            ? undefined
            : `Choose a whole number from ${MIN_SUGGESTIONS} to ${MAX_SUGGESTIONS}.`
        }
      },
      this.heading("Matching"),
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
          validate: (value) => value >= 0 && value <= 1
            ? undefined
            : "Choose a value from 0 to 1."
        }
      },
      this.heading("Scope"),
      this.listSetting(
        "excludedFolders",
        "Excluded folders",
        "One vault-relative folder per line or a comma-separated list.",
        "Archive\nPrivate"
      ),
      this.listSetting(
        "excludedTags",
        "Excluded tags",
        "One tag per line or a comma-separated list. A leading # is optional.",
        "private\ndraft",
        (values) => values.map((tag) => tag.replace(/^#/u, ""))
      ),
      this.heading("Link insertion"),
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

  private heading(name: string): SettingDefinitionItem<SettingKey> {
    return {
      name,
      searchable: false,
      render: (setting) => {
        setting.setName(name).setHeading();
      }
    };
  }

  private listSetting(
    key: ListSettingKey,
    name: string,
    description: string,
    placeholder: string,
    transform: (values: string[]) => string[] = (values) => values
  ): SettingDefinitionItem<SettingKey> {
    return {
      name,
      desc: description,
      render: (setting: Setting) => {
        setting.addTextArea((text) => {
          text
            .setValue(this.owner.settings[key].join("\n"))
            .setPlaceholder(placeholder)
            .onChange((value) => {
              this.owner.settings[key] = transform(normalizeDelimitedList(value));
              void this.owner.saveSettings();
            });
          text.inputEl.addClass("semantic-links-settings-list");
        });
      }
    };
  }
}
